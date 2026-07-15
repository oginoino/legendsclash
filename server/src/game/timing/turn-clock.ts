export interface TurnClockView {
  endsAt: number;
  paused: boolean;
  timeLeftMs: number;
}

/**
 * Relogio de uma fase da partida. Mantem um unico deadline e permite que
 * varios clientes bloqueiem o tempo sem que o primeiro a retomar libere os
 * demais.
 */
export class TurnClock {
  private endsAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private timeLeftMs = 0;
  private onExpire: (() => void) | null = null;
  private readonly pausePlayerIds: Set<string>;

  constructor(pausedBy: Iterable<string> = []) {
    this.pausePlayerIds = new Set(pausedBy);
  }

  arm(ms: number, onExpire: () => void): void {
    this.clearTimer();
    this.timeLeftMs = Math.max(0, ms);
    this.onExpire = onExpire;
    if (this.paused) {
      this.endsAt = 0;
      return;
    }
    this.schedule();
  }

  clear(): void {
    this.clearTimer();
    this.onExpire = null;
  }

  setPausedBy(playerId: string, paused: boolean): boolean {
    const alreadyPaused = this.pausePlayerIds.has(playerId);
    if (paused === alreadyPaused) return false;

    if (paused) {
      if (!this.pausePlayerIds.size) {
        this.timeLeftMs = this.currentTimeLeftMs();
        this.clearTimer();
        this.endsAt = 0;
      }
      this.pausePlayerIds.add(playerId);
      return true;
    }

    this.pausePlayerIds.delete(playerId);
    if (!this.pausePlayerIds.size && this.onExpire) this.schedule();
    return true;
  }

  get paused(): boolean {
    return this.pausePlayerIds.size > 0;
  }

  get pausedBy(): string[] {
    return [...this.pausePlayerIds];
  }

  view(): TurnClockView {
    return {
      endsAt: this.endsAt,
      paused: this.paused,
      timeLeftMs: this.currentTimeLeftMs(),
    };
  }

  private currentTimeLeftMs(): number {
    return this.paused
      ? this.timeLeftMs
      : Math.max(0, this.endsAt - Date.now());
  }

  private schedule(): void {
    this.endsAt = Date.now() + this.timeLeftMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timeLeftMs = 0;
      this.endsAt = Date.now();
      const onExpire = this.onExpire;
      this.onExpire = null;
      onExpire?.();
    }, this.timeLeftMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
