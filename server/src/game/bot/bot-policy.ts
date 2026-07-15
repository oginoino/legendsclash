import { CARDS } from '@legendsclash/shared';
import type { CardDef, Target } from '@legendsclash/shared';
import type { Seat } from '../types.js';

function firstEnemySeat(seats: Seat[], casterIdx: number): number {
  return seats.findIndex((seat, seatIdx) => seatIdx !== casterIdx && !seat.out);
}

/** Escolhe um alvo legal para uma carta segundo a heuristica gananciosa da IA. */
export function targetForBotCard(
  seats: Seat[],
  casterIdx: number,
  def: CardDef,
): Target | undefined {
  const enemyIdx = firstEnemySeat(seats, casterIdx);
  const enemy = enemyIdx >= 0 ? seats[enemyIdx] : null;

  if (def.target === 'friendly-creature') {
    const mine = seats[casterIdx].board[0];
    return mine ? { seat: casterIdx, iid: mine.iid } : undefined;
  }
  if (def.target === 'enemy-creature') {
    if (!enemy || enemy.board.length === 0) return undefined;
    return { seat: enemyIdx, iid: enemy.board[0].iid };
  }
  if (def.target === 'enemy-any') {
    if (!enemy) return undefined;
    if (enemy.board.length === 0 || def.pierce) return { seat: enemyIdx };
    return { seat: enemyIdx, iid: enemy.board[0].iid };
  }
  return undefined;
}

/** Prioriza Provocar; sem criaturas, ataca diretamente o comandante. */
export function targetForBotAttack(seats: Seat[], casterIdx: number): Target | undefined {
  const enemyIdx = firstEnemySeat(seats, casterIdx);
  if (enemyIdx < 0) return undefined;
  const enemy = seats[enemyIdx];
  if (enemy.board.length === 0) return { seat: enemyIdx };
  const taunt = enemy.board.find((creature) => CARDS[creature.defId].keywords?.includes('taunt'));
  return { seat: enemyIdx, iid: (taunt ?? enemy.board[0]).iid };
}
