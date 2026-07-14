import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@legendsclash/shared';
import {
  RoomCoordinator,
  RoomError,
  type RoomStore,
} from '../src/application/lobby/room-coordinator.js';
import type { UserRecord } from '../src/store.js';

function user(id: string, name = id): UserRecord {
  return {
    id,
    email: '',
    name,
    avatar: 'shield',
    commander: 'shield',
    accent: '#4f8cff',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    profileCover: 'default',
    faction: '',
    authUserId: null,
    guest: true,
    mmr: 1000,
    league: 'Bronze',
    wins: 0,
    losses: 0,
    muted: [],
    friends: [],
    history: [],
    createdAt: 0,
    streak: 0,
    lastPlayDay: 0,
  };
}

function setup(initialUsers: UserRecord[]) {
  const users = new Map(initialUsers.map((candidate) => [candidate.id, candidate]));
  const inMatch = new Set<string>();
  const removedFromQueue: string[] = [];
  const started: UserRecord[][] = [];
  const sent: Array<{ userId: string; message: ServerMsg }> = [];
  const store: RoomStore = { userById: (id) => users.get(id) };
  const rooms = new RoomCoordinator({
    store,
    isInMatch: (userId) => inMatch.has(userId),
    removeFromQueue: (userId) => removedFromQueue.push(userId),
    startMatch: (players) => started.push(players),
    sendTo: (userId, message) => sent.push({ userId, message }),
  });
  return { rooms, inMatch, removedFromQueue, sent, started };
}

function latestRoom(sent: Array<{ userId: string; message: ServerMsg }>, userId: string) {
  const entry = [...sent].reverse().find((candidate): candidate is {
    userId: string;
    message: Extract<ServerMsg, { t: 'room:state' }>;
  } => candidate.userId === userId && candidate.message.t === 'room:state');
  return entry?.message.room;
}

describe('RoomCoordinator', () => {
  it('cria e sincroniza a sala com a apresentação pública do anfitrião', () => {
    const host = user('host', '');
    host.photo = '/avatar.webp';
    const { rooms, removedFromQueue, sent } = setup([host]);

    rooms.create(host);

    expect(removedFromQueue).toEqual(['host']);
    expect(rooms.has('host')).toBe(true);
    expect(rooms.participantsFor('host')).toEqual(['host']);
    expect(latestRoom(sent, 'host')).toMatchObject({
      seats: 2,
      members: [{ id: 'host', name: 'Jogador', photo: '/avatar.webp', isHost: true }],
    });

    sent.splice(0);
    rooms.sync('host');
    expect(latestRoom(sent, 'host')).toEqual(rooms.stateFor('host'));
    rooms.sync('outside');
    expect(latestRoom(sent, 'outside')).toBeNull();
  });

  it('rejeita sala durante partida e traduz falhas de código ou lotação', () => {
    const host = user('host');
    const guest = user('guest');
    const third = user('third');
    const { rooms, inMatch } = setup([host, guest, third]);
    inMatch.add(host.id);

    expect(() => rooms.create(host)).toThrowError(new RoomError('Você já está em uma partida.'));
    inMatch.delete(host.id);
    rooms.create(host);
    expect(() => rooms.join(guest, 'inexistente')).toThrowError(
      new RoomError('Sala não encontrada. Confira o código.'),
    );

    const code = rooms.stateFor(host.id)!.code;
    rooms.join(guest, ` ${code.toLowerCase()} `);
    expect(() => rooms.join(third, code)).toThrowError(new RoomError('A sala está cheia.'));
  });

  it('difunde a entrada e inicia somente com anfitrião e assentos completos', () => {
    const host = user('host');
    const guest = user('guest');
    const { rooms, removedFromQueue, sent, started } = setup([host, guest]);
    rooms.create(host);

    expect(() => rooms.start(host)).toThrowError(
      new RoomError('Aguarde os assentos serem preenchidos.'),
    );
    rooms.join(guest, rooms.stateFor(host.id)!.code);
    expect(latestRoom(sent, host.id)?.members.map((member) => member.id)).toEqual(['host', 'guest']);
    expect(latestRoom(sent, guest.id)?.members.map((member) => member.id)).toEqual(['host', 'guest']);
    expect(removedFromQueue).toEqual(['host', 'guest']);
    expect(() => rooms.start(guest)).toThrowError(
      new RoomError('Apenas o anfitrião pode iniciar.'),
    );

    sent.splice(0);
    rooms.start(host);

    expect(started).toEqual([[host, guest]]);
    expect(sent).toEqual([
      { userId: 'host', message: { t: 'room:state', room: null } },
      { userId: 'guest', message: { t: 'room:state', room: null } },
    ]);
    expect(rooms.has(host.id)).toBe(false);
    expect(rooms.has(guest.id)).toBe(false);
  });

  it('promove o próximo anfitrião ao sair e diferencia remoção silenciosa', () => {
    const host = user('host');
    const guest = user('guest');
    const { rooms, sent } = setup([host, guest]);
    rooms.create(host);
    rooms.join(guest, rooms.stateFor(host.id)!.code);
    sent.splice(0);

    rooms.leave(host);

    expect(latestRoom(sent, host.id)).toBeNull();
    expect(latestRoom(sent, guest.id)).toMatchObject({
      members: [{ id: guest.id, isHost: true }],
    });

    sent.splice(0);
    rooms.remove(guest.id);
    expect(sent).toEqual([]);
    expect(rooms.has(guest.id)).toBe(false);
  });

  it('retira desconectados e atualiza quem permaneceu na sala', () => {
    const host = user('host');
    const guest = user('guest');
    const { rooms, sent } = setup([host, guest]);
    rooms.create(host);
    rooms.join(guest, rooms.stateFor(host.id)!.code);
    sent.splice(0);

    rooms.disconnect(guest.id);

    expect(rooms.has(guest.id)).toBe(false);
    expect(latestRoom(sent, host.id)?.members).toMatchObject([{ id: host.id, isHost: true }]);
  });
});
