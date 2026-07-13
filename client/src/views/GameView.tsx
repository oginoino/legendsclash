import { useEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_BOARD } from '@legendsclash/shared';
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
import { usePreferences } from '../preferences';
import { createGameActionController } from '../features/game/action-controller';
import { Creature, GhostCreature, HeroPlate } from '../features/game/components/ArenaPieces';
import type { AimMode } from '../features/game/components/AimOverlay';
import { GameSidePanel, MobileGameToolbar } from '../features/game/components/GameChrome';
import type { SidePane } from '../features/game/components/GameChrome';
import { GameInteractionOverlays } from '../features/game/components/GameInteractionOverlays';
import type { HandConfirm, TargetHint } from '../features/game/components/GameInteractionOverlays';
import { GameOverOverlay } from '../features/game/components/GameOverOverlay';
import { MulliganOverlay } from '../features/game/components/MulliganOverlay';
import { TurnHud } from '../features/game/components/TurnHud';
import { createGameDragController } from '../features/game/drag-controller';
import type { DragCardVisual } from '../features/game/drag-gesture-model';
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
  combatPreviewFor,
  deriveTargetingState,
  isHoverTargetValid,
  noTargetActionLabel,
} from '../features/game/targeting-model';
import type {
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

  function clearAim() {
    setSelection(null);
    setHover(null);
    setMouse(null);
    setDragCard(null);
    setHoverCost(0);
    setHandFocus(null);
    clearInspect('hand');
  }

  const {
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
  } = createGameActionController({
    clearAim,
    clearInspect,
    enemy,
    enemySeatIdx,
    game,
    handFocus,
    myTurn,
    player: me,
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
  });

  const {
    onTargetMouseDown,
    onTargetPointerDown,
  } = createGameDragController({
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
    player: me,
    setCantAttackWarn,
    setDragCard,
    setEnergyWarnAt,
    setHandFocus,
    setHover,
    setMouse,
    setSelection,
  });

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
