import { createHash, randomBytes } from 'node:crypto';
import type { DbShape, Persistence, SessionRecord, UserRecord } from './contracts.js';

/** Account sessions are long lived and renewed while in use. */
const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Guest sessions remain ephemeral and are never written to persistence. */
const GUEST_SESSION_TTL_MS = 24 * 3600_000;
/** Persist a sliding expiration at most once per hour. */
const SESSION_TOUCH_MS = 3600_000;

/**
 * Owns the in-memory session index and its write-through persistence rules.
 * Store keeps the public facade and user ownership; this registry only handles
 * token lifecycle and the reachability of ephemeral guests.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly db: Pick<DbShape, 'sessions'>,
    private readonly usersById: Map<string, UserRecord>,
    private readonly persistence: Persistence,
  ) {
    const now = Date.now();
    this.db.sessions = this.db.sessions.filter((session) => session.expiresAt > now);
    for (const session of this.db.sessions) this.sessions.set(session.tokenHash, session);
  }

  create(playerId: string): string {
    const guest = this.usersById.get(playerId)?.guest ?? false;
    const rawToken = randomBytes(32).toString('hex');
    const now = Date.now();
    const session: SessionRecord = {
      tokenHash: SessionRegistry.hashToken(rawToken),
      playerId,
      createdAt: now,
      expiresAt: now + (guest ? GUEST_SESSION_TTL_MS : SESSION_TTL_MS),
      lastSeenAt: now,
    };
    this.db.sessions.push(session);
    this.sessions.set(session.tokenHash, session);
    if (!guest) this.persistence.saveSession(session);
    return rawToken;
  }

  resolve(rawToken: string): UserRecord | undefined {
    const session = this.sessions.get(SessionRegistry.hashToken(rawToken));
    if (!session) return undefined;
    const now = Date.now();
    if (session.expiresAt <= now) {
      this.drop(session.tokenHash);
      return undefined;
    }
    const user = this.usersById.get(session.playerId);
    if (now - session.lastSeenAt > SESSION_TOUCH_MS) {
      session.lastSeenAt = now;
      session.expiresAt = now + (user?.guest ? GUEST_SESSION_TTL_MS : SESSION_TTL_MS);
      if (!user?.guest) this.persistence.saveSession(session);
    }
    return user;
  }

  revoke(rawToken: string): void {
    this.drop(SessionRegistry.hashToken(rawToken));
  }

  /** Removes a token without disposing its guest, used during account adoption. */
  detach(rawToken: string): void {
    this.remove(SessionRegistry.hashToken(rawToken));
  }

  recordsForPlayerIds(playerIds: Set<string>): SessionRecord[] {
    return [...this.sessions.values()].filter((session) => playerIds.has(session.playerId));
  }

  restorable(records: SessionRecord[]): SessionRecord[] {
    const now = Date.now();
    return records.filter((session) => (
      session.expiresAt > now && !this.sessions.has(session.tokenHash)
    ));
  }

  restore(records: SessionRecord[]): void {
    for (const session of records) {
      this.sessions.set(session.tokenHash, session);
      this.db.sessions.push(session);
    }
  }

  private static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private remove(tokenHash: string): boolean {
    if (!this.sessions.delete(tokenHash)) return false;
    this.db.sessions = this.db.sessions.filter((session) => session.tokenHash !== tokenHash);
    return true;
  }

  private drop(tokenHash: string): void {
    const session = this.sessions.get(tokenHash);
    if (!this.remove(tokenHash)) return;
    const user = session && this.usersById.get(session.playerId);
    if (user?.guest) {
      this.usersById.delete(user.id);
      return;
    }
    this.persistence.deleteSession(tokenHash);
  }
}
