import { describe, expect, it } from 'vitest';
import { MatchmakingQueue } from '../src/matchmaking.js';

describe('fila de matchmaking por MMR', () => {
  it('pareia jogadores com MMR próximo imediatamente', () => {
    const q = new MatchmakingQueue();
    q.join('a', 1000);
    q.join('b', 1040);
    const pairs = q.tick();
    expect(pairs).toHaveLength(1);
    expect(q.size).toBe(0);
  });

  it('não pareia novato com veterano de cara (fairness)', () => {
    const q = new MatchmakingQueue();
    q.join('novato', 1000);
    q.join('veterano', 1500);
    expect(q.tick()).toHaveLength(0);
    expect(q.size).toBe(2);
  });

  it('expande a janela com o tempo de espera', () => {
    const q = new MatchmakingQueue();
    const past = Date.now() - 40_000; // 40s na fila
    q.join('novato', 1000);
    q.join('veterano', 1500);
    // simula espera longa
    (q as unknown as { entries: Array<{ since: number }> }).entries.forEach((e) => { e.since = past; });
    expect(q.tick()).toHaveLength(1);
  });

  it('prefere o par de menor diferença quando há vários na fila', () => {
    const q = new MatchmakingQueue();
    q.join('a', 1000);
    q.join('b', 1010);
    q.join('c', 1500);
    q.join('d', 1520);
    const pairs = q.tick();
    expect(pairs).toHaveLength(2);
    for (const [x, y] of pairs) {
      expect(Math.abs(x.mmr - y.mmr)).toBeLessThanOrEqual(75);
    }
  });
});
