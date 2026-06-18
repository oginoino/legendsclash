import { useEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_ENERGY, TAUNTS, TURN_SECONDS, achievementLabel, commanderTitle } from '@legendsclash/shared';
import type { CreatureOnBoard, GameView as GameViewState, SeatView } from '@legendsclash/shared';
import { dismissGameOver, send, useAppState } from '../store';
import { CardArt } from '../components/CardArt';
import { CardView } from '../components/CardView';
import { Chat } from '../components/Chat';
import { LeagueBadge } from '../components/LeagueBadge';
import { RulesModal } from '../components/RulesModal';
import { Tutorial } from '../components/Tutorial';
import { CodexView } from './CodexView';
import { sfx, soundOn, toggleSound } from '../sounds';

type Selection =
  | { kind: 'hand'; iid: string }
  | { kind: 'attacker'; iid: string }
  | null;

type HoverTarget = { kind: 'face' } | { kind: 'creature'; iid: string } | null;

/** Efeito flutuante transitório (dano/cura), ancorado a um elemento da arena. */
interface FloatFx {
  id: number;
  kind: 'dmg' | 'heal';
  value: number;
  anchor: string; // `face-{seat}` ou `cr-{iid}`
  at: number;
}

/** Criatura recém-destruída, mantida em cena para a animação de morte. */
interface Ghost {
  id: number;
  seatIdx: number;
  creature: CreatureOnBoard;
  /** Slot (0-based) que ocupava na mesa — a morte anima no lugar exato. */
  slot: number;
  at: number;
}

/** Revelação de carta jogada pelo oponente. */
interface Reveal {
  id: number;
  cardId: string;
  at: number;
}

/** Prévia de combate/dano calculada no hover do alvo (decisão informada). */
interface CombatPreview {
  targetDmg: number;
  targetDies?: boolean;
  lethal?: boolean; // venceria a partida
  overflow?: number; // dano excedente que atravessa para o comandante
  selfDmg?: number; // retaliação no atacante
  selfDies?: boolean;
  attackerIid?: string;
}

/**
 * Posição (1-based) de cada criatura que tem uma cópia idêntica na mesma
 * mesa — o cliente marca a carta exata com esse número, casando com o
 * "(posição N)" do log do servidor. Quando a carta é única na mesa, fica de
 * fora (sem poluição visual). É o mesmo critério do `creatureLabel` do motor.
 */
function dupPositions(board: CreatureOnBoard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of board) counts.set(c.defId, (counts.get(c.defId) ?? 0) + 1);
  const positions = new Map<string, number>();
  board.forEach((c, i) => {
    if ((counts.get(c.defId) ?? 0) >= 2) positions.set(c.iid, i + 1);
  });
  return positions;
}

let fxId = 1;
const FX_TTL = 1100;
const GHOST_TTL = 700;
const REVEAL_TTL = 1700;
/** Tempo que uma provocação fica como balão sobre o comandante. */
const BUBBLE_TTL = 4500;
/** Cadência mínima entre provocações (anti-spam local). */
const TAUNT_COOLDOWN_MS = 2500;

/** Balão de provocação ancorado ao comandante de um assento. */
interface Bubble {
  id: number;
  seatIdx: number;
  text: string;
  at: number;
}
const SPELL_DMG: Record<string, number> = { s_faisca: 2, s_bola_de_fogo: 5 };

/** Movimento mínimo (px) para um toque virar arrasto em vez de clique. */
const DRAG_THRESHOLD_PX = 8;
/** Inspeção no hover só com mouse real — no toque o mouseover sintético do
 *  tap deixaria o overlay preso na tela (não há mouseleave correspondente). */
const CAN_HOVER = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
/** Elevação mínima (px) para "soltar pra jogar" uma carta sem alvo. */
const PLAY_LIFT_PX = 48;

/** Curva da seta de mira: arco quadrático do atacante/carta até o alvo. */
function arrowPath(a: { x1: number; y1: number; x2: number; y2: number }): string {
  const cx = (a.x1 + a.x2) / 2;
  const cy = Math.min(a.y1, a.y2) - 60;
  return `M ${a.x1} ${a.y1} Q ${cx} ${cy} ${a.x2} ${a.y2}`;
}

/**
 * Gesto de arrasto em andamento (mouse ou dedo — Pointer Events unificam).
 * `pending` ainda pode virar clique; `target` mira com a seta; `lift` levanta
 * uma carta sem alvo para jogá-la; `dead` consome o gesto sem ação (feedback
 * de erro já dado).
 */
interface DragState {
  pointerId: number;
  kind: 'hand' | 'creature';
  iid: string;
  defId: string;
  startX: number;
  startY: number;
  mode: 'pending' | 'target' | 'lift' | 'dead';
}

/** Alvo sob o cursor/dedo, resolvido pelos data-anchor já presentes no DOM. */
type AimTarget =
  | { kind: 'face' }
  | { kind: 'enemy-creature'; c: CreatureOnBoard }
  | { kind: 'my-creature'; c: CreatureOnBoard };

export function GameView() {
  const s = useAppState();
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [hoverCost, setHoverCost] = useState(0);
  const [energyWarnAt, setEnergyWarnAt] = useState(0);
  const [cantAttackWarn, setCantAttackWarn] = useState<{ iid: string; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fx, setFx] = useState<FloatFx[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [reveals, setReveals] = useState<Reveal[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [tauntOpen, setTauntOpen] = useState(false);
  const [banner, setBanner] = useState<{ text: string; at: number } | null>(null);
  // investida da atacante: empurrão na direção do inimigo no momento do envio
  const [attackFx, setAttackFx] = useState<{ iid: string; at: number } | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [sound, setSound] = useState(soundOn());
  const [showRules, setShowRules] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  // tutorial da 1ª partida: uma vez por dispositivo (flag em localStorage)
  const [showTutorial, setShowTutorial] = useState(() => {
    try { return localStorage.getItem('lc_tutorial_done') !== '1'; } catch { return false; }
  });
  // carta sem alvo sendo "levantada" pelo gesto de arrasto (solta ≥48px acima = joga)
  const [lift, setLift] = useState<{ iid: string; dy: number } | null>(null);
  // inspeção no hover (desktop): carta ampliada flutuando acima da mão —
  // a mão é um scroll container, então escalar a carta no lugar seria cortado
  const [inspect, setInspect] = useState<{ iid: string; defId: string; x: number; y: number } | null>(null);
  // gaveta lateral no mobile: log/chat viram bottom-sheet com badge de não lidas
  const [sidePane, setSidePane] = useState<'log' | 'chat' | null>(null);
  const [chatSeen, setChatSeen] = useState(0);
  const prevRef = useRef<GameViewState | null>(null);
  const prevChatLenRef = useRef(0);
  const tauntCooldownRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
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

  useEffect(() => {
    const t = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      setFx((f) => (f.length && ts - f[0].at > FX_TTL ? f.filter((x) => ts - x.at < FX_TTL) : f));
      setGhosts((g) => (g.length && ts - g[0].at > GHOST_TTL ? g.filter((x) => ts - x.at < GHOST_TTL) : g));
      setReveals((r) => (r.length && ts - r[0].at > REVEAL_TTL ? r.filter((x) => ts - x.at < REVEAL_TTL) : r));
      setBubbles((b) => (b.length && ts - b[0].at > BUBBLE_TTL ? b.filter((x) => ts - x.at < BUBBLE_TTL) : b));
      setBanner((b) => (b && ts - b.at > 1500 ? null : b));
    }, 250);
    return () => clearInterval(t);
  }, []);

  // cancela a seleção com Esc ou clique com o botão direito
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelection(null); setTauntOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Arrasto para mirar/jogar: listeners na window unificam mouse e toque
  // (no toque o pointer é capturado pelo elemento de origem; na window os
  // eventos chegam igual e o alvo real vem de elementFromPoint).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) return;
      if (drag.mode === 'pending') {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
        dragApiRef.current.begin(drag);
      }
      dragApiRef.current.move(drag, e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) {
        // tap sem arrasto no toque: a seta não pode ficar congelada na tela
        if (e.pointerType === 'touch') setMouse(null);
        return;
      }
      dragRef.current = null;
      if (drag.mode === 'pending') {
        if (e.pointerType === 'touch') setMouse(null);
        return; // foi um toque: o click nativo decide a ação
      }
      // o mouse sintetiza um click após o arrasto — não pode virar ação
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 400);
      dragApiRef.current.finish(drag, e.clientX, e.clientY);
    };
    const onCancel = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) return;
      dragRef.current = null;
      dragApiRef.current.cancel(drag);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []);

  // ── Game feel: diff do estado autoritativo → efeitos visuais/sonoros ──
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = game;
    if (!prev || !game || prev.matchId !== game.matchId || game.yourSeat < 0) return;

    const ts = Date.now();
    const newFx: FloatFx[] = [];
    const newGhosts: Ghost[] = [];
    let hadDamage = false;
    let hadHeal = false;

    game.seats.forEach((seat, i) => {
      const before = prev.seats[i];
      if (!before) return;
      if (seat.hp < before.hp) {
        newFx.push({ id: fxId++, kind: 'dmg', value: before.hp - seat.hp, anchor: `face-${i}`, at: ts });
        hadDamage = true;
      } else if (seat.hp > before.hp) {
        newFx.push({ id: fxId++, kind: 'heal', value: seat.hp - before.hp, anchor: `face-${i}`, at: ts });
        hadHeal = true;
      }
      const prevById = new Map(before.board.map((c) => [c.iid, c]));
      for (const c of seat.board) {
        const pc = prevById.get(c.iid);
        if (pc && c.health < pc.health) {
          newFx.push({ id: fxId++, kind: 'dmg', value: pc.health - c.health, anchor: `cr-${c.iid}`, at: ts });
          hadDamage = true;
        } else if (pc && c.health > pc.health) {
          newFx.push({ id: fxId++, kind: 'heal', value: c.health - pc.health, anchor: `cr-${c.iid}`, at: ts });
          hadHeal = true;
        }
      }
      before.board.forEach((pc, slot) => {
        if (!seat.board.some((c) => c.iid === pc.iid)) {
          newGhosts.push({ id: fxId++, seatIdx: i, creature: pc, slot, at: ts });
        }
      });
    });

    // revelação: cartas jogadas pelo oponente desde o último estado
    const newPlays = game.plays.slice(prev.plays.length);
    const enemyPlays = newPlays.filter((p) => p.seat !== game.yourSeat);
    if (enemyPlays.length) {
      setReveals((r) => [...r, ...enemyPlays.map((p) => ({ id: fxId++, cardId: p.cardId, at: ts }))]);
      sfx.reveal();
    }

    if (newFx.length) setFx((f) => [...f, ...newFx]);
    if (newGhosts.length) setGhosts((g) => [...g, ...newGhosts]);
    if (hadDamage) sfx.damage();
    else if (hadHeal) sfx.heal();

    if (prev.turnSeat !== game.turnSeat && game.status === 'active') {
      const mine = game.turnSeat === game.yourSeat;
      setBanner({ text: mine ? '⚔️ Seu turno!' : `Turno de ${game.seats[game.turnSeat].name}`, at: ts });
      if (mine) sfx.myTurn();
      setSelection(null);
      setHover(null);
    }
  }, [game]);

  // gaveta de chat aberta = mensagens consideradas lidas (badge zera)
  useEffect(() => {
    if (sidePane === 'chat') setChatSeen(s.chat.length);
  }, [sidePane, s.chat.length]);

  // provocações/mensagens viram balões sobre o comandante de quem enviou
  useEffect(() => {
    const g = s.game;
    if (!g) return;
    if (s.chat.length < prevChatLenRef.current) prevChatLenRef.current = 0; // nova partida zera
    const fresh = s.chat.slice(prevChatLenRef.current);
    prevChatLenRef.current = s.chat.length;
    if (!fresh.length) return;
    const ts = Date.now();
    const add: Bubble[] = [];
    for (const m of fresh) {
      const seatIdx = g.seats.findIndex((st) => st.playerId === m.from.id);
      if (seatIdx >= 0) add.push({ id: fxId++, seatIdx, text: m.text, at: ts });
    }
    if (add.length) setBubbles((b) => [...b, ...add]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.chat]);

  // fanfarra de fim de partida
  const overSig = s.gameOver?.matchId;
  useEffect(() => {
    if (!overSig || !s.profile) return;
    if (s.gameOver!.winnerId === s.profile.id) sfx.victory();
    else sfx.defeat();
  }, [overSig]);

  const me = useMemo(
    () => (game && game.yourSeat >= 0 ? game.seats[game.yourSeat] : null),
    [game],
  );

  const myTurn = !!game && !!me && game.turnSeat === game.yourSeat && game.status === 'active';
  const secondsLeft = game ? Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000)) : 0;

  // tique-taque de urgência nos últimos 5 segundos do seu turno
  useEffect(() => {
    if (myTurn && secondsLeft > 0 && secondsLeft <= 5) sfx.tick();
  }, [secondsLeft, myTurn]);

  if (!game || !me) return null;

  // Fase de mulligan: tela própria de troca de mão, antes do tabuleiro.
  // (Seguro como early return: não há hooks depois deste ponto no componente.)
  if (game.status === 'mulligan') return <MulliganOverlay game={game} me={me} />;

  const enemySeatIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
  const enemy = game.seats[enemySeatIdx];
  const timerPct = Math.min(100, (secondsLeft / TURN_SECONDS) * 100);

  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((c) => c.iid === selection.iid)?.defId ?? '']
    : null;
  const selectedAttacker = selection?.kind === 'attacker'
    ? me.board.find((c) => c.iid === selection.iid) ?? null
    : null;

  const noMovesLeft =
    myTurn &&
    !game.hand.some((c) => CARDS[c.defId].cost <= me.energy) &&
    !me.board.some((c) => c.canAttack);

  // Dinâmica Yu-Gi-Oh: criaturas em campo protegem o comandante de ataques
  // e magias (apenas efeitos especiais "pierce" atravessam).
  const faceShielded = enemy.board.length > 0;
  // Provocar: prioridade entre criaturas — a com a palavra-chave vai primeiro
  const enemyTaunts = enemy.board.filter((c) => CARDS[c.defId].keywords?.includes('taunt'));
  const mustHitTaunt = selection?.kind === 'attacker' && enemyTaunts.length > 0;

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
      const retaliation = defender.attack + enemy.attackBonus;
      const dies = defender.health <= power;
      // dano excedente: só quando a defensora morta era a última criatura
      const overflow = dies && enemy.board.length === 1 ? Math.max(0, power - defender.health) : 0;
      return {
        targetDmg: power,
        targetDies: dies,
        overflow: overflow > 0 ? overflow : undefined,
        lethal: overflow > 0 && overflow >= enemy.hp + enemy.shield,
        selfDmg: retaliation,
        selfDies: selectedAttacker.health <= retaliation,
        attackerIid: selectedAttacker.iid,
      };
    }
    if (selectedHandDef && SPELL_DMG[selectedHandDef.id] !== undefined) {
      const dmg = SPELL_DMG[selectedHandDef.id];
      if (target.kind === 'face') {
        if (faceShielded && !selectedHandDef.pierce) return null;
        return { targetDmg: dmg, lethal: dmg >= enemy.hp + enemy.shield };
      }
      const victim = enemy.board.find((c) => c.iid === target.iid);
      if (!victim) return null;
      return { targetDmg: dmg, targetDies: victim.health <= dmg };
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

  /** Ataca com a criatura no alvo; valida Provocar e proteção do comandante. */
  function performAttack(attacker: CreatureOnBoard, t: AimTarget): void {
    if (!myTurn || !attacker.canAttack) return;
    if (t.kind === 'my-creature') return; // sem fogo amigo
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

  /** Joga a carta da mão (com ou sem alvo); silencioso em alvo incompatível. */
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
      if (t.kind !== 'my-creature') return;
      send({ t: 'game:play', iid, target: { seat: game!.yourSeat, iid: t.c.iid } });
    } else if (t.kind === 'enemy-creature') {
      if (wants !== 'enemy-creature' && wants !== 'enemy-any') return;
      send({ t: 'game:play', iid, target: { seat: enemySeatIdx, iid: t.c.iid } });
    } else if (t.kind === 'face') {
      if (wants !== 'enemy-any') return;
      if (faceShielded && !def.pierce) {
        sfx.error();
        return; // criaturas protegem o comandante até de magias
      }
      send({ t: 'game:play', iid, target: { seat: enemySeatIdx } });
    } else {
      return;
    }
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
      performPlay(iid, defId, null);
    } else {
      sfx.click();
      setSelection(selection?.kind === 'hand' && selection.iid === iid ? null : { kind: 'hand', iid });
    }
  }

  function clickMyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef?.target === 'friendly-creature') {
      performPlay(selection.iid, selectedHandDef.id, { kind: 'my-creature', c });
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

  /** Resolve o alvo sob o ponteiro pelos data-anchor já presentes no DOM. */
  function resolveTargetAt(x: number, y: number): AimTarget | null {
    const anchor = document.elementFromPoint(x, y)?.closest('[data-anchor]')?.getAttribute('data-anchor');
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

  function aimTargetToHover(t: AimTarget | null): HoverTarget {
    if (!t) return null;
    if (t.kind === 'face') return { kind: 'face' };
    return { kind: 'creature', iid: t.c.iid };
  }

  /** Início de gesto numa carta da mão ou criatura própria. */
  function onTargetPointerDown(e: React.PointerEvent, origin: { kind: 'hand' | 'creature'; iid: string; defId: string }) {
    if (!myTurn || !e.isPrimary || e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
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
      } else {
        setSelection(null);
        drag.mode = 'lift';
      }
    },
    move(drag, x, y) {
      if (drag.mode === 'target') {
        setMouse({ x, y });
        setHover(aimTargetToHover(resolveTargetAt(x, y)));
      } else if (drag.mode === 'lift') {
        setLift({ iid: drag.iid, dy: Math.min(0, y - drag.startY) });
      }
    },
    finish(drag, x, y) {
      if (drag.mode === 'target') {
        const t = resolveTargetAt(x, y);
        if (drag.kind === 'creature') {
          const attacker = me?.board.find((c) => c.iid === drag.iid);
          if (attacker && t) performAttack(attacker, t);
          else clearAim(); // soltou no vazio: cancela a mira
        } else if (t) {
          performPlay(drag.iid, drag.defId, t);
        } else {
          clearAim();
        }
        // alvo bloqueado (Provocar/escudo) mantém a seleção para o tap-tap,
        // mas a seta não deve ficar congelada no ponto do último toque
        setMouse(null);
        setHover(null);
      } else if (drag.mode === 'lift') {
        if (drag.startY - y >= PLAY_LIFT_PX) performPlay(drag.iid, drag.defId, null);
        setLift(null);
      }
    },
    cancel(drag) {
      // navegador tomou o gesto (rolagem da mão, gesto de sistema): limpa tudo
      if (drag.mode === 'target') clearAim();
      setLift(null);
    },
  };

  const targetingEnemy =
    selection?.kind === 'attacker' ||
    (selection?.kind === 'hand' && selectedHandDef?.target !== 'friendly-creature');
  const targetingFriendly = selection?.kind === 'hand' && selectedHandDef?.target === 'friendly-creature';

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
    if (hover.kind === 'face') return !faceShielded || !!selectedHandDef?.pierce;
    const ec = enemy.board.find((c) => c.iid === hover.iid);
    if (!ec) return false;
    if (mustHitTaunt && !CARDS[ec.defId].keywords?.includes('taunt')) return false;
    return true;
  })();

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
  // cor da mira: letal = vermelho · ataque = ouro · magia = roxo
  const aimColor = lethalAim ? '#f85149' : selection?.kind === 'attacker' ? '#e3b341' : '#b083f0';
  const unreadChat = Math.max(0, s.chat.length - chatSeen);

  // prévia de dano em TODOS os alvos válidos ao selecionar — decisão
  // informada sem depender de hover (essencial no toque)
  const staticFacePreview = targetingEnemy && hover?.kind !== 'face' ? previewFor({ kind: 'face' }) : null;

  return (
    <div
      className="game-screen"
      onPointerMove={selection ? (e) => setMouse({ x: e.clientX, y: e.clientY }) : undefined}
      onContextMenu={selection ? (e) => { e.preventDefault(); setSelection(null); } : undefined}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="mobile-topbar">
        <button
          className={`btn small ghost ${sidePane === 'log' ? 'active' : ''}`}
          onClick={() => setSidePane(sidePane === 'log' ? null : 'log')}
          title="Eventos"
          aria-label="Eventos da partida"
        >
          📜
        </button>
        <button
          className={`btn small ghost ${sidePane === 'chat' ? 'active' : ''}`}
          onClick={() => setSidePane(sidePane === 'chat' ? null : 'chat')}
          title="Chat"
          aria-label={`Chat${unreadChat > 0 ? ` (${unreadChat} não lidas)` : ''}`}
        >
          💬
          {unreadChat > 0 && sidePane !== 'chat' && <span className="unread-badge">{unreadChat}</span>}
        </button>
        <button className="btn small ghost" onClick={() => setShowRules(true)} title="Como jogar" aria-label="Como jogar">📖</button>
        <button className="btn small ghost" onClick={() => setShowCodex(true)} title="Arquivo de Aurélia" aria-label="Arquivo de Aurélia">📜</button>
        <button className="btn small ghost" onClick={() => setSound(toggleSound())} title="Som" aria-label={sound ? 'Desligar som' : 'Ligar som'}>
          {sound ? '🔊' : '🔇'}
        </button>
        <button
          className="btn small ghost danger"
          onClick={() => { if (confirm('Desistir da partida?')) send({ t: 'game:surrender' }); }}
          title="Desistir"
          aria-label="Desistir da partida"
        >
          🏳️
        </button>
      </div>
      <div
        className="game-board"
        onClick={(e) => {
          // toque em área vazia da arena cancela a mira/provocação (equivalente do Esc)
          if (!(e.target as Element).closest('[data-anchor], button, .hand')) {
            setSelection(null);
            setTauntOpen(false);
          }
        }}
      >
        <HeroPlate
          seat={enemy}
          seatIdx={enemySeatIdx}
          isEnemy
          onFaceClick={clickEnemyFace}
          targetable={!!targetingEnemy && (!faceShielded || !!selectedHandDef?.pierce)}
          blocked={!!targetingEnemy && faceShielded && !selectedHandDef?.pierce}
          lethal={faceLethal || !!staticFacePreview?.lethal}
          preview={hover?.kind === 'face' ? preview : staticFacePreview}
          previewDim={hover?.kind !== 'face' && !!staticFacePreview}
          onHover={(h) => setHover(h ? { kind: 'face' } : null)}
          fx={fxFor(`face-${enemySeatIdx}`)}
          bubble={bubbleFor(enemySeatIdx)}
        />

        <div className={`board-row enemy-row ${targetingEnemy ? 'targetable' : ''}`}>
          {enemy.board.map((c, i) => {
            const isTaunt = CARDS[c.defId].keywords?.includes('taunt');
            const blocked = !!mustHitTaunt && !isTaunt;
            const hovered = hover?.kind === 'creature' && hover.iid === c.iid;
            // chip estático em cada alvo válido enquanto algo está selecionado
            const staticPv = !hovered && targetingEnemy && !blocked
              ? previewFor({ kind: 'creature', iid: c.iid })
              : null;
            return (
              <Creature
                key={c.iid}
                c={c}
                bonus={enemy.attackBonus}
                blocked={blocked}
                posIndex={enemyPos.get(c.iid)}
                preview={hovered ? preview : staticPv}
                previewDim={!hovered && !!staticPv}
                onHover={(on) => setHover(on ? { kind: 'creature', iid: c.iid } : null)}
                fx={fxFor(`cr-${c.iid}`)}
                onClick={() => clickEnemyCreature(c)}
                style={{ order: i * 2 }}
              />
            );
          })}
          {ghostsFor(enemySeatIdx).map((g) => <GhostCreature key={g.id} g={g} />)}
          {enemy.board.length === 0 && ghostsFor(enemySeatIdx).length === 0 && (
            <div className="board-empty">mesa vazia</div>
          )}
        </div>

        <div className="board-divider">
          <div className={myTurn ? 'turn-pill mine' : 'turn-pill'}>
            <span className={myTurn && secondsLeft <= 10 ? 'time-urgent' : ''}>
              {game.status !== 'active'
                ? 'Partida encerrada'
                : myTurn
                  ? `Seu turno · ${secondsLeft}s`
                  : `Turno de ${game.seats[game.turnSeat].name} · ${secondsLeft}s`}
            </span>
            <span className="timer-track">
              <span
                className={`timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`}
                style={{ width: `${timerPct}%` }}
              />
            </span>
          </div>
          <div className="pace-hud">
            <span className="pace-turn" title="Turno da partida">Turno {game.turnNumber}</span>
            {me.fatigue === 0 && me.deckCount <= 3 && (
              <span className="pace-fatigue" title="Seu baralho está acabando — em breve cada compra custa vida">
                ⚠️ Fadiga à vista ({me.deckCount} no deck)
              </span>
            )}
          </div>
          {myTurn && (
            <button
              className={`btn end-turn ${noMovesLeft ? 'pulse' : ''}`}
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
                    {t.text}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`btn small taunt-toggle ${tauntOpen ? 'active' : ''}`}
              onClick={() => setTauntOpen((o) => !o)}
              title="Provocar o oponente"
            >
              😎
            </button>
          </div>
        </div>

        <div className={`board-row my-row ${targetingFriendly ? 'friendly-targetable' : ''}`}>
          {me.board.map((c, i) => (
            <Creature
              key={c.iid}
              c={c}
              bonus={me.attackBonus}
              mine
              selected={selection?.kind === 'attacker' && selection.iid === c.iid}
              buffTarget={targetingFriendly}
              lunging={attackFx?.iid === c.iid && now - attackFx.at < 500}
              warn={cantAttackWarn?.iid === c.iid && now - cantAttackWarn.at < 600}
              posIndex={myPos.get(c.iid)}
              retaliation={preview?.attackerIid === c.iid ? preview : null}
              fx={fxFor(`cr-${c.iid}`)}
              onClick={() => clickMyCreature(c)}
              onPointerDown={(e) => onTargetPointerDown(e, { kind: 'creature', iid: c.iid, defId: c.defId })}
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
        />

        <div className="hand">
          {game.hand.map((c, i) => {
            const off = i - (game.hand.length - 1) / 2;
            const isSelected = selection?.kind === 'hand' && selection.iid === c.iid;
            const affordable = CARDS[c.defId].cost <= me.energy;
            const lifting = lift?.iid === c.iid;
            return (
              <CardView
                key={c.iid}
                defId={c.defId}
                anchorId={`hand-${c.iid}`}
                playable={myTurn && affordable}
                selected={isSelected}
                lifting={lifting}
                onClick={() => clickHandCard(c.iid, c.defId)}
                onPointerDown={myTurn ? (e) => onTargetPointerDown(e, { kind: 'hand', iid: c.iid, defId: c.defId }) : undefined}
                onMouseEnter={(e) => {
                  if (myTurn && affordable) setHoverCost(CARDS[c.defId].cost);
                  if (!CAN_HOVER) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setInspect({ iid: c.iid, defId: c.defId, x: r.left + r.width / 2, y: r.top - 10 });
                }}
                onMouseLeave={() => { setHoverCost(0); setInspect(null); }}
                style={lifting ? {
                  // a carta segue o dedo na vertical; soltar bem acima joga
                  transform: `translateY(${lift!.dy}px) scale(1.12)`,
                  zIndex: 13,
                } : isSelected ? undefined : {
                  transform: `rotate(${off * 2.5}deg) translateY(${Math.abs(off) * 5}px)`,
                }}
              />
            );
          })}
        </div>
      </div>

      <aside className={`game-side ${sidePane ? `open pane-${sidePane}` : ''}`}>
        <button className="btn small ghost drawer-close" onClick={() => setSidePane(null)}>
          ▾ Fechar
        </button>
        <div className="side-top">
          <span>
            <button className="btn small ghost" onClick={() => setSound(toggleSound())} title="Som">
              {sound ? '🔊' : '🔇'}
            </button>
            <button className="btn small ghost" onClick={() => setShowRules(true)} title="Como jogar">
              📖
            </button>
            <button className="btn small ghost" onClick={() => setShowCodex(true)} title="Arquivo de Aurélia">
              📜
            </button>
          </span>
          <button
            className="btn small ghost danger"
            onClick={() => { if (confirm('Desistir da partida?')) send({ t: 'game:surrender' }); }}
          >
            🏳️ Desistir
          </button>
        </div>
        <div className="panel log-panel">
          <h3>📜 Eventos</h3>
          <ul className="game-log" role="log" aria-live="polite" aria-label="Eventos da partida">
            {game.log.slice(-14).reverse().map((l, i) => <li key={game.log.length - i}>{l.text}</li>)}
          </ul>
        </div>
        <div className="panel side-chat">
          <h3>💬 Chat</h3>
          <Chat />
        </div>
      </aside>

      {selection && (
        <div className="target-hint">
          <span className="target-hint-text">
            {selection.kind === 'attacker'
              ? `⚔️ Atacando com ${selectedAttacker ? CARDS[selectedAttacker.defId].name : 'sua criatura'}: ${
                  mustHitTaunt
                    ? 'Provocar — ataque o Golem antes das outras criaturas'
                    : faceShielded
                      ? 'as criaturas inimigas protegem o comandante — derrote-as primeiro'
                      : 'mesa livre — ataque o comandante ou veja a prévia no alvo'
                }`
              : selectedHandDef?.target === 'friendly-creature'
                ? 'Escolha uma criatura aliada'
                : faceShielded && !selectedHandDef?.pierce
                  ? 'Escolha uma criatura inimiga — elas protegem o comandante'
                  : 'Escolha um alvo inimigo — a prévia de dano aparece em cada um'}
          </span>
          <button className="btn small cancel-pill" onClick={clearAim}>✕ Cancelar</button>
        </div>
      )}

      {arrow && (
        <svg className="aim-arrow" width="100%" height="100%" style={{ filter: `drop-shadow(0 0 7px ${aimColor}aa)` }}>
          <defs>
            <marker id="arrowhead" markerWidth="9" markerHeight="9" refX="5" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 L2.6,4.5 Z" fill={aimColor} />
            </marker>
          </defs>
          {/* trilho translúcido: o "corpo" luminoso da seta */}
          <path d={arrowPath(arrow)} stroke={aimColor} strokeOpacity="0.22" strokeWidth="12" strokeLinecap="round" fill="none" />
          {/* linha viva com tracejado correndo rumo ao alvo */}
          <path
            className="aim-flow"
            d={arrowPath(arrow)}
            stroke={aimColor}
            strokeWidth="4"
            strokeDasharray="11 9"
            strokeLinecap="round"
            fill="none"
            markerEnd={lockOn ? undefined : 'url(#arrowhead)'}
          />
          {/* retícula de "travado no alvo" */}
          {lockOn && (
            <g className={`aim-reticle ${lethalAim ? 'lethal' : ''}`}>
              <circle className="reticle-ring" cx={arrow.x2} cy={arrow.y2} r="26" fill="none" stroke={aimColor} strokeWidth="2.5" />
              <circle className="reticle-ping" cx={arrow.x2} cy={arrow.y2} r="26" fill="none" stroke={aimColor} strokeWidth="2.5" />
              <g stroke={aimColor} strokeWidth="2.5" strokeLinecap="round">
                <line x1={arrow.x2 - 34} y1={arrow.y2} x2={arrow.x2 - 21} y2={arrow.y2} />
                <line x1={arrow.x2 + 21} y1={arrow.y2} x2={arrow.x2 + 34} y2={arrow.y2} />
                <line x1={arrow.x2} y1={arrow.y2 - 34} x2={arrow.x2} y2={arrow.y2 - 21} />
                <line x1={arrow.x2} y1={arrow.y2 + 21} x2={arrow.x2} y2={arrow.y2 + 34} />
              </g>
            </g>
          )}
        </svg>
      )}

      <div className="reveal-stack">
        {reveals.map((r) => (
          <div key={r.id} className="card-reveal">
            <span className="reveal-label">Oponente jogou</span>
            <CardView defId={r.cardId} />
          </div>
        ))}
      </div>

      {inspect && !selection && !lift && game.status === 'active' && game.hand.some((c) => c.iid === inspect.iid) && (
        <div
          className="card-inspect"
          style={{
            left: Math.min(Math.max(inspect.x, 130), window.innerWidth - 130),
            top: inspect.y,
          }}
        >
          <CardView defId={inspect.defId} />
        </div>
      )}

      {banner && <div className="turn-banner" key={banner.at} role="status" aria-live="assertive">{banner.text}</div>}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showCodex && <CodexView onClose={() => setShowCodex(false)} />}
      {showTutorial && !s.gameOver && <Tutorial onClose={() => setShowTutorial(false)} />}
      {s.gameOver && <GameOverOverlay />}
    </div>
  );
}

function FxLayer({ fx }: { fx: FloatFx[] }) {
  return (
    <>
      {fx.map((f) => (
        <span key={f.id} className={`float-fx ${f.kind}`}>
          {f.kind === 'dmg' ? `-${f.value}` : `+${f.value}`}
        </span>
      ))}
    </>
  );
}

function PreviewChip({ p, self, dim }: { p: CombatPreview; self?: boolean; dim?: boolean }) {
  if (self) {
    if (p.selfDmg === undefined) return null;
    return (
      <span className={`preview-chip ${p.selfDies ? 'dies' : ''}`}>
        −{p.selfDmg}{p.selfDies ? ' 💀' : ''}
      </span>
    );
  }
  return (
    <span className={`preview-chip ${dim ? 'static' : ''} ${p.lethal ? 'lethal' : p.targetDies ? 'dies' : ''}`}>
      −{p.targetDmg}
      {p.targetDies ? ' 💀' : ''}
      {p.overflow ? ` ↯${p.overflow}` : ''}
      {p.lethal ? ' ☠ LETAL' : ''}
    </span>
  );
}

function HeroPlate({ seat, seatIdx, isEnemy, onFaceClick, targetable, blocked, lethal, preview, previewDim, onHover, pendingCost = 0, energyWarn, fx, bubble }: {
  seat: SeatView;
  seatIdx: number;
  isEnemy?: boolean;
  onFaceClick?: () => void;
  targetable?: boolean;
  blocked?: boolean;
  lethal?: boolean;
  preview?: CombatPreview | null;
  previewDim?: boolean;
  onHover?: (on: boolean) => void;
  pendingCost?: number;
  energyWarn?: boolean;
  fx: FloatFx[];
  bubble?: Bubble | null;
}) {
  const hit = fx.some((f) => f.kind === 'dmg');
  const title = commanderTitle(seat.commander);
  return (
    <div className={`hero-plate ${isEnemy ? 'enemy' : ''}`} style={{ ['--accent' as string]: seat.accent }}>
      {bubble && (
        <div className={`taunt-bubble ${isEnemy ? 'down' : 'up'}`} key={bubble.id}>{bubble.text}</div>
      )}
      <button
        className={[
          'portrait',
          targetable ? 'targetable' : '',
          blocked ? 'blocked' : '',
          lethal ? 'lethal' : '',
          hit ? 'hit' : '',
        ].join(' ')}
        data-anchor={`face-${seatIdx}`}
        onClick={onFaceClick}
        disabled={!onFaceClick}
        onMouseEnter={onHover && targetable ? () => onHover(true) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}
        title={blocked ? 'Protegido por Provocar' : undefined}
      >
        <span className="portrait-avatar">{seat.commander || seat.avatar}</span>
        <span className="hp-orb">{seat.hp}</span>
        {seat.shield > 0 && <span className="shield-orb">🛡️{seat.shield}</span>}
        {preview && <PreviewChip p={preview} dim={previewDim} />}
        <FxLayer fx={fx} />
      </button>
      <div className="hero-info">
        <span className="hero-name">
          {seat.name}
          {!seat.connected && <em className="dc-tag"> · reconectando…</em>}
        </span>
        {title && <span className="commander-sub">{title}</span>}
        <span
          className={`energy-crystals ${energyWarn ? 'warn' : ''}`}
          title={`Energia ${seat.energy}/${seat.maxEnergy}`}
        >
          {Array.from({ length: Math.min(MAX_ENERGY, Math.max(seat.maxEnergy, seat.energy)) }, (_, i) => {
            const willSpend = pendingCost > 0 && i >= seat.energy - pendingCost && i < seat.energy;
            return <i key={i} className={`crystal ${i < seat.energy ? 'full' : ''} ${willSpend ? 'spend' : ''}`} />;
          })}
          <b>{seat.energy}/{seat.maxEnergy}</b>
        </span>
      </div>
      <div className="hero-meta">
        <span className="meta-chip" title="Cartas no deck">🂠 {seat.deckCount}</span>
        {isEnemy && <span className="meta-chip" title="Cartas na mão">✋ {seat.handCount}</span>}
        {seat.attackBonus > 0 && (
          <span className="meta-chip buff" title="Estandarte de Guerra">🚩 +{seat.attackBonus}</span>
        )}
        {seat.fatigue > 0 && <span className="meta-chip warn" title="Fadiga">💀 {seat.fatigue}</span>}
      </div>
    </div>
  );
}

function Creature({ c, bonus, mine, selected, buffTarget, blocked, warn, posIndex, lunging, preview, previewDim, retaliation, onHover, fx, onClick, onPointerDown, style }: {
  c: CreatureOnBoard;
  bonus: number;
  mine?: boolean;
  selected?: boolean;
  buffTarget?: boolean;
  blocked?: boolean;
  warn?: boolean;
  /** Número da posição quando há cópias iguais na mesa (senão indefinido). */
  posIndex?: number;
  lunging?: boolean;
  preview?: CombatPreview | null;
  previewDim?: boolean;
  retaliation?: CombatPreview | null;
  onHover?: (on: boolean) => void;
  fx: FloatFx[];
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  style?: React.CSSProperties;
}) {
  const def = CARDS[c.defId];
  const hit = fx.some((f) => f.kind === 'dmg');
  const healed = fx.some((f) => f.kind === 'heal');
  const isTaunt = def.keywords?.includes('taunt');
  // convenção de card game: número verde = acima do impresso; vermelho = ferida
  const atkBuffed = c.attack + bonus > (def.attack ?? 0);
  const hpHurt = c.health < c.baseHealth;
  const hpBuffed = !hpHurt && c.baseHealth > (def.health ?? 0);
  const classes = [
    'creature',
    mine ? 'mine' : '',
    selected ? 'selected' : '',
    mine && c.canAttack ? 'ready' : '',
    buffTarget && mine ? 'buff-target' : '',
    blocked ? 'blocked' : '',
    warn ? 'cant-attack' : '',
    lunging ? 'lunging' : '',
    isTaunt ? 'taunt' : '',
    c.health < c.baseHealth ? 'wounded' : '',
    hit ? 'hit struck' : '',
    healed ? 'healed' : '',
  ].join(' ');
  return (
    <button
      className={classes}
      data-anchor={`cr-${c.iid}`}
      style={style}
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={
        blocked
          ? 'Protegido por Provocar — ataque o Golem primeiro'
          : mine && !c.canAttack
            ? 'Essa criatura não pode atacar agora (acabou de entrar ou já atacou neste turno)'
            : posIndex
              ? `${def.name} · posição ${posIndex} na mesa`
              : def.text
      }
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {isTaunt && <span className="taunt-badge" title="Provocar">🛡</span>}
      {posIndex && (
        <span className="pos-badge" title={`Posição ${posIndex} na mesa — cópia idêntica em campo`}>
          {posIndex}
        </span>
      )}
      <CardArt defId={c.defId} className="creature-art" />
      <span className="creature-name">{def.name}</span>
      <span className={`stat-gem atk ${atkBuffed ? 'buffed' : ''}`}>{c.attack + bonus}</span>
      <span className={`stat-gem hp ${hpHurt ? 'hurt' : hpBuffed ? 'buffed' : ''}`}>{c.health}</span>
      {mine && c.canAttack && <span className="ready-dot" />}
      {preview && <PreviewChip p={preview} dim={previewDim} />}
      {retaliation && <PreviewChip p={retaliation} self />}
      <FxLayer fx={fx} />
    </button>
  );
}

function GhostCreature({ g }: { g: Ghost }) {
  const def = CARDS[g.creature.defId];
  return (
    // order = slot*2 - 1: a caveira fica imediatamente antes de quem assumiu
    // o lugar, animando a morte na posição exata em que a carta estava.
    <span className="creature ghost" style={{ order: g.slot * 2 - 1 }}>
      <CardArt defId={g.creature.defId} className="creature-art" />
      <span className="creature-name">{def.name}</span>
      <span className="ghost-skull">💀</span>
    </span>
  );
}

/** Fase de mulligan: ajustar a mão inicial (trocar cartas) antes do turno 1. */
function MulliganOverlay({ game, me }: { game: GameViewState; me: SeatView }) {
  const [swap, setSwap] = useState<Set<string>>(() => new Set());
  const confirmed = me.mulliganDone;

  function toggle(iid: string, defId: string) {
    if (confirmed || CARDS[defId].token) return; // a Moeda não é trocável
    setSwap((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) next.delete(iid);
      else next.add(iid);
      return next;
    });
  }

  function confirm() {
    sfx.click();
    send({ t: 'game:mulligan', iids: [...swap] });
  }

  return (
    <div className="overlay">
      <div className="panel mulligan">
        <h2>Ajuste sua mão inicial</h2>
        <p className="mulligan-hint">
          Toque nas cartas que quer devolver ao baralho — você compra outras no lugar.
          A Moeda do Tempo fica.
        </p>
        <div className="mulligan-hand">
          {game.hand.map((c) => {
            const token = !!CARDS[c.defId].token;
            const picked = swap.has(c.iid);
            return (
              <div key={c.iid} className={`mulligan-slot ${picked ? 'swapping' : ''} ${token ? 'locked' : ''}`}>
                <CardView
                  defId={c.defId}
                  selected={picked}
                  onClick={confirmed || token ? undefined : () => toggle(c.iid, c.defId)}
                />
                <span className="mulligan-flag">{token ? '🪙 fixa' : picked ? '↺ trocar' : 'manter'}</span>
              </div>
            );
          })}
        </div>
        {confirmed ? (
          <p className="mulligan-waiting">Mão confirmada — aguardando o oponente…</p>
        ) : (
          <button className="btn primary big mulligan-confirm" onClick={confirm}>
            {swap.size ? `Trocar ${swap.size} e começar` : 'Manter a mão e começar'}
          </button>
        )}
      </div>
    </div>
  );
}

function GameOverOverlay() {
  const s = useAppState();
  const result = s.gameOver;
  const myId = s.profile?.id;
  if (!result || !myId) return null;

  const won = result.winnerId === myId;
  const my = result.mmr[myId];
  const reasonText: Record<string, string> = {
    hp: won ? 'Você zerou a vida do oponente!' : 'Sua vida chegou a zero.',
    surrender: won ? 'O oponente desistiu da partida.' : 'Você desistiu da partida.',
    timeout: won ? 'O oponente não voltou a tempo.' : 'Você ficou desconectado por muito tempo.',
  };

  return (
    <div className="overlay">
      {won && (
        <div className="confetti">
          {Array.from({ length: 18 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 53) % 100}%`,
                animationDelay: `${(i % 6) * 0.25}s`,
                background: ['#e3b341', '#4d8dff', '#3fb950', '#b083f0', '#f85149'][i % 5],
              }}
            />
          ))}
        </div>
      )}
      <div className={`panel game-over ${won ? 'won' : 'lost'}`} role="alert" aria-live="assertive">
        <div className="go-emblem">{won ? '🏆' : '💀'}</div>
        <h2>{won ? 'Vitória!' : 'Derrota'}</h2>
        <p>{reasonText[result.reason]}</p>
        <p className="dim">{result.turns} turnos · {Math.max(1, Math.round(result.durationMs / 60000))} min</p>
        {my && (
          <p className="mmr-change">
            MMR: {my.before} → <strong>{my.after}</strong>{' '}
            <span className={my.delta >= 0 ? 'delta up' : 'delta down'}>
              ({my.delta >= 0 ? '+' : ''}{my.delta})
            </span>
            <br />
            <LeagueBadge league={my.league} />
          </p>
        )}
        {(() => {
          const newly = (myId && result.unlocked?.[myId]) || [];
          return newly.length ? (
            <div className="go-unlocks">
              <p className="go-unlocks-title">✨ Conquista desbloqueada!</p>
              {newly.map((a) => <span key={a} className="go-unlock">🏅 {achievementLabel(a)}</span>)}
            </div>
          ) : null;
        })()}
        <button className="btn primary big" onClick={() => { sfx.click(); dismissGameOver(); }}>
          ⚔️ Jogar de novo
        </button>
      </div>
    </div>
  );
}
