import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_AVATAR,
  DEFAULT_COMMANDER,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
  type MatchHistoryEntry,
} from '@legendsclash/shared';
import type {
  DbShape,
  Persistence,
  RankingSnapshot,
  UserRecord,
} from '../src/persistence/contracts.js';
import { epochDay } from '../src/persistence/profile-manager.js';
import { ProgressionManager, advanceStreak } from '../src/persistence/progression-manager.js';

function user(id: string, mmr = 1000, guest = false): UserRecord {
  return {
    id,
    email: guest ? '' : `${id}@test.local`,
    name: id,
    avatar: DEFAULT_AVATAR,
    commander: DEFAULT_COMMANDER,
    accent: DEFAULT_ACCENT,
    photo: null,
    frame: DEFAULT_FRAME,
    accentStyle: DEFAULT_ACCENT_STYLE,
    profileCover: DEFAULT_PROFILE_COVER,
    faction: '',
    authUserId: null,
    guest,
    mmr,
    wins: 0,
    losses: 0,
    muted: [],
    friends: [],
    history: [],
    createdAt: Date.now(),
    streak: 0,
    lastPlayDay: 0,
  };
}

function match(index: number, won = true): MatchHistoryEntry {
  return {
    matchId: `match-${index}`,
    opponentName: `Opponent ${index}`,
    opponentId: `opponent-${index}`,
    won,
    reason: 'hp',
    mmrDelta: won ? 16 : -16,
    turns: 10,
    durationMs: 60_000,
    endedAt: Date.now() - index,
  };
}

function makePersistence(overrides: Partial<Persistence> = {}): Persistence {
  return {
    load: vi.fn(async (): Promise<DbShape> => ({ users: [], reports: [], sessions: [], events: [] })),
    saveUser: vi.fn(),
    saveMatch: vi.fn(),
    saveReport: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    saveEvent: vi.fn(),
    uploadAvatar: vi.fn(),
    ...overrides,
  };
}

function setup(persistedUsers: UserRecord[], runtimeUsers = persistedUsers, persistence = makePersistence()) {
  const db: DbShape = { users: persistedUsers, reports: [], sessions: [], events: [] };
  const users = new Map(runtimeUsers.map((record) => [record.id, record]));
  const manager = new ProgressionManager(db, users, persistence);
  return { manager, persistence };
}

describe('ProgressionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('advances, preserves and resets daily streaks deterministically', () => {
    expect(advanceStreak(3, 20_000, 20_001)).toEqual({ streak: 4, lastPlayDay: 20_001 });
    expect(advanceStreak(3, 20_000, 20_000)).toEqual({ streak: 3, lastPlayDay: 20_000 });
    expect(advanceStreak(3, 20_000, 20_005)).toEqual({ streak: 1, lastPlayDay: 20_005 });
  });

  it('records account progression, caps history and persists the result', () => {
    const account = user('account');
    account.wins = 2;
    account.streak = 3;
    account.lastPlayDay = epochDay(Date.now()) - 1;
    account.history = Array.from({ length: 50 }, (_, index) => match(index + 1));
    const { manager, persistence } = setup([account]);
    const latest = match(0);

    manager.recordMatch(account.id, latest, 1120, true);

    expect(account).toMatchObject({ mmr: 1120, league: 'Prata', wins: 3, streak: 4 });
    expect(account.lastPlayDay).toBe(epochDay(Date.now()));
    expect(account.history).toHaveLength(50);
    expect(account.history[0]).toBe(latest);
    expect(persistence.saveUser).toHaveBeenCalledWith(account);
    expect(persistence.saveMatch).toHaveBeenCalledWith(account.id, latest);
  });

  it('keeps guest progression in memory without writing to persistence', () => {
    const guest = user('guest', 1000, true);
    const { manager, persistence } = setup([], [guest]);
    const result = match(1, false);

    manager.recordMatch(guest.id, result, 984, false);

    expect(guest).toMatchObject({ mmr: 984, league: 'Bronze', wins: 0, losses: 1, streak: 1 });
    expect(guest.history).toEqual([result]);
    expect(persistence.saveUser).not.toHaveBeenCalled();
    expect(persistence.saveMatch).not.toHaveBeenCalled();
  });

  it('sorts ranked players and builds a bounded neighborhood', () => {
    const leader = user('leader', 1400);
    const middle = user('middle', 1200);
    const lower = user('lower', 1000);
    const newcomer = user('newcomer', 1600);
    leader.wins = middle.wins = lower.wins = 1;
    const { manager } = setup([lower, newcomer, leader, middle]);

    expect(manager.leaderboard(2).map((record) => record.id)).toEqual(['leader', 'middle']);
    expect(manager.rankView(middle.id, 1)).toEqual({
      rank: 2,
      around: [leader, middle, lower],
    });
    expect(manager.rankView(newcomer.id)).toBeNull();
  });

  it('prefers the fresh ranking supplied by persistence', async () => {
    const account = user('account');
    account.wins = 1;
    const persisted: RankingSnapshot = { entries: [account], myRank: 7, around: [account] };
    const loadRanking = vi.fn(async () => persisted);
    const { manager } = setup([account], [account], makePersistence({ loadRanking }));

    await expect(manager.rankingSnapshot(account.id, 10, 2)).resolves.toBe(persisted);
    expect(loadRanking).toHaveBeenCalledWith(account.id, 10, 2);
  });

  it('falls back to the in-memory ranking when persistence is unavailable', async () => {
    const account = user('account');
    account.wins = 1;
    const loadRanking = vi.fn(async (): Promise<RankingSnapshot> => {
      throw new Error('offline');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { manager } = setup([account], [account], makePersistence({ loadRanking }));

    await expect(manager.rankingSnapshot(account.id)).resolves.toEqual({
      entries: [account],
      myRank: 1,
      around: [account],
    });
    expect(log).toHaveBeenCalledOnce();
  });
});
