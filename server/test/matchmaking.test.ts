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

  it('não pareia dois da mesma origem (anti alt-farm) — tenta outro candidato', () => {
    const q = new MatchmakingQueue();
    q.join('alt1', 1000);
    q.join('alt2', 1005); // mesma origem do alt1
    q.join('real', 1010);
    const ip: Record<string, string> = { alt1: 'x', alt2: 'x', real: 'y' };
    const pairs = q.tick(undefined, (a, b) => ip[a.userId] === ip[b.userId]);
    expect(pairs).toHaveLength(1);
    const ids = [pairs[0][0].userId, pairs[0][1].userId].sort();
    expect(ids).not.toEqual(['alt1', 'alt2']); // os dois "alts" não se enfrentam
    expect(ids).toContain('real');
  });

  it('dois da mesma origem sozinhos não pareiam (ficam na fila)', () => {
    const q = new MatchmakingQueue();
    q.join('a', 1000);
    q.join('b', 1000);
    const pairs = q.tick(undefined, () => true); // tudo bloqueado
    expect(pairs).toHaveLength(0);
    expect(q.size).toBe(2);
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
