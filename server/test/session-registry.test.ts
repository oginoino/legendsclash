import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DbShape,
  Persistence,
  SessionRecord,
  UserRecord,
} from '../src/persistence/contracts.js';
import { SessionRegistry } from '../src/persistence/session-registry.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function user(id: string, guest: boolean): UserRecord {
  return {
    id,
    email: guest ? '' : `${id}@test.local`,
    name: id,
    avatar: 'wolf',
    commander: 'guardian',
    accent: 'gold',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    profileCover: 'aurelia',
    faction: '',
    authUserId: null,
    guest,
    mmr: 1000,
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

function makePersistence(): Persistence {
  return {
    load: vi.fn(),
    saveUser: vi.fn(),
    saveMatch: vi.fn(),
    saveReport: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    saveEvent: vi.fn(),
    uploadAvatar: vi.fn(),
  };
}

function setup(initialSessions: SessionRecord[] = []) {
  const db: DbShape = { users: [], reports: [], sessions: initialSessions, events: [] };
  const users = new Map<string, UserRecord>();
  const persistence = makePersistence();
  const registry = new SessionRegistry(db, users, persistence);
  return { db, users, persistence, registry };
}

describe('SessionRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('persists account sessions and renews their sliding expiration', () => {
    const { db, users, persistence, registry } = setup();
    const account = user('account', false);
    users.set(account.id, account);

    const token = registry.create(account.id);
    const originalExpiration = db.sessions[0].expiresAt;
    expect(persistence.saveSession).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * HOUR);
    expect(registry.resolve(token)).toBe(account);
    expect(db.sessions[0].expiresAt).toBeGreaterThan(originalExpiration);
    expect(persistence.saveSession).toHaveBeenCalledTimes(2);
  });

  it('keeps guest sessions in memory and releases the guest on revoke', () => {
    const { db, users, persistence, registry } = setup();
    const guest = user('guest', true);
    users.set(guest.id, guest);

    const token = registry.create(guest.id);
    expect(persistence.saveSession).not.toHaveBeenCalled();

    registry.revoke(token);
    expect(db.sessions).toEqual([]);
    expect(users.has(guest.id)).toBe(false);
    expect(persistence.deleteSession).not.toHaveBeenCalled();
  });

  it('drops expired account sessions from memory and persistence', () => {
    const { db, users, persistence, registry } = setup();
    const account = user('expired', false);
    users.set(account.id, account);
    const token = registry.create(account.id);

    vi.advanceTimersByTime(31 * DAY);
    expect(registry.resolve(token)).toBeUndefined();
    expect(db.sessions).toEqual([]);
    expect(persistence.deleteSession).toHaveBeenCalledOnce();
  });

  it('restores only live sessions that are not already indexed', () => {
    const { db, users, registry } = setup();
    const guest = user('restored', true);
    users.set(guest.id, guest);
    const now = Date.now();
    const live: SessionRecord = {
      tokenHash: 'live', playerId: guest.id, createdAt: now, lastSeenAt: now, expiresAt: now + HOUR,
    };
    const expired: SessionRecord = {
      tokenHash: 'expired', playerId: guest.id, createdAt: now, lastSeenAt: now, expiresAt: now - 1,
    };

    const restorable = registry.restorable([live, expired]);
    registry.restore(restorable);

    expect(db.sessions).toEqual([live]);
    expect(registry.restorable([live])).toEqual([]);
    expect(registry.recordsForPlayerIds(new Set([guest.id]))).toEqual([live]);
  });
});
