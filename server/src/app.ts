import type { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg, MatchHistoryEntry } from '@legendsclash/shared';
import { Store, type UserRecord } from './store.js';
import { MatchmakingQueue } from './matchmaking.js';
import { RoomManager, ROOM_SEATS, type RoomPlayer } from './rooms.js';
import { Match, GameError, type EngineResult, type MatchPlayer } from './game/engine.js';
import { applyElo, leagueOf } from './elo.js';
import { filterText, MAX_CHAT_LENGTH } from './wordfilter.js';

/**
 * Orquestra sessões WebSocket: autenticação, fila, salas, chat e partidas.
 * O estado de jogo vive exclusivamente aqui (servidor autoritativo).
 */

const QUEUE_TICK_MS = 2000;

/** Nome exibido a terceiros — contas com onboarding pendente têm nome vazio. */
function displayName(u: UserRecord): string {
  return u.name || 'Jogador';
}

export class App {
  private sockets = new Map<string, WebSocket>(); // userId → conexão ativa
  private socketUser = new WeakMap<WebSocket, string>();
  private queue = new MatchmakingQueue();
  private rooms = new RoomManager();
  private matches = new Map<string, Match>(); // userId → partida ativa
  private recentChat = new Map<string, string[]>(); // userId → últimas mensagens (contexto de report)
  private queueTimer: NodeJS.Timeout;

  constructor(private store: Store) {
    this.queueTimer = setInterval(() => this.tickQueue(), QUEUE_TICK_MS);
  }

  // ─── Conexão e autenticação ─────────────────────────────────────

  handleConnection(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return this.send(ws, { t: 'error', message: 'Mensagem inválida.' });
      }
      try {
        this.handleMessage(ws, msg);
      } catch (err) {
        const message = err instanceof GameError || err instanceof Error
          ? err.message
          : 'Erro interno.';
        this.send(ws, { t: 'error', message });
        if (!(err instanceof GameError) && !(err instanceof KnownError)) console.error(err);
      }
    });
    ws.on('close', () => this.handleClose(ws));
  }

  private handleMessage(ws: WebSocket, msg: ClientMsg): void {
    if (msg.t === 'hello') return this.handleHello(ws, msg.token);

    const userId = this.socketUser.get(ws);
    if (!userId) throw new KnownError('Sessão não autenticada.');
    const user = this.store.userById(userId);
    if (!user) throw new KnownError('Usuário não encontrado.');

    switch (msg.t) {
      case 'queue:join': return this.queueJoin(user);
      case 'queue:leave': return this.queueLeave(user);
      case 'room:create': return this.roomCreate(user);
      case 'room:join': return this.roomJoin(user, msg.code);
      case 'room:leave': return this.roomLeave(user);
      case 'room:start': return this.roomStart(user);
      case 'chat:send': return this.chatSend(user, msg.text);
      case 'chat:mute': return this.chatMute(user, msg.playerId, true);
      case 'chat:unmute': return this.chatMute(user, msg.playerId, false);
      case 'chat:report': return this.chatReport(user, msg.playerId, msg.reason);
      case 'game:play': return this.withMatch(user, (m) => m.playCard(user.id, msg.iid, msg.target));
      case 'game:attack': return this.withMatch(user, (m) => m.attack(user.id, msg.attackerIid, msg.target));
      case 'game:endTurn': return this.withMatch(user, (m) => m.endTurn(user.id));
      case 'game:surrender': return this.withMatch(user, (m) => m.surrender(user.id));
      case 'leaderboard:get': return this.sendLeaderboard(user);
      case 'history:get':
        return this.sendTo(user.id, { t: 'history', entries: user.history });
    }
  }

  private handleHello(ws: WebSocket, token: string): void {
    const user = this.store.userBySession(token);
    if (!user) return this.send(ws, { t: 'error', message: 'Sessão expirada. Entre novamente.' });

    // Uma conexão ativa por usuário: a nova substitui a antiga.
    const old = this.sockets.get(user.id);
    if (old && old !== ws) old.close();
    this.sockets.set(user.id, ws);
    this.socketUser.set(ws, user.id);

    this.send(ws, { t: 'hello:ok', profile: this.store.profileOf(user) });

    // Reconexão a partida em andamento (janela anti-abandono de 2 min)
    const match = this.matches.get(user.id);
    if (match && !match.finished) {
      match.handleReconnect(user.id);
      this.send(ws, { t: 'game:state', view: match.viewFor(user.id) });
      return;
    }
    const room = this.rooms.roomOf(user.id);
    if (room) this.send(ws, { t: 'room:state', room: this.rooms.toState(room) });
  }

  private handleClose(ws: WebSocket): void {
    const userId = this.socketUser.get(ws);
    if (!userId) return;
    if (this.sockets.get(userId) !== ws) return; // conexão antiga substituída

    this.sockets.delete(userId);
    this.queue.leave(userId);

    const match = this.matches.get(userId);
    if (match && !match.finished) {
      match.handleDisconnect(userId);
      return; // permanece na partida durante a janela de reconexão
    }
    const room = this.rooms.leave(userId);
    if (room) this.broadcastRoom(room.code);
  }

  // ─── Fila / matchmaking ─────────────────────────────────────────

  private queueJoin(user: UserRecord): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    if (this.rooms.roomOf(user.id)) throw new KnownError('Saia da sala antes de entrar na fila.');
    this.queue.join(user.id, user.mmr);
    this.sendTo(user.id, { t: 'queue:status', inQueue: true, size: this.queue.size });
  }

  private queueLeave(user: UserRecord): void {
    this.queue.leave(user.id);
    this.sendTo(user.id, { t: 'queue:status', inQueue: false, size: this.queue.size });
  }

  private tickQueue(): void {
    for (const [a, b] of this.queue.tick()) {
      const ua = this.store.userById(a.userId);
      const ub = this.store.userById(b.userId);
      if (!ua || !ub) continue;
      this.startMatch([ua, ub]);
    }
  }

  // ─── Salas (lobby + convite por link) ───────────────────────────

  private asRoomPlayer(u: UserRecord): RoomPlayer {
    return { id: u.id, name: displayName(u), avatar: u.avatar, mmr: u.mmr };
  }

  private roomCreate(user: UserRecord): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    this.queue.leave(user.id);
    this.rooms.leave(user.id);
    const room = this.rooms.create(this.asRoomPlayer(user));
    this.broadcastRoom(room.code);
  }

  private roomJoin(user: UserRecord, code: string): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    this.queue.leave(user.id);
    try {
      const room = this.rooms.join(code, this.asRoomPlayer(user));
      this.broadcastRoom(room.code);
    } catch (err) {
      throw new KnownError((err as Error).message);
    }
  }

  private roomLeave(user: UserRecord): void {
    const room = this.rooms.leave(user.id);
    this.sendTo(user.id, { t: 'room:state', room: null });
    if (room) this.broadcastRoom(room.code);
  }

  private roomStart(user: UserRecord): void {
    const room = this.rooms.roomOf(user.id);
    if (!room) throw new KnownError('Você não está em uma sala.');
    if (room.hostId !== user.id) throw new KnownError('Apenas o anfitrião pode iniciar.');
    if (room.members.length < ROOM_SEATS) {
      throw new KnownError('Aguarde os assentos serem preenchidos.');
    }
    const players = room.members
      .map((m) => this.store.userById(m.id))
      .filter((u): u is UserRecord => !!u);
    this.rooms.dissolve(room.code);
    for (const p of players) this.sendTo(p.id, { t: 'room:state', room: null });
    this.startMatch(players);
  }

  private broadcastRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const state = this.rooms.toState(room);
    for (const m of room.members) this.sendTo(m.id, { t: 'room:state', room: state });
  }

  // ─── Partidas ───────────────────────────────────────────────────

  private startMatch(users: UserRecord[]): void {
    const players: MatchPlayer[] = users.map((u) => ({
      id: u.id, name: displayName(u), avatar: u.avatar, mmr: u.mmr,
    }));
    let match: Match;
    match = new Match(
      players,
      () => this.broadcastMatch(match),
      (result) => this.finishMatch(match, result),
    );
    for (const u of users) this.matches.set(u.id, match);
    match.start();
  }

  private withMatch(user: UserRecord, fn: (m: Match) => void): void {
    const match = this.matches.get(user.id);
    if (!match || match.finished) throw new KnownError('Você não está em uma partida.');
    fn(match);
  }

  private broadcastMatch(match: Match): void {
    for (const pid of match.playerIds()) {
      this.sendTo(pid, { t: 'game:state', view: match.viewFor(pid) });
    }
  }

  private finishMatch(match: Match, result: EngineResult): void {
    const ids = match.playerIds();
    const winnerId = ids[result.winnerSeat];
    const loserId = ids.find((id) => id !== winnerId)!;
    const winner = this.store.userById(winnerId)!;
    const loser = this.store.userById(loserId)!;

    const before = { winner: winner.mmr, loser: loser.mmr };
    const after = applyElo(winner.mmr, loser.mmr);

    const entryFor = (won: boolean, opp: UserRecord, delta: number): MatchHistoryEntry => ({
      matchId: match.id,
      opponentName: displayName(opp),
      opponentId: opp.id,
      won,
      reason: result.reason,
      mmrDelta: delta,
      turns: result.turns,
      durationMs: result.durationMs,
      endedAt: Date.now(),
    });

    this.store.recordMatch(winnerId, entryFor(true, loser, after.winner - before.winner), after.winner, true);
    this.store.recordMatch(loserId, entryFor(false, winner, after.loser - before.loser), after.loser, false);

    const mmr = {
      [winnerId]: {
        before: before.winner, after: after.winner,
        delta: after.winner - before.winner, league: leagueOf(after.winner),
      },
      [loserId]: {
        before: before.loser, after: after.loser,
        delta: after.loser - before.loser, league: leagueOf(after.loser),
      },
    };

    this.broadcastMatch(match); // estado final
    for (const pid of ids) {
      this.matches.delete(pid);
      this.sendTo(pid, {
        t: 'game:over',
        result: {
          matchId: match.id, winnerId, reason: result.reason,
          turns: result.turns, durationMs: result.durationMs, mmr,
        },
      });
      const u = this.store.userById(pid);
      if (u) this.sendTo(pid, { t: 'profile', profile: this.store.profileOf(u) });
    }
    match.dispose();
  }

  // ─── Chat (filtro, mute e report — slide "MVP — 90 dias") ───────

  private chatSend(user: UserRecord, rawText: string): void {
    const text = filterText(String(rawText).slice(0, MAX_CHAT_LENGTH).trim());
    if (!text) return;

    const recent = this.recentChat.get(user.id) ?? [];
    recent.push(text);
    this.recentChat.set(user.id, recent.slice(-10));

    const recipients = this.chatRecipients(user.id);
    if (!recipients.length) throw new KnownError('Você não está em uma sala ou partida.');

    const message = {
      from: { id: user.id, name: displayName(user), avatar: user.avatar },
      text,
      at: Date.now(),
    };
    for (const rid of recipients) {
      const r = this.store.userById(rid);
      if (r?.muted.includes(user.id)) continue; // silenciado pelo destinatário
      this.sendTo(rid, { t: 'chat:message', message });
    }
  }

  private chatRecipients(userId: string): string[] {
    const match = this.matches.get(userId);
    if (match) return match.playerIds();
    const room = this.rooms.roomOf(userId);
    if (room) return room.members.map((m) => m.id);
    return [];
  }

  private chatMute(user: UserRecord, targetId: string, muted: boolean): void {
    this.store.setMuted(user.id, targetId, muted);
    this.sendTo(user.id, { t: 'profile', profile: this.store.profileOf(user) });
  }

  private chatReport(user: UserRecord, targetId: string, reason: string): void {
    this.store.addReport({
      reporterId: user.id,
      reportedId: targetId,
      reason: String(reason).slice(0, 500),
      context: (this.recentChat.get(targetId) ?? []).join(' | '),
      at: Date.now(),
    });
    this.sendTo(user.id, { t: 'chat:report:ok' });
  }

  // ─── Ranking ────────────────────────────────────────────────────

  private sendLeaderboard(user: UserRecord): void {
    const entries = this.store.leaderboard().map((u) => ({
      id: u.id, name: displayName(u), avatar: u.avatar, mmr: u.mmr,
      league: leagueOf(u.mmr), wins: u.wins, losses: u.losses,
    }));
    this.sendTo(user.id, { t: 'leaderboard', entries });
  }

  // ─── Infra ──────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendTo(userId: string, msg: ServerMsg): void {
    const ws = this.sockets.get(userId);
    if (ws) this.send(ws, msg);
  }

  dispose(): void {
    clearInterval(this.queueTimer);
  }
}

/** Erros esperados de fluxo (não são bugs — não vão para o console). */
class KnownError extends Error {}
