import type { League, Profile, PublicProfile } from '@legendsclash/shared';
import {
  FACTION_TILTS,
  accentStyleUnlocked,
  accentUnlocked,
  achievementsOf,
  commanderUnlocked,
  frameUnlocked,
  isValidAccent,
  isValidAccentStyle,
  isValidAvatar,
  isValidCommander,
  isValidFrame,
  isValidProfileCover,
  normalizeIconId,
  profileCoverUnlocked,
} from '@legendsclash/shared';
import { leagueOf } from '../elo.js';
import type { Persistence, UserRecord } from './contracts.js';

export interface CosmeticsPatch {
  name?: string;
  avatar?: string;
  commander?: string;
  accent?: string;
  frame?: string;
  accentStyle?: string;
  profileCover?: string;
}

/** UTC epoch day used by daily profile progression. */
export function epochDay(ts: number): number {
  return Math.floor(ts / 86_400_000);
}

/**
 * Applies profile policies to the authoritative user cache and owns their
 * write-through persistence. Store remains the public facade for callers.
 */
export class ProfileManager {
  constructor(
    private readonly usersById: Map<string, UserRecord>,
    private readonly persistence: Persistence,
  ) {}

  updateProfile(userId: string, name: string, avatar: string): UserRecord | undefined {
    const user = this.usersById.get(userId);
    if (!user) return undefined;
    user.name = name.trim().slice(0, 24);
    if (avatar && isValidAvatar(avatar)) user.avatar = normalizeIconId(avatar);
    this.save(user);
    return user;
  }

  updateCosmetics(userId: string, patch: CosmeticsPatch): UserRecord | undefined {
    const user = this.usersById.get(userId);
    if (!user) return undefined;
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 24);
      if (name) user.name = name;
    }
    const earned = achievementsOf(user.wins, user.wins + user.losses);
    if (patch.avatar && isValidAvatar(patch.avatar)) user.avatar = normalizeIconId(patch.avatar);
    if (
      patch.commander
      && isValidCommander(patch.commander)
      && commanderUnlocked(normalizeIconId(patch.commander), earned)
    ) {
      user.commander = normalizeIconId(patch.commander);
    }
    if (patch.accent && isValidAccent(patch.accent) && accentUnlocked(patch.accent, earned)) {
      user.accent = patch.accent;
    }
    if (patch.frame && isValidFrame(patch.frame) && frameUnlocked(patch.frame, earned)) {
      user.frame = patch.frame;
    }
    if (
      patch.accentStyle
      && isValidAccentStyle(patch.accentStyle)
      && accentStyleUnlocked(patch.accentStyle, earned)
    ) {
      user.accentStyle = patch.accentStyle;
    }
    if (
      patch.profileCover
      && isValidProfileCover(patch.profileCover)
      && profileCoverUnlocked(patch.profileCover, earned)
    ) {
      user.profileCover = patch.profileCover;
    }
    this.save(user);
    return user;
  }

  setPhoto(userId: string, photo: string | null): UserRecord | undefined {
    const user = this.usersById.get(userId);
    if (!user) return undefined;
    user.photo = photo;
    this.save(user);
    return user;
  }

  uploadAvatar(userId: string, bytes: Buffer, contentType: string): Promise<string> {
    return this.persistence.uploadAvatar(userId, bytes, contentType);
  }

  setFaction(userId: string, factionId: string): UserRecord | undefined {
    const user = this.usersById.get(userId);
    if (!user || (factionId !== '' && !FACTION_TILTS[factionId])) return undefined;
    user.faction = factionId;
    this.save(user);
    return user;
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
      league: user.league ?? leagueOf(user.mmr) as League,
      wins: user.wins,
      losses: user.losses,
      streak: user.streak,
      playedToday: user.lastPlayDay === epochDay(Date.now()),
      achievements: achievementsOf(user.wins, user.wins + user.losses),
      muted: user.muted,
      friends: user.friends,
    };
  }

  publicProfileOf(user: UserRecord): PublicProfile {
    return {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      commander: user.commander,
      accent: user.accent,
      photo: user.photo,
      frame: user.frame,
      accentStyle: user.accentStyle,
      profileCover: user.profileCover,
      faction: user.faction,
      league: user.league ?? leagueOf(user.mmr) as League,
      mmr: user.mmr,
      wins: user.wins,
      losses: user.losses,
      achievements: achievementsOf(user.wins, user.wins + user.losses),
      streak: user.streak,
    };
  }

  private save(user: UserRecord): void {
    if (!user.guest) this.persistence.saveUser(user);
  }
}
