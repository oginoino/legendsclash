import { CARDS, MAX_BOARD } from '@legendsclash/shared';
import type { CreatureOnBoard, SeatView } from '@legendsclash/shared';
import type {
  Dispatch,
  MouseEvent,
  MutableRefObject,
  PointerEvent,
  SetStateAction,
} from 'react';
import { triggerHaptic } from '../../preferences';
import { sfx } from '../../sounds';
import {
  isPlayDropReadyAt,
  TOUCH_TARGET_MAGNET_PX,
} from './drag-gesture-model';
import type { DragCardVisual, DragOrigin, DragState } from './drag-gesture-model';
import type { DragGestureApi } from './hooks/useDragGesture';
import {
  aimTargetToHover,
  distanceFromRect,
  isValidDragTarget,
  playDropLabel,
  targetAnchor,
  targetFromAnchor,
  targetKey,
  targetLabel,
} from './targeting-model';
import type { AimTarget, HoverTarget, Selection } from './targeting-model';
import type { HandFocus, InspectCard } from './view-model';

interface GameDragControllerOptions {
  cancelDrag: () => void;
  clearAim: () => void;
  clearInspect: (source?: InspectCard['source']) => void;
  dragApiRef: MutableRefObject<DragGestureApi | null>;
  dragRef: MutableRefObject<DragState | null>;
  enemy: SeatView;
  enemySeatIdx: number;
  myTurn: boolean;
  performAttack: (attacker: CreatureOnBoard, target: AimTarget) => void;
  performPlay: (iid: string, defId: string, target: AimTarget | null) => void;
  player: SeatView;
  setCantAttackWarn: Dispatch<SetStateAction<{ iid: string; at: number } | null>>;
  setDragCard: Dispatch<SetStateAction<DragCardVisual | null>>;
  setEnergyWarnAt: Dispatch<SetStateAction<number>>;
  setHandFocus: Dispatch<SetStateAction<HandFocus>>;
  setHover: Dispatch<SetStateAction<HoverTarget>>;
  setMouse: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
}

export function createGameDragController({
  cancelDrag,
  clearAim,
  clearInspect,
  dragApiRef,
  dragRef,
  enemy,
  enemySeatIdx,
  myTurn,
  performAttack,
  performPlay,
  player,
  setCantAttackWarn,
  setDragCard,
  setEnergyWarnAt,
  setHandFocus,
  setHover,
  setMouse,
  setSelection,
}: GameDragControllerOptions) {
  function resolveTargetAt(x: number, y: number): AimTarget | null {
    const anchor = document
      .elementFromPoint(x, y)
      ?.closest('[data-anchor]')
      ?.getAttribute('data-anchor');
    return targetFromAnchor(anchor, enemySeatIdx, enemy.board, player.board);
  }

  function resolveDragTargetAt(
    drag: DragState,
    x: number,
    y: number,
  ): { target: AimTarget | null; magnetized: boolean } {
    const exact = resolveTargetAt(x, y);
    if (exact || drag.pointerType !== 'touch') return { target: exact, magnetized: false };

    const candidates: AimTarget[] = [
      { kind: 'face' },
      ...enemy.board.map((creature) => ({ kind: 'enemy-creature' as const, c: creature })),
      ...player.board.map((creature) => ({ kind: 'my-creature' as const, c: creature })),
    ];
    let nearest: AimTarget | null = null;
    let nearestDistance = TOUCH_TARGET_MAGNET_PX + 1;
    for (const candidate of candidates) {
      if (!isValidDragTarget(drag, candidate, enemy.board)) continue;
      const element = document.querySelector<HTMLElement>(
        `[data-anchor="${targetAnchor(candidate, enemySeatIdx)}"]`,
      );
      if (!element) continue;
      const distance = distanceFromRect(x, y, element.getBoundingClientRect());
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    const magnetized = !!nearest && nearestDistance <= TOUCH_TARGET_MAGNET_PX;
    return { target: magnetized ? nearest : null, magnetized };
  }

  function setDragLockFeedback(
    drag: DragState,
    target: AimTarget | null,
    valid: boolean,
  ): void {
    const next = valid && target ? targetKey(target) : null;
    if (drag.pointerType === 'touch' && next && next !== drag.lockedTarget) {
      triggerHaptic();
    }
    drag.lockedTarget = next;
  }

  function isPlayDropReady(drag: DragState, x: number, y: number): boolean {
    const definition = CARDS[drag.defId];
    if (!definition) return false;
    const rowRect = definition.type === 'creature' && drag.pointerType === 'touch'
      ? document.querySelector<HTMLElement>('.my-row')?.getBoundingClientRect()
      : null;
    return isPlayDropReadyAt({
      drag,
      isCreature: definition.type === 'creature',
      rowRect,
      x,
      y,
    });
  }

  function onTargetPointerDown(event: PointerEvent, origin: DragOrigin): void {
    if (!myTurn || !event.isPrimary || event.button !== 0) return;
    if ((event.target as Element).closest('.creature-info')) return;
    if (dragRef.current) cancelDrag();
    dragRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      ...origin,
      startX: event.clientX,
      startY: event.clientY,
      mode: 'pending',
      captureEl: event.currentTarget as HTMLElement,
    };
  }

  function onTargetMouseDown(event: MouseEvent, origin: DragOrigin): void {
    if (!myTurn || event.button !== 0 || dragRef.current) return;
    if ((event.target as Element).closest('.creature-info')) return;
    dragRef.current = {
      pointerId: -1,
      pointerType: 'mouse',
      ...origin,
      startX: event.clientX,
      startY: event.clientY,
      mode: 'pending',
    };
  }

  dragApiRef.current = {
    begin(drag) {
      if (drag.kind === 'creature') {
        const creature = player.board.find((candidate) => candidate.iid === drag.iid);
        if (!creature || !myTurn) {
          drag.mode = 'dead';
        } else if (!creature.canAttack) {
          setSelection(null);
          setCantAttackWarn({ iid: creature.iid, at: Date.now() });
          sfx.error();
          drag.mode = 'dead';
        } else {
          sfx.click();
          setSelection({ kind: 'attacker', iid: drag.iid });
          drag.mode = 'target';
        }
        return;
      }

      const definition = CARDS[drag.defId];
      setHandFocus(null);
      clearInspect('hand');
      if (!definition || !myTurn) {
        drag.mode = 'dead';
      } else if (definition.cost > player.energy) {
        setEnergyWarnAt(Date.now());
        sfx.error();
        drag.mode = 'dead';
      } else if (definition.target && definition.target !== 'none') {
        sfx.click();
        setSelection({ kind: 'hand', iid: drag.iid });
        drag.mode = 'target';
        setDragCard({
          iid: drag.iid,
          defId: drag.defId,
          x: drag.startX,
          y: drag.startY,
          mode: 'target',
          valid: false,
          label: targetLabel(null, false, drag.defId),
          pointerType: drag.pointerType,
          magnetized: false,
        });
      } else {
        setSelection(null);
        drag.mode = 'lift';
        setDragCard({
          iid: drag.iid,
          defId: drag.defId,
          x: drag.startX,
          y: drag.startY,
          mode: 'play',
          valid: false,
          label: playDropLabel(drag.defId, false),
          pointerType: drag.pointerType,
          magnetized: false,
        });
      }
    },
    move(drag, x, y) {
      if (drag.mode === 'target') {
        const { target, magnetized } = resolveDragTargetAt(drag, x, y);
        const valid = isValidDragTarget(drag, target, enemy.board);
        setDragLockFeedback(drag, target, valid);
        setMouse({ x, y });
        setHover(aimTargetToHover(target));
        setDragCard((card) => card ? {
          ...card,
          x,
          y,
          valid,
          label: targetLabel(target, valid, drag.defId),
          magnetized,
        } : card);
      } else if (drag.mode === 'lift') {
        const definition = CARDS[drag.defId];
        const hasRoom = definition.type !== 'creature' || player.board.length < MAX_BOARD;
        const ready = hasRoom && isPlayDropReady(drag, x, y);
        const nextLock = ready ? 'play-zone' : null;
        if (drag.pointerType === 'touch' && nextLock && drag.lockedTarget !== nextLock) {
          triggerHaptic();
        }
        drag.lockedTarget = nextLock;
        setDragCard((card) => card ? {
          ...card,
          x,
          y,
          valid: ready,
          label: hasRoom ? playDropLabel(drag.defId, ready) : 'Sua mesa está cheia',
        } : card);
      }
    },
    finish(drag, x, y) {
      setDragCard(null);
      if (drag.mode === 'target') {
        const { target } = resolveDragTargetAt(drag, x, y);
        const valid = isValidDragTarget(drag, target, enemy.board);
        if (drag.kind === 'creature') {
          const attacker = player.board.find((creature) => creature.iid === drag.iid);
          if (attacker && target && valid) performAttack(attacker, target);
          else clearAim();
        } else if (target && valid) {
          performPlay(drag.iid, drag.defId, target);
        } else {
          clearAim();
        }
        setMouse(null);
        setHover(null);
      } else if (drag.mode === 'lift') {
        const definition = CARDS[drag.defId];
        const hasRoom = definition.type !== 'creature' || player.board.length < MAX_BOARD;
        if (hasRoom && isPlayDropReady(drag, x, y)) {
          performPlay(drag.iid, drag.defId, null);
        } else {
          clearInspect('hand');
        }
      }
    },
    cancel(drag) {
      if (drag.mode === 'target') clearAim();
      setDragCard(null);
      setMouse(null);
      setHover(null);
    },
  };

  return { onTargetMouseDown, onTargetPointerDown };
}
