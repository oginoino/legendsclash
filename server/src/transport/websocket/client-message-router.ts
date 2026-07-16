import type { ClientMsg, ServerMsg } from '@legendsclash/shared';
import type { Match } from '../../game/engine.js';
import type { UserRecord } from '../../store.js';

export type AuthenticatedClientMessage = Exclude<ClientMsg, { t: 'hello' } | { t: 'ping' }>;

interface MatchmakingCommands {
  join(user: UserRecord): void;
  leave(user: UserRecord): void;
}

interface RoomCommands {
  create(user: UserRecord): void;
  join(user: UserRecord, code: string): void;
  leave(user: UserRecord): void;
  start(user: UserRecord): void;
}

interface ChatCommands {
  send(user: UserRecord, text: string): void;
  sendTaunt(user: UserRecord, id: string): void;
  setMuted(user: UserRecord, playerId: string, muted: boolean): void;
  report(user: UserRecord, playerId: string, reason: string): void;
}

interface SocialCommands {
  requestRematch(user: UserRecord): void;
  declineRematch(user: UserRecord): void;
  setFriend(user: UserRecord, playerId: string, friend: boolean): void;
  getProfile(user: UserRecord, playerId: string): void;
}

export interface ClientMessageRouterDependencies {
  matchmaking: MatchmakingCommands;
  rooms: RoomCommands;
  chat: ChatCommands;
  social: SocialCommands;
  updateProfile(user: UserRecord, message: Extract<ClientMsg, { t: 'profile:update' }>): void;
  startPractice(user: UserRecord): void;
  withMatch(user: UserRecord, action: (match: Match) => void): void;
  matchFor(userId: string): Match | undefined;
  sendLeaderboard(user: UserRecord): Promise<void>;
  sendTo(userId: string, message: ServerMsg): void;
  pickFaction(user: UserRecord, factionId: string): void;
}

/** Encaminha apenas intenções já autenticadas para os coordenadores de domínio. */
export class ClientMessageRouter {
  constructor(private readonly dependencies: ClientMessageRouterDependencies) {}

  route(user: UserRecord, message: AuthenticatedClientMessage): void {
    const { matchmaking, rooms, chat, social } = this.dependencies;

    switch (message.t) {
      case 'profile:update':
        return this.dependencies.updateProfile(user, message);
      case 'queue:join':
        return matchmaking.join(user);
      case 'queue:leave':
        return matchmaking.leave(user);
      case 'practice:start':
        return this.dependencies.startPractice(user);
      case 'room:create':
        return rooms.create(user);
      case 'room:join':
        return rooms.join(user, message.code);
      case 'room:leave':
        return rooms.leave(user);
      case 'room:start':
        return rooms.start(user);
      case 'chat:send':
        return chat.send(user, message.text);
      case 'chat:taunt':
        return chat.sendTaunt(user, message.id);
      case 'chat:mute':
        return chat.setMuted(user, message.playerId, true);
      case 'chat:unmute':
        return chat.setMuted(user, message.playerId, false);
      case 'chat:report':
        return chat.report(user, message.playerId, message.reason);
      case 'game:mulligan':
        return this.dependencies.withMatch(user, (match) => match.mulligan(user.id, message.iids));
      case 'game:tutorial': {
        // Sinal de UI idempotente: ao desmontar/reconectar a partida pode ja ter acabado.
        const match = this.dependencies.matchFor(user.id);
        if (match && !match.finished) match.setTutorialOpen(user.id, message.open === true);
        return;
      }
      case 'game:play':
        return this.dependencies.withMatch(user, (match) => (
          match.playCard(user.id, message.iid, message.target)
        ));
      case 'game:attack':
        return this.dependencies.withMatch(user, (match) => (
          match.attack(user.id, message.attackerIid, message.target)
        ));
      case 'game:endTurn':
        return this.dependencies.withMatch(user, (match) => match.endTurn(user.id));
      case 'game:surrender':
        return this.dependencies.withMatch(user, (match) => match.surrender(user.id));
      case 'leaderboard:get':
        void this.dependencies.sendLeaderboard(user);
        return;
      case 'history:get':
        return this.dependencies.sendTo(user.id, { t: 'history', entries: user.history });
      case 'rematch:request':
        return social.requestRematch(user);
      case 'rematch:decline':
        return social.declineRematch(user);
      case 'friend:add':
        return social.setFriend(user, message.playerId, true);
      case 'friend:remove':
        return social.setFriend(user, message.playerId, false);
      case 'profile:get':
        return social.getProfile(user, message.playerId);
      case 'faction:pick':
        return this.dependencies.pickFaction(user, message.factionId);
    }
  }
}
