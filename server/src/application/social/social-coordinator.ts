import type { Profile, PublicProfile, ServerMsg } from '@legendsclash/shared';
import type { UserRecord } from '../../store.js';
import { RateLimiter } from '../../ratelimit.js';
import { ApplicationError } from '../application-error.js';

/** Dependência mínima de persistência exigida pela continuidade social. */
export interface SocialStore {
  userById(id: string): UserRecord | undefined;
  setFriend(userId: string, friendId: string, add: boolean): void;
  profileOf(user: UserRecord): Profile;
  publicProfileOf(user: UserRecord): PublicProfile;
}

export interface SocialCoordinatorDependencies {
  store: SocialStore;
  participantsFor(userId: string): string[];
  isOnline(userId: string): boolean;
  isInMatch(userId: string): boolean;
  startMatch(users: UserRecord[]): void;
  sendTo(userId: string, message: ServerMsg): void;
}

export class SocialError extends ApplicationError {}

/**
 * Coordena revanche, amizades e acesso ao perfil público sem conhecer sockets,
 * salas ou a implementação das partidas.
 */
export class SocialCoordinator {
  private recentOpponents = new Map<string, string[]>();
  private pendingRematches = new Map<string, { opponentId: string; at: number }>();
  private limiter = new RateLimiter(4, 0.5);

  constructor(private readonly dependencies: SocialCoordinatorDependencies) {}

  /** Registra os encontros mais recentes que habilitam as ações pós-partida. */
  recordOpponents(playerIds: string[]): void {
    for (const playerId of playerIds) {
      const opponents = playerIds.filter((candidate) => candidate !== playerId);
      const recent = [...opponents, ...(this.recentOpponents.get(playerId) ?? [])];
      this.recentOpponents.set(playerId, [...new Set(recent)].slice(0, 10));
    }
  }

  requestRematch(user: UserRecord): void {
    if (!this.limiter.take(user.id)) return;
    if (this.dependencies.isInMatch(user.id)) {
      throw new SocialError('Termine a partida atual primeiro.');
    }

    const opponentId = (this.recentOpponents.get(user.id) ?? [])[0];
    const opponent = opponentId ? this.dependencies.store.userById(opponentId) : undefined;
    if (
      !opponent
      || !this.dependencies.isOnline(opponent.id)
      || this.dependencies.isInMatch(opponent.id)
    ) {
      this.dependencies.sendTo(user.id, { t: 'rematch:state', status: 'unavailable' });
      return;
    }

    const opponentRequest = this.pendingRematches.get(opponent.id);
    if (opponentRequest?.opponentId === user.id) {
      this.pendingRematches.delete(opponent.id);
      this.pendingRematches.delete(user.id);
      this.dependencies.startMatch([user, opponent]);
      return;
    }

    this.pendingRematches.set(user.id, { opponentId: opponent.id, at: Date.now() });
    this.dependencies.sendTo(user.id, { t: 'rematch:state', status: 'sent' });
    this.dependencies.sendTo(opponent.id, {
      t: 'rematch:state',
      status: 'incoming',
      from: {
        id: user.id,
        name: user.name || 'Jogador',
        avatar: user.avatar,
        photo: user.photo,
      },
    });
  }

  declineRematch(user: UserRecord): void {
    for (const [requesterId, request] of this.pendingRematches) {
      if (request.opponentId !== user.id) continue;
      this.pendingRematches.delete(requesterId);
      this.dependencies.sendTo(requesterId, { t: 'rematch:state', status: 'declined' });
    }
  }

  setFriend(user: UserRecord, friendId: string, add: boolean): void {
    if (!this.limiter.take(user.id)) return;
    if (add && !this.knows(user.id, friendId)) {
      throw new SocialError('Só dá para adicionar quem você enfrentou.');
    }
    this.dependencies.store.setFriend(user.id, friendId, add);
    this.dependencies.sendTo(user.id, {
      t: 'profile',
      profile: this.dependencies.store.profileOf(user),
    });
  }

  getProfile(user: UserRecord, targetId: string): void {
    if (!this.limiter.take(user.id)) return;
    const target = this.dependencies.store.userById(targetId);
    if (!target) throw new SocialError('Jogador não encontrado.');
    const appearsInRanking = !target.guest && target.wins + target.losses > 0;
    if (!this.knows(user.id, targetId) && !appearsInRanking) {
      throw new SocialError('Perfil ainda não está disponível publicamente.');
    }
    this.dependencies.sendTo(user.id, {
      t: 'profile:view',
      profile: this.dependencies.store.publicProfileOf(target),
    });
  }

  /** Limpa estado efêmero relacionado à conexão encerrada. */
  forget(userId: string): void {
    this.limiter.forget(userId);
    this.pendingRematches.delete(userId);
    for (const [requesterId, request] of this.pendingRematches) {
      if (request.opponentId === userId) this.pendingRematches.delete(requesterId);
    }
  }

  private knows(userId: string, otherId: string): boolean {
    if (userId === otherId) return false;
    if (this.dependencies.participantsFor(userId).includes(otherId)) return true;
    if ((this.recentOpponents.get(userId) ?? []).includes(otherId)) return true;
    return this.dependencies.store.userById(userId)?.friends.includes(otherId) ?? false;
  }
}
