import type { League } from '@legendsclash/shared';

/**
 * Matchmaking e progressão por habilidade: sistema tipo Elo (slide "Fairness
 * por design"). Monetização não toca em rating — sem pay-to-win.
 */

export const BASE_MMR = 1000;
const K = 32;
const MIN_MMR = 100;

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function applyElo(winner: number, loser: number): { winner: number; loser: number } {
  const ew = expectedScore(winner, loser);
  const delta = Math.round(K * (1 - ew));
  return {
    winner: winner + delta,
    loser: Math.max(MIN_MMR, loser - delta),
  };
}

/** Ranking simples em três ligas: Bronze, Prata e Ouro (slide "MVP — 90 dias"). */
export function leagueOf(mmr: number): League {
  if (mmr >= 1300) return 'Ouro';
  if (mmr >= 1100) return 'Prata';
  return 'Bronze';
}
