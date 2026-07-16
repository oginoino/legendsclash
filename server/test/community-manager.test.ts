import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_AVATAR,
  DEFAULT_COMMANDER,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
} from '@legendsclash/shared';
import { CommunityManager } from '../src/persistence/community-manager.js';
import type {
  DbShape,
  Persistence,
  ReportRecord,
  UserRecord,
} from '../src/persistence/contracts.js';

function user(id: string, guest = false): UserRecord {
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

function setup(initialUsers: UserRecord[]) {
  const db: DbShape = { users: initialUsers, reports: [], sessions: [], events: [] };
  const persistence = makePersistence();
  const users = new Map(initialUsers.map((record) => [record.id, record]));
  return {
    db,
    persistence,
    manager: new CommunityManager(db, users, persistence),
  };
}

describe('CommunityManager', () => {
  it('adds and removes muted players with account write-through', () => {
    const owner = user('owner');
    const { persistence, manager } = setup([owner]);

    manager.setMuted(owner.id, 'target', true);
    manager.setMuted(owner.id, 'target', true);
    expect(owner.muted).toEqual(['target']);

    manager.setMuted(owner.id, 'target', false);
    expect(owner.muted).toEqual([]);
    expect(persistence.saveUser).toHaveBeenCalledTimes(3);
    expect(persistence.saveUser).toHaveBeenLastCalledWith(owner);
  });

  it('enforces relation caps and keeps guest changes in memory', () => {
    const guest = user('guest', true);
    guest.muted = Array.from({ length: 500 }, (_, index) => `muted-${index}`);
    guest.friends = Array.from({ length: 500 }, (_, index) => `friend-${index}`);
    const { persistence, manager } = setup([guest]);

    manager.setMuted(guest.id, 'overflow-muted', true);
    manager.setFriend(guest.id, 'overflow-friend', true);
    manager.setMuted(guest.id, 'muted-0', false);
    manager.setFriend(guest.id, 'friend-0', false);

    expect(guest.muted).toHaveLength(499);
    expect(guest.muted).not.toContain('overflow-muted');
    expect(guest.friends).toHaveLength(499);
    expect(guest.friends).not.toContain('overflow-friend');
    expect(persistence.saveUser).not.toHaveBeenCalled();
  });

  it('prevents self-friendship and persists idempotent account changes', () => {
    const owner = user('owner');
    const { persistence, manager } = setup([owner]);

    manager.setFriend(owner.id, owner.id, true);
    expect(persistence.saveUser).not.toHaveBeenCalled();

    manager.setFriend(owner.id, 'friend', true);
    manager.setFriend(owner.id, 'friend', true);
    manager.setFriend(owner.id, 'friend', false);

    expect(owner.friends).toEqual([]);
    expect(persistence.saveUser).toHaveBeenCalledTimes(3);
  });

  it('appends reports to runtime state and persistence', () => {
    const { db, persistence, manager } = setup([]);
    const report: ReportRecord = {
      reporterId: 'reporter',
      reportedId: 'reported',
      reason: 'spam',
      context: 'mensagens recentes',
      at: 123,
    };

    manager.addReport(report);

    expect(db.reports).toEqual([report]);
    expect(persistence.saveReport).toHaveBeenCalledWith(report);
  });
});
