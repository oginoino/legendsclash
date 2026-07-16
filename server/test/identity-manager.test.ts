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
import type { DbShape, Persistence, UserRecord } from '../src/persistence/contracts.js';
import { IdentityManager } from '../src/persistence/identity-manager.js';
import { SessionRegistry } from '../src/persistence/session-registry.js';

function account(id: string, email = `${id}@test.local`): UserRecord {
  return {
    id,
    email,
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
    guest: false,
    mmr: 1000,
    league: 'Bronze',
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

function match(id: string, endedAt: number): MatchHistoryEntry {
  return {
    matchId: id,
    opponentName: 'Opponent',
    opponentId: 'opponent',
    won: true,
    reason: 'hp',
    mmrDelta: 16,
    turns: 8,
    durationMs: 60_000,
    endedAt,
  };
}

function makePersistence(): Persistence {
  return {
    load: vi.fn(async (): Promise<DbShape> => ({ users: [], reports: [], sessions: [], events: [] })),
    saveUser: vi.fn(),
    saveMatch: vi.fn(),
    saveReport: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    saveEvent: vi.fn(),
    uploadAvatar: vi.fn(),
  };
}

function setup(persistedUsers: UserRecord[] = []) {
  const db: DbShape = { users: persistedUsers, reports: [], sessions: [], events: [] };
  const users = new Map(persistedUsers.map((user) => [user.id, user]));
  const persistence = makePersistence();
  const sessions = new SessionRegistry(db, users, persistence);
  const recordGuestAdoption = vi.fn();
  const manager = new IdentityManager(db, users, persistence, sessions, recordGuestAdoption);
  return { db, users, persistence, sessions, recordGuestAdoption, manager };
}

describe('IdentityManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates a normalized account and indexes it for runtime reads', () => {
    const { db, users, persistence, manager } = setup();

    const result = manager.findOrCreatePlayerByAuth('  Player@Example.COM ', 'auth-1');

    expect(result.isNew).toBe(true);
    expect(result.user).toMatchObject({
      email: 'player@example.com',
      name: '',
      authUserId: 'auth-1',
      guest: false,
      mmr: 1000,
      league: 'Bronze',
    });
    expect(db.users).toEqual([result.user]);
    expect(users.get(result.user.id)).toBe(result.user);
    expect(persistence.saveUser).toHaveBeenCalledWith(result.user);
  });

  it('links a legacy e-mail account and prioritizes its auth identity afterwards', () => {
    const legacy = account('legacy', 'player@example.com');
    const { persistence, manager } = setup([legacy]);

    expect(manager.findOrCreatePlayerByAuth('PLAYER@example.com', 'auth-1')).toEqual({
      user: legacy,
      isNew: false,
    });
    expect(legacy.authUserId).toBe('auth-1');
    expect(persistence.saveUser).toHaveBeenCalledWith(legacy);

    expect(manager.findOrCreatePlayerByAuth('changed@example.com', 'auth-1').user).toBe(legacy);
  });

  it('keeps a sanitized guest only in the runtime index', () => {
    const { db, users, persistence, manager } = setup();

    const guest = manager.createGuest(`  ${'A'.repeat(30)}  `, 'invalid-avatar');

    expect(guest).toMatchObject({
      email: '',
      name: 'A'.repeat(24),
      avatar: DEFAULT_AVATAR,
      commander: DEFAULT_COMMANDER,
      authUserId: null,
      guest: true,
    });
    expect(users.get(guest.id)).toBe(guest);
    expect(db.users).toEqual([]);
    expect(persistence.saveUser).not.toHaveBeenCalled();
  });

  it('adopts guest identity and progression in chronological persistence order', () => {
    const target = account('account');
    const { persistence, sessions, recordGuestAdoption, manager } = setup([target]);
    const guest = manager.createGuest('Guest', DEFAULT_AVATAR);
    const latest = match('latest', Date.now());
    const oldest = match('oldest', Date.now() - 10_000);
    Object.assign(guest, {
      accent: '#abcdef',
      faction: 'ether',
      mmr: 1275,
      league: undefined,
      wins: 3,
      losses: 2,
      muted: ['muted'],
      friends: ['friend'],
      history: [latest, oldest],
      streak: 4,
      lastPlayDay: 20_000,
    });
    const guestToken = sessions.create(guest.id);

    expect(manager.adoptGuestProgress(target.id, guestToken)).toBe(true);

    expect(target).toMatchObject({
      name: 'Guest',
      accent: '#abcdef',
      faction: 'ether',
      mmr: 1275,
      league: 'Prata',
      wins: 3,
      losses: 2,
      muted: ['muted'],
      friends: ['friend'],
      history: [latest, oldest],
      streak: 4,
      lastPlayDay: 20_000,
    });
    expect(persistence.saveUser).toHaveBeenCalledWith(target);
    expect(persistence.saveMatch).toHaveBeenNthCalledWith(1, target.id, oldest);
    expect(persistence.saveMatch).toHaveBeenNthCalledWith(2, target.id, latest);
    expect(recordGuestAdoption).toHaveBeenCalledWith(target.id, { mmr: 1275, matches: 5 });
    expect(sessions.resolve(guestToken)).toBeUndefined();
    expect(manager.userById(guest.id)).toBe(guest);
  });

  it('rejects adoption without a live guest session', () => {
    const target = account('account');
    const { persistence, recordGuestAdoption, manager } = setup([target]);

    expect(manager.adoptGuestProgress(target.id, 'invalid-token')).toBe(false);
    expect(persistence.saveUser).not.toHaveBeenCalled();
    expect(recordGuestAdoption).not.toHaveBeenCalled();
  });

  it('exports and restores only guests reachable through live sessions', () => {
    const source = setup();
    const guest = source.manager.createGuest('Guest', DEFAULT_AVATAR);
    const guestToken = source.sessions.create(guest.id);
    const snapshot = structuredClone(source.manager.exportGuests());
    delete (snapshot.users[0] as Partial<UserRecord>).profileCover;
    delete (snapshot.users[0] as Partial<UserRecord>).faction;
    delete (snapshot.users[0] as Partial<UserRecord>).league;

    const destination = setup();
    expect(destination.manager.importGuests(snapshot.users, snapshot.sessions)).toBe(1);

    const restored = destination.sessions.resolve(guestToken);
    expect(restored).toMatchObject({
      id: guest.id,
      profileCover: DEFAULT_PROFILE_COVER,
      faction: '',
      league: 'Bronze',
    });

    snapshot.sessions[0].expiresAt = Date.now() - 1;
    const expiredDestination = setup();
    expect(expiredDestination.manager.importGuests(snapshot.users, snapshot.sessions)).toBe(0);
    expect(expiredDestination.manager.userById(guest.id)).toBeUndefined();
  });
});
