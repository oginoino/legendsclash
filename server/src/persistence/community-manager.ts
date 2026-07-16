import type { DbShape, Persistence, ReportRecord, UserRecord } from './contracts.js';

const RELATION_LIMIT = 500;

/**
 * Owns persisted player relationships and moderation records. Application
 * coordinators remain responsible for permission checks and rate limits.
 */
export class CommunityManager {
  constructor(
    private readonly db: Pick<DbShape, 'reports'>,
    private readonly usersById: Map<string, UserRecord>,
    private readonly persistence: Persistence,
  ) {}

  setMuted(userId: string, targetId: string, muted: boolean): void {
    const user = this.usersById.get(userId);
    if (!user) return;
    if (muted && !user.muted.includes(targetId) && user.muted.length < RELATION_LIMIT) {
      user.muted.push(targetId);
    }
    if (!muted) user.muted = user.muted.filter((id) => id !== targetId);
    if (!user.guest) this.persistence.saveUser(user);
  }

  addReport(report: ReportRecord): void {
    this.db.reports.push(report);
    this.persistence.saveReport(report);
  }

  setFriend(userId: string, friendId: string, add: boolean): void {
    const user = this.usersById.get(userId);
    if (!user || userId === friendId) return;
    if (add && !user.friends.includes(friendId) && user.friends.length < RELATION_LIMIT) {
      user.friends.push(friendId);
    }
    if (!add) user.friends = user.friends.filter((id) => id !== friendId);
    if (!user.guest) this.persistence.saveUser(user);
  }
}
