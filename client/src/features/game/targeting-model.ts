import { CARDS } from '@legendsclash/shared';
import type { CardDef, CreatureOnBoard, SeatView } from '@legendsclash/shared';

export type Selection =
  | { kind: 'hand'; iid: string }
  | { kind: 'attacker'; iid: string }
  | null;

export type HoverTarget = { kind: 'face' } | { kind: 'creature'; iid: string } | null;

export type AimTarget =
  | { kind: 'face' }
  | { kind: 'enemy-creature'; c: CreatureOnBoard }
  | { kind: 'my-creature'; c: CreatureOnBoard };

export interface CombatPreview {
  targetDmg: number;
  targetDies?: boolean;
  lethal?: boolean;
  overflow?: number;
  selfDmg?: number;
  selfDies?: boolean;
  attackerIid?: string;
}

export interface TargetingState {
  friendly: boolean;
  enemyCreature: boolean;
  face: boolean;
  enemy: boolean;
}

interface RectBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface DragOrigin {
  kind: 'hand' | 'creature';
  defId: string;
}

const SPELL_DAMAGE: Record<string, number> = {
  s_faisca: 2,
  s_bola_de_fogo: 5,
  s_lanca_gelo: 3,
  s_julgamento: 3,
};

export function deriveTargetingState(
  selection: Selection,
  selectedCard: CardDef | null | undefined,
): TargetingState {
  const friendly = selection?.kind === 'hand' && selectedCard?.target === 'friendly-creature';
  const enemyCreature = selection?.kind === 'attacker' || (
    selection?.kind === 'hand'
    && (selectedCard?.target === 'enemy-creature' || selectedCard?.target === 'enemy-any')
  );
  const face = selection?.kind === 'attacker'
    || (selection?.kind === 'hand' && selectedCard?.target === 'enemy-any');
  return { friendly, enemyCreature, face, enemy: enemyCreature || face };
}

export function combatPreviewFor({
  target,
  myTurn,
  attacker,
  selectedCard,
  player,
  enemy,
}: {
  target: HoverTarget;
  myTurn: boolean;
  attacker: CreatureOnBoard | null;
  selectedCard: CardDef | null | undefined;
  player: Pick<SeatView, 'artifacts' | 'attackBonus'>;
  enemy: Pick<SeatView, 'attackBonus' | 'board' | 'hp' | 'shield'>;
}): CombatPreview | null {
  if (!target || !myTurn) return null;

  if (attacker) {
    const power = attacker.attack + player.attackBonus;
    if (target.kind === 'face') {
      if (enemy.board.length > 0) return null;
      return {
        targetDmg: power,
        lethal: power >= enemy.hp + enemy.shield,
        attackerIid: attacker.iid,
      };
    }

    const defender = enemy.board.find((creature) => creature.iid === target.iid);
    if (!defender) return null;
    const taunts = enemy.board.filter((creature) => CARDS[creature.defId].keywords?.includes('taunt'));
    if (taunts.length > 0 && !CARDS[defender.defId].keywords?.includes('taunt')) return null;

    const dealt = defender.ward ? 0 : power;
    const retaliation = attacker.ward ? 0 : defender.attack + enemy.attackBonus;
    const targetDies = dealt > 0 && defender.health <= dealt;
    const overflow = targetDies && enemy.board.length === 1
      ? Math.max(0, power - defender.health)
      : 0;

    return {
      targetDmg: dealt,
      targetDies,
      overflow: overflow > 0 ? overflow : undefined,
      lethal: overflow > 0 && overflow >= enemy.hp + enemy.shield,
      selfDmg: retaliation,
      selfDies: retaliation > 0 && attacker.health <= retaliation,
      attackerIid: attacker.iid,
    };
  }

  const baseDamage = selectedCard ? SPELL_DAMAGE[selectedCard.id] : undefined;
  if (selectedCard && baseDamage !== undefined) {
    const damage = baseDamage + player.artifacts.filter((artifact) => artifact === 'a_orbe').length;
    if (target.kind === 'face') {
      if (enemy.board.length > 0 && !selectedCard.pierce) return null;
      return { targetDmg: damage, lethal: damage >= enemy.hp + enemy.shield };
    }

    const victim = enemy.board.find((creature) => creature.iid === target.iid);
    if (!victim) return null;
    const dealt = victim.ward ? 0 : damage;
    return { targetDmg: dealt, targetDies: dealt > 0 && victim.health <= dealt };
  }

  return null;
}

export function isHoverTargetValid({
  hover,
  targeting,
  selectedCard,
  playerBoard,
  enemyBoard,
  mustHitTaunt,
}: {
  hover: HoverTarget;
  targeting: TargetingState;
  selectedCard: CardDef | null | undefined;
  playerBoard: CreatureOnBoard[];
  enemyBoard: CreatureOnBoard[];
  mustHitTaunt: boolean;
}): boolean {
  if (!hover) return false;
  if (targeting.friendly) {
    return hover.kind === 'creature' && playerBoard.some((creature) => creature.iid === hover.iid);
  }
  if (!targeting.enemy) return false;
  if (hover.kind === 'face') {
    return targeting.face && (enemyBoard.length === 0 || !!selectedCard?.pierce);
  }
  if (!targeting.enemyCreature) return false;
  const enemy = enemyBoard.find((creature) => creature.iid === hover.iid);
  if (!enemy) return false;
  return !mustHitTaunt || CARDS[enemy.defId].keywords?.includes('taunt') === true;
}

export function targetFromAnchor(
  anchor: string | null | undefined,
  enemySeatIdx: number,
  enemyBoard: CreatureOnBoard[],
  playerBoard: CreatureOnBoard[],
): AimTarget | null {
  if (!anchor) return null;
  if (anchor === `face-${enemySeatIdx}`) return { kind: 'face' };
  if (!anchor.startsWith('cr-')) return null;

  const iid = anchor.slice(3);
  const enemy = enemyBoard.find((creature) => creature.iid === iid);
  if (enemy) return { kind: 'enemy-creature', c: enemy };
  const player = playerBoard.find((creature) => creature.iid === iid);
  return player ? { kind: 'my-creature', c: player } : null;
}

export function aimTargetToHover(target: AimTarget | null): HoverTarget {
  if (!target) return null;
  return target.kind === 'face' ? { kind: 'face' } : { kind: 'creature', iid: target.c.iid };
}

export function isValidDragTarget(
  origin: DragOrigin,
  target: AimTarget | null,
  enemyBoard: CreatureOnBoard[],
): boolean {
  if (!target) return false;
  if (origin.kind === 'creature') {
    if (target.kind === 'my-creature') return false;
    if (target.kind === 'face') return enemyBoard.length === 0;
    const enemyHasTaunt = enemyBoard.some(
      (creature) => CARDS[creature.defId].keywords?.includes('taunt'),
    );
    return !enemyHasTaunt || CARDS[target.c.defId].keywords?.includes('taunt') === true;
  }

  const definition = CARDS[origin.defId];
  const wants = definition?.target ?? 'none';
  if (wants === 'friendly-creature') return target.kind === 'my-creature';
  if (wants === 'enemy-creature') return target.kind === 'enemy-creature';
  if (wants !== 'enemy-any' || target.kind === 'my-creature') return false;
  if (target.kind === 'face') return enemyBoard.length === 0 || !!definition.pierce;
  return target.kind === 'enemy-creature';
}

export function targetAnchor(target: AimTarget, enemySeatIdx: number): string {
  return target.kind === 'face' ? `face-${enemySeatIdx}` : `cr-${target.c.iid}`;
}

export function targetKey(target: AimTarget): string {
  return target.kind === 'face' ? 'face' : `${target.kind}-${target.c.iid}`;
}

export function distanceFromRect(x: number, y: number, rect: RectBounds): number {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

export function noTargetActionLabel(defId: string): string {
  const definition = CARDS[defId];
  if (!definition) return 'Usar';
  if (definition.type === 'creature') return 'Invocar';
  if (definition.type === 'artifact') return 'Equipar';
  return 'Usar';
}

export function targetLabel(target: AimTarget | null, valid: boolean, defId: string): string {
  const definition = CARDS[defId];
  if (valid && target) {
    if (target.kind === 'face') return 'Solte no comandante';
    return `Solte em ${CARDS[target.c.defId].name}`;
  }
  if (definition?.target === 'friendly-creature') return 'Escolha uma criatura aliada';
  if (definition?.target === 'enemy-creature') return 'Escolha uma criatura inimiga';
  return 'Escolha criatura ou comandante';
}

export function playDropLabel(defId: string, ready: boolean): string {
  if (!ready && CARDS[defId]?.type === 'creature') return 'Leve até sua mesa';
  const action = noTargetActionLabel(defId).toLocaleLowerCase('pt-BR');
  return ready ? `Solte para ${action}` : `Arraste para ${action}`;
}
