import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryManager } from '../src/persistence/telemetry-manager.js';
import type { DbShape, EventRecord, Persistence } from '../src/persistence/contracts.js';

function event(type: string, at: number): EventRecord {
  return {
    type,
    userId: null,
    matchId: null,
    props: {},
    at,
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

function setup(events: EventRecord[] = [], memoryCap?: number) {
  const db: DbShape = { users: [], reports: [], sessions: [], events };
  const persistence = makePersistence();
  return {
    db,
    persistence,
    manager: new TelemetryManager(db, persistence, memoryCap),
  };
}

describe('TelemetryManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('normalizes optional fields and writes the event through', () => {
    const { db, persistence, manager } = setup();

    manager.recordEvent('session_start');

    const recorded: EventRecord = {
      type: 'session_start',
      userId: null,
      matchId: null,
      props: {},
      at: Date.now(),
    };
    expect(db.events).toEqual([recorded]);
    expect(persistence.saveEvent).toHaveBeenCalledWith(recorded);
  });

  it('preserves actor, match and product properties', () => {
    const { manager, persistence } = setup();

    manager.recordEvent('match_end', {
      userId: 'player',
      matchId: 'match',
      props: { won: true, turns: 12 },
    });

    expect(persistence.saveEvent).toHaveBeenCalledWith({
      type: 'match_end',
      userId: 'player',
      matchId: 'match',
      props: { won: true, turns: 12 },
      at: Date.now(),
    });
  });

  it('evicts the oldest event when the runtime buffer reaches its cap', () => {
    const oldest = event('oldest', 1);
    const retained = event('retained', 2);
    const { db, manager } = setup([oldest, retained], 2);

    manager.recordEvent('latest');

    expect(db.events).toHaveLength(2);
    expect(db.events.map(({ type }) => type)).toEqual(['retained', 'latest']);
  });

  it('exposes the shared runtime buffer used by diagnostics', () => {
    const events = [event('existing', 1)];
    const { manager } = setup(events);

    expect(manager.recentEvents()).toBe(events);
  });
});
