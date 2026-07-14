import type { RoomState, ServerMsg } from '@legendsclash/shared';
import { ROOM_SEATS, RoomManager, type RoomPlayer } from '../../rooms.js';
import type { Store, UserRecord } from '../../store.js';
import { ApplicationError } from '../application-error.js';

export type RoomStore = Pick<Store, 'userById'>;

export interface RoomCoordinatorDependencies {
  store: RoomStore;
  isInMatch(userId: string): boolean;
  removeFromQueue(userId: string): void;
  startMatch(users: UserRecord[]): void;
  sendTo(userId: string, message: ServerMsg): void;
}

export class RoomError extends ApplicationError {}

/** Coordena salas privadas sem conhecer sockets, fila ou implementação de partidas. */
export class RoomCoordinator {
  private readonly rooms = new RoomManager();

  constructor(private readonly dependencies: RoomCoordinatorDependencies) {}

  has(userId: string): boolean {
    return !!this.rooms.roomOf(userId);
  }

  participantsFor(userId: string): string[] {
    return this.rooms.roomOf(userId)?.members.map((member) => member.id) ?? [];
  }

  stateFor(userId: string): RoomState | null {
    const room = this.rooms.roomOf(userId);
    return room ? this.rooms.toState(room) : null;
  }

  sync(userId: string): void {
    this.dependencies.sendTo(userId, { t: 'room:state', room: this.stateFor(userId) });
  }

  create(user: UserRecord): void {
    this.assertAvailable(user.id);
    this.dependencies.removeFromQueue(user.id);
    this.rooms.leave(user.id);
    const room = this.rooms.create(this.asRoomPlayer(user));
    this.broadcast(room.code);
  }

  join(user: UserRecord, code: string): void {
    this.assertAvailable(user.id);
    this.dependencies.removeFromQueue(user.id);
    try {
      const room = this.rooms.join(code, this.asRoomPlayer(user));
      this.broadcast(room.code);
    } catch (error) {
      throw new RoomError(error instanceof Error ? error.message : 'Não foi possível entrar na sala.');
    }
  }

  leave(user: UserRecord): void {
    const room = this.rooms.leave(user.id);
    this.dependencies.sendTo(user.id, { t: 'room:state', room: null });
    if (room) this.broadcast(room.code);
  }

  start(user: UserRecord): void {
    const room = this.rooms.roomOf(user.id);
    if (!room) throw new RoomError('Você não está em uma sala.');
    if (room.hostId !== user.id) throw new RoomError('Apenas o anfitrião pode iniciar.');
    if (room.members.length < ROOM_SEATS) {
      throw new RoomError('Aguarde os assentos serem preenchidos.');
    }

    const players = room.members
      .map((member) => this.dependencies.store.userById(member.id))
      .filter((candidate): candidate is UserRecord => !!candidate);
    this.rooms.dissolve(room.code);
    for (const player of players) {
      this.dependencies.sendTo(player.id, { t: 'room:state', room: null });
    }
    this.dependencies.startMatch(players);
  }

  /** Fecha a participação quando não há partida protegendo a reconexão. */
  disconnect(userId: string): void {
    const room = this.rooms.leave(userId);
    if (room) this.broadcast(room.code);
  }

  /** Treino e troca de sala removem o vínculo sem emitir uma intenção de saída. */
  remove(userId: string): void {
    this.rooms.leave(userId);
  }

  private assertAvailable(userId: string): void {
    if (this.dependencies.isInMatch(userId)) {
      throw new RoomError('Você já está em uma partida.');
    }
  }

  private asRoomPlayer(user: UserRecord): RoomPlayer {
    return {
      id: user.id,
      name: user.name || 'Jogador',
      avatar: user.avatar,
      photo: user.photo,
      mmr: user.mmr,
    };
  }

  private broadcast(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const state = this.rooms.toState(room);
    for (const member of room.members) {
      this.dependencies.sendTo(member.id, { t: 'room:state', room: state });
    }
  }
}
