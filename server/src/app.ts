import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { FACTION_TILTS } from '@legendsclash/shared';
import { contentFlags } from './content.js';
import type { ClientMsg, ServerMsg, LeaderboardEntry, Profile } from '@legendsclash/shared';
import { Store, type UserRecord } from './store.js';
import { RoomManager, ROOM_SEATS, type RoomPlayer } from './rooms.js';
import { Match, GameError, type MatchSnapshot } from './game/engine.js';
import { leagueOf } from './elo.js';
import { RateLimiter } from './ratelimit.js';
import { ApplicationError } from './application/application-error.js';
import { ChatCoordinator } from './application/chat/chat-coordinator.js';
import { MatchmakingCoordinator } from './application/lobby/matchmaking-coordinator.js';
import { MatchFactory } from './application/matches/match-factory.js';
import { MatchFinalizer } from './application/matches/match-finalizer.js';
import { MatchRegistry } from './application/matches/match-registry.js';
import { SocialCoordinator } from './application/social/social-coordinator.js';

/**
 * Orquestra sessões WebSocket: autenticação, fila, salas, chat e partidas.
 * O estado de jogo vive exclusivamente aqui (servidor autoritativo).
 */

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
  private rooms = new RoomManager();
  private matches = new MatchRegistry();
  private socketIp = new WeakMap<WebSocket, string>(); // conexão → IP (anti alt-farm)
  private userIp = new Map<string, string>(); // userId → IP da conexão ativa
  // Teto geral de mensagens. Chat e ações sociais mantêm limites específicos
  // dentro dos coordenadores responsáveis por essas regras.
  private msgLimiter = new RateLimiter(50, 30); // teto geral por usuário (~30 msg/s, burst 50)
  private readonly chat: ChatCoordinator;
  private readonly matchmaking: MatchmakingCoordinator;
  private readonly matchFactory: MatchFactory;
  private readonly matchFinalizer: MatchFinalizer;
  private readonly social: SocialCoordinator;
  /** Avisa o snapshot de runtime quando o conjunto de partidas muda. */
  onMatchesChanged: (() => void) | null = null;

  constructor(private store: Store) {
    this.chat = new ChatCoordinator({
      store,
      recipientsFor: (userId) => this.interactionParticipants(userId),
      sendTo: (userId, message) => this.sendTo(userId, message),
    });
    this.social = new SocialCoordinator({
      store,
      participantsFor: (userId) => this.interactionParticipants(userId),
      isOnline: (userId) => this.sockets.has(userId),
      isInMatch: (userId) => this.matches.has(userId),
      startMatch: (users) => this.startMatch(users),
      sendTo: (userId, message) => this.sendTo(userId, message),
    });
    this.matchFinalizer = new MatchFinalizer({
      store,
      broadcastMatch: (match) => this.broadcastMatch(match),
      unregisterMatch: (match) => this.matches.unregister(match),
      recordOpponents: (playerIds) => this.social.recordOpponents(playerIds),
      sendTo: (playerId, message) => this.sendTo(playerId, message),
      onMatchesChanged: () => this.onMatchesChanged?.(),
    });
    this.matchFactory = new MatchFactory({
      flags: contentFlags,
      onUpdate: (match) => this.broadcastMatch(match),
      onRankedFinish: (match, result) => this.matchFinalizer.finishRanked(match, result),
      onPracticeFinish: (match, result) => this.matchFinalizer.finishPractice(match, result),
    });
    this.matchmaking = new MatchmakingCoordinator({
      store,
      isInMatch: (userId) => this.matches.has(userId),
      isInRoom: (userId) => !!this.rooms.roomOf(userId),
      originFor: (userId) => this.userIp.get(userId),
      startMatch: (users) => this.startMatch(users),
      sendTo: (userId, message) => this.sendTo(userId, message),
    });
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
        if (!(err instanceof GameError) && !(err instanceof ApplicationError)) {
          console.error(err);
        }
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
      case 'queue:join': return this.matchmaking.join(user);
      case 'queue:leave': return this.matchmaking.leave(user);
      case 'practice:start': return this.startPractice(user);
      case 'room:create': return this.roomCreate(user);
      case 'room:join': return this.roomJoin(user, msg.code);
      case 'room:leave': return this.roomLeave(user);
      case 'room:start': return this.roomStart(user);
      case 'chat:send': return this.chat.send(user, msg.text);
      case 'chat:taunt': return this.chat.sendTaunt(user, msg.id);
      case 'chat:mute': return this.chat.setMuted(user, msg.playerId, true);
      case 'chat:unmute': return this.chat.setMuted(user, msg.playerId, false);
      case 'chat:report': return this.chat.report(user, msg.playerId, msg.reason);
      case 'game:mulligan': return this.withMatch(user, (m) => m.mulligan(user.id, msg.iids));
      case 'game:tutorial': {
        // Sinal de UI idempotente: ao desmontar/reconectar a partida pode ja ter acabado.
        const match = this.matches.get(user.id);
        if (match && !match.finished) match.setTutorialOpen(user.id, msg.open === true);
        return;
      }
      case 'game:play': return this.withMatch(user, (m) => m.playCard(user.id, msg.iid, msg.target));
      case 'game:attack': return this.withMatch(user, (m) => m.attack(user.id, msg.attackerIid, msg.target));
      case 'game:endTurn': return this.withMatch(user, (m) => m.endTurn(user.id));
      case 'game:surrender': return this.withMatch(user, (m) => m.surrender(user.id));
      case 'leaderboard:get':
        void this.sendLeaderboard(user);
        return;
      case 'history:get':
        // convidado vê o histórico da sessão (em memória); conta, o persistido
        return this.sendTo(user.id, { t: 'history', entries: user.history });
      case 'rematch:request': return this.social.requestRematch(user);
      case 'rematch:decline': return this.social.declineRematch(user);
      case 'friend:add': return this.social.setFriend(user, msg.playerId, true);
      case 'friend:remove': return this.social.setFriend(user, msg.playerId, false);
      case 'profile:get': return this.social.getProfile(user, msg.playerId);
      case 'faction:pick': return this.factionPick(user, msg.factionId);
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

    this.send(ws, {
      t: 'hello:ok',
      profile: this.store.profileOf(user),
      content: { factions: contentFlags.factions, cosmetics: contentFlags.cosmeticsV2 },
    });
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
    this.send(ws, { t: 'queue:status', inQueue: false, size: this.matchmaking.size });
    const room = this.rooms.roomOf(user.id);
    this.send(ws, { t: 'room:state', room: room ? this.rooms.toState(room) : null });
  }

  private handleClose(ws: WebSocket): void {
    const userId = this.socketUser.get(ws);
    if (!userId) return;
    if (this.sockets.get(userId) !== ws) return; // conexão antiga substituída

    this.sockets.delete(userId);
    this.matchmaking.disconnect(userId);
    // libera os baldes de rate-limit (reconexão recomeça com balde cheio)
    this.msgLimiter.forget(userId);
    this.chat.forget(userId);
    this.social.forget(userId);
    this.userIp.delete(userId);

    const match = this.matches.get(userId);
    if (match && !match.finished) {
      // Refresh, troca de rede e suspensão do navegador são indistinguíveis
      // aqui. Treino e ranqueada usam a mesma janela para eliminar a corrida
      // entre o socket antigo fechar e o novo `hello` autenticar.
      match.handleDisconnect(userId);
      return; // permanece na partida durante a janela de reconexão
    }
    const room = this.rooms.leave(userId);
    if (room) this.broadcastRoom(room.code);
  }

  // ─── Personalização (perfil + comandante) ───────────────────────

  private profileUpdate(
    user: UserRecord,
    patch: { name?: string; avatar?: string; commander?: string; accent?: string; frame?: string; accentStyle?: string; profileCover?: string },
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
        photo: updated.photo, frame: updated.frame, accentStyle: updated.accentStyle,
      });
      this.broadcastMatch(match);
    }
  }

  /**
   * Aplica a foto de perfil (vinda da rota HTTP de upload, já validada e
   * hospedada). Persiste, devolve o perfil ao dono e reflete numa partida em
   * andamento (a foto é visível ao oponente). `photo: null` remove.
   */
  applyPhoto(userId: string, photo: string | null): Profile | undefined {
    const updated = this.store.setPhoto(userId, photo);
    if (!updated) return undefined;
    const profile = this.store.profileOf(updated);
    this.sendTo(userId, { t: 'profile', profile });
    const match = this.matches.get(userId);
    if (match && !match.finished) {
      match.updateCosmetics(userId, { photo: updated.photo });
      this.broadcastMatch(match);
    }
    return profile;
  }

  // ─── Salas (lobby + convite por link) ───────────────────────────

  private asRoomPlayer(u: UserRecord): RoomPlayer {
    return { id: u.id, name: displayName(u), avatar: u.avatar, photo: u.photo, mmr: u.mmr };
  }

  private roomCreate(user: UserRecord): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    this.matchmaking.remove(user.id);
    this.rooms.leave(user.id);
    const room = this.rooms.create(this.asRoomPlayer(user));
    this.broadcastRoom(room.code);
  }

  private roomJoin(user: UserRecord, code: string): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    this.matchmaking.remove(user.id);
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
    const { match, players, content } = this.matchFactory.createRanked(users);
    this.matches.register(match, users.map((user) => user.id));
    match.start();
    // telemetria: ordem de assentos + condições de conteúdo p/ winrate-por-condição
    this.store.recordEvent('match_start', {
      matchId: match.id,
      props: {
        seats: players.map((p, seat) => ({ seat, playerId: p.id, mmr: p.mmr })),
        content: { factions: content.factions ?? null, comeback: !!content.comeback },
      },
    });
    this.onMatchesChanged?.();
  }

  // ─── Snapshot de runtime (partidas sobrevivem a deploys) ─────────

  /** Partidas ativas, deduplicadas, em formato persistível. Treino não restaura. */
  exportMatches(): MatchSnapshot[] {
    return this.matches.exportSnapshots();
  }

  /**
   * Religa as partidas do processo anterior. Cada uma volta com os jogadores
   * desconectados; o hello de reconexão os traz de volta à batalha.
   */
  restoreMatches(snaps: MatchSnapshot[]): number {
    let restored = 0;
    for (const snap of snaps) {
      try {
        const ids = snap.seats.map((s) => s.player.id);
        if (ids.some((id) => !this.store.userById(id) || this.matches.has(id))) continue;
        const match = this.matchFactory.restoreRanked(snap);
        this.matches.register(match, ids);
        restored++;
      } catch (err) {
        console.error('[runtime] partida descartada na restauração:', err);
      }
    }
    return restored;
  }

  private withMatch(user: UserRecord, fn: (m: Match) => void): void {
    const match = this.matches.get(user.id);
    if (!match || match.finished) throw new KnownError('Você não está em uma partida.');
    fn(match);
  }

  // ─── Modo treino (vs CPU, sem MMR) ──────────────────────────────

  private startPractice(user: UserRecord): void {
    if (this.matches.has(user.id)) throw new KnownError('Você já está em uma partida.');
    this.matchmaking.remove(user.id);
    this.rooms.leave(user.id);
    const match = this.matchFactory.createPractice(user);
    // só o humano é registrado (o bot não tem socket)
    this.matches.register(match, [user.id], 'practice');
    match.start();
  }

  private broadcastMatch(match: Match): void {
    for (const pid of match.playerIds()) {
      this.sendTo(pid, { t: 'game:state', view: match.viewFor(pid) });
    }
  }

  // Os coordenadores recebem apenas os participantes do contexto atual.
  private interactionParticipants(userId: string): string[] {
    const match = this.matches.get(userId);
    if (match) return match.playerIds();
    const room = this.rooms.roomOf(userId);
    if (room) return room.members.map((m) => m.id);
    return [];
  }

  private factionPick(user: UserRecord, factionId: string): void {
    // '' = neutro; senão precisa ser uma facção conhecida (anti-lixo)
    if (factionId && !FACTION_TILTS[factionId]) throw new KnownError('Facção desconhecida.');
    const updated = this.store.setFaction(user.id, factionId);
    if (!updated) throw new KnownError('Perfil não encontrado.');
    this.sendTo(user.id, { t: 'profile', profile: this.store.profileOf(updated) });
  }

  // ─── Ranking ────────────────────────────────────────────────────

  private async sendLeaderboard(user: UserRecord): Promise<void> {
    const toEntry = (u: UserRecord): LeaderboardEntry => ({
      id: u.id, name: displayName(u), avatar: u.avatar, photo: u.photo, mmr: u.mmr,
      profileCover: u.profileCover, faction: u.faction,
      league: u.league ?? leagueOf(u.mmr), wins: u.wins, losses: u.losses,
    });
    const ranking = await this.store.rankingSnapshot(user.id);
    this.sendTo(user.id, {
      t: 'leaderboard',
      entries: ranking.entries.map(toEntry),
      myRank: ranking.myRank,
      around: ranking.around?.map(toEntry),
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

  /** Encerramento gracioso após snapshot: libera timers sem abortar partidas. */
  shutdown(): void {
    this.dispose();
  }

  dispose(): void {
    this.matchmaking.dispose();
    this.matches.dispose();
  }
}

/** Erros esperados de fluxo (não são bugs — não vão para o console). */
class KnownError extends ApplicationError {}
