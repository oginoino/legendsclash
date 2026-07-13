import type { Dispatch, SetStateAction } from 'react';
import { CARDS } from '@legendsclash/shared';
import type { CreatureOnBoard, GameView, SeatView } from '@legendsclash/shared';
import { sfx } from '../../sounds';
import { send } from '../../store';
import { resolveAttackAction, resolvePlayAction } from './action-model';
import type { DragCardVisual } from './drag-gesture-model';
import type { AimTarget, HoverTarget, Selection } from './targeting-model';
import type { HandFocus, InspectCard } from './view-model';

interface GameActionControllerOptions {
  clearAim: () => void;
  clearInspect: (source?: InspectCard['source']) => void;
  enemy: SeatView;
  enemySeatIdx: number;
  game: GameView;
  handFocus: HandFocus;
  myTurn: boolean;
  player: SeatView;
  selection: Selection;
  setAttackFx: Dispatch<SetStateAction<{ iid: string; at: number } | null>>;
  setCantAttackWarn: Dispatch<SetStateAction<{ iid: string; at: number } | null>>;
  setDragCard: Dispatch<SetStateAction<DragCardVisual | null>>;
  setEnergyWarnAt: Dispatch<SetStateAction<number>>;
  setHandFocus: Dispatch<SetStateAction<HandFocus>>;
  setHover: Dispatch<SetStateAction<HoverTarget>>;
  setHoverCost: Dispatch<SetStateAction<number>>;
  setMouse: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
  touchPlayConfirm: boolean;
}

export function createGameActionController({
  clearAim,
  clearInspect,
  enemy,
  enemySeatIdx,
  game,
  handFocus,
  myTurn,
  player,
  selection,
  setAttackFx,
  setCantAttackWarn,
  setDragCard,
  setEnergyWarnAt,
  setHandFocus,
  setHover,
  setHoverCost,
  setMouse,
  setSelection,
  touchPlayConfirm,
}: GameActionControllerOptions) {
  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((card) => card.iid === selection.iid)?.defId ?? '']
    : null;
  const selectedAttacker = selection?.kind === 'attacker'
    ? player.board.find((creature) => creature.iid === selection.iid) ?? null
    : null;
  const focusedHandDef = handFocus ? CARDS[handFocus.defId] : null;
  const faceShielded = enemy.board.length > 0;
  const enemyTaunts = enemy.board.filter(
    (creature) => CARDS[creature.defId].keywords?.includes('taunt'),
  );
  const mustHitTaunt = selection?.kind === 'attacker' && enemyTaunts.length > 0;
  const tauntFocusName = enemyTaunts[0]
    ? CARDS[enemyTaunts[0].defId].name
    : 'criatura com Provocar';

  function focusHandCard(iid: string, defId: string): void {
    sfx.click();
    setSelection(null);
    setHover(null);
    setMouse(null);
    setDragCard(null);
    clearInspect('hand');
    setHandFocus({ iid, defId });
    setHoverCost(CARDS[defId]?.cost ?? 0);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-anchor="hand-${iid}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }

  function performAttack(attacker: CreatureOnBoard, target: AimTarget): void {
    const decision = resolveAttackAction({
      attacker,
      enemyBoard: enemy.board,
      enemySeatIdx,
      myTurn,
      target,
    });
    if (!decision.ok) {
      if (decision.feedback === 'error') sfx.error();
      return;
    }

    send(decision.command);
    setAttackFx({ iid: attacker.iid, at: Date.now() });
    sfx.attack();
    clearAim();
  }

  function performPlay(iid: string, defId: string, target: AimTarget | null): void {
    const definition = CARDS[defId];
    const decision = resolvePlayAction({
      definition,
      enemyBoard: enemy.board,
      enemySeatIdx,
      energy: player.energy,
      iid,
      myTurn,
      target,
      yourSeat: game.yourSeat,
    });
    if (!decision.ok) {
      if (decision.feedback === 'energy') {
        setEnergyWarnAt(Date.now());
        sfx.error();
      } else if (decision.feedback === 'error') {
        sfx.error();
      }
      return;
    }

    send(decision.command);
    clearInspect('hand');
    if (definition.type === 'creature') sfx.summon(); else sfx.play();
    clearAim();
  }

  function confirmFocusedHandPlay(): void {
    if (!handFocus) return;
    const current = game.hand.find((card) => card.iid === handFocus.iid);
    if (!current) {
      setHandFocus(null);
      return;
    }
    performPlay(current.iid, current.defId, null);
  }

  function clickHandCard(iid: string, defId: string): void {
    if (!myTurn) return;
    const definition = CARDS[defId];
    if (definition.cost > player.energy) {
      setEnergyWarnAt(Date.now());
      sfx.error();
      return;
    }
    if (definition.target === 'none' || !definition.target) {
      if (touchPlayConfirm) {
        focusHandCard(iid, defId);
        return;
      }
      performPlay(iid, defId, null);
    } else {
      sfx.click();
      setHandFocus(null);
      clearInspect('hand');
      setSelection(
        selection?.kind === 'hand' && selection.iid === iid ? null : { kind: 'hand', iid },
      );
    }
  }

  function clickMyCreature(creature: CreatureOnBoard): void {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef) {
      if (selectedHandDef.target === 'friendly-creature') {
        performPlay(selection.iid, selectedHandDef.id, { kind: 'my-creature', c: creature });
      } else {
        sfx.error();
      }
      return;
    }
    if (creature.canAttack) {
      sfx.click();
      setSelection(
        selection?.kind === 'attacker' && selection.iid === creature.iid
          ? null
          : { kind: 'attacker', iid: creature.iid },
      );
    } else {
      setSelection(null);
      setCantAttackWarn({ iid: creature.iid, at: Date.now() });
      sfx.error();
    }
  }

  function clickEnemyCreature(creature: CreatureOnBoard): void {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef) {
      performPlay(selection.iid, selectedHandDef.id, { kind: 'enemy-creature', c: creature });
    } else if (selection?.kind === 'attacker' && selectedAttacker) {
      performAttack(selectedAttacker, { kind: 'enemy-creature', c: creature });
    }
  }

  function clickEnemyFace(): void {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef) {
      performPlay(selection.iid, selectedHandDef.id, { kind: 'face' });
    } else if (selection?.kind === 'attacker' && selectedAttacker) {
      performAttack(selectedAttacker, { kind: 'face' });
    }
  }

  return {
    clickEnemyCreature,
    clickEnemyFace,
    clickHandCard,
    clickMyCreature,
    confirmFocusedHandPlay,
    faceShielded,
    focusedHandDef,
    mustHitTaunt,
    performAttack,
    performPlay,
    selectedAttacker,
    selectedHandDef,
    tauntFocusName,
  };
}
