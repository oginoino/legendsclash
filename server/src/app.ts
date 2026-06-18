import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { TAUNTS, achievementsOf } from '@legendsclash/shared';
import type { ClientMsg, ServerMsg, MatchHistoryEntry, League, LeaderboardEntry } from '@legendsclash/shared';
import { Store, type UserRecord } from './store.js';
import { MatchmakingQueue } from './matchmaking.js';
import { RoomManager, ROOM_SEATS, type RoomPlayer } from './rooms.js';
import { Match, GameError, type EngineResult, type MatchPlayer } from './game/engine.js';
import { applyElo, leagueOf } from './elo.js';
import { filterText, MAX_CHAT_LENGTH } from './wordfilter.js';
import { RateLimiter } from './ratelimit.js';

/**
 * Orquestra sessões WebSocket: autenticação, fila, salas, chat e partidas.
 * O estado de jogo vive exclusivamente aqui (servidor autoritativo).
 */

const QUEUE_TICK_MS = 2000;
/** Nº de denunciantes distintos por alvo que sinaliza revisão (moderação). */
const REPORT_FLAG_THRESHOLD = 3;

/**
 * IP do cliente para a guarda anti alt-farm. Atrás do Caddy (produção) o IP real
 * vem em X-Forwarded-For; loopback (dev/e2e) é tratado como desconhecido para não
 * confundir dois jogadores locais com a mesma origem.
 */
function clientIp(req?: IncomingMessage): string {
  if (!req) return '';
  const xff = req.headers['x-forwarded-for'];
  const fwd = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0].trim();
  if (fwd) return fwd;
  const ra = req.socket.remoteAddress ?? '';
  return /^(::1$|::ffff:127\.|127\.)/.test(ra) ? '' : ra;
}

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
  private socketIp = new WeakMap<WebSocket, string>(); // conexão → IP (anti alt-farm)
  private userIp = new Map<string, string>(); // userId → IP da conexão ativa
  private reportsByTarget = new Map<string, Set<string>>(); // denunciado → denunciantes distintos
  // Rate-limits por usuário (token bucket): defesa autoritativa contra flood/DoS
  // e spam de provocação — os cooldowns do cliente são só UX.
  private msgLimiter = new RateLimiter(50, 30); // teto geral por usuário (~30 msg/s, burst 50)
  private chatLimiter = new RateLimiter(5, 1); // chat livre: ~1 msg/s, burst 5
  private tauntLimiter = new RateLimiter(1, 0.4); // provocação: ~1 a cada 2,5 s
  private queueTimer: NodeJS.Timeout;

  constructor(private store: Store) {
    this.queueTimer = setInterval(() => this.tickQueue(), QUEUE_TICK_MS);
  }

  // ─── Conexão e autenticação ─────────────────────────────────────

  handleConnection(ws: WebSocket, req?: IncomingMessage): void {
    const ip = clientIp(req);
    if (ip) this.socketIp.set(ws, ip);
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
    // keepalive: responde antes da exigência de autenticação
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'hello') return this.handleHello(ws, msg.token);

    const userId = this.socketUser.get(ws);
    if (!userId) throw new KnownError('Sessão não autenticada.');
    const user = this.store.userById(userId);
    if (!user) throw new KnownError('Usuário não encontrado.');

    // Teto geral anti-flood por usuário (DoS barato). Generoso o bastante para
    // não tocar no jogo normal (um humano fica muito abaixo); acima do limite,
    // descarta em silêncio para não realimentar o atacante.
    if (!this.msgLimiter.take(userId)) return;

    switch (msg.t) {
      case 'profile:update': return this.profileUpdate(user, msg);
      case 'queue:join': return this.queueJoin(user);
      case 'queue:leave': return this.queueLeave(user);
      case 'room:create': return this.roomCreate(user);
      case 'room:join': return this.roomJoin(user, msg.code);
      case 'room:leave': return this.roomLeave(user);
      case 'room:start': return this.roomStart(user);
      case 'chat:send': return this.chatSend(user, msg.text);
      case 'chat:taunt': return this.tauntSend(user, msg.id);
      case 'chat:mute': return this.chatMute(user, msg.playerId, true);
      case 'chat:unmute': return this.chatMute(user, msg.playerId, false);
      case 'chat:report': return this.chatReport(user, msg.playerId, msg.reason);
      case 'game:mulligan': return this.withMatch(user, (m) => m.mulligan(user.id, msg.iids));
      case 'game:play': return this.withMatch(user, (m) => m.playCard(user.id, msg.iid, msg.target));
      case 'game:attack': return this.withMatch(user, (m) => m.attack(user.id, msg.attackerIid, msg.target));
      case 'game:endTurn': return this.withMatch(user, (m) => m.endTurn(user.id));
      case 'game:surrender': return this.withMatch(user, (m) => m.surrender(user.id));
      case 'leaderboard:get': return this.sendLeaderboard(user);
      case 'history:get':
        // convidado vê o histórico da sessão (em memória); conta, o persistido
        return this.sendTo(user.id, { t: 'history', entries: user.history });
    }
  }

  private handleHello(ws: WebSocket, token: string): void {
    const user = this.store.userBySession(token);
    if (!user) return this.send(ws, { t: 'error', message: 'Sessão expirada. Entre novamente.' });

    // Uma conexão ativa por usuário: a nova substitui a antiga. O código 4001
    // diz à aba antiga para NÃO reconectar sozinha — senão as duas abas
    // entram num cabo de guerra infinito de reconexões.
    const old = this.sockets.get(user.id);
    if (old && old !== ws) old.close(4001, 'Conexão substituída por outra aba/dispositivo.');
    this.sockets.set(user.id, ws);
    this.socketUser.set(ws, user.id);
    const ip = this.socketIp.get(ws);
    if (ip) this.userIp.set(user.id, ip);

    this.send(ws, { t: 'hello:ok', profile: this.store.profileOf(user) });
    this.store.recordEvent('session_start', { userId: user.id, props: { guest: user.guest } });

    // Reconexão a partida em andamento (janela anti-abandono de 2 min)
    const match = this.matches.get(user.id);
    if (match && !match.finished) {
      match.handleReconnect(user.id);
      this.send(ws, { t: 'game:state', view: match.viewFor(user.id) });
      return;
    }
    // Verdade completa pós-(re)conexão: sem isso, quem reconecta após um
    // restart do servidor fica preso numa batalha/sala/fila fantasma.
    this.send(ws, { t: 'game:state', view: null });
    this.send(ws, { t: 'queue:status', inQueue: false, size: this.queue.size });
    const room = this.rooms.roomOf(user.id);
    this.send(ws, { t: 'room:state', room: room ? this.rooms.toState(room) : null });
  }

  private handleClose(ws: WebSocket): void {
    const userId = this.socketUser.get(ws);
    if (!userId) return;
    if (this.sockets.get(userId) !== ws) return; // conexão antiga substituída

    this.sockets.delete(userId);
    const wasQueued = this.queue.has(userId);
    this.queue.leave(userId);
    if (wasQueued) this.store.recordEvent('queue_abandon', { userId });
    // libera os baldes de rate-limit (reconexão recomeça com balde cheio)
    this.msgLimiter.forget(userId);
    this.chatLimiter.forget(userId);
    this.tauntLimiter.forget(userId);
    this.userIp.delete(userId);

    const match = this.matches.get(userId);
    if (match && !match.finished) {
      match.handleDisconnect(userId);
      return; // permanece na partida durante a janela de reconexão
    }
    const room = this.rooms.leave(userId);
    if (room) this.broadcastRoom(room.code);
  }

  // ─── Personalização (perfil + comandante) ───────────────────────

  private profileUpdate(
    user: UserRecord,
    patch: { name?: string; avatar?: string; commander?: string; accent?: string },
  ): void {
    const updated = this.store.updateCosmetics(user.id, patch);
    if (!updated) throw new KnownError('Perfil não encontrado.');
    this.sendTo(user.id, { t: 'profile', profile: this.store.profileOf(updated) });
    // reflete a personalização na partida em andamento (cosmético, sem regras)
    const match = this.matches.get(user.id);
    if (match && !match.finished) {
      match.updateCosmetics(user.id, {
        name: updated.name, avatar: updated.avatar,
        commander: updated.commander, accent: updated.accent,
      });
      this.broadcastMatch(match);
    }
  }

  // ─── Fila / matchmaking ─────────────────────────────────────────

  private queueJoin(user: UserRecord): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    if (this.rooms.roomOf(user.id)) throw new KnownError('Saia da sala antes de entrar na fila.');
    this.queue.join(user.id, user.mmr);
    this.store.recordEvent('queue_join', { userId: user.id, props: { mmr: user.mmr } });
    this.broadcastQueue(); // o recém-chegado e quem já esperava veem o novo estado
  }

  private queueLeave(user: UserRecord): void {
    const wasQueued = this.queue.has(user.id);
    this.queue.leave(user.id);
    if (wasQueued) this.store.recordEvent('queue_leave', { userId: user.id });
    this.sendTo(user.id, { t: 'queue:status', inQueue: false, size: this.queue.size });
    this.broadcastQueue(); // quem continua pode ter ficado sozinho
  }

  private tickQueue(): void {
    // anti alt-farm: não pareia dois da mesma origem (IP conhecido e igual)
    const sameOrigin = (a: { userId: string }, b: { userId: string }): boolean => {
      const ia = this.userIp.get(a.userId);
      return !!ia && ia === this.userIp.get(b.userId);
    };
    for (const [a, b] of this.queue.tick(undefined, sameOrigin)) {
      const ua = this.store.userById(a.userId);
      const ub = this.store.userById(b.userId);
      if (!ua || !ub) continue;
      this.startMatch([ua, ub]);
    }
    this.broadcastQueue(); // remanescentes (ex.: ímpar sozinho) recebem waitingAlone
  }

  /**
   * Difunde o estado da fila a todos que aguardam: tamanho e se estão sozinhos.
   * waitingAlone vira a rota de escape da 1ª sessão — em vez de um spinner sem
   * fim, o cliente sugere criar uma sala e convidar um amigo.
   */
  private broadcastQueue(): void {
    const size = this.queue.size;
    const waitingAlone = size === 1;
    for (const uid of this.queue.userIds()) {
      this.sendTo(uid, { t: 'queue:status', inQueue: true, size, waitingAlone });
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
      id: u.id, name: displayName(u), avatar: u.avatar,
      commander: u.commander, accent: u.accent, mmr: u.mmr,
    }));
    // Sorteia a ordem dos assentos: sem isso, o seat 0 (que joga primeiro) seria
    // sempre o de menor MMR do par, porque o matchmaking ordena a fila por MMR —
    // a vantagem de iniciativa ficaria correlacionada ao rating. Fisher–Yates com
    // aleatoriedade do servidor (mesma garantia anti-cheat do embaralhamento de deck).
    for (let i = players.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [players[i], players[j]] = [players[j], players[i]];
    }
    let match: Match;
    match = new Match(
      players,
      () => this.broadcastMatch(match),
      (result) => this.finishMatch(match, result),
      undefined, // turnSeconds: usa o padrão (TURN_SECONDS)
      true, // habilita a fase de mulligan (troca de mão) antes do turno 1
    );
    for (const u of users) this.matches.set(u.id, match);
    match.start();
    // telemetria: ordem de assentos (sorteada) p/ derivar winrate por assento
    this.store.recordEvent('match_start', {
      matchId: match.id,
      props: { seats: players.map((p, seat) => ({ seat, playerId: p.id, mmr: p.mmr })) },
    });
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
    const winner = this.store.userById(winnerId)!;
    const loserIds = ids.filter((id) => id !== winnerId);
    const winnerBefore = winner.mmr;

    // Quem concluiu a 1ª partida — capturado ANTES de recordMatch incrementar V/D.
    const firstTimers = ids.filter((id) => {
      const u = this.store.userById(id);
      return !!u && u.wins + u.losses === 0;
    });
    // Conquistas ANTES da partida, para detectar as recém-obtidas (celebração).
    const achBefore: Record<string, string[]> = {};
    for (const id of ids) {
      const u = this.store.userById(id);
      achBefore[id] = u ? achievementsOf(u.wins, u.wins + u.losses) : [];
    }

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

    // Elo é pareado contra o rating do vencedor ANTES da partida; o vencedor
    // acumula o ganho de cada perdedor. Em 1v1 (N=2) é idêntico ao Elo clássico;
    // em N>2 (arquitetura N-player) nenhum perdedor fica sem registro de derrota
    // nem ajuste de MMR — antes só um perdedor era contabilizado.
    const mmr: Record<string, { before: number; after: number; delta: number; league: League }> = {};
    let winnerGain = 0;
    let toughestLoser = this.store.userById(loserIds[0])!;
    for (const loserId of loserIds) {
      const loser = this.store.userById(loserId);
      if (!loser) continue;
      const loserBefore = loser.mmr;
      const after = applyElo(winnerBefore, loserBefore);
      const loserDelta = after.loser - loserBefore;
      winnerGain += after.winner - winnerBefore;
      if (loserBefore >= toughestLoser.mmr) toughestLoser = loser;
      this.store.recordMatch(loserId, entryFor(false, winner, loserDelta), after.loser, false);
      mmr[loserId] = {
        before: loserBefore, after: after.loser,
        delta: loserDelta, league: leagueOf(after.loser),
      };
    }

    const winnerAfter = winnerBefore + winnerGain;
    this.store.recordMatch(winnerId, entryFor(true, toughestLoser, winnerGain), winnerAfter, true);
    mmr[winnerId] = {
      before: winnerBefore, after: winnerAfter,
      delta: winnerGain, league: leagueOf(winnerAfter),
    };

    this.store.recordEvent('match_end', {
      matchId: match.id,
      props: {
        winnerId, winnerSeat: result.winnerSeat, reason: result.reason,
        turns: result.turns, durationMs: result.durationMs,
        deltas: Object.fromEntries(Object.entries(mmr).map(([id, m]) => [id, m.delta])),
      },
    });
    for (const id of firstTimers) {
      this.store.recordEvent('first_match_completed', {
        userId: id, matchId: match.id, props: { won: id === winnerId },
      });
    }

    // conquistas recém-obtidas nesta partida (celebração no fim)
    const unlocked: Record<string, string[]> = {};
    for (const id of ids) {
      const u = this.store.userById(id);
      if (!u) continue;
      const fresh = achievementsOf(u.wins, u.wins + u.losses).filter((a) => !achBefore[id].includes(a));
      if (fresh.length) unlocked[id] = fresh;
    }

    this.broadcastMatch(match); // estado final
    for (const pid of ids) {
      this.matches.delete(pid);
      this.sendTo(pid, {
        t: 'game:over',
        result: {
          matchId: match.id, winnerId, reason: result.reason,
          turns: result.turns, durationMs: result.durationMs, mmr, unlocked,
        },
      });
      const u = this.store.userById(pid);
      if (u) this.sendTo(pid, { t: 'profile', profile: this.store.profileOf(u) });
    }
    match.dispose();
  }

  // ─── Chat (filtro, mute e report — slide "MVP — 90 dias") ───────

  private chatSend(user: UserRecord, rawText: string): void {
    // chat é restrito à sala/partida (efêmero) — convidados participam normalmente
    const text = filterText(String(rawText).slice(0, MAX_CHAT_LENGTH).trim());
    if (!text) return;
    // flood: acima do limite, descarta em silêncio (o cliente também throttla)
    if (!this.chatLimiter.take(user.id)) return;
    this.deliverChat(user, text);
  }

  /**
   * Provocação tipada: só aceita ids do catálogo TAUNTS e aplica o cooldown no
   * servidor. O cooldown do cliente (GameView) é só UX — um socket cru o ignora,
   * então o limite que conta vive aqui.
   */
  private tauntSend(user: UserRecord, id: string): void {
    const taunt = TAUNTS.find((t) => t.id === id);
    if (!taunt) throw new KnownError('Provocação inválida.');
    if (!this.tauntLimiter.take(user.id)) return; // dentro do cooldown: descarta
    this.deliverChat(user, taunt.text);
  }

  /** Entrega uma mensagem ao chat da sala/partida, respeitando mute do destinatário. */
  private deliverChat(user: UserRecord, text: string): void {
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
    if (targetId === user.id) return; // silenciar a si mesmo não faz sentido
    this.store.setMuted(user.id, targetId, muted);
    this.sendTo(user.id, { t: 'profile', profile: this.store.profileOf(user) });
  }

  private chatReport(user: UserRecord, targetId: string, reason: string): void {
    // valida o alvo: sem auto-denúncia e só quem está na mesma sala/partida
    // (evita poluição da base e report-bombing de ids arbitrários)
    if (targetId === user.id) throw new KnownError('Você não pode se denunciar.');
    if (!this.chatRecipients(user.id).includes(targetId)) {
      throw new KnownError('Só dá para denunciar quem está na sua sala ou partida.');
    }
    // alívio imediato: silencia o denunciado para o denunciante (atalho do mute)
    this.store.setMuted(user.id, targetId, true);
    this.store.addReport({
      reporterId: user.id,
      reportedId: targetId,
      reason: String(reason).slice(0, 500),
      context: (this.recentChat.get(targetId) ?? []).join(' | '),
      at: Date.now(),
    });
    // sinal de volume: denunciantes DISTINTOS por alvo (fecha o ciclo da denúncia)
    const reporters = this.reportsByTarget.get(targetId) ?? new Set<string>();
    reporters.add(user.id);
    this.reportsByTarget.set(targetId, reporters);
    if (reporters.size >= REPORT_FLAG_THRESHOLD) {
      console.warn(`[moderação] ${targetId} acumulou ${reporters.size} denunciantes distintos — revisar`);
    }
    this.sendTo(user.id, { t: 'chat:report:ok' });
  }

  // ─── Ranking ────────────────────────────────────────────────────

  private sendLeaderboard(user: UserRecord): void {
    const toEntry = (u: UserRecord): LeaderboardEntry => ({
      id: u.id, name: displayName(u), avatar: u.avatar, mmr: u.mmr,
      league: leagueOf(u.mmr), wins: u.wins, losses: u.losses,
    });
    const entries = this.store.leaderboard().map(toEntry);
    const rv = this.store.rankView(user.id); // posição + vizinhos (alvo de subida)
    this.sendTo(user.id, {
      t: 'leaderboard',
      entries,
      myRank: rv?.rank,
      around: rv?.around.map(toEntry),
    });
  }

  // ─── Infra ──────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendTo(userId: string, msg: ServerMsg): void {
    const ws = this.sockets.get(userId);
    if (ws) this.send(ws, msg);
  }

  /**
   * Encerramento gracioso (SIGTERM/restart de deploy): tira os jogadores das
   * partidas em andamento de volta ao menu SEM perda de Elo — a partida foi
   * interrompida pelo servidor, não perdida —, em vez de sumir junto com o
   * processo (que deixava os clientes pendurados até a reconexão).
   */
  shutdown(): void {
    for (const match of new Set(this.matches.values())) {
      if (match.finished) continue;
      for (const pid of match.playerIds()) {
        this.store.recordEvent('match_aborted', { userId: pid, matchId: match.id });
        this.sendTo(pid, { t: 'game:state', view: null });
      }
      match.dispose();
    }
    this.matches.clear();
    this.dispose();
  }

  dispose(): void {
    clearInterval(this.queueTimer);
  }
}

/** Erros esperados de fluxo (não são bugs — não vão para o console). */
class KnownError extends Error {}
