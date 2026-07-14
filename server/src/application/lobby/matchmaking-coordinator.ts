import type { ServerMsg } from '@legendsclash/shared';
import { MatchmakingQueue, type QueueEntry } from '../../matchmaking.js';
import type { Store, UserRecord } from '../../store.js';
import { ApplicationError } from '../application-error.js';

export type MatchmakingStore = Pick<Store, 'recordEvent' | 'userById'>;

export interface MatchmakingCoordinatorDependencies {
  store: MatchmakingStore;
  isInMatch(userId: string): boolean;
  isInRoom(userId: string): boolean;
  originFor(userId: string): string | undefined;
  startMatch(users: UserRecord[]): void;
  sendTo(userId: string, message: ServerMsg): void;
  tickMs?: number;
}

export class MatchmakingError extends ApplicationError {}

/** Coordena fila, pareamento periódico e telemetria sem conhecer sockets ou salas. */
export class MatchmakingCoordinator {
  private readonly queue = new MatchmakingQueue();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly dependencies: MatchmakingCoordinatorDependencies) {
    this.timer = setInterval(() => this.tick(), dependencies.tickMs ?? 2_000);
  }

  get size(): number {
    return this.queue.size;
  }

  join(user: UserRecord): void {
    if (this.dependencies.isInMatch(user.id)) {
      throw new MatchmakingError('Você já está em uma partida.');
    }
    if (this.dependencies.isInRoom(user.id)) {
      throw new MatchmakingError('Saia da sala antes de entrar na fila.');
    }
    this.queue.join(user.id, user.mmr);
    this.dependencies.store.recordEvent('queue_join', {
      userId: user.id,
      props: { mmr: user.mmr },
    });
    this.broadcast();
  }

  leave(user: UserRecord): void {
    const wasQueued = this.queue.has(user.id);
    this.queue.leave(user.id);
    if (wasQueued) this.dependencies.store.recordEvent('queue_leave', { userId: user.id });
    this.dependencies.sendTo(user.id, {
      t: 'queue:status',
      inQueue: false,
      size: this.queue.size,
    });
    this.broadcast();
  }

  /** Remove da fila ao fechar o socket, preservando a semântica de abandono. */
  disconnect(userId: string): void {
    const wasQueued = this.queue.has(userId);
    this.queue.leave(userId);
    if (wasQueued) this.dependencies.store.recordEvent('queue_abandon', { userId });
  }

  /** Sala e treino retiram o jogador sem gerar uma segunda intenção analítica. */
  remove(userId: string): void {
    this.queue.leave(userId);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private tick(): void {
    const sameOrigin = (first: QueueEntry, second: QueueEntry): boolean => {
      const origin = this.dependencies.originFor(first.userId);
      return !!origin && origin === this.dependencies.originFor(second.userId);
    };
    for (const [first, second] of this.queue.tick(undefined, sameOrigin)) {
      const firstUser = this.dependencies.store.userById(first.userId);
      const secondUser = this.dependencies.store.userById(second.userId);
      if (!firstUser || !secondUser) continue;
      this.dependencies.startMatch([firstUser, secondUser]);
    }
    this.broadcast();
  }

  private broadcast(): void {
    const size = this.queue.size;
    const waitingAlone = size === 1;
    for (const userId of this.queue.userIds()) {
      this.dependencies.sendTo(userId, {
        t: 'queue:status',
        inQueue: true,
        size,
        waitingAlone,
      });
    }
  }
}
