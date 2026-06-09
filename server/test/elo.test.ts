import { describe, expect, it } from 'vitest';
import { applyElo, leagueOf } from '../src/elo.js';

describe('elo', () => {
  it('vitória entre iguais transfere 16 pontos (K=32)', () => {
    const r = applyElo(1000, 1000);
    expect(r.winner).toBe(1016);
    expect(r.loser).toBe(984);
  });

  it('vencer um adversário muito mais forte rende mais pontos', () => {
    const upset = applyElo(1000, 1300);
    const expected = applyElo(1300, 1000);
    expect(upset.winner - 1000).toBeGreaterThan(expected.winner - 1300);
  });

  it('rating nunca cai abaixo do piso', () => {
    const r = applyElo(1000, 100);
    expect(r.loser).toBeGreaterThanOrEqual(100);
  });
});

describe('ligas (Bronze / Prata / Ouro)', () => {
  it('classifica pelas faixas de MMR', () => {
    expect(leagueOf(1000)).toBe('Bronze');
    expect(leagueOf(1099)).toBe('Bronze');
    expect(leagueOf(1100)).toBe('Prata');
    expect(leagueOf(1299)).toBe('Prata');
    expect(leagueOf(1300)).toBe('Ouro');
  });
});
