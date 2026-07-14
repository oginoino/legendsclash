import {
  achievementsOf,
  type MatchHistoryEntry,
  type Profile,
  type ServerMsg,
} from '@legendsclash/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  MatchFinalizer,
  type MatchFinalizerStore,
} from '../src/application/matches/match-finalizer.js';
import { leagueOf } from '../src/elo.js';
import {
  Match,
  type EngineResult,
  type MatchPlayer,
} from '../src/game/engine.js';
import type { UserRecord } from '../src/store.js';

interface RecordedEvent {
  type: string;
  userId?: string | null;
  matchId?: string | null;
  props?: Record<string, unknown>;
}

class FakeStore implements MatchFinalizerStore {
  readonly users = new Map<string, UserRecord>();
  readonly records: Array<{ userId: string; entry: MatchHistoryEntry; newMmr: number; won: boolean }> = [];
  readonly events: RecordedEvent[] = [];

  constructor(users: UserRecord[]) {
    for (const user of users) this.users.set(user.id, user);
  }

  userById(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

  recordMatch(
    userId: string,
    entry: MatchHistoryEntry,
    newMmr: number,
    won: boolean,
  ): void {
    this.records.push({ userId, entry, newMmr, won });
    const user = this.users.get(userId);
    if (!user) return;
    user.mmr = newMmr;
    if (won) user.wins++; else user.losses++;
    user.history.unshift(entry);
  }

  recordEvent(
    type: string,
    options: {
      userId?: string | null;
      matchId?: string | null;
      props?: Record<string, unknown>;
    } = {},
  ): void {
    this.events.push({ type, ...options });
  }

  profileOf(user: UserRecord): Profile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      commander: user.commander,
      accent: user.accent,
      photo: user.photo,
      frame: user.frame,
      accentStyle: user.accentStyle,
      profileCover: user.profileCover,
      faction: user.faction,
      guest: user.guest,
      mmr: user.mmr,
      league: leagueOf(user.mmr),
      wins: user.wins,
      losses: user.losses,
      streak: user.streak,
      playedToday: false,
      achievements: achievementsOf(user.wins, user.wins + user.losses),
      muted: user.muted,
      friends: user.friends,
    };
  }
}

function user(id: string, mmr: number, name = id): UserRecord {
  return {
    id,
    email: `${id}@example.com`,
    name,
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

function player(user: UserRecord): MatchPlayer {
  return {
    id: user.id,
    name: user.name || 'Jogador',
    avatar: user.avatar,
    commander: user.commander,
    accent: user.accent,
    photo: user.photo,
    frame: user.frame,
    accentStyle: user.accentStyle,
    mmr: user.mmr,
  };
}

function result(seats: number, winnerSeat: number): EngineResult {
  return {
    winnerSeat,
    reason: 'surrender',
    turns: 8,
    durationMs: 90_000,
    stats: Array.from({ length: seats }, (_, seat) => ({
      creaturesSummoned: seat + 1,
      spellsCast: seat,
      damageDealt: 10 - seat,
      shieldAbsorbed: seat * 2,
    })),
    mvp: Array.from({ length: seats }, (_, seat) => seat === 1
      ? null
      : { defId: `card-${seat}`, damage: 5 + seat, kills: seat }),
  };
}

function setup(users: UserRecord[]) {
  const timeline: string[] = [];
  const sent: Array<{ playerId: string; message: ServerMsg }> = [];
  const opponents: string[][] = [];
  const store = new FakeStore(users);
  const finalizer = new MatchFinalizer({
    store,
    broadcastMatch: () => timeline.push('broadcast'),
    unregisterMatch: () => timeline.push('unregister'),
    recordOpponents: (ids) => {
      opponents.push([...ids]);
      timeline.push('opponents');
    },
    sendTo: (playerId, message) => {
      sent.push({ playerId, message });
      timeline.push(`send:${message.t}:${playerId}`);
    },
    onMatchesChanged: () => timeline.push('changed'),
    now: () => 1_234,
  });
  return { finalizer, opponents, sent, store, timeline };
}

function trackDispose(match: Match, timeline: string[]) {
  const dispose = match.dispose.bind(match);
  return vi.spyOn(match, 'dispose').mockImplementation(() => {
    timeline.push('dispose');
    dispose();
  });
}

describe('MatchFinalizer', () => {
  it('finaliza ranqueada N-player com Elo, histórico, conquistas e ordem de mensagens', () => {
    const winner = user('p1', 1000, '');
    const firstLoser = user('p2', 1000, 'Lina');
    const toughestLoser = user('p3', 1200, 'Ravi');
    const { finalizer, opponents, sent, store, timeline } = setup([
      winner,
      firstLoser,
      toughestLoser,
    ]);
    const match = new Match(
      [winner, firstLoser, toughestLoser].map(player),
      () => {},
      () => {},
    );
    const dispose = trackDispose(match, timeline);

    finalizer.finishRanked(match, result(3, 0));

    expect(winner.mmr).toBe(1040);
    expect(firstLoser.mmr).toBe(984);
    expect(toughestLoser.mmr).toBe(1176);
    expect(store.records.map((record) => [record.userId, record.won])).toEqual([
      ['p2', false],
      ['p3', false],
      ['p1', true],
    ]);
    expect(winner.history[0]).toMatchObject({
      opponentId: 'p3',
      opponentName: 'Ravi',
      mmrDelta: 40,
      endedAt: 1_234,
    });
    expect(firstLoser.history[0].opponentName).toBe('Jogador');
    expect(store.events.filter((event) => event.type === 'first_match_completed')).toHaveLength(3);
    expect(store.events.find((event) => event.type === 'match_end')?.props).toMatchObject({
      winnerId: 'p1',
      deltas: { p1: 40, p2: -16, p3: -24 },
    });
    expect(opponents).toEqual([['p1', 'p2', 'p3']]);

    const winnerGameOver = sent.find(
      ({ playerId, message }) => playerId === 'p1' && message.t === 'game:over',
    )?.message;
    expect(winnerGameOver).toMatchObject({
      t: 'game:over',
      result: {
        winnerId: 'p1',
        unlocked: { p1: ['first_win'] },
        mmr: {
          p1: { before: 1000, after: 1040, delta: 40, league: 'Bronze' },
          p2: { before: 1000, after: 984, delta: -16, league: 'Bronze' },
          p3: { before: 1200, after: 1176, delta: -24, league: 'Prata' },
        },
        stats: {
          p1: expect.objectContaining({ creaturesSummoned: 1 }),
          p2: expect.objectContaining({ creaturesSummoned: 2 }),
          p3: expect.objectContaining({ creaturesSummoned: 3 }),
        },
        mvp: {
          p1: expect.objectContaining({ defId: 'card-0' }),
          p2: null,
          p3: expect.objectContaining({ defId: 'card-2' }),
        },
      },
    });
    expect(timeline.slice(timeline.indexOf('opponents'))).toEqual([
      'opponents',
      'broadcast',
      'unregister',
      'send:game:over:p1',
      'send:profile:p1',
      'send:game:over:p2',
      'send:profile:p2',
      'send:game:over:p3',
      'send:profile:p3',
      'dispose',
      'changed',
    ]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('finaliza treino enviando apenas recap ao humano e sem progressão ranqueada', () => {
    const human = user('p1', 1080, 'Lina');
    const bot = user('bot:7', 1080, 'Treinador IA');
    const { finalizer, opponents, sent, store, timeline } = setup([human]);
    const match = new Match([player(human), player(bot)], () => {}, () => {});
    const dispose = trackDispose(match, timeline);

    finalizer.finishPractice(match, result(2, 1));

    expect(human).toMatchObject({ mmr: 1080, wins: 0, losses: 0, history: [] });
    expect(store.records).toEqual([]);
    expect(store.events).toEqual([]);
    expect(opponents).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      playerId: 'p1',
      message: {
        t: 'game:over',
        result: {
          winnerId: 'bot:7',
          mmr: {},
          stats: {
            p1: expect.objectContaining({ creaturesSummoned: 1 }),
            'bot:7': expect.objectContaining({ creaturesSummoned: 2 }),
          },
          mvp: {
            p1: expect.objectContaining({ defId: 'card-0' }),
            'bot:7': null,
          },
        },
      },
    });
    expect(timeline).toEqual([
      'broadcast',
      'unregister',
      'send:game:over:p1',
      'dispose',
      'changed',
    ]);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
