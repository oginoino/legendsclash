import { CARDS } from '@legendsclash/shared';
import type { CardDef, ClientMsg, CreatureOnBoard } from '@legendsclash/shared';
import type { AimTarget } from './targeting-model';

export type AttackCommand = Extract<ClientMsg, { t: 'game:attack' }>;
export type PlayCommand = Extract<ClientMsg, { t: 'game:play' }>;
export type ActionBlockFeedback = 'silent' | 'error' | 'energy';
export type ActionBlockReason =
  | 'inactive-turn'
  | 'exhausted-attacker'
  | 'friendly-fire'
  | 'guarded-commander'
  | 'taunt-priority'
  | 'unaffordable'
  | 'target-required'
  | 'invalid-target';

export type ActionDecision<TCommand> =
  | { ok: true; command: TCommand }
  | { ok: false; reason: ActionBlockReason; feedback: ActionBlockFeedback };

function blocked(
  reason: ActionBlockReason,
  feedback: ActionBlockFeedback,
): ActionDecision<never> {
  return { ok: false, reason, feedback };
}

export function resolveAttackAction({
  attacker,
  enemyBoard,
  enemySeatIdx,
  myTurn,
  target,
}: {
  attacker: CreatureOnBoard;
  enemyBoard: CreatureOnBoard[];
  enemySeatIdx: number;
  myTurn: boolean;
  target: AimTarget;
}): ActionDecision<AttackCommand> {
  if (!myTurn) return blocked('inactive-turn', 'silent');
  if (!attacker.canAttack) return blocked('exhausted-attacker', 'silent');
  if (target.kind === 'my-creature') return blocked('friendly-fire', 'error');
  if (target.kind === 'face') {
    if (enemyBoard.length > 0) return blocked('guarded-commander', 'error');
    return {
      ok: true,
      command: {
        t: 'game:attack',
        attackerIid: attacker.iid,
        target: { seat: enemySeatIdx },
      },
    };
  }

  const enemyHasTaunt = enemyBoard.some(
    (creature) => CARDS[creature.defId].keywords?.includes('taunt'),
  );
  if (enemyHasTaunt && !CARDS[target.c.defId].keywords?.includes('taunt')) {
    return blocked('taunt-priority', 'error');
  }
  return {
    ok: true,
    command: {
      t: 'game:attack',
      attackerIid: attacker.iid,
      target: { seat: enemySeatIdx, iid: target.c.iid },
    },
  };
}

export function resolvePlayAction({
  definition,
  enemyBoard,
  enemySeatIdx,
  energy,
  iid,
  myTurn,
  target,
  yourSeat,
}: {
  definition: CardDef;
  enemyBoard: CreatureOnBoard[];
  enemySeatIdx: number;
  energy: number;
  iid: string;
  myTurn: boolean;
  target: AimTarget | null;
  yourSeat: number;
}): ActionDecision<PlayCommand> {
  if (!myTurn) return blocked('inactive-turn', 'silent');
  if (definition.cost > energy) return blocked('unaffordable', 'energy');

  const wants = definition.target ?? 'none';
  if (wants === 'none') {
    return { ok: true, command: { t: 'game:play', iid } };
  }
  if (!target) return blocked('target-required', 'silent');
  if (wants === 'friendly-creature') {
    if (target.kind !== 'my-creature') return blocked('invalid-target', 'error');
    return {
      ok: true,
      command: {
        t: 'game:play',
        iid,
        target: { seat: yourSeat, iid: target.c.iid },
      },
    };
  }
  if (target.kind === 'enemy-creature') {
    if (wants !== 'enemy-creature' && wants !== 'enemy-any') {
      return blocked('invalid-target', 'error');
    }
    return {
      ok: true,
      command: {
        t: 'game:play',
        iid,
        target: { seat: enemySeatIdx, iid: target.c.iid },
      },
    };
  }
  if (target.kind === 'face') {
    if (wants !== 'enemy-any') return blocked('invalid-target', 'error');
    if (enemyBoard.length > 0 && !definition.pierce) {
      return blocked('guarded-commander', 'error');
    }
    return {
      ok: true,
      command: { t: 'game:play', iid, target: { seat: enemySeatIdx } },
    };
  }
  return blocked('invalid-target', 'error');
}
