import { randomBytes } from 'node:crypto';
import type { League } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_AVATAR,
  DEFAULT_COMMANDER,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
  isValidAvatar,
  isValidCommander,
  normalizeIconId,
} from '@legendsclash/shared';
import { BASE_MMR, leagueOf } from '../elo.js';
import type { DbShape, Persistence, SessionRecord, UserRecord } from './contracts.js';
import type { SessionRegistry } from './session-registry.js';

type GuestAdoptionRecorder = (userId: string, props: Record<string, unknown>) => void;

/**
 * Owns account lookup, guest lifetime and the transition from guest to account.
 * Store remains the public facade while sessions and persistence are injected.
 */
export class IdentityManager {
  constructor(
    private readonly db: Pick<DbShape, 'users'>,
    private readonly usersById: Map<string, UserRecord>,
    private readonly persistence: Persistence,
    private readonly sessions: SessionRegistry,
    private readonly recordGuestAdoption: GuestAdoptionRecorder = () => undefined,
  ) {}

  /**
   * Finds the account for a Supabase identity, linking legacy e-mail accounts
   * on first login. New accounts keep an empty name until onboarding finishes.
   */
  findOrCreatePlayerByAuth(email: string, authUserId: string | null): { user: UserRecord; isNew: boolean } {
    const normalizedEmail = email.trim().toLowerCase();
    let user = authUserId
      ? this.db.users.find((candidate) => candidate.authUserId === authUserId)
      : undefined;
    user ??= this.db.users.find((candidate) => candidate.email === normalizedEmail);
    if (user) {
      if (authUserId && user.authUserId !== authUserId) {
        user.authUserId = authUserId;
        this.persistence.saveUser(user);
      }
      return { user, isNew: false };
    }

    user = this.buildUser({
      email: normalizedEmail,
      name: '',
      avatar: DEFAULT_AVATAR,
      commander: DEFAULT_COMMANDER,
      authUserId,
      guest: false,
    });
    this.db.users.push(user);
    this.usersById.set(user.id, user);
    this.persistence.saveUser(user);
    return { user, isNew: true };
  }

  /** Guests live only in the runtime index and never enter persisted users. */
  createGuest(name: string, avatar: string): UserRecord {
    const normalizedAvatar = isValidAvatar(avatar) ? normalizeIconId(avatar) : DEFAULT_AVATAR;
    const user = this.buildUser({
      email: '',
      name: name.trim().slice(0, 24),
      avatar: normalizedAvatar,
      commander: isValidCommander(normalizedAvatar) ? normalizedAvatar : DEFAULT_COMMANDER,
      authUserId: null,
      guest: true,
    });
    this.usersById.set(user.id, user);
    return user;
  }

  /** Copies guest identity and progression into an existing persisted account. */
  adoptGuestProgress(targetId: string, guestToken: string): boolean {
    const guest = this.sessions.resolve(guestToken);
    if (!guest?.guest) return false;
    const target = this.usersById.get(targetId);
    if (!target || target.guest || target.id === guest.id) return false;

    target.name = guest.name;
    target.avatar = guest.avatar;
    target.commander = guest.commander;
    target.accent = guest.accent;
    target.photo = guest.photo;
    target.frame = guest.frame;
    target.accentStyle = guest.accentStyle;
    target.profileCover = guest.profileCover;
    target.faction = guest.faction;
    target.mmr = guest.mmr;
    target.league = guest.league ?? leagueOf(guest.mmr) as League;
    target.wins = guest.wins;
    target.losses = guest.losses;
    target.muted = [...guest.muted];
    target.friends = [...guest.friends];
    target.history = [...guest.history];
    target.streak = guest.streak;
    target.lastPlayDay = guest.lastPlayDay;
    this.persistence.saveUser(target);
    for (let index = target.history.length - 1; index >= 0; index--) {
      this.persistence.saveMatch(target.id, target.history[index]);
    }
    this.sessions.detach(guestToken);
    this.recordGuestAdoption(target.id, {
      mmr: target.mmr,
      matches: target.wins + target.losses,
    });
    return true;
  }

  /** Exports only reachable guest state for runtime snapshots. */
  exportGuests(): { users: UserRecord[]; sessions: SessionRecord[] } {
    const users = [...this.usersById.values()].filter((user) => user.guest);
    const ids = new Set(users.map((user) => user.id));
    return { users, sessions: this.sessions.recordsForPlayerIds(ids) };
  }

  /** Restores guests that still have a live session after a process restart. */
  importGuests(users: UserRecord[], sessions: SessionRecord[]): number {
    const aliveSessions = this.sessions.restorable(sessions);
    const reachable = new Set(aliveSessions.map((session) => session.playerId));
    let restored = 0;
    for (const user of users) {
      if (!user.guest || this.usersById.has(user.id) || !reachable.has(user.id)) continue;
      user.profileCover ??= DEFAULT_PROFILE_COVER;
      user.faction ??= '';
      user.league ??= leagueOf(user.mmr) as League;
      this.usersById.set(user.id, user);
      restored++;
    }
    this.sessions.restore(aliveSessions.filter((session) => this.usersById.get(session.playerId)?.guest));
    return restored;
  }

  userById(id: string): UserRecord | undefined {
    return this.usersById.get(id);
  }

  private buildUser(options: {
    email: string;
    name: string;
    avatar: string;
    commander: string;
    authUserId: string | null;
    guest: boolean;
  }): UserRecord {
    return {
      id: randomBytes(8).toString('hex'),
      email: options.email,
      name: options.name,
      avatar: options.avatar,
      commander: options.commander,
      accent: DEFAULT_ACCENT,
      photo: null,
      frame: DEFAULT_FRAME,
      accentStyle: DEFAULT_ACCENT_STYLE,
      profileCover: DEFAULT_PROFILE_COVER,
      faction: '',
      authUserId: options.authUserId,
      guest: options.guest,
      mmr: BASE_MMR,
      league: leagueOf(BASE_MMR) as League,
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
}
