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
const MAX_WINDOW = 1000; // teto: nem após espera longa casa ratings absurdamente distantes

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

  /** Ids de todos os que aguardam (para difundir o estado da fila). */
  userIds(): string[] {
    return this.entries.map((e) => e.userId);
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Retorna pares formados nesta rodada (chamado em tick periódico).
   * `blocked(a,b)` veta um par (ex.: mesma origem/IP — anti alt-farm); quando
   * o vizinho mais próximo é vetado, tenta o próximo candidato dentro da janela.
   */
  tick(
    now = Date.now(),
    blocked?: (a: QueueEntry, b: QueueEntry) => boolean,
  ): Array<[QueueEntry, QueueEntry]> {
    const pairs: Array<[QueueEntry, QueueEntry]> = [];
    const sorted = [...this.entries].sort((a, b) => a.mmr - b.mmr);
    const used = new Set<string>();

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      if (used.has(a.userId)) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (used.has(b.userId)) continue;
        const waitedSec = (now - Math.min(a.since, b.since)) / 1000;
        const window = Math.min(MAX_WINDOW, INITIAL_WINDOW + waitedSec * WINDOW_GROWTH_PER_SEC);
        if (Math.abs(a.mmr - b.mmr) > window) continue;
        if (blocked?.(a, b)) continue; // mesma origem: tenta outro candidato
        pairs.push([a, b]);
        used.add(a.userId);
        used.add(b.userId);
        break;
      }
    }

    if (pairs.length) {
      this.entries = this.entries.filter((e) => !used.has(e.userId));
    }
    return pairs;
  }
}
