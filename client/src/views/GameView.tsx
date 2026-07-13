import { useEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_BOARD } from '@legendsclash/shared';
import type { CreatureOnBoard } from '@legendsclash/shared';
import { send, useAppState } from '../store';
import {
  IcoCheck, IcoSurrender, IcoTarget,
} from '../icons';
import { CardView } from '../components/CardView';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RulesModal } from '../components/RulesModal';
import { Tutorial } from '../components/Tutorial';
import { CodexView } from './CodexView';
import { sfx } from '../sounds';
import { triggerHaptic, usePreferences } from '../preferences';
import { Creature, GhostCreature, HeroPlate } from '../features/game/components/ArenaPieces';
import type { AimMode } from '../features/game/components/AimOverlay';
import { GameSidePanel, MobileGameToolbar } from '../features/game/components/GameChrome';
import type { SidePane } from '../features/game/components/GameChrome';
import { GameInteractionOverlays } from '../features/game/components/GameInteractionOverlays';
import type { HandConfirm, TargetHint } from '../features/game/components/GameInteractionOverlays';
import { GameOverOverlay } from '../features/game/components/GameOverOverlay';
import { MulliganOverlay } from '../features/game/components/MulliganOverlay';
import { TurnHud } from '../features/game/components/TurnHud';
import {
  PLAY_LIFT_PX,
  TOUCH_DROP_SLOP_PX,
  TOUCH_PLAY_LIFT_PX,
  TOUCH_TARGET_MAGNET_PX,
} from '../features/game/drag-gesture-model';
import type {
  DragCardVisual,
  DragOrigin,
  DragState,
} from '../features/game/drag-gesture-model';
import { DAMAGE_SOURCE_TTL, ENEMY_ATTACK_FX_TTL } from '../features/game/feedback-model';
import type { Bubble } from '../features/game/feedback-model';
import { deriveGameHud } from '../features/game/hud-model';
import { useCardInspection } from '../features/game/hooks/useCardInspection';
import { useCardImagePreload } from '../features/game/hooks/useCardImagePreload';
import { useDragGesture } from '../features/game/hooks/useDragGesture';
import { useGameFeedback } from '../features/game/hooks/useGameFeedback';
import { useHandFocus } from '../features/game/hooks/useHandFocus';
import { useTurnClock } from '../features/game/hooks/useTurnClock';
import {
  CAN_HOVER,
  TAUNT_COOLDOWN_MS,
  dupPositions, handIntent,
} from '../features/game/view-model';
import {
  aimTargetToHover,
  combatPreviewFor,
  deriveTargetingState,
  distanceFromRect,
  isHoverTargetValid,
  isValidDragTarget,
  noTargetActionLabel,
  playDropLabel,
  targetAnchor,
  targetFromAnchor,
  targetKey,
  targetLabel,
} from '../features/game/targeting-model';
import type {
  AimTarget,
  ArrowGeometry,
  HoverTarget,
  Selection,
} from '../features/game/targeting-model';

export function GameView() {
  const s = useAppState();
  const preferences = usePreferences();
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [hoverCost, setHoverCost] = useState(0);
  const [energyWarnAt, setEnergyWarnAt] = useState(0);
  const [cantAttackWarn, setCantAttackWarn] = useState<{ iid: string; at: number } | null>(null);
  const [tauntOpen, setTauntOpen] = useState(false);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  // Tutorial pertence ao jogador, nao ao dispositivo compartilhado.
  const tutorialStorageKey = `lc_tutorial_done:${s.profile?.id ?? 'unknown'}`;
  const [tutorialDismissed, setTutorialDismissed] = useState(() => {
    try { return localStorage.getItem(tutorialStorageKey) === '1'; } catch { return false; }
  });
  // Copia elevada da carta arrastada. Fica fora do overflow da mao e acima da arena.
  const [dragCard, setDragCard] = useState<DragCardVisual | null>(null);
  // gaveta lateral no mobile: log/chat viram bottom-sheet com badge de não lidas
  const [sidePane, setSidePane] = useState<SidePane>(null);
  const [chatSeen, setChatSeen] = useState(0);
  const [confirmSurrenderOpen, setConfirmSurrenderOpen] = useState(false);
  const tauntCooldownRef = useRef(0);
  const { clearInspect, inspect, showInspect } = useCardInspection();
  const {
    cancelDrag,
    consumeSyntheticClick,
    dragApiRef,
    dragRef,
  } = useDragGesture(() => setMouse(null));

  const game = s.game;
  const me = useMemo(
    () => (game && game.yourSeat >= 0 ? game.seats[game.yourSeat] : null),
    [game],
  );
  const {
    myTurn,
    now,
    secondsLeft,
    timeUrgent,
    timerPct,
    turnOwnerIsMe,
  } = useTurnClock(game, !!me);
  const {
    handFocus,
    handRef,
    setHandFocus,
    touchPlayConfirm,
  } = useHandFocus(game, myTurn);
  const {
    attackFx,
    banner,
    bubbles,
    damageNotice,
    dismissTeach,
    effects: fx,
    ghosts,
    reveals,
    setAttackFx,
    teach,
  } = useGameFeedback({
    battleHints: preferences.battleHints,
    chat: s.chat,
    game,
    gameOver: s.gameOver,
    now,
    onTurnChanged: () => {
      setSelection(null);
      setHover(null);
    },
    profileId: s.profile?.id,
  });
  useCardImagePreload(game, reveals);

  const firstMatch = !!s.profile && s.profile.wins + s.profile.losses === 0;
  const tutorialVisible = firstMatch && !tutorialDismissed && !s.gameOver;

  function finishTutorial() {
    try { localStorage.setItem(tutorialStorageKey, '1'); } catch { /* armazenamento opcional */ }
    setTutorialDismissed(true);
  }

  useEffect(() => {
    if (!tutorialVisible || !game || game.status !== 'active' || !s.connected) return;
    const announceOpen = () => send({ t: 'game:tutorial', open: true });
    announceOpen();
    // Reafirma o estado apos suspensoes longas de aba/rede movel. O servidor
    // trata mensagens repetidas sem broadcast adicional.
    const heartbeat = window.setInterval(announceOpen, 15_000);
    return () => {
      window.clearInterval(heartbeat);
      send({ t: 'game:tutorial', open: false });
    };
  }, [game?.matchId, game?.status, s.connected, tutorialVisible]);

  // Segunda barreira contra refresh acidental. O servidor mantém a partida
  // viva, mas navegadores compatíveis ainda pedem confirmação antes de sair.
  useEffect(() => {
    if (!game || game.status === 'finished' || s.gameOver) return;
    const protectActiveMatch = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectActiveMatch);
    return () => window.removeEventListener('beforeunload', protectActiveMatch);
  }, [game?.matchId, game?.status, s.gameOver?.matchId]);

  // cancela a seleção com Esc ou clique com o botão direito
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelDrag();
        clearAim();
        setTauntOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDrag]);

  // gaveta de chat aberta = mensagens consideradas lidas (badge zera)
  useEffect(() => {
    if (sidePane === 'chat') setChatSeen(s.chat.length);
  }, [sidePane, s.chat.length]);

  if (!game || !me) return null;

  // Fase de mulligan: tela própria de troca de mão, antes do tabuleiro.
  // (Seguro como early return: não há hooks depois deste ponto no componente.)
  if (game.status === 'mulligan') return <MulliganOverlay game={game} me={me} />;

  const enemySeatIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
  const enemy = game.seats[enemySeatIdx];
  const hud = deriveGameHud({ hand: game.hand, player: me, enemy, myTurn });

  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((c) => c.iid === selection.iid)?.defId ?? '']
    : null;
  const selectedAttacker = selection?.kind === 'attacker'
    ? me.board.find((c) => c.iid === selection.iid) ?? null
    : null;
  const focusedHandDef = handFocus ? CARDS[handFocus.defId] : null;

  // Dinâmica Yu-Gi-Oh: criaturas em campo protegem o comandante de ataques
  // e magias (apenas efeitos especiais "pierce" atravessam).
  const faceShielded = enemy.board.length > 0;
  // Provocar: prioridade entre criaturas — a com a palavra-chave vai primeiro
  const enemyTaunts = enemy.board.filter((c) => CARDS[c.defId].keywords?.includes('taunt'));
  const mustHitTaunt = selection?.kind === 'attacker' && enemyTaunts.length > 0;
  const tauntFocusName = enemyTaunts[0] ? CARDS[enemyTaunts[0].defId].name : 'criatura com Provocar';

  // Cartas iguais na mesa ganham o número da posição (casa com o log do
  // servidor) — assim o efeito/dano nunca fica ambíguo entre cópias idênticas.
  const enemyPos = dupPositions(enemy.board);
  const myPos = dupPositions(me.board);

  // A regra vive no modelo puro; o componente apenas fornece o snapshot atual.
  function previewFor(target: HoverTarget) {
    return combatPreviewFor({
      target,
      myTurn,
      attacker: selectedAttacker,
      selectedCard: selectedHandDef,
      player: me!,
      enemy,
    });
  }
  const preview = previewFor(hover);

  // ── Ações ───────────────────────────────────────────────────────
  // Núcleo parametrizado, compartilhado pelo clique-clique e pelo arrasto
  // (Pointer Events): validações de Provocar/escudo/energia num lugar só.

  function clearAim() {
    setSelection(null);
    setHover(null);
    setMouse(null);
    setDragCard(null);
    setHoverCost(0);
    setHandFocus(null);
    clearInspect('hand');
  }

  function focusHandCard(iid: string, defId: string) {
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

  function confirmFocusedHandPlay() {
    if (!handFocus || !game) return;
    const current = game.hand.find((c) => c.iid === handFocus.iid);
    if (!current) {
      setHandFocus(null);
      return;
    }
    performPlay(current.iid, current.defId, null);
  }

  /** Dispara uma provocação no chat da partida (cadência no cliente p/ UX; o
   *  servidor reforça o cooldown e valida o id contra o catálogo). */
  function sendTaunt(id: string) {
    setTauntOpen(false);
    const ts = Date.now();
    if (ts - tauntCooldownRef.current < TAUNT_COOLDOWN_MS) return;
    tauntCooldownRef.current = ts;
    send({ t: 'chat:taunt', id });
  }

  function requestSurrender() {
    sfx.click();
    setTauntOpen(false);
    setSidePane(null);
    setConfirmSurrenderOpen(true);
  }

  function confirmSurrender() {
    sfx.click();
    setConfirmSurrenderOpen(false);
    send({ t: 'game:surrender' });
  }

  /** Ataca com a criatura no alvo; valida Provocar e proteção do comandante. */
  function performAttack(attacker: CreatureOnBoard, t: AimTarget): void {
    if (!myTurn || !attacker.canAttack) return;
    if (t.kind === 'my-creature') {
      sfx.error();
      return; // sem fogo amigo
    }
    if (t.kind === 'face') {
      if (faceShielded) {
        sfx.error();
        return;
      }
      send({ t: 'game:attack', attackerIid: attacker.iid, target: { seat: enemySeatIdx } });
    } else {
      if (enemyTaunts.length > 0 && !CARDS[t.c.defId].keywords?.includes('taunt')) {
        sfx.error();
        return; // alvo bloqueado por Provocar — o visual já explica
      }
      send({ t: 'game:attack', attackerIid: attacker.iid, target: { seat: enemySeatIdx, iid: t.c.iid } });
    }
    setAttackFx({ iid: attacker.iid, at: Date.now() });
    sfx.attack();
    clearAim();
  }

  /** Joga a carta da mão (com ou sem alvo), preservando a mira quando o alvo é inválido. */
  function performPlay(iid: string, defId: string, t: AimTarget | null): void {
    if (!myTurn) return;
    const def = CARDS[defId];
    if (def.cost > me!.energy) {
      // feedback de "por que não posso?": cristais tremem + som de erro
      setEnergyWarnAt(Date.now());
      sfx.error();
      return;
    }
    const wants = def.target ?? 'none';
    if (wants === 'none') {
      send({ t: 'game:play', iid });
    } else if (!t) {
      return;
    } else if (wants === 'friendly-creature') {
      if (t.kind !== 'my-creature') {
        sfx.error();
        return;
      }
      send({ t: 'game:play', iid, target: { seat: game!.yourSeat, iid: t.c.iid } });
    } else if (t.kind === 'enemy-creature') {
      if (wants !== 'enemy-creature' && wants !== 'enemy-any') {
        sfx.error();
        return;
      }
      send({ t: 'game:play', iid, target: { seat: enemySeatIdx, iid: t.c.iid } });
    } else if (t.kind === 'face') {
      if (wants !== 'enemy-any') {
        sfx.error();
        return;
      }
      if (faceShielded && !def.pierce) {
        sfx.error();
        return; // criaturas protegem o comandante até de magias
      }
      send({ t: 'game:play', iid, target: { seat: enemySeatIdx } });
    } else {
      sfx.error();
      return;
    }
    clearInspect('hand');
    if (def.type === 'creature') sfx.summon(); else sfx.play();
    clearAim();
  }

  function clickHandCard(iid: string, defId: string) {
    if (!myTurn) return;
    const def = CARDS[defId];
    if (def.cost > me!.energy) {
      setEnergyWarnAt(Date.now());
      sfx.error();
      return;
    }
    if (def.target === 'none' || !def.target) {
      if (touchPlayConfirm) {
        focusHandCard(iid, defId);
        return;
      }
      performPlay(iid, defId, null);
    } else {
      sfx.click();
      setHandFocus(null);
      clearInspect('hand');
      setSelection(selection?.kind === 'hand' && selection.iid === iid ? null : { kind: 'hand', iid });
    }
  }

  function clickMyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef) {
      if (selectedHandDef.target === 'friendly-creature') {
        performPlay(selection.iid, selectedHandDef.id, { kind: 'my-creature', c });
      } else {
        sfx.error();
      }
      return;
    }
    if (c.canAttack) {
      sfx.click();
      setSelection(
        selection?.kind === 'attacker' && selection.iid === c.iid ? null : { kind: 'attacker', iid: c.iid },
      );
    } else {
      // criatura que não pode atacar: limpa a seleção e avisa — nunca deixar
      // uma seleção antiga ativa em silêncio (o ataque sairia do monstro errado)
      setSelection(null);
      setCantAttackWarn({ iid: c.iid, at: Date.now() });
      sfx.error();
    }
  }

  function clickEnemyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef) {
      performPlay(selection.iid, selectedHandDef.id, { kind: 'enemy-creature', c });
    } else if (selection?.kind === 'attacker' && selectedAttacker) {
      performAttack(selectedAttacker, { kind: 'enemy-creature', c });
    }
  }

  function clickEnemyFace() {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef) {
      performPlay(selection.iid, selectedHandDef.id, { kind: 'face' });
    } else if (selection?.kind === 'attacker' && selectedAttacker) {
      performAttack(selectedAttacker, { kind: 'face' });
    }
  }

  // ── Arrasto para mirar/jogar (mouse e toque via Pointer Events) ──

  /** Resolve o alvo exato sob o ponteiro pelos data-anchor presentes no DOM. */
  function resolveTargetAt(x: number, y: number): AimTarget | null {
    const anchor = document.elementFromPoint(x, y)?.closest('[data-anchor]')?.getAttribute('data-anchor');
    return targetFromAnchor(anchor, enemySeatIdx, enemy.board, me!.board);
  }

  /**
   * O dedo cobre parte do alvo. Quando não há um elemento exatamente sob ele,
   * aproxima para o destino válido mais próximo, sem atravessar um alvo inválido.
   */
  function resolveDragTargetAt(drag: DragState, x: number, y: number): { target: AimTarget | null; magnetized: boolean } {
    const exact = resolveTargetAt(x, y);
    if (exact || drag.pointerType !== 'touch') return { target: exact, magnetized: false };

    const candidates: AimTarget[] = [
      { kind: 'face' },
      ...enemy.board.map((c) => ({ kind: 'enemy-creature' as const, c })),
      ...me!.board.map((c) => ({ kind: 'my-creature' as const, c })),
    ];
    let nearest: AimTarget | null = null;
    let nearestDistance = TOUCH_TARGET_MAGNET_PX + 1;
    for (const candidate of candidates) {
      if (!isValidDragTarget(drag, candidate, enemy.board)) continue;
      const element = document.querySelector<HTMLElement>(`[data-anchor="${targetAnchor(candidate, enemySeatIdx)}"]`);
      if (!element) continue;
      const distance = distanceFromRect(x, y, element.getBoundingClientRect());
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return {
      target: nearestDistance <= TOUCH_TARGET_MAGNET_PX ? nearest : null,
      magnetized: !!nearest && nearestDistance <= TOUCH_TARGET_MAGNET_PX,
    };
  }

  function setDragLockFeedback(drag: DragState, target: AimTarget | null, valid: boolean): void {
    const next = valid && target ? targetKey(target) : null;
    if (drag.pointerType === 'touch' && next && next !== drag.lockedTarget) {
      triggerHaptic();
    }
    drag.lockedTarget = next;
  }

  function isPlayDropReady(drag: DragState, x: number, y: number): boolean {
    const def = CARDS[drag.defId];
    if (!def) return false;
    const lift = drag.startY - y;
    const requiredLift = drag.pointerType === 'touch' ? TOUCH_PLAY_LIFT_PX : PLAY_LIFT_PX;
    if (lift < requiredLift) return false;
    if (def.type !== 'creature' || drag.pointerType !== 'touch') return true;

    const row = document.querySelector<HTMLElement>('.my-row');
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return x >= rect.left - TOUCH_DROP_SLOP_PX
      && x <= rect.right + TOUCH_DROP_SLOP_PX
      && y >= rect.top - TOUCH_DROP_SLOP_PX
      && y <= rect.bottom + TOUCH_DROP_SLOP_PX;
  }

  /** Início de gesto numa carta da mão ou criatura própria. */
  function onTargetPointerDown(e: React.PointerEvent, origin: DragOrigin) {
    if (!myTurn || !e.isPrimary || e.button !== 0) return;
    if ((e.target as Element).closest('.creature-info')) return;
    if (dragRef.current) cancelDrag();
    dragRef.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      ...origin,
      startX: e.clientX,
      startY: e.clientY,
      mode: 'pending',
      captureEl: e.currentTarget as HTMLElement,
    };
  }

  function onTargetMouseDown(e: React.MouseEvent, origin: DragOrigin) {
    if (!myTurn || e.button !== 0 || dragRef.current) return;
    if ((e.target as Element).closest('.creature-info')) return;
    dragRef.current = {
      pointerId: -1,
      pointerType: 'mouse',
      ...origin,
      startX: e.clientX,
      startY: e.clientY,
      mode: 'pending',
    };
  }

  // fechamento fresco deste render para os listeners de window
  dragApiRef.current = {
    begin(drag) {
      if (drag.kind === 'creature') {
        const c = me?.board.find((x) => x.iid === drag.iid);
        if (!c || !myTurn) {
          drag.mode = 'dead';
        } else if (!c.canAttack) {
          setSelection(null);
          setCantAttackWarn({ iid: c.iid, at: Date.now() });
          sfx.error();
          drag.mode = 'dead';
        } else {
          sfx.click();
          setSelection({ kind: 'attacker', iid: drag.iid });
          drag.mode = 'target';
        }
        return;
      }
      const def = CARDS[drag.defId];
      setHandFocus(null);
      clearInspect('hand');
      if (!def || !myTurn) {
        drag.mode = 'dead';
      } else if (def.cost > me!.energy) {
        setEnergyWarnAt(Date.now());
        sfx.error();
        drag.mode = 'dead';
      } else if (def.target && def.target !== 'none') {
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
        const def = CARDS[drag.defId];
        const hasRoom = def.type !== 'creature' || me!.board.length < MAX_BOARD;
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
        const { target: t } = resolveDragTargetAt(drag, x, y);
        const valid = isValidDragTarget(drag, t, enemy.board);
        if (drag.kind === 'creature') {
          const attacker = me?.board.find((c) => c.iid === drag.iid);
          if (attacker && t && valid) performAttack(attacker, t);
          else clearAim(); // soltou no vazio: cancela a mira
        } else if (t && valid) {
          performPlay(drag.iid, drag.defId, t);
        } else {
          clearAim();
        }
        // alvo bloqueado (Provocar/escudo) mantém a seleção para o tap-tap,
        // mas a seta não deve ficar congelada no ponto do último toque
        setMouse(null);
        setHover(null);
      } else if (drag.mode === 'lift') {
        const def = CARDS[drag.defId];
        const hasRoom = def.type !== 'creature' || me!.board.length < MAX_BOARD;
        if (hasRoom && isPlayDropReady(drag, x, y)) performPlay(drag.iid, drag.defId, null);
        else clearInspect('hand');
      }
    },
    cancel(drag) {
      // navegador tomou o gesto (rolagem da mão, gesto de sistema): limpa tudo
      if (drag.mode === 'target') clearAim();
      setDragCard(null);
      setMouse(null);
      setHover(null);
    },
  };

  const targeting = deriveTargetingState(selection, selectedHandDef);
  const targetingFriendly = targeting.friendly;
  const targetingEnemyCreature = targeting.enemyCreature;
  const targetingFace = targeting.face;

  const fxFor = (anchor: string) => fx.filter((f) => f.anchor === anchor);
  const ghostsFor = (seatIdx: number) => ghosts.filter((g) => g.seatIdx === seatIdx);
  const bubbleFor = (seatIdx: number): Bubble | null => {
    let latest: Bubble | null = null;
    for (const b of bubbles) if (b.seatIdx === seatIdx && (!latest || b.at >= latest.at)) latest = b;
    return latest;
  };

  // alvo válido sob o ponteiro? (trava a seta e mostra a retícula nele)
  const hoverValid = isHoverTargetValid({
    hover,
    targeting,
    selectedCard: selectedHandDef,
    playerBoard: me.board,
    enemyBoard: enemy.board,
    mustHitTaunt,
  });
  const draggingHandTarget = dragCard?.mode === 'target';
  const draggingCreaturePlay = dragCard?.mode === 'play' && CARDS[dragCard.defId]?.type === 'creature';

  // ── Seta de mira ────────────────────────────────────────────────
  // A ponta segue o ponteiro; sobre um alvo válido ela "trava" no centro
  // dele e troca a flecha por uma retícula pulsante (estilo Hearthstone).
  let arrow: ArrowGeometry | null = null;
  let lockOn = false;
  if (selection && mouse) {
    const originKey = selection.kind === 'attacker' ? `cr-${selection.iid}` : `hand-${selection.iid}`;
    const el = document.querySelector(`[data-anchor="${originKey}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      let x2 = mouse.x;
      let y2 = mouse.y;
      if (hoverValid && hover) {
        const tKey = hover.kind === 'face' ? `face-${enemySeatIdx}` : `cr-${hover.iid}`;
        const te = document.querySelector(`[data-anchor="${tKey}"]`);
        if (te) {
          const tr = te.getBoundingClientRect();
          x2 = tr.left + tr.width / 2;
          y2 = tr.top + tr.height / 2;
          lockOn = true;
        }
      }
      arrow = { x1: r.left + r.width / 2, y1: r.top + r.height / 2, x2, y2 };
    }
  }

  const energyWarn = now - energyWarnAt < 600;
  const faceLethal = !!preview?.lethal && hover?.kind === 'face';
  const lethalAim = !!preview?.lethal; // colore a seta também no overflow letal
  const aimMode: AimMode = lethalAim
    ? 'lethal'
    : selection?.kind === 'attacker'
      ? 'attack'
      : targetingFriendly
        ? 'support'
        : 'spell';
  const unreadChat = Math.max(0, s.chat.length - chatSeen);

  // prévia de dano em TODOS os alvos válidos ao selecionar — decisão
  // informada sem depender de hover (essencial no toque)
  const staticFacePreview = targetingFace && hover?.kind !== 'face' ? previewFor({ kind: 'face' }) : null;
  const targetHint: TargetHint | null = selection?.kind === 'attacker'
    ? {
      mode: 'attack',
      title: selectedAttacker ? CARDS[selectedAttacker.defId].name : 'Ataque selecionado',
      body: mustHitTaunt
        ? `${tauntFocusName} está protegendo a mesa. Ataque Provocar primeiro.`
        : faceShielded
          ? 'As criaturas inimigas protegem o comandante. Remova a mesa para abrir dano direto.'
          : 'Mesa livre. Escolha um alvo e confirme pela prévia de dano.',
    }
    : selection?.kind === 'hand' && selectedHandDef
      ? {
        mode: selectedHandDef.target === 'friendly-creature' ? 'support' : 'spell',
        title: selectedHandDef.name,
        body: selectedHandDef.target === 'friendly-creature'
          ? 'Escolha uma criatura aliada para receber o efeito.'
          : faceShielded && !selectedHandDef.pierce
            ? 'As criaturas inimigas bloqueiam o comandante. Mire uma criatura primeiro.'
            : 'Escolha o melhor alvo usando a prévia de dano.',
      }
      : null;
  const handConfirm: HandConfirm | null = touchPlayConfirm && handFocus && focusedHandDef && myTurn
    ? {
      mode: 'play' as const,
      title: focusedHandDef.name,
      body: 'Revise antes de jogar.',
      actionLabel: noTargetActionLabel(handFocus.defId),
    }
    : null;
  const visibleInspect = inspect
    && (!selection || inspect.source === 'creature')
    && !dragCard
    && game.status === 'active'
    && (inspect.source === 'creature' || game.hand.some((card) => card.iid === inspect.iid))
    ? inspect
    : null;

  return (
    <div
      className={`game-screen ${selection ? 'is-aiming' : ''} ${dragCard ? 'dragging-hand-card' : ''} ${handFocus ? 'has-hand-focus' : ''}`}
      onPointerMove={selection ? (e) => setMouse({ x: e.clientX, y: e.clientY }) : undefined}
      onContextMenu={selection ? (e) => { e.preventDefault(); clearAim(); } : undefined}
      onClickCapture={consumeSyntheticClick}
    >
      <MobileGameToolbar
        sidePane={sidePane}
        unreadChat={unreadChat}
        onPaneChange={setSidePane}
        onShowRules={() => setShowRules(true)}
        onShowCodex={() => setShowCodex(true)}
        onSurrender={requestSurrender}
      />
      <div
        className="game-board"
        onClick={(e) => {
          // toque em área vazia da arena cancela a mira/provocação (equivalente do Esc)
          if (!(e.target as Element).closest('[data-anchor], button, .hand')) {
            clearAim();
            setTauntOpen(false);
            clearInspect('creature');
          }
        }}
      >
        <HeroPlate
          seat={enemy}
          seatIdx={enemySeatIdx}
          isEnemy
          onFaceClick={clickEnemyFace}
          targetable={!!targetingFace && (!faceShielded || !!selectedHandDef?.pierce)}
          blocked={!!targetingFace && faceShielded && !selectedHandDef?.pierce}
          dropTarget={!!draggingHandTarget && !!targetingFace && (!faceShielded || !!selectedHandDef?.pierce)}
          dropHovered={!!draggingHandTarget && hoverValid && hover?.kind === 'face'}
          lethal={faceLethal || !!staticFacePreview?.lethal}
          preview={hover?.kind === 'face' ? preview : staticFacePreview}
          previewDim={hover?.kind !== 'face' && !!staticFacePreview}
          onHover={(h) => setHover(h ? { kind: 'face' } : null)}
          fx={fxFor(`face-${enemySeatIdx}`)}
          bubble={bubbleFor(enemySeatIdx)}
        />

        <div className={`board-row enemy-row ${targetingEnemyCreature ? 'targetable' : ''} ${draggingHandTarget && targetingEnemyCreature ? 'drop-destinations enemy' : ''}`}>
          {draggingHandTarget && targetingEnemyCreature && enemy.board.length > 0 && (
            <span className="drop-zone-label enemy"><IcoTarget className="ic" /> Destinos possíveis</span>
          )}
          {enemy.board.map((c, i) => {
            const isTaunt = CARDS[c.defId].keywords?.includes('taunt');
            const blocked = !!mustHitTaunt && !isTaunt;
            const hovered = hover?.kind === 'creature' && hover.iid === c.iid;
            // chip estático em cada alvo válido enquanto algo está selecionado
            const staticPv = !hovered && targetingEnemyCreature && !blocked
              ? previewFor({ kind: 'creature', iid: c.iid })
              : null;
            return (
              <Creature
                key={c.iid}
                c={c}
                bonus={enemy.attackBonus}
                lunging={attackFx?.iid === c.iid && now - attackFx.at < ENEMY_ATTACK_FX_TTL}
                sourceActive={damageNotice?.sourceIid === c.iid && now - damageNotice.at < DAMAGE_SOURCE_TTL}
                blocked={blocked}
                dropTarget={!!draggingHandTarget && !!targetingEnemyCreature && !blocked}
                dropHovered={!!draggingHandTarget && hoverValid && hovered}
                dropTone="enemy"
                posIndex={enemyPos.get(c.iid)}
                preview={hovered ? preview : staticPv}
                previewDim={!hovered && !!staticPv}
                onHover={(on) => setHover(on ? { kind: 'creature', iid: c.iid } : null)}
                fx={fxFor(`cr-${c.iid}`)}
                onClick={() => clickEnemyCreature(c)}
                onInspect={(e) => showInspect({
                  iid: c.iid,
                  defId: c.defId,
                  x: e.clientX,
                  y: e.clientY - 12,
                  source: 'creature',
                }, 3200)}
                style={{ order: i * 2 }}
              />
            );
          })}
          {ghostsFor(enemySeatIdx).map((g) => <GhostCreature key={g.id} g={g} />)}
          {enemy.board.length === 0 && ghostsFor(enemySeatIdx).length === 0 && (
            <div className="board-empty">mesa vazia</div>
          )}
        </div>

        <TurnHud
          game={game}
          player={me}
          hud={hud}
          myTurn={myTurn}
          turnOwnerIsMe={turnOwnerIsMe}
          secondsLeft={secondsLeft}
          timeUrgent={timeUrgent}
          timerPct={timerPct}
          tauntOpen={tauntOpen}
          onEndTurn={() => { sfx.click(); send({ t: 'game:endTurn' }); }}
          onToggleTaunt={() => setTauntOpen((open) => !open)}
          onTaunt={sendTaunt}
        />

        <div className={`board-row my-row ${targetingFriendly ? 'friendly-targetable' : ''} ${draggingHandTarget && targetingFriendly ? 'drop-destinations support' : ''} ${draggingCreaturePlay ? `card-drop-zone ${dragCard?.valid ? 'ready' : ''}` : ''}`}>
          {draggingHandTarget && targetingFriendly && me.board.length > 0 && (
            <span className="drop-zone-label support"><IcoTarget className="ic" /> Criaturas aliadas</span>
          )}
          {draggingCreaturePlay && (
            <span className="drop-zone-label play"><IcoCheck className="ic" /> {me.board.length >= MAX_BOARD ? 'Mesa cheia' : 'Solte para invocar'}</span>
          )}
          {me.board.map((c, i) => (
            <Creature
              key={c.iid}
              c={c}
              bonus={me.attackBonus}
              mine
              selected={selection?.kind === 'attacker' && selection.iid === c.iid}
              buffTarget={targetingFriendly}
              dropTarget={!!draggingHandTarget && !!targetingFriendly}
              dropHovered={!!draggingHandTarget && hoverValid && hover?.kind === 'creature' && hover.iid === c.iid}
              dropTone="support"
              lunging={attackFx?.iid === c.iid && now - attackFx.at < 500}
              warn={cantAttackWarn?.iid === c.iid && now - cantAttackWarn.at < 600}
              posIndex={myPos.get(c.iid)}
              retaliation={preview?.attackerIid === c.iid ? preview : null}
              fx={fxFor(`cr-${c.iid}`)}
              onClick={() => clickMyCreature(c)}
              onPointerDown={(e) => onTargetPointerDown(e, { kind: 'creature', iid: c.iid, defId: c.defId })}
              onMouseDown={(e) => onTargetMouseDown(e, { kind: 'creature', iid: c.iid, defId: c.defId })}
              onInspect={(e) => showInspect({
                iid: c.iid,
                defId: c.defId,
                x: e.clientX,
                y: e.clientY - 12,
                source: 'creature',
              }, 3200)}
              style={{ order: i * 2 }}
            />
          ))}
          {ghostsFor(game.yourSeat).map((g) => <GhostCreature key={g.id} g={g} />)}
          {me.board.length === 0 && ghostsFor(game.yourSeat).length === 0 && (
            <div className="board-empty">invoque criaturas aqui</div>
          )}
        </div>

        <HeroPlate
          seat={me}
          seatIdx={game.yourSeat}
          pendingCost={selection?.kind === 'hand' && selectedHandDef ? selectedHandDef.cost : hoverCost}
          energyWarn={energyWarn}
          fx={fxFor(`face-${game.yourSeat}`)}
          bubble={bubbleFor(game.yourSeat)}
          impact={damageNotice}
        />

        <div className="hand" ref={handRef}>
          {game.hand.map((c, i) => {
            const off = i - (game.hand.length - 1) / 2;
            const isSelected = selection?.kind === 'hand' && selection.iid === c.iid;
            const isFocused = handFocus?.iid === c.iid;
            const affordable = CARDS[c.defId].cost <= me.energy;
            const dragging = dragCard?.iid === c.iid;
            const intent = affordable && myTurn ? handIntent(c.defId, isSelected) : null;
            return (
              <CardView
                key={c.iid}
                defId={c.defId}
                anchorId={`hand-${c.iid}`}
                playable={myTurn && affordable}
                selected={isSelected || isFocused}
                lifting={dragging}
                className={[
                  myTurn && !affordable ? 'unaffordable' : '',
                  dragging ? 'drag-origin' : '',
                ].filter(Boolean).join(' ') || undefined}
                statusLabel={myTurn && !affordable ? `Falta ${CARDS[c.defId].cost - me.energy}` : isFocused ? 'Pronta' : intent?.label}
                statusTone={myTurn && !affordable ? 'warn' : isFocused ? 'good' : intent?.tone}
                onClick={() => clickHandCard(c.iid, c.defId)}
                onPointerDown={myTurn ? (e) => onTargetPointerDown(e, { kind: 'hand', iid: c.iid, defId: c.defId }) : undefined}
                onMouseDown={myTurn ? (e) => onTargetMouseDown(e, { kind: 'hand', iid: c.iid, defId: c.defId }) : undefined}
                onMouseEnter={(e) => {
                  if (myTurn && affordable) setHoverCost(CARDS[c.defId].cost);
                  if (!CAN_HOVER) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  showInspect({
                    iid: c.iid,
                    defId: c.defId,
                    x: r.left + r.width / 2,
                    y: r.top - 10,
                    source: 'hand',
                  });
                }}
                onMouseLeave={() => { setHoverCost(0); clearInspect('hand'); }}
                style={isSelected && !dragging ? undefined : {
                  transform: `rotate(${off * 2.5}deg) translateY(${Math.abs(off) * 5}px)`,
                }}
              />
            );
          })}
        </div>
      </div>

      <GameSidePanel
        sidePane={sidePane}
        player={me}
        enemy={enemy}
        readyDamage={hud.readyDamage}
        enemyBoardDamage={hud.enemyBoardDamage}
        log={game.log}
        onClose={() => setSidePane(null)}
        onShowRules={() => setShowRules(true)}
        onShowCodex={() => setShowCodex(true)}
        onSurrender={requestSurrender}
      />

      <GameInteractionOverlays
        dragCard={dragCard}
        targetHint={targetHint}
        handConfirm={handConfirm}
        handFocus={handFocus}
        onClearAim={clearAim}
        onConfirmFocusedHandPlay={confirmFocusedHandPlay}
        arrow={arrow}
        lockOn={lockOn}
        aimMode={aimMode}
        tacticAim={selectedHandDef?.type === 'tactic'}
        reveals={reveals}
        inspect={visibleInspect}
        banner={banner}
        hideBanner={!!s.gameOver}
        teach={teach}
        onDismissTeach={dismissTeach}
      />
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showCodex && <CodexView onClose={() => setShowCodex(false)} />}
      {tutorialVisible && <Tutorial paused={game.turnPaused} onClose={finishTutorial} />}
      {confirmSurrenderOpen && (
        <ConfirmDialog
          tone="danger"
          icon={<IcoSurrender />}
          title="Desistir da partida?"
          message="A derrota será registrada imediatamente e o oponente receberá a vitória. Use apenas se não quiser continuar este duelo."
          cancelLabel="Continuar jogando"
          confirmLabel="Desistir agora"
          onCancel={() => setConfirmSurrenderOpen(false)}
          onConfirm={confirmSurrender}
        />
      )}
      {s.gameOver && <GameOverOverlay />}
    </div>
  );
}
