import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { FACTION_TILTS } from '@legendsclash/shared';
import { contentFlags } from './content.js';
import type { LeaderboardEntry, Profile } from '@legendsclash/shared';
import { Store, type UserRecord } from './store.js';
import { Match, type MatchSnapshot } from './game/engine.js';
import { leagueOf } from './elo.js';
import { ApplicationError } from './application/application-error.js';
import { ChatCoordinator } from './application/chat/chat-coordinator.js';
import { MatchmakingCoordinator } from './application/lobby/matchmaking-coordinator.js';
import { RoomCoordinator } from './application/lobby/room-coordinator.js';
import { MatchFactory } from './application/matches/match-factory.js';
import { MatchFinalizer } from './application/matches/match-finalizer.js';
import { MatchRegistry } from './application/matches/match-registry.js';
import { SocialCoordinator } from './application/social/social-coordinator.js';
import { ClientMessageRouter } from './transport/websocket/client-message-router.js';
import { ConnectionLifecycle } from './transport/websocket/connection-lifecycle.js';

/**
 * Orquestra sessões WebSocket: autenticação, fila, salas, chat e partidas.
 * O estado de jogo vive exclusivamente aqui (servidor autoritativo).
 */

/** Nome exibido a terceiros — contas com onboarding pendente têm nome vazio. */
function displayName(u: UserRecord): string {
  return u.name || 'Jogador';
}

export class App {
  private matches = new MatchRegistry();
  private readonly chat: ChatCoordinator;
  private readonly matchmaking: MatchmakingCoordinator;
  private readonly rooms: RoomCoordinator;
  private readonly matchFactory: MatchFactory;
  private readonly matchFinalizer: MatchFinalizer;
  private readonly social: SocialCoordinator;
  private readonly messages: ClientMessageRouter;
  private readonly connections: ConnectionLifecycle;
  /** Avisa o snapshot de runtime quando o conjunto de partidas muda. */
  onMatchesChanged: (() => void) | null = null;

  constructor(private store: Store) {
    this.chat = new ChatCoordinator({
      store,
      recipientsFor: (userId) => this.interactionParticipants(userId),
      sendTo: (userId, message) => this.connections.sendTo(userId, message),
    });
    this.social = new SocialCoordinator({
      store,
      participantsFor: (userId) => this.interactionParticipants(userId),
      isOnline: (userId) => this.connections.isOnline(userId),
      isInMatch: (userId) => this.matches.has(userId),
      startMatch: (users) => this.startMatch(users),
      sendTo: (userId, message) => this.connections.sendTo(userId, message),
    });
    this.matchFinalizer = new MatchFinalizer({
      store,
      broadcastMatch: (match) => this.broadcastMatch(match),
      unregisterMatch: (match) => this.matches.unregister(match),
      recordOpponents: (playerIds) => this.social.recordOpponents(playerIds),
      sendTo: (playerId, message) => this.connections.sendTo(playerId, message),
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
      isInRoom: (userId) => this.rooms.has(userId),
      originFor: (userId) => this.connections.originFor(userId),
      startMatch: (users) => this.startMatch(users),
      sendTo: (userId, message) => this.connections.sendTo(userId, message),
    });
    this.rooms = new RoomCoordinator({
      store,
      isInMatch: (userId) => this.matches.has(userId),
      removeFromQueue: (userId) => this.matchmaking.remove(userId),
      startMatch: (users) => this.startMatch(users),
      sendTo: (userId, message) => this.connections.sendTo(userId, message),
    });
    this.messages = new ClientMessageRouter({
      matchmaking: this.matchmaking,
      rooms: this.rooms,
      chat: this.chat,
      social: this.social,
      updateProfile: (user, message) => this.profileUpdate(user, message),
      startPractice: (user) => this.startPractice(user),
      withMatch: (user, action) => this.withMatch(user, action),
      matchFor: (userId) => this.matches.get(userId),
      sendLeaderboard: (user) => this.sendLeaderboard(user),
      sendTo: (userId, message) => this.connections.sendTo(userId, message),
      pickFaction: (user, factionId) => this.factionPick(user, factionId),
    });
    this.connections = new ConnectionLifecycle({
      resolveSession: (token) => store.userBySession(token),
      resolveUser: (userId) => store.userById(userId),
      profileFor: (user) => store.profileOf(user),
      content: { factions: contentFlags.factions, cosmetics: contentFlags.cosmeticsV2 },
      recordSessionStart: (user) => {
        store.recordEvent('session_start', { userId: user.id, props: { guest: user.guest } });
      },
      matchFor: (userId) => this.matches.get(userId),
      queueSize: () => this.matchmaking.size,
      syncRoom: (userId) => this.rooms.sync(userId),
      disconnectQueue: (userId) => this.matchmaking.disconnect(userId),
      disconnectRoom: (userId) => this.rooms.disconnect(userId),
      forgetChat: (userId) => this.chat.forget(userId),
      forgetSocial: (userId) => this.social.forget(userId),
      routeMessage: (user, message) => this.messages.route(user, message),
    });
  }

  // Fachada pública preservada para o WebSocketServer em index.ts.
  handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    this.connections.handleConnection(socket, request);
  }

  // ─── Personalização (perfil + comandante) ───────────────────────

  private profileUpdate(
    user: UserRecord,
    patch: { name?: string; avatar?: string; commander?: string; accent?: string; frame?: string; accentStyle?: string; profileCover?: string },
  ): void {
    const updated = this.store.updateCosmetics(user.id, patch);
    if (!updated) throw new KnownError('Perfil não encontrado.');
    this.connections.sendTo(user.id, { t: 'profile', profile: this.store.profileOf(updated) });
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
    this.connections.sendTo(userId, { t: 'profile', profile });
    const match = this.matches.get(userId);
    if (match && !match.finished) {
      match.updateCosmetics(userId, { photo: updated.photo });
      this.broadcastMatch(match);
    }
    return profile;
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
    this.rooms.remove(user.id);
    const match = this.matchFactory.createPractice(user);
    // só o humano é registrado (o bot não tem socket)
    this.matches.register(match, [user.id], 'practice');
    match.start();
  }

  private broadcastMatch(match: Match): void {
    for (const pid of match.playerIds()) {
      this.connections.sendTo(pid, { t: 'game:state', view: match.viewFor(pid) });
    }
  }

  // Os coordenadores recebem apenas os participantes do contexto atual.
  private interactionParticipants(userId: string): string[] {
    const match = this.matches.get(userId);
    if (match) return match.playerIds();
    return this.rooms.participantsFor(userId);
  }

  private factionPick(user: UserRecord, factionId: string): void {
    // '' = neutro; senão precisa ser uma facção conhecida (anti-lixo)
    if (factionId && !FACTION_TILTS[factionId]) throw new KnownError('Facção desconhecida.');
    const updated = this.store.setFaction(user.id, factionId);
    if (!updated) throw new KnownError('Perfil não encontrado.');
    this.connections.sendTo(user.id, { t: 'profile', profile: this.store.profileOf(updated) });
  }

  // ─── Ranking ────────────────────────────────────────────────────

  private async sendLeaderboard(user: UserRecord): Promise<void> {
    const toEntry = (u: UserRecord): LeaderboardEntry => ({
      id: u.id, name: displayName(u), avatar: u.avatar, photo: u.photo, mmr: u.mmr,
      profileCover: u.profileCover, faction: u.faction,
      league: u.league ?? leagueOf(u.mmr), wins: u.wins, losses: u.losses,
    });
    const ranking = await this.store.rankingSnapshot(user.id);
    this.connections.sendTo(user.id, {
      t: 'leaderboard',
      entries: ranking.entries.map(toEntry),
      myRank: ranking.myRank,
      around: ranking.around?.map(toEntry),
    });
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
