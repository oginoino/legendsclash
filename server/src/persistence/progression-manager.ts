import type { League, MatchHistoryEntry } from '@legendsclash/shared';
import { leagueOf } from '../elo.js';
import type {
  DbShape,
  Persistence,
  RankingSnapshot,
  UserRecord,
} from './contracts.js';
import { epochDay } from './profile-manager.js';

/** Advances daily play streaks without depending on the system clock. */
export function advanceStreak(
  streak: number,
  lastPlayDay: number,
  today: number,
): { streak: number; lastPlayDay: number } {
  if (lastPlayDay === today) return { streak, lastPlayDay };
  return { streak: lastPlayDay === today - 1 ? streak + 1 : 1, lastPlayDay: today };
}

/**
 * Owns persisted match progression and ranking projections. Store remains the
 * public facade while this manager coordinates cache and adapter operations.
 */
export class ProgressionManager {
  constructor(
    private readonly db: Pick<DbShape, 'users'>,
    private readonly usersById: Map<string, UserRecord>,
    private readonly persistence: Persistence,
  ) {}

  recordMatch(userId: string, entry: MatchHistoryEntry, newMmr: number, won: boolean): void {
    const user = this.usersById.get(userId);
    if (!user) return;
    user.mmr = newMmr;
    user.league = leagueOf(newMmr) as League;
    if (won) user.wins++; else user.losses++;
    user.history.unshift(entry);
    user.history = user.history.slice(0, 50);
    const streak = advanceStreak(user.streak, user.lastPlayDay, epochDay(Date.now()));
    user.streak = streak.streak;
    user.lastPlayDay = streak.lastPlayDay;
    if (user.guest) return;
    this.persistence.saveUser(user);
    this.persistence.saveMatch(userId, entry);
  }

  leaderboard(limit = 20): UserRecord[] {
    return [...this.db.users]
      .filter((user) => user.wins + user.losses > 0)
      .sort((left, right) => right.mmr - left.mmr)
      .slice(0, limit);
  }

  rankView(userId: string, span = 3): { rank: number; around: UserRecord[] } | null {
    const ranked = [...this.db.users]
      .filter((user) => user.wins + user.losses > 0)
      .sort((left, right) => right.mmr - left.mmr);
    const index = ranked.findIndex((user) => user.id === userId);
    if (index < 0) return null;
    return {
      rank: index + 1,
      around: ranked.slice(Math.max(0, index - span), index + span + 1),
    };
  }

  async rankingSnapshot(userId: string, limit = 20, span = 3): Promise<RankingSnapshot> {
    if (this.persistence.loadRanking) {
      try {
        return await this.persistence.loadRanking(userId, limit, span);
      } catch (err) {
        console.error('[store] ranking persistido indisponível; usando cache:', err);
      }
    }
    const rankView = this.rankView(userId, span);
    return {
      entries: this.leaderboard(limit),
      myRank: rankView?.rank,
      around: rankView?.around,
    };
  }
}
