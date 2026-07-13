import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_BOARD, TAUNTS } from '@legendsclash/shared';
import type { CreatureOnBoard } from '@legendsclash/shared';
import { send, useAppState } from '../store';
import { TauntIcon } from '../cosmetics';
import {
  IcoAttack, IcoBanner, IcoBot, IcoBuff, IcoChat, IcoCheck, IcoClose, IcoCodex, IcoDeath,
  IcoDeck, IcoEnergy, IcoEvents, IcoHand, IcoHint, IcoPause, IcoRules, IcoSparkle,
  IcoSurrender, IcoTarget, IcoTaunt, IcoTimer, IcoWarning,
} from '../icons';
import { CardView } from '../components/CardView';
import { Chat } from '../components/Chat';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RulesModal } from '../components/RulesModal';
import { Tutorial } from '../components/Tutorial';
import { CodexView } from './CodexView';
import { SoundControl } from '../components/SoundControl';
import { sfx } from '../sounds';
import { triggerHaptic, usePreferences } from '../preferences';
import { Creature, GhostCreature, HeroPlate } from '../features/game/components/ArenaPieces';
import { GameOverOverlay } from '../features/game/components/GameOverOverlay';
import { MulliganOverlay } from '../features/game/components/MulliganOverlay';
import { DAMAGE_SOURCE_TTL, ENEMY_ATTACK_FX_TTL } from '../features/game/feedback-model';
import type { Bubble } from '../features/game/feedback-model';
import { useCardImagePreload } from '../features/game/hooks/useCardImagePreload';
import { useGameFeedback } from '../features/game/hooks/useGameFeedback';
import { useTurnClock } from '../features/game/hooks/useTurnClock';
import {
  CAN_HOVER, DRAG_THRESHOLD_PX,
  PACE_CHIP_STYLE, PACE_CHIP_TEXT_STYLE, PACE_CHIP_TIGHT_STYLE, PACE_HUD_STYLE,
  PLAY_LIFT_PX, SPELL_DMG,
  TAUNT_COOLDOWN_MS, TOUCH_CONFIRM_QUERY, TOUCH_DRAG_THRESHOLD_PX, TOUCH_DROP_SLOP_PX,
  TOUCH_PLAY_LIFT_PX, TOUCH_TARGET_MAGNET_PX, TOUCH_VERTICAL_INTENT_PX,
  arrowPath, arrowPoint, dupPositions, formatTurnClock, handIntent, logIcon, logTone,
  noTargetActionLabel,
} from '../features/game/view-model';
import type {
  AimTarget, CoachTone, CombatPreview, DragCardVisual, DragState, HandFocus,
  HoverTarget, InspectCard, Selection,
} from '../features/game/view-model';

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
  // inspeção no hover (desktop): carta ampliada flutuando acima da mão —
  // a mão é um scroll container, então escalar a carta no lugar seria cortado
  const [inspect, setInspect] = useState<InspectCard | null>(null);
  // gaveta lateral no mobile: log/chat viram bottom-sheet com badge de não lidas
  const [sidePane, setSidePane] = useState<'log' | 'chat' | null>(null);
  const [chatSeen, setChatSeen] = useState(0);
  const [confirmSurrenderOpen, setConfirmSurrenderOpen] = useState(false);
  const [handFocus, setHandFocus] = useState<HandFocus>(null);
  const [touchPlayConfirm, setTouchPlayConfirm] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(TOUCH_CONFIRM_QUERY).matches
  ));
  const tauntCooldownRef = useRef(0);
  const inspectTimerRef = useRef<number | null>(null);
  const handRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const cancelDragRef = useRef<() => void>(() => undefined);
  // após um arrasto real, o clique sintético do mouse não deve disparar ações
  const suppressClickRef = useRef(false);
  // entrega aos listeners de window (registrados uma vez) o fechamento mais
  // recente do componente — estado fresco do jogo a cada render
  const dragApiRef = useRef<{
    begin: (drag: DragState) => void;
    move: (drag: DragState, x: number, y: number) => void;
    finish: (drag: DragState, x: number, y: number) => void;
    cancel: (drag: DragState) => void;
  } | null>(null);

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
  const handSignature = game?.hand.map((c) => c.iid).join('|') ?? '';

  function finishTutorial() {
    try { localStorage.setItem(tutorialStorageKey, '1'); } catch { /* armazenamento opcional */ }
    setTutorialDismissed(true);
  }

  function clearInspect(source?: InspectCard['source']) {
    if (inspectTimerRef.current) {
      window.clearTimeout(inspectTimerRef.current);
      inspectTimerRef.current = null;
    }
    setInspect((cur) => (!source || cur?.source === source ? null : cur));
  }

  function showInspect(next: InspectCard, ttlMs?: number) {
    if (inspectTimerRef.current) {
      window.clearTimeout(inspectTimerRef.current);
      inspectTimerRef.current = null;
    }
    setInspect(next);
    if (ttlMs) {
      inspectTimerRef.current = window.setTimeout(() => {
        setInspect((cur) => (
          cur?.iid === next.iid && cur.source === next.source ? null : cur
        ));
        inspectTimerRef.current = null;
      }, ttlMs);
    }
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

  useEffect(() => () => {
    if (inspectTimerRef.current) window.clearTimeout(inspectTimerRef.current);
  }, []);
  // cancela a seleção com Esc ou clique com o botão direito
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelDragRef.current();
        clearAim();
        setTauntOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Arrasto para mirar/jogar: listeners na window unificam mouse e toque
  // (no toque o pointer é capturado pelo elemento de origem; na window os
  // eventos chegam igual e o alvo real vem de elementFromPoint).
  useEffect(() => {
    const releaseCapture = (drag: DragState) => {
      if (drag.pointerId < 0 || !drag.captureEl) return;
      try {
        if (drag.captureEl.hasPointerCapture(drag.pointerId)) {
          drag.captureEl.releasePointerCapture(drag.pointerId);
        }
      } catch { /* o navegador pode liberar a captura antes do pointercancel */ }
    };
    const suppressSyntheticClick = () => {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 400);
    };
    const cancelActiveDrag = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      releaseCapture(drag);
      dragApiRef.current?.cancel(drag);
    };
    cancelDragRef.current = cancelActiveDrag;

    const moveDrag = (drag: DragState, x: number, y: number) => {
      if (!dragApiRef.current) return;
      if (drag.mode === 'pending') {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        const threshold = drag.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
        if (Math.hypot(dx, dy) < threshold) return;

        if (drag.pointerType === 'touch') {
          const horizontalIntent = Math.abs(dx) > Math.abs(dy) + 6;
          const upwardIntent = -dy >= TOUCH_VERTICAL_INTENT_PX;
          if (horizontalIntent || !upwardIntent) {
            drag.mode = 'pan';
            return;
          }
        }

        dragApiRef.current.begin(drag);
        const activeMode = drag.mode as DragState['mode'];
        if ((activeMode === 'target' || activeMode === 'lift') && drag.pointerId >= 0 && drag.captureEl) {
          try { drag.captureEl.setPointerCapture(drag.pointerId); } catch { /* captura é melhoria progressiva */ }
        }
      }
      if (drag.mode === 'pan' || drag.mode === 'dead') return;
      dragApiRef.current.move(drag, x, y);
    };
    const finishDrag = (drag: DragState, x: number, y: number) => {
      if (!dragApiRef.current) return;
      dragRef.current = null;
      releaseCapture(drag);
      if (drag.mode === 'pending') {
        if (drag.pointerType === 'touch') setMouse(null);
        return; // foi um toque/clique: a ação nativa decide
      }
      // Navegadores podem sintetizar click após arrasto/pan: nunca o converte
      // numa segunda ação ou abertura involuntária da carta.
      suppressSyntheticClick();
      if (drag.mode === 'pan' || drag.mode === 'dead') {
        dragApiRef.current.cancel(drag);
        return;
      }
      dragApiRef.current.finish(drag, x, y);
    };
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) return;
      moveDrag(drag, e.clientX, e.clientY);
      if (drag.pointerType === 'touch' && (drag.mode === 'target' || drag.mode === 'lift')) {
        e.preventDefault();
      }
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) {
        // tap sem arrasto no toque: a seta não pode ficar congelada na tela
        if (e.pointerType === 'touch') setMouse(null);
        return;
      }
      finishDrag(drag, e.clientX, e.clientY);
    };
    const onCancel = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) return;
      cancelActiveDrag();
    };
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      // Fallback apenas para navegadores sem Pointer Events. Num mouse moderno,
      // pointermove e mousemove chegam juntos e processar ambos gera jitter.
      if (!drag || drag.pointerId !== -1) return;
      moveDrag(drag, e.clientX, e.clientY);
    };
    const onMouseUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== -1) return;
      finishDrag(drag, e.clientX, e.clientY);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelActiveDrag();
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', cancelActiveDrag);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', cancelActiveDrag);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelDragRef.current = () => undefined;
    };
  }, []);

  // gaveta de chat aberta = mensagens consideradas lidas (badge zera)
  useEffect(() => {
    if (sidePane === 'chat') setChatSeen(s.chat.length);
  }, [sidePane, s.chat.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(TOUCH_CONFIRM_QUERY);
    const update = () => setTouchPlayConfirm(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!handFocus) return;
    if (!game || !myTurn || !game.hand.some((c) => c.iid === handFocus.iid)) {
      setHandFocus(null);
    }
  }, [game, handFocus, myTurn]);

  useLayoutEffect(() => {
    if (!handSignature) return;
    const el = handRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>('.card:first-child');
    if (!first) return;
    const handRect = el.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();
    const minLeft = handRect.left + 10;
    if (firstRect.left < minLeft) {
      el.scrollLeft = Math.max(0, el.scrollLeft - (minLeft - firstRect.left));
    }
  }, [handSignature]);

  if (!game || !me) return null;

  // Fase de mulligan: tela própria de troca de mão, antes do tabuleiro.
  // (Seguro como early return: não há hooks depois deste ponto no componente.)
  if (game.status === 'mulligan') return <MulliganOverlay game={game} me={me} />;

  const enemySeatIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
  const enemy = game.seats[enemySeatIdx];
  const isPracticeOpponent = enemy.playerId.startsWith('bot:');

  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((c) => c.iid === selection.iid)?.defId ?? '']
    : null;
  const selectedAttacker = selection?.kind === 'attacker'
    ? me.board.find((c) => c.iid === selection.iid) ?? null
    : null;
  const focusedHandDef = handFocus ? CARDS[handFocus.defId] : null;

  const noMovesLeft =
    myTurn &&
    !game.hand.some((c) => CARDS[c.defId].cost <= me.energy) &&
    !me.board.some((c) => c.canAttack);
  const playableCardCount = myTurn ? game.hand.filter((c) => CARDS[c.defId].cost <= me.energy).length : 0;
  const readyAttackerCount = myTurn ? me.board.filter((c) => c.canAttack).length : 0;
  const playableCardText = playableCardCount === 1 ? '1 carta jogável' : `${playableCardCount} cartas jogáveis`;
  const readyAttackerText = readyAttackerCount === 1 ? '1 atacante pronto' : `${readyAttackerCount} atacantes prontos`;
  const actionCoach = myTurn
    ? {
      done: noMovesLeft,
      label: noMovesLeft ? 'Encerrar' : `${playableCardCount} cartas · ${readyAttackerCount} ataques`,
      aria: noMovesLeft
        ? 'Sem ações disponíveis. Encerre o turno.'
        : `${playableCardText}. ${readyAttackerText}.`,
    }
    : null;
  const readyDamage = myTurn
    ? me.board.filter((c) => c.canAttack).reduce((sum, c) => sum + c.attack + me.attackBonus, 0)
    : 0;
  const enemyBoardDamage = enemy.board.reduce((sum, c) => sum + c.attack + enemy.attackBonus, 0);

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

  // ── Prévia de combate (hover no alvo) ──────────────────────────
  function previewFor(target: HoverTarget): CombatPreview | null {
    if (!target || !myTurn) return null;
    if (selectedAttacker) {
      const power = selectedAttacker.attack + me!.attackBonus;
      if (target.kind === 'face') {
        if (faceShielded) return null;
        return { targetDmg: power, lethal: power >= enemy.hp + enemy.shield, attackerIid: selectedAttacker.iid };
      }
      const defender = enemy.board.find((c) => c.iid === target.iid);
      if (!defender) return null;
      if (mustHitTaunt && !CARDS[defender.defId].keywords?.includes('taunt')) return null;
      // Escudo Arcano (ward): o primeiro dano de qualquer lado é anulado —
      // a prévia espelha o hurtCreature do servidor para não prometer morte.
      const dealt = defender.ward ? 0 : power;
      const retaliation = selectedAttacker.ward ? 0 : defender.attack + enemy.attackBonus;
      const dies = dealt > 0 && defender.health <= dealt;
      // dano excedente: só quando a defensora morta era a última criatura
      const overflow = dies && enemy.board.length === 1 ? Math.max(0, power - defender.health) : 0;
      return {
        targetDmg: dealt,
        targetDies: dies,
        overflow: overflow > 0 ? overflow : undefined,
        lethal: overflow > 0 && overflow >= enemy.hp + enemy.shield,
        selfDmg: retaliation,
        selfDies: retaliation > 0 && selectedAttacker.health <= retaliation,
        attackerIid: selectedAttacker.iid,
      };
    }
    if (selectedHandDef && SPELL_DMG[selectedHandDef.id] !== undefined) {
      // Orbe de Éter: magias de dano do assento ganham +1 por orbe equipado
      const dmg = SPELL_DMG[selectedHandDef.id] + me!.artifacts.filter((a) => a === 'a_orbe').length;
      if (target.kind === 'face') {
        if (faceShielded && !selectedHandDef.pierce) return null;
        return { targetDmg: dmg, lethal: dmg >= enemy.hp + enemy.shield };
      }
      const victim = enemy.board.find((c) => c.iid === target.iid);
      if (!victim) return null;
      const dealt = victim.ward ? 0 : dmg;
      return { targetDmg: dealt, targetDies: dealt > 0 && victim.health <= dealt };
    }
    return null;
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

  function targetFromAnchor(anchor: string | null | undefined): AimTarget | null {
    if (!anchor || !game || !me) return null;
    if (anchor === `face-${enemySeatIdx}`) return { kind: 'face' };
    if (anchor.startsWith('cr-')) {
      const iid = anchor.slice(3);
      const ec = enemy.board.find((c) => c.iid === iid);
      if (ec) return { kind: 'enemy-creature', c: ec };
      const mc = me.board.find((c) => c.iid === iid);
      if (mc) return { kind: 'my-creature', c: mc };
    }
    return null;
  }

  /** Resolve o alvo exato sob o ponteiro pelos data-anchor presentes no DOM. */
  function resolveTargetAt(x: number, y: number): AimTarget | null {
    const anchor = document.elementFromPoint(x, y)?.closest('[data-anchor]')?.getAttribute('data-anchor');
    return targetFromAnchor(anchor);
  }

  function aimTargetToHover(t: AimTarget | null): HoverTarget {
    if (!t) return null;
    if (t.kind === 'face') return { kind: 'face' };
    return { kind: 'creature', iid: t.c.iid };
  }

  function validTargetForDrag(drag: DragState, target: AimTarget | null): boolean {
    if (!target) return false;
    if (drag.kind === 'creature') {
      if (target.kind === 'my-creature') return false;
      if (target.kind === 'face') return !faceShielded;
      return enemyTaunts.length === 0 || CARDS[target.c.defId].keywords?.includes('taunt') === true;
    }

    const def = CARDS[drag.defId];
    const wants = def?.target ?? 'none';
    if (wants === 'friendly-creature') return target.kind === 'my-creature';
    if (wants === 'enemy-creature') return target.kind === 'enemy-creature';
    if (wants !== 'enemy-any' || target.kind === 'my-creature') return false;
    if (target.kind === 'face') return !faceShielded || !!def.pierce;
    return target.kind === 'enemy-creature';
  }

  function targetAnchor(target: AimTarget): string {
    return target.kind === 'face' ? `face-${enemySeatIdx}` : `cr-${target.c.iid}`;
  }

  function targetKey(target: AimTarget): string {
    return target.kind === 'face' ? 'face' : `${target.kind}-${target.c.iid}`;
  }

  function distanceFromRect(x: number, y: number, rect: DOMRect): number {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.hypot(dx, dy);
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
      if (!validTargetForDrag(drag, candidate)) continue;
      const element = document.querySelector<HTMLElement>(`[data-anchor="${targetAnchor(candidate)}"]`);
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

  function targetLabel(target: AimTarget | null, valid: boolean, defId: string): string {
    const def = CARDS[defId];
    if (valid && target) {
      if (target.kind === 'face') return 'Solte no comandante';
      return `Solte em ${CARDS[target.c.defId].name}`;
    }
    if (def?.target === 'friendly-creature') return 'Escolha uma criatura aliada';
    if (def?.target === 'enemy-creature') return 'Escolha uma criatura inimiga';
    return 'Escolha criatura ou comandante';
  }

  function playDropLabel(defId: string, ready: boolean): string {
    if (!ready && CARDS[defId]?.type === 'creature') return 'Leve até sua mesa';
    const action = noTargetActionLabel(defId).toLocaleLowerCase('pt-BR');
    return ready ? `Solte para ${action}` : `Arraste para ${action}`;
  }

  /** Início de gesto numa carta da mão ou criatura própria. */
  function onTargetPointerDown(e: React.PointerEvent, origin: { kind: 'hand' | 'creature'; iid: string; defId: string }) {
    if (!myTurn || !e.isPrimary || e.button !== 0) return;
    if ((e.target as Element).closest('.creature-info')) return;
    if (dragRef.current) cancelDragRef.current();
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

  function onTargetMouseDown(e: React.MouseEvent, origin: { kind: 'hand' | 'creature'; iid: string; defId: string }) {
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
        const valid = validTargetForDrag(drag, target);
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
        const valid = validTargetForDrag(drag, t);
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

  const targetingFriendly = selection?.kind === 'hand' && selectedHandDef?.target === 'friendly-creature';
  const targetingEnemyCreature = selection?.kind === 'attacker' || (
    selection?.kind === 'hand'
    && (selectedHandDef?.target === 'enemy-creature' || selectedHandDef?.target === 'enemy-any')
  );
  const targetingFace = selection?.kind === 'attacker'
    || (selection?.kind === 'hand' && selectedHandDef?.target === 'enemy-any');
  const targetingEnemy = targetingEnemyCreature || targetingFace;

  const fxFor = (anchor: string) => fx.filter((f) => f.anchor === anchor);
  const ghostsFor = (seatIdx: number) => ghosts.filter((g) => g.seatIdx === seatIdx);
  const bubbleFor = (seatIdx: number): Bubble | null => {
    let latest: Bubble | null = null;
    for (const b of bubbles) if (b.seatIdx === seatIdx && (!latest || b.at >= latest.at)) latest = b;
    return latest;
  };

  // alvo válido sob o ponteiro? (trava a seta e mostra a retícula nele)
  const hoverValid = (() => {
    if (!hover) return false;
    if (targetingFriendly) return hover.kind === 'creature' && me.board.some((c) => c.iid === hover.iid);
    if (!targetingEnemy) return false;
    if (hover.kind === 'face') return targetingFace && (!faceShielded || !!selectedHandDef?.pierce);
    if (!targetingEnemyCreature) return false;
    const ec = enemy.board.find((c) => c.iid === hover.iid);
    if (!ec) return false;
    if (mustHitTaunt && !CARDS[ec.defId].keywords?.includes('taunt')) return false;
    return true;
  })();
  const draggingHandTarget = dragCard?.mode === 'target';
  const draggingCreaturePlay = dragCard?.mode === 'play' && CARDS[dragCard.defId]?.type === 'creature';

  // ── Seta de mira ────────────────────────────────────────────────
  // A ponta segue o ponteiro; sobre um alvo válido ela "trava" no centro
  // dele e troca a flecha por uma retícula pulsante (estilo Hearthstone).
  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
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
  const aimMode = lethalAim
    ? 'lethal'
    : selection?.kind === 'attacker'
      ? 'attack'
      : targetingFriendly
        ? 'support'
        : 'spell';
  const aimColor = aimMode === 'lethal'
    ? '#e8665d'
    : aimMode === 'attack'
      ? '#d7a84c'
      : aimMode === 'support'
        ? '#4fc36b'
        : '#9d7ce8';
  const aimAccent = aimMode === 'attack'
    ? '#f2d28a'
    : aimMode === 'lethal'
      ? '#ffd6a3'
      : aimMode === 'support'
        ? '#a7efb1'
        : '#9fc3ff';
  const aimLabel = aimMode === 'lethal'
    ? 'LETAL'
    : aimMode === 'attack'
      ? 'ATAQUE'
      : aimMode === 'support'
        ? 'ALIADO'
        : selectedHandDef?.type === 'tactic'
          ? 'TÁTICA'
          : 'MAGIA';
  const aimMid = arrow ? arrowPoint(arrow, 0.52) : null;
  const aimRuneA = arrow ? arrowPoint(arrow, 0.32) : null;
  const aimRuneB = arrow ? arrowPoint(arrow, 0.72) : null;
  const unreadChat = Math.max(0, s.chat.length - chatSeen);
  const enemyFatiguePressure = enemy.fatigue > 0 || (enemy.deckCount <= 3 && enemy.deckCount >= 0);
  const turnCoach: { tone: CoachTone; title: string; body: string } = myTurn
    ? noMovesLeft
      ? {
        tone: 'end',
        title: 'Sem ações restantes',
        body: 'Encerre o turno para manter o ritmo.',
      }
      : readyAttackerCount > 0 && !faceShielded
        ? {
          tone: 'lethal',
          title: 'Alvo direto aberto',
          body: 'O comandante inimigo está vulnerável.',
        }
        : readyAttackerCount > 0
          ? {
            tone: 'attack',
            title: 'Ataque a mesa',
            body: `${enemy.board.length} ${enemy.board.length === 1 ? 'criatura protege' : 'criaturas protegem'} o comandante.`,
          }
          : playableCardCount > 0
            ? {
              tone: 'play',
              title: 'Use sua energia',
              body: `${playableCardText}; priorize presença cedo.`,
            }
            : {
              tone: 'wait',
              title: 'Procure a próxima janela',
              body: 'Sem ataques prontos. Avalie encerrar depois de revisar a mão.',
            }
    : isPracticeOpponent
      ? {
        tone: 'bot',
        title: 'Treinador avaliando a mesa',
        body: `${enemy.handCount} ${enemy.handCount === 1 ? 'carta' : 'cartas'} na mão · ${enemy.board.length} na mesa.`,
      }
      : {
        tone: 'wait',
        title: 'Planeje a resposta',
        body: `${enemy.name} tem ${enemy.handCount} ${enemy.handCount === 1 ? 'carta' : 'cartas'} na mão.`,
      };

  // prévia de dano em TODOS os alvos válidos ao selecionar — decisão
  // informada sem depender de hover (essencial no toque)
  const staticFacePreview = targetingFace && hover?.kind !== 'face' ? previewFor({ kind: 'face' }) : null;
  const targetHint = selection?.kind === 'attacker'
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
  const handConfirm = touchPlayConfirm && handFocus && focusedHandDef && myTurn
    ? {
      mode: 'play' as const,
      title: focusedHandDef.name,
      body: 'Revise antes de jogar.',
      actionLabel: noTargetActionLabel(handFocus.defId),
    }
    : null;
  const touchCommand = targetHint;

  return (
    <div
      className={`game-screen ${selection ? 'is-aiming' : ''} ${dragCard ? 'dragging-hand-card' : ''} ${handFocus ? 'has-hand-focus' : ''}`}
      onPointerMove={selection ? (e) => setMouse({ x: e.clientX, y: e.clientY }) : undefined}
      onContextMenu={selection ? (e) => { e.preventDefault(); clearAim(); } : undefined}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <style>{`
        .board-divider.no-divider-line {
          border-top: 0 !important;
          border-bottom: 0 !important;
          box-shadow: none !important;
          background-image: none !important;
        }

        .board-divider.no-divider-line::before,
        .board-divider.no-divider-line::after {
          content: none !important;
          display: none !important;
        }
      `}</style>
      <div className="mobile-topbar">
        <button
          className={`btn small ghost ${sidePane === 'log' ? 'active' : ''}`}
          onClick={() => setSidePane(sidePane === 'log' ? null : 'log')}
          title="Eventos"
          aria-label="Eventos da partida"
        >
          <IcoEvents />
        </button>
        <button
          className={`btn small ghost ${sidePane === 'chat' ? 'active' : ''}`}
          onClick={() => setSidePane(sidePane === 'chat' ? null : 'chat')}
          title="Chat"
          aria-label={`Chat${unreadChat > 0 ? ` (${unreadChat} não lidas)` : ''}`}
        >
          <IcoChat />
          {unreadChat > 0 && sidePane !== 'chat' && <span className="unread-badge">{unreadChat}</span>}
        </button>
        <button className="btn small ghost" onClick={() => setShowRules(true)} title="Como jogar" aria-label="Como jogar"><IcoRules /></button>
        <button className="btn small ghost" onClick={() => setShowCodex(true)} title="Arquivo de Aurélia" aria-label="Arquivo de Aurélia"><IcoCodex /></button>
        <SoundControl />
        <button
          className="btn small ghost danger"
          onClick={requestSurrender}
          title="Desistir"
          aria-label="Desistir da partida"
        >
          <IcoSurrender />
        </button>
      </div>
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

        <div className="board-divider no-divider-line">
          <div
            className={`turn-pill ${turnOwnerIsMe ? 'mine' : ''} ${game.turnPaused ? 'paused' : ''} ${timeUrgent ? 'urgent' : ''}`}
            style={{ '--timer-angle': `${timerPct * 3.6}deg` } as React.CSSProperties}
            aria-label={game.turnPaused
              ? `Cronômetro pausado em ${formatTurnClock(secondsLeft)} durante o tutorial inicial`
              : `${turnOwnerIsMe ? 'Seu turno' : `Turno de ${game.seats[game.turnSeat].name}`}. ${formatTurnClock(secondsLeft)} restantes`}
          >
            <span className="turn-clock" aria-hidden="true">
              {game.turnPaused ? <IcoPause className="ic" /> : <IcoTimer className="ic" />}
            </span>
            <span className="turn-time-copy">
              <span className="turn-time-eyebrow">
                <span className="turn-label-full">
                  {game.status !== 'active'
                    ? 'Partida encerrada'
                    : game.turnPaused
                      ? 'Tutorial inicial'
                      : turnOwnerIsMe
                        ? 'Seu turno'
                        : `Turno de ${game.seats[game.turnSeat].name}`}
                </span>
                <span className="turn-label-compact">
                  {game.status !== 'active' ? 'Fim' : game.turnPaused ? 'Pausa' : turnOwnerIsMe ? 'Seu turno' : 'Oponente'}
                </span>
              </span>
              <strong className={timeUrgent ? 'time-urgent' : ''} role="timer">
                {game.status !== 'active'
                  ? 'Encerrada'
                  : game.turnPaused
                    ? 'Pausado'
                    : formatTurnClock(secondsLeft)}
              </strong>
            </span>
            {/* aviso único para leitor de tela ao entrar nos últimos 10s (sem repetir a cada segundo) */}
            <span className="sr-only" role="status" aria-live="assertive">
              {game.turnPaused ? 'Cronômetro pausado durante o tutorial inicial' : timeUrgent ? 'Tempo do seu turno acabando' : ''}
            </span>
            <span className="timer-track" aria-hidden="true">
              <span
                className={`timer-fill ${timeUrgent ? 'urgent' : ''} ${game.turnPaused ? 'paused' : ''}`}
                style={{ width: `${timerPct}%` }}
              />
            </span>
          </div>
          <div className="pace-hud" style={PACE_HUD_STYLE} aria-label="Ritmo do turno">
            <span className="pace-turn" style={PACE_CHIP_TIGHT_STYLE} aria-label={`Turno ${game.turnNumber}`}>
              <span style={PACE_CHIP_TEXT_STYLE}>Turno {game.turnNumber}</span>
            </span>
            {me.fatigue === 0 && me.deckCount <= 3 && (
              <span
                className="pace-fatigue"
                style={PACE_CHIP_STYLE}
                aria-label={`Seu baralho está acabando. ${me.deckCount} cartas no deck antes da fadiga.`}
              >
                <IcoWarning className="ic" />
                <span style={PACE_CHIP_TEXT_STYLE}>Fadiga à vista</span>
                <strong>{me.deckCount}</strong>
              </span>
            )}
            {enemyFatiguePressure && (
              <span
                className="pace-opportunity"
                style={PACE_CHIP_STYLE}
                aria-label="O oponente está perto de sofrer dano por fadiga."
              >
                <IcoDeath className="ic" />
                <span style={PACE_CHIP_TEXT_STYLE}>Pressione o deck</span>
              </span>
            )}
            {actionCoach && (
              <span
                className={`pace-action ${actionCoach.done ? 'done' : ''}`}
                style={PACE_CHIP_STYLE}
                aria-label={actionCoach.aria}
              >
                <IcoHint className="ic" />
                <span style={PACE_CHIP_TEXT_STYLE}>{actionCoach.label}</span>
              </span>
            )}
          </div>
          <div className={`turn-coach ${turnCoach.tone}`} role="status" aria-live="polite">
            <span className="turn-coach-icon">
              {turnCoach.tone === 'bot'
                ? <IcoBot />
                : turnCoach.tone === 'attack' || turnCoach.tone === 'lethal'
                ? <IcoAttack />
                : turnCoach.tone === 'play'
                  ? <IcoEnergy />
                  : turnCoach.tone === 'end'
                    ? <IcoCheck />
                    : <IcoHint />}
            </span>
            <span className="turn-coach-copy">
              <strong>{turnCoach.title}</strong>
              <span>{turnCoach.body}</span>
            </span>
          </div>
          {myTurn && (
            <button
              className={`btn end-turn ${noMovesLeft ? 'pulse' : ''}`}
              aria-label={noMovesLeft ? 'Encerrar turno, sem ações disponíveis' : 'Encerrar turno'}
              onClick={() => { sfx.click(); send({ t: 'game:endTurn' }); }}
            >
              Encerrar turno ▸
            </button>
          )}
          <div className="taunt-dock">
            {tauntOpen && (
              <div className="taunt-wheel">
                {TAUNTS.map((t) => (
                  <button key={t.id} type="button" className="taunt-pick" onClick={() => sendTaunt(t.id)}>
                    <TauntIcon id={t.icon} className="ic" /> {t.text}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`btn small taunt-toggle ${tauntOpen ? 'active' : ''}`}
              onClick={() => setTauntOpen((o) => !o)}
              title="Provocar o oponente"
              aria-label="Provocar o oponente"
            >
              <IcoTaunt />
            </button>
          </div>
        </div>

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

      <aside className={`game-side ${sidePane ? `open pane-${sidePane}` : ''}`}>
        <button className="btn small ghost drawer-close" onClick={() => setSidePane(null)}>
          ▾ Fechar {sidePane === 'log' ? 'Eventos' : sidePane === 'chat' ? 'Chat' : 'Painel'}
        </button>
        <div className="side-top">
          <span>
            <SoundControl />
            <button className="btn small ghost" onClick={() => setShowRules(true)} title="Como jogar" aria-label="Como jogar">
              <IcoRules />
            </button>
            <button className="btn small ghost" onClick={() => setShowCodex(true)} title="Arquivo de Aurélia" aria-label="Arquivo de Aurélia">
              <IcoCodex />
            </button>
          </span>
          <button
            className="btn small ghost danger"
            onClick={requestSurrender}
          >
            <IcoSurrender className="ic" /> Desistir
          </button>
        </div>
        <div className="panel match-brief" aria-label="Leitura rápida da partida">
          <h3><IcoHint className="ic" /> Leitura da mesa</h3>
          <div className="brief-grid">
            <span title="Suas criaturas em campo">
              <IcoBanner className="ic" />
              <b>{me.board.length}</b>
              sua mesa
            </span>
            <span title="Criaturas inimigas em campo">
              <IcoWarning className="ic" />
              <b>{enemy.board.length}</b>
              inimiga
            </span>
            <span title="Dano disponível para atacar neste turno">
              <IcoAttack className="ic" />
              <b>{readyDamage}</b>
              dano pronto
            </span>
            <span title="Força total da mesa inimiga">
              <IcoDeath className="ic" />
              <b>{enemyBoardDamage}</b>
              ameaça
            </span>
            <span title="Cartas no seu baralho">
              <IcoDeck className="ic" />
              <b>{me.deckCount}</b>
              seu deck
            </span>
            <span title="Cartas na mão inimiga">
              <IcoHand className="ic" />
              <b>{enemy.handCount}</b>
              mão inimiga
            </span>
          </div>
        </div>
        <div className="panel log-panel">
          <h3><IcoEvents className="ic" /> Eventos</h3>
          <ul className="game-log" role="log" aria-live="polite" aria-label="Eventos da partida">
            {game.log.slice(-14).reverse().map((l, i) => {
              const tone = logTone(l.text);
              return (
                <li key={game.log.length - i} className={`log-${tone}`}>
                  <span className="log-mark" aria-hidden>{logIcon(tone)}</span>
                  <span>{l.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="panel side-chat">
          <h3><IcoChat className="ic" /> Chat</h3>
          <Chat />
        </div>
      </aside>

      {dragCard && (
        <div
          className={[
            'drag-card-layer',
            `drag-${dragCard.mode}`,
            `input-${dragCard.pointerType}`,
            dragCard.valid ? 'valid' : '',
            dragCard.magnetized ? 'magnetized' : '',
            CARDS[dragCard.defId]?.target === 'friendly-creature' ? 'support' : '',
            dragCard.y < 240 ? 'place-below' : 'place-above',
          ].filter(Boolean).join(' ')}
          style={{
            left: `clamp(74px, ${dragCard.x}px, calc(100vw - 74px))`,
            top: dragCard.y,
          }}
          aria-hidden="true"
        >
          <CardView
            defId={dragCard.defId}
            as="div"
            className="drag-card-preview"
            imageLoading="eager"
            imagePriority="high"
          />
          <span className="drag-card-label">
            {dragCard.mode === 'play'
              ? <IcoCheck className="ic" />
              : CARDS[dragCard.defId]?.target === 'friendly-creature'
                ? <IcoBuff className="ic" />
                : <IcoTarget className="ic" />}
            <strong>{dragCard.label}</strong>
          </span>
        </div>
      )}

      {targetHint && (
        <div className={`target-hint ${targetHint.mode}`}>
          <span className="target-hint-icon">
            {targetHint.mode === 'attack' ? <IcoAttack /> : targetHint.mode === 'support' ? <IcoBuff /> : <IcoSparkle />}
          </span>
          <span className="target-hint-text">
            <strong>{targetHint.title}</strong>
            <span>{targetHint.body}</span>
          </span>
          <button className="btn small hint-cancel" onClick={clearAim}><IcoClose className="ic" /> Cancelar</button>
        </div>
      )}

      {touchCommand && (
        <div className={`touch-command ${touchCommand.mode}`} role="status" aria-live="polite">
          <span className="touch-command-icon">
            {touchCommand.mode === 'attack'
              ? <IcoAttack />
              : touchCommand.mode === 'support'
                ? <IcoBuff />
                : <IcoSparkle />}
          </span>
          <span className="touch-command-text">
            <strong>{touchCommand.title}</strong>
            <span>{touchCommand.body}</span>
          </span>
          <button className="btn small cancel-pill" onClick={clearAim} aria-label="Cancelar mira">
            <IcoClose className="ic" /> Cancelar
          </button>
        </div>
      )}

      {handConfirm && handFocus && (
        <div className="hand-focus-tray" role="dialog" aria-live="polite" aria-label={`Carta focada: ${handConfirm.title}`}>
          <div className="hand-focus-card" aria-hidden="true">
            <CardView
              defId={handFocus.defId}
              as="div"
              selected
              className="focus-preview-card"
              imageLoading="eager"
              imagePriority="high"
              statusLabel="Pronta"
              statusTone="good"
            />
          </div>
          <div className="hand-focus-panel">
            <span className="touch-command-icon">
              <IcoHand />
            </span>
            <span className="touch-command-text">
              <strong>{handConfirm.title}</strong>
              <span>{handConfirm.body}</span>
            </span>
            <div className="hand-focus-buttons">
              <button
                className="btn small play-pill"
                onClick={confirmFocusedHandPlay}
                aria-label={`${handConfirm.actionLabel} ${handConfirm.title}`}
              >
                <IcoCheck className="ic" /> {handConfirm.actionLabel}
              </button>
              <button className="btn small cancel-pill" onClick={clearAim} aria-label="Fechar carta focada">
                <IcoClose className="ic" /> Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {arrow && (
        <svg
          className={`aim-arrow aim-${aimMode} ${lockOn ? 'locked' : ''}`}
          width="100%"
          height="100%"
          style={{
            ['--aim' as string]: aimColor,
            ['--aim-2' as string]: aimAccent,
            filter: `drop-shadow(0 0 3px ${aimColor}66)`,
          } as React.CSSProperties}
        >
          <defs>
            <linearGradient id="aim-gradient" gradientUnits="userSpaceOnUse" x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}>
              <stop offset="0%" stopColor={aimAccent} stopOpacity="0.62" />
              <stop offset="54%" stopColor={aimColor} stopOpacity="0.82" />
              <stop offset="100%" stopColor={lethalAim ? '#f4aaa0' : aimAccent} stopOpacity="0.68" />
            </linearGradient>
            <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="6.7" refY="5" orient="auto">
              <path
                d="M1,1 L9,5 L1,9 L3.2,5 Z"
                fill={lethalAim ? '#f1a097' : aimAccent}
                fillOpacity="0.78"
                stroke={aimColor}
                strokeOpacity="0.7"
                strokeWidth="0.65"
              />
            </marker>
          </defs>

          <g className="aim-origin" opacity="0.72">
            <circle cx={arrow.x1} cy={arrow.y1} r="14" fill="none" stroke={aimAccent} strokeOpacity="0.16" strokeWidth="6" />
            <circle cx={arrow.x1} cy={arrow.y1} r="7.5" fill="none" stroke={aimColor} strokeOpacity="0.42" strokeWidth="1.4" />
          </g>

          <path
            className="aim-aura"
            d={arrowPath(arrow)}
            stroke="url(#aim-gradient)"
            strokeOpacity="0.07"
            strokeWidth="15"
            strokeLinecap="round"
            fill="none"
          />
          <path
            className="aim-trail"
            d={arrowPath(arrow)}
            stroke="url(#aim-gradient)"
            strokeOpacity="0.15"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <path
            className="aim-rail"
            d={arrowPath(arrow)}
            stroke="url(#aim-gradient)"
            strokeOpacity="0.44"
            strokeWidth="5.25"
            strokeLinecap="round"
            fill="none"
          />
          <path
            className="aim-flow"
            d={arrowPath(arrow)}
            stroke="url(#aim-gradient)"
            strokeOpacity="0.82"
            strokeWidth="2.75"
            strokeLinecap="round"
            fill="none"
            markerEnd={lockOn ? undefined : 'url(#arrowhead)'}
            style={{ strokeDasharray: 'none', strokeDashoffset: 0 }}
          />
          <path
            className="aim-core"
            d={arrowPath(arrow)}
            stroke={lethalAim ? '#fff2cb' : '#fff9e6'}
            strokeOpacity="0.34"
            strokeWidth="0.95"
            strokeLinecap="round"
            fill="none"
            style={{ strokeDasharray: 'none', strokeDashoffset: 0 }}
          />

          {aimRuneA && (
            <g className="aim-rune" transform={`translate(${aimRuneA.x} ${aimRuneA.y}) rotate(45)`} opacity="0.56">
              <rect x="-3.25" y="-3.25" width="6.5" height="6.5" rx="1.15" fill={aimColor} fillOpacity="0.12" stroke={aimAccent} strokeOpacity="0.55" strokeWidth="1" />
              <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="2.2s" repeatCount="indefinite" additive="sum" />
            </g>
          )}
          {aimRuneB && (
            <g className="aim-rune delay" transform={`translate(${aimRuneB.x} ${aimRuneB.y}) rotate(45)`} opacity="0.44">
              <rect x="-2.6" y="-2.6" width="5.2" height="5.2" rx="1" fill={aimAccent} fillOpacity="0.12" stroke={aimColor} strokeOpacity="0.48" strokeWidth="0.9" />
              <animateTransform attributeName="transform" type="scale" values="1;1.06;1" dur="2.6s" repeatCount="indefinite" additive="sum" />
            </g>
          )}

          {/* retícula de "travado no alvo" */}
          {lockOn && (
            <g className={`aim-reticle ${lethalAim ? 'lethal' : ''}`} opacity="0.9">
              <circle className="reticle-aura" cx={arrow.x2} cy={arrow.y2} r="25" fill={aimColor} fillOpacity="0.055" />
              <circle className="reticle-ring" cx={arrow.x2} cy={arrow.y2} r="19" fill="none" stroke="url(#aim-gradient)" strokeOpacity="0.72" strokeWidth="1.75" />
              <circle className="reticle-ping" cx={arrow.x2} cy={arrow.y2} r="19" fill="none" stroke={aimColor} strokeOpacity="0.38" strokeWidth="1.5">
                <animate attributeName="r" values="19;25" dur="1.65s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.38;0" dur="1.65s" repeatCount="indefinite" />
              </circle>
              <rect className="reticle-gem" x={arrow.x2 - 3.5} y={arrow.y2 - 3.5} width="7" height="7" rx="1.2" fill={aimAccent} fillOpacity="0.18" stroke={aimColor} strokeOpacity="0.62" strokeWidth="1" transform={`rotate(45 ${arrow.x2} ${arrow.y2})`} />
              <g stroke={aimColor} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round">
                <line x1={arrow.x2 - 25} y1={arrow.y2} x2={arrow.x2 - 17} y2={arrow.y2} />
                <line x1={arrow.x2 + 17} y1={arrow.y2} x2={arrow.x2 + 25} y2={arrow.y2} />
                <line x1={arrow.x2} y1={arrow.y2 - 25} x2={arrow.x2} y2={arrow.y2 - 17} />
                <line x1={arrow.x2} y1={arrow.y2 + 17} x2={arrow.x2} y2={arrow.y2 + 25} />
              </g>
            </g>
          )}
        </svg>
      )}
      {arrow && aimMid && (
        <div
          className={`aim-callout aim-${aimMode} ${lockOn ? 'locked' : ''}`}
          style={{
            left: aimMid.x,
            top: aimMid.y,
            ['--aim' as string]: aimColor,
            ['--aim-2' as string]: aimAccent,
          } as React.CSSProperties}
        >
          {aimLabel}
        </div>
      )}

      <div className="reveal-stack">
        {reveals.map((r) => (
          <div key={r.id} className="card-reveal">
            <span className="reveal-label">Oponente jogou</span>
            <CardView defId={r.cardId} />
          </div>
        ))}
      </div>

      {inspect
        && (!selection || inspect.source === 'creature')
        && !dragCard
        && game.status === 'active'
        && (inspect.source === 'creature' || game.hand.some((c) => c.iid === inspect.iid)) && (
          <div
            className={`card-inspect ${inspect.source === 'creature' ? 'board-inspect' : ''}`}
            style={{
              left: Math.min(
                Math.max(inspect.x, inspect.source === 'creature' ? 160 : 130),
                window.innerWidth - (inspect.source === 'creature' ? 160 : 130),
              ),
              top: inspect.source === 'creature'
                ? Math.min(Math.max(inspect.y, 460), window.innerHeight - 12)
                : inspect.y,
            }}
          >
            <CardView defId={inspect.defId} />
          </div>
      )}

      {banner && !s.gameOver && <div className="turn-banner" key={banner.at} role="status" aria-live="assertive">{banner.text}</div>}
      {teach && (
        <div className="teach-toast" key={teach.id} role="status" aria-live="polite">
          <span>{teach.text}</span>
          <button className="btn small ghost" onClick={dismissTeach} aria-label="Fechar dica"><IcoClose /></button>
        </div>
      )}
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
