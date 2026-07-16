import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_AVATAR,
  DEFAULT_COMMANDER,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
} from '@legendsclash/shared';
import type { DbShape, Persistence, UserRecord } from '../src/persistence/contracts.js';
import { ProfileManager, epochDay } from '../src/persistence/profile-manager.js';

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
    load: vi.fn(async (): Promise<DbShape> => ({ users: [], reports: [], sessions: [], events: [] })),
    saveUser: vi.fn(),
    saveMatch: vi.fn(),
    saveReport: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    saveEvent: vi.fn(),
    uploadAvatar: vi.fn(async () => 'https://cdn.test/avatar.webp'),
  };
}

function setup(...records: UserRecord[]) {
  const users = new Map(records.map((record) => [record.id, record]));
  const persistence = makePersistence();
  const manager = new ProfileManager(users, persistence);
  return { manager, persistence, users };
}

describe('ProfileManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('updates account identity with write-through and keeps guests in memory', () => {
    const account = user('account');
    const guest = user('guest', true);
    const { manager, persistence } = setup(account, guest);

    expect(manager.updateProfile(account.id, '  Guardiao da Aurora  ', 'shield')).toBe(account);
    expect(account.name).toBe('Guardiao da Aurora');
    expect(account.avatar).toBe('shield');
    expect(persistence.saveUser).toHaveBeenCalledOnce();

    manager.setPhoto(guest.id, 'data:image/webp;base64,AA==');
    expect(guest.photo).toBe('data:image/webp;base64,AA==');
    expect(persistence.saveUser).toHaveBeenCalledOnce();
  });

  it('enforces catalog validation and achievement unlocks for cosmetics', () => {
    const account = user('cosmetics');
    const { manager } = setup(account);

    manager.updateCosmetics(account.id, {
      commander: 'crown',
      frame: 'dragon',
      accentStyle: 'ember',
      profileCover: 'champion',
    });
    expect(account).toMatchObject({
      commander: DEFAULT_COMMANDER,
      frame: DEFAULT_FRAME,
      accentStyle: DEFAULT_ACCENT_STYLE,
      profileCover: DEFAULT_PROFILE_COVER,
    });

    account.wins = 10;
    account.losses = 40;
    manager.updateCosmetics(account.id, {
      commander: 'crown',
      frame: 'dragon',
      accentStyle: 'ember',
      profileCover: 'champion',
    });
    expect(account).toMatchObject({
      commander: 'crown',
      frame: 'dragon',
      accentStyle: 'ember',
      profileCover: 'champion',
    });
  });

  it('accepts only known factions and leaves missing users unchanged', () => {
    const account = user('faction');
    const { manager, persistence } = setup(account);

    expect(manager.setFaction(account.id, 'javascript:')).toBeUndefined();
    expect(manager.setFaction('missing', 'eter')).toBeUndefined();
    expect(persistence.saveUser).not.toHaveBeenCalled();

    expect(manager.setFaction(account.id, 'eter')).toBe(account);
    expect(account.faction).toBe('eter');
    expect(persistence.saveUser).toHaveBeenCalledOnce();
  });

  it('builds private and redacted public profile projections', () => {
    const account = user('projection');
    account.wins = 1;
    account.streak = 3;
    account.lastPlayDay = epochDay(Date.now());
    account.muted = ['blocked'];
    account.friends = ['friend'];
    const { manager } = setup(account);

    const profile = manager.profileOf(account);
    expect(profile).toMatchObject({
      email: account.email,
      playedToday: true,
      achievements: ['first_win'],
      muted: ['blocked'],
      friends: ['friend'],
    });

    const publicProfile = manager.publicProfileOf(account);
    expect(publicProfile).not.toHaveProperty('email');
    expect(publicProfile).not.toHaveProperty('muted');
    expect(publicProfile).not.toHaveProperty('friends');
    expect(publicProfile).toMatchObject({ achievements: ['first_win'], streak: 3 });
  });

  it('delegates avatar bytes to the configured persistence adapter', async () => {
    const account = user('upload');
    const { manager, persistence } = setup(account);
    const bytes = Buffer.from([1, 2, 3]);

    await expect(manager.uploadAvatar(account.id, bytes, 'image/webp'))
      .resolves.toBe('https://cdn.test/avatar.webp');
    expect(persistence.uploadAvatar).toHaveBeenCalledWith(account.id, bytes, 'image/webp');
  });
});
