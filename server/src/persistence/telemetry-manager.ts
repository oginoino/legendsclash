import type { DbShape, EventRecord, Persistence } from './contracts.js';

/** Buffer curto para debug/testes; a fonte de verdade continua no banco. */
const DEFAULT_MEMORY_CAP = 500;

export interface TelemetryEventOptions {
  userId?: string | null;
  matchId?: string | null;
  props?: Record<string, unknown>;
}

/** Owns telemetry event normalization, the runtime buffer and write-through. */
export class TelemetryManager {
  constructor(
    private readonly db: Pick<DbShape, 'events'>,
    private readonly persistence: Persistence,
    private readonly memoryCap = DEFAULT_MEMORY_CAP,
  ) {}

  recordEvent(type: string, options: TelemetryEventOptions = {}): void {
    const event: EventRecord = {
      type,
      userId: options.userId ?? null,
      matchId: options.matchId ?? null,
      props: options.props ?? {},
      at: Date.now(),
    };
    this.db.events.push(event);
    if (this.db.events.length > this.memoryCap) this.db.events.shift();
    this.persistence.saveEvent(event);
  }

  recentEvents(): EventRecord[] {
    return this.db.events;
  }
}
