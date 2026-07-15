interface ReconnectableSeat {
  connected: boolean;
}

interface ReconnectEntry {
  timer: NodeJS.Timeout | null;
  deadline: number;
}

/** Mantem a janela antiabandono fora do estado de dominio dos assentos. */
export class ReconnectController<TSeat extends ReconnectableSeat> {
  private readonly entries = new Map<TSeat, ReconnectEntry>();

  constructor(private readonly onTimeout: (seat: TSeat) => void) {}

  disconnect(seat: TSeat, ms: number): void {
    this.cancel(seat);
    seat.connected = false;
    const delay = Math.max(0, ms);
    const entry: ReconnectEntry = {
      timer: null,
      deadline: Date.now() + delay,
    };
    const timer = setTimeout(() => {
      const current = this.entries.get(seat);
      if (!current || current.timer !== timer) return;
      current.timer = null;
      if (!seat.connected) this.onTimeout(seat);
    }, delay);
    entry.timer = timer;
    this.entries.set(seat, entry);
  }

  reconnect(seat: TSeat): boolean {
    this.cancel(seat);
    if (seat.connected) return false;
    seat.connected = true;
    return true;
  }

  deadlineFor(seat: TSeat): number | null {
    if (seat.connected) return null;
    return this.entries.get(seat)?.deadline ?? null;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.entries.clear();
  }

  private cancel(seat: TSeat): void {
    const entry = this.entries.get(seat);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(seat);
  }
}
