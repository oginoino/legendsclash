import type { ServerMsg } from '@legendsclash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MatchmakingCoordinator,
  MatchmakingError,
  type MatchmakingStore,
} from '../src/application/lobby/matchmaking-coordinator.js';
import type { UserRecord } from '../src/store.js';

class FakeStore implements MatchmakingStore {
  readonly users = new Map<string, UserRecord>();
  readonly events: Array<{ type: string; userId?: string | null; props?: Record<string, unknown> }> = [];

  constructor(users: UserRecord[]) {
    for (const user of users) this.users.set(user.id, user);
  }

  userById(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

  recordEvent(
    type: string,
    options: { userId?: string | null; props?: Record<string, unknown> } = {},
  ): void {
    this.events.push({ type, ...options });
  }
}

function user(id: string, mmr = 1000): UserRecord {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatar: 'shield',
    commander: 'shield',
    accent: '#e3b341',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    profileCover: 'aurelia',
    faction: '',
    authUserId: id,
    guest: false,
    mmr,
    wins: 0,
    losses: 0,
    muted: [],
    friends: [],
    history: [],
    createdAt: 1,
    streak: 0,
    lastPlayDay: 0,
  };
}

interface SetupOptions {
  inMatch?: Set<string>;
  inRoom?: Set<string>;
  origins?: Record<string, string>;
}

const coordinators: MatchmakingCoordinator[] = [];

afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose();
  vi.useRealTimers();
});

function setup(users: UserRecord[], options: SetupOptions = {}) {
  const store = new FakeStore(users);
  const sent: Array<{ userId: string; message: ServerMsg }> = [];
  const started: string[][] = [];
  const coordinator = new MatchmakingCoordinator({
    store,
    isInMatch: (userId) => options.inMatch?.has(userId) ?? false,
    isInRoom: (userId) => options.inRoom?.has(userId) ?? false,
    originFor: (userId) => options.origins?.[userId],
    startMatch: (players) => started.push(players.map((player) => player.id)),
    sendTo: (userId, message) => sent.push({ userId, message }),
    tickMs: 2_000,
  });
  coordinators.push(coordinator);
  return { coordinator, sent, started, store };
}

describe('MatchmakingCoordinator', () => {
  it('protege os contextos e anuncia espera solitária ao entrar', () => {
    vi.useFakeTimers();
    const p1 = user('p1');
    const inMatch = new Set(['p1']);
    const inRoom = new Set<string>();
    const { coordinator, sent, store } = setup([p1], { inMatch, inRoom });

    expect(() => coordinator.join(p1)).toThrowError(
      new MatchmakingError('Você já está em uma partida.'),
    );
    inMatch.clear();
    inRoom.add('p1');
    expect(() => coordinator.join(p1)).toThrowError(
      new MatchmakingError('Saia da sala antes de entrar na fila.'),
    );
    inRoom.clear();
    coordinator.join(p1);

    expect(store.events).toEqual([
      { type: 'queue_join', userId: 'p1', props: { mmr: 1000 } },
    ]);
    expect(sent).toEqual([{
      userId: 'p1',
      message: { t: 'queue:status', inQueue: true, size: 1, waitingAlone: true },
    }]);
  });

  it('evita mesma origem e tenta o próximo candidato elegível', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
    const players = [user('p1', 1000), user('p2', 1001), user('p3', 1002)];
    const { coordinator, sent, started } = setup(players, {
      origins: { p1: '203.0.113.1', p2: '203.0.113.1', p3: '203.0.113.2' },
    });
    for (const player of players) coordinator.join(player);
    sent.splice(0);

    vi.advanceTimersByTime(2_000);

    expect(started).toEqual([['p1', 'p3']]);
    expect(coordinator.size).toBe(1);
    expect(sent).toEqual([{
      userId: 'p2',
      message: { t: 'queue:status', inQueue: true, size: 1, waitingAlone: true },
    }]);
  });

  it('distingue saída explícita, abandono e remoção silenciosa', () => {
    vi.useFakeTimers();
    const p1 = user('p1');
    const p2 = user('p2');
    const { coordinator, sent, store } = setup([p1, p2]);
    coordinator.join(p1);
    coordinator.join(p2);
    sent.splice(0);
    store.events.splice(0);

    coordinator.leave(p1);

    expect(store.events).toEqual([{ type: 'queue_leave', userId: 'p1' }]);
    expect(sent).toEqual([
      { userId: 'p1', message: { t: 'queue:status', inQueue: false, size: 1 } },
      { userId: 'p2', message: { t: 'queue:status', inQueue: true, size: 1, waitingAlone: true } },
    ]);

    coordinator.join(p1);
    sent.splice(0);
    store.events.splice(0);
    coordinator.disconnect('p1');
    expect(store.events).toEqual([{ type: 'queue_abandon', userId: 'p1' }]);
    expect(sent).toEqual([]);

    coordinator.remove('p2');
    expect(coordinator.size).toBe(0);
    expect(store.events).toEqual([{ type: 'queue_abandon', userId: 'p1' }]);
  });

  it('interrompe o tick periódico ao descartar', () => {
    vi.useFakeTimers();
    const p1 = user('p1');
    const p2 = user('p2');
    const { coordinator, started } = setup([p1, p2]);
    coordinator.join(p1);
    coordinator.join(p2);

    coordinator.dispose();
    vi.advanceTimersByTime(10_000);

    expect(started).toEqual([]);
  });
});
