/**
 * Fila de matchmaking por MMR (slide "Fairness por design": novatos nunca
 * enfrentam veteranos). A janela de pareamento começa estreita e expande com
 * o tempo de espera — qualidade primeiro, latência de fila depois.
 */

export interface QueueEntry {
  userId: string;
  mmr: number;
  since: number;
}

const INITIAL_WINDOW = 75; // Δ MMR aceito imediatamente
const WINDOW_GROWTH_PER_SEC = 15; // expansão por segundo de espera

export class MatchmakingQueue {
  private entries: QueueEntry[] = [];

  join(userId: string, mmr: number): void {
    if (this.entries.some((e) => e.userId === userId)) return;
    this.entries.push({ userId, mmr, since: Date.now() });
  }

  leave(userId: string): void {
    this.entries = this.entries.filter((e) => e.userId !== userId);
  }

  has(userId: string): boolean {
    return this.entries.some((e) => e.userId === userId);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Retorna pares formados nesta rodada (chamado em tick periódico). */
  tick(now = Date.now()): Array<[QueueEntry, QueueEntry]> {
    const pairs: Array<[QueueEntry, QueueEntry]> = [];
    const sorted = [...this.entries].sort((a, b) => a.mmr - b.mmr);
    const used = new Set<string>();

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      if (used.has(a.userId)) continue;
      const b = sorted[i + 1];
      if (used.has(b.userId)) continue;
      const waitedSec = (now - Math.min(a.since, b.since)) / 1000;
      const window = INITIAL_WINDOW + waitedSec * WINDOW_GROWTH_PER_SEC;
      if (Math.abs(a.mmr - b.mmr) <= window) {
        pairs.push([a, b]);
        used.add(a.userId);
        used.add(b.userId);
      }
    }

    if (pairs.length) {
      this.entries = this.entries.filter((e) => !used.has(e.userId));
    }
    return pairs;
  }
}
