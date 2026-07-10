import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_ENERGY, TAUNTS, TURN_SECONDS, achievementLabel, commanderTitle, keywordDesc, keywordLabel } from '@legendsclash/shared';
import type { CreatureOnBoard, GameView as GameViewState, SeatView } from '@legendsclash/shared';
import { addFriend, declineRematch, dismissGameOver, requestRematch, send, useAppState, viewProfile } from '../store';
import { Avatar, CosmeticIcon, TauntIcon, accentVars } from '../cosmetics';
import {
  IcoAddFriend, IcoAttack, IcoBanner, IcoBuff, IcoChat, IcoCheck, IcoClose, IcoCodex, IcoCoin,
  IcoDeath, IcoDeck, IcoEnergy, IcoEvents, IcoExpensive, IcoHand, IcoHint, IcoLethal, IcoMedal,
  IcoOverflow, IcoRematch, IcoRules, IcoShield, IcoSparkle, IcoStar, IcoSurrender, IcoSwap, IcoWard,
  IcoTaunt, IcoTimer, IcoVictory, IcoWarning,
} from '../icons';
import { CardArt } from '../components/CardArt';
import { CardView } from '../components/CardView';
import { Chat } from '../components/Chat';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LeagueBadge } from '../components/LeagueBadge';
import { RulesModal } from '../components/RulesModal';
import { Tutorial } from '../components/Tutorial';
import { CodexView } from './CodexView';
import { SoundControl } from '../components/SoundControl';
import { sfx } from '../sounds';
import { preloadCardImages } from '../preload';

type Selection =
  | { kind: 'hand'; iid: string }
  | { kind: 'attacker'; iid: string }
  | null;

type HandFocus = { iid: string; defId: string } | null;

type HoverTarget = { kind: 'face' } | { kind: 'creature'; iid: string } | null;
type InspectCard = {
  iid: string;
  defId: string;
  x: number;
  y: number;
  source: 'hand' | 'creature';
};

type LogTone = 'turn' | 'damage' | 'summon' | 'spell' | 'fatigue' | 'shield' | 'surrender' | 'neutral';
type CoachTone = 'wait' | 'end' | 'play' | 'attack' | 'lethal';
type HandIntentTone = 'neutral' | 'good' | 'target' | 'support';

/** Efeito flutuante transitório, ancorado a um elemento da arena.
 *  dmg/heal = vida; shield = dano absorvido pelo escudo; buff = empoderamento. */
interface FloatFx {
  id: number;
  kind: 'dmg' | 'heal' | 'shield' | 'buff';
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

/** Tooltip da criatura na arena: explica as palavras-chave + o texto da carta. */
function creatureHint(def: { keywords?: readonly string[]; text: string }): string {
  const kw = (def.keywords ?? []).map((k) => `${keywordLabel(k)}: ${keywordDesc(k)}`).join(' · ');
  return kw ? `${kw}\n${def.text}` : def.text;
}

function logTone(text: string): LogTone {
  const t = text.toLocaleLowerCase('pt-BR');
  if (t.includes('turno')) return 'turn';
  if (t.includes('fadiga') || t.includes('baralho')) return 'fatigue';
  if (t.includes('desist')) return 'surrender';
  if (t.includes('escudo')) return 'shield';
  if (t.includes('dano') || t.includes('ataca') || t.includes('derrot')) return 'damage';
  if (t.includes('invoc') || t.includes('entra')) return 'summon';
  if (t.includes('magia') || t.includes('jogou') || t.includes('compra')) return 'spell';
  return 'neutral';
}

function logIcon(tone: LogTone) {
  switch (tone) {
    case 'turn': return <IcoTimer />;
    case 'damage': return <IcoAttack />;
    case 'summon': return <IcoBanner />;
    case 'spell': return <IcoSparkle />;
    case 'fatigue': return <IcoDeath />;
    case 'shield': return <IcoShield />;
    case 'surrender': return <IcoSurrender />;
    default: return <IcoEvents />;
  }
}

function gameOverLesson(reason: string, won: boolean): string {
  if (reason === 'fatigue') {
    return won
      ? 'Você venceu porque transformou o baralho inimigo em pressão. Quando o deck fica curto, forçar compras passa a ser dano real.'
      : 'Fadiga cresce a cada compra sem cartas no baralho. Quando o deck fica curto, preserve vida e procure encerrar antes da próxima compra.';
  }
  if (reason === 'hp') {
    return won
      ? 'Boa leitura de dano: continue contando escudo, mesa e vida antes de comprometer a mão.'
      : 'Revise os turnos em que a mesa ficou aberta. Criaturas em campo protegem o comandante e reduzem dano direto.';
  }
  if (reason === 'surrender') {
    return won
      ? 'O oponente reconheceu que a posição estava perdida. Use a revanche para testar outra linha de abertura.'
      : 'A desistência encerra rápido, mas o histórico ainda registra a derrota. Use treino para testar mãos difíceis sem afetar MMR.';
  }
  if (reason === 'timeout') {
    return won
      ? 'Vitória por janela de reconexão. Em partidas longas, mantenha pressão para converter antes que o tempo decida.'
      : 'A janela de reconexão protege quedas rápidas, mas abandonar por muito tempo ainda encerra a partida.';
  }
  return 'Use o histórico e a revanche para entender onde a partida virou.';
}

function handIntent(defId: string, selected: boolean): { label: string; tone: HandIntentTone } {
  const def = CARDS[defId];
  if (!def) return { label: 'Usar', tone: 'neutral' };
  if (selected) return { label: 'Mirando', tone: 'target' };
  if (def.target === 'friendly-creature') return { label: 'Aliado', tone: 'support' };
  if (def.target && def.target !== 'none') return { label: 'Mira', tone: 'target' };
  if (def.type === 'creature') return { label: 'Invocar', tone: 'good' };
  if (def.type === 'artifact') return { label: 'Equipar', tone: 'neutral' };
  return { label: 'Usar', tone: 'neutral' };
}

let fxId = 1;
const FX_TTL = 1100;
const GHOST_TTL = 700;
const REVEAL_TTL = 1700;
const DAMAGE_NOTICE_TTL = 4200;
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

interface DamageNoticeHit {
  target: string;
  amount?: number;
  kind: 'hp' | 'shield' | 'creature' | 'defeat';
}

interface DamageNotice {
  id: number;
  owner: string;
  source: string;
  detail: string;
  hits: DamageNoticeHit[];
  at: number;
}

const SPELL_DMG: Record<string, number> = {
  s_faisca: 2, s_bola_de_fogo: 5, s_lanca_gelo: 3, s_julgamento: 3,
};

/** Movimento mínimo (px) para um toque virar arrasto em vez de clique. */
const DRAG_THRESHOLD_PX = 8;
/** Inspeção no hover só com mouse real — no toque o mouseover sintético do
 *  tap deixaria o overlay preso na tela (não há mouseleave correspondente). */
const CAN_HOVER = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
/** Fluxo mobile/touch: tap foca a carta; jogar sem alvo exige CTA explícito. */
const TOUCH_CONFIRM_QUERY = '(hover: none), (pointer: coarse)';
/** Elevação mínima (px) para "soltar pra jogar" uma carta sem alvo. */
const PLAY_LIFT_PX = 48;

function noTargetActionLabel(defId: string): string {
  const def = CARDS[defId];
  if (!def) return 'Usar';
  if (def.type === 'creature') return 'Invocar';
  if (def.type === 'artifact') return 'Equipar';
  return 'Usar';
}

function isDamageLogLine(text: string): boolean {
  return /\b(causou|sofreu|atingiu|atacou|revidou|excedente|sangrou|dano)\b/i.test(text);
}

function damageSourceFromLog(text: string | undefined): string {
  if (!text) return 'Ação inimiga';
  if (text.startsWith('Grito de Batalha')) return 'Grito de Batalha';
  if (text.startsWith('Estertor')) return 'Estertor';
  const [source] = text.split(/\s+(?:causou|atingiu|atacou|revidou|sofreu)\b/i);
  return source?.replace(/^O\s+/, '').trim() || 'Ação inimiga';
}

function damageDetailFromLog(text: string | undefined): string {
  if (!text) return 'O efeito inimigo afetou seu lado da mesa.';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Layout estável para o HUD de ritmo do turno.
 * Mantém os chips em uma linha, impede wrap imprevisível e substitui
 * tooltips nativos por aria-label — o browser não desenha aquela caixa
 * branca por cima da arena.
 */
const PACE_HUD_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 0,
  maxWidth: 'min(44vw, 520px)',
  height: 28,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  flexWrap: 'nowrap',
  lineHeight: 1,
};

const PACE_CHIP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
  maxWidth: 180,
  height: 24,
  padding: '0 8px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  flex: '0 1 auto',
  lineHeight: 1,
  verticalAlign: 'middle',
};

const PACE_CHIP_TIGHT_STYLE: React.CSSProperties = {
  ...PACE_CHIP_STYLE,
  maxWidth: 132,
  flex: '0 0 auto',
};

const PACE_CHIP_TEXT_STYLE: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};


/** Curva da seta de mira: arco quadrático do atacante/carta até o alvo. */
function arrowPath(a: { x1: number; y1: number; x2: number; y2: number }): string {
  const cx = (a.x1 + a.x2) / 2;
  const cy = Math.min(a.y1, a.y2) - 60;
  return `M ${a.x1} ${a.y1} Q ${cx} ${cy} ${a.x2} ${a.y2}`;
}

function arrowPoint(a: { x1: number; y1: number; x2: number; y2: number }, t: number): { x: number; y: number } {
  const cx = (a.x1 + a.x2) / 2;
  const cy = Math.min(a.y1, a.y2) - 60;
  const mt = 1 - t;
  return {
    x: mt * mt * a.x1 + 2 * mt * t * cx + t * t * a.x2,
    y: mt * mt * a.y1 + 2 * mt * t * cy + t * t * a.y2,
  };
}

/**
 * Gesto de arrasto em andamento (mouse ou dedo — Pointer Events unificam).
 * `pending` ainda pode virar clique; `target` mira com a seta; `lift` levanta
 * uma carta sem alvo para jogá-la; `dead` consome o gesto sem ação (feedback
 * de erro já dado).
 */
interface DragState {
  pointerId: number;
  pointerType: string;
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
  const [damageNotice, setDamageNotice] = useState<DamageNotice | null>(null);
  // ensino contextual one-shot (Provocar, fadiga) — uma vez por dispositivo
  const [teach, setTeach] = useState<{ id: string; text: string; at: number } | null>(null);
  // investida da atacante: empurrão na direção do inimigo no momento do envio
  const [attackFx, setAttackFx] = useState<{ iid: string; at: number } | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
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
  const [inspect, setInspect] = useState<InspectCard | null>(null);
  // gaveta lateral no mobile: log/chat viram bottom-sheet com badge de não lidas
  const [sidePane, setSidePane] = useState<'log' | 'chat' | null>(null);
  const [chatSeen, setChatSeen] = useState(0);
  const [confirmSurrenderOpen, setConfirmSurrenderOpen] = useState(false);
  const [handFocus, setHandFocus] = useState<HandFocus>(null);
  const [touchPlayConfirm, setTouchPlayConfirm] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(TOUCH_CONFIRM_QUERY).matches
  ));
  const prevRef = useRef<GameViewState | null>(null);
  const prevChatLenRef = useRef(0);
  const tauntCooldownRef = useRef(0);
  const inspectTimerRef = useRef<number | null>(null);
  const handRef = useRef<HTMLDivElement | null>(null);
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
  const handSignature = game?.hand.map((c) => c.iid).join('|') ?? '';

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

  const visibleImageKey = useMemo(() => {
    if (!game) return '';
    const ids = [
      ...game.hand.map((c) => c.defId),
      ...game.seats.flatMap((seat) => seat.board.map((c) => c.defId)),
      ...reveals.map((r) => r.cardId),
    ];
    return [...new Set(ids)].join('|');
  }, [game, reveals]);

  useEffect(() => {
    const t = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      setFx((f) => (f.length && ts - f[0].at > FX_TTL ? f.filter((x) => ts - x.at < FX_TTL) : f));
      setGhosts((g) => (g.length && ts - g[0].at > GHOST_TTL ? g.filter((x) => ts - x.at < GHOST_TTL) : g));
      setReveals((r) => (r.length && ts - r[0].at > REVEAL_TTL ? r.filter((x) => ts - x.at < REVEAL_TTL) : r));
      setBubbles((b) => (b.length && ts - b[0].at > BUBBLE_TTL ? b.filter((x) => ts - x.at < BUBBLE_TTL) : b));
      setBanner((b) => (b && ts - b.at > 1500 ? null : b));
      setDamageNotice((d) => (d && ts - d.at > DAMAGE_NOTICE_TTL ? null : d));
      setTeach((t) => (t && ts - t.at > 7000 ? null : t));
    }, 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!visibleImageKey) return;
    preloadCardImages(visibleImageKey.split('|'), { priority: 'high', decode: true });
  }, [visibleImageKey]);

  useEffect(() => () => {
    if (inspectTimerRef.current) window.clearTimeout(inspectTimerRef.current);
  }, []);
  // cancela a seleção com Esc ou clique com o botão direito
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { clearAim(); setTauntOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Arrasto para mirar/jogar: listeners na window unificam mouse e toque
  // (no toque o pointer é capturado pelo elemento de origem; na window os
  // eventos chegam igual e o alvo real vem de elementFromPoint).
  useEffect(() => {
    const moveDrag = (drag: DragState, x: number, y: number) => {
      if (!dragApiRef.current) return;
      if (drag.mode === 'pending') {
        if (Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD_PX) return;
        dragApiRef.current.begin(drag);
      }
      dragApiRef.current.move(drag, x, y);
    };
    const finishDrag = (drag: DragState, x: number, y: number) => {
      if (!dragApiRef.current) return;
      dragRef.current = null;
      if (drag.mode === 'pending') {
        if (drag.pointerType === 'touch') setMouse(null);
        return; // foi um toque/clique: a ação nativa decide
      }
      // o mouse sintetiza um click após o arrasto — não pode virar ação
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 400);
      dragApiRef.current.finish(drag, x, y);
    };
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId || !dragApiRef.current) return;
      moveDrag(drag, e.clientX, e.clientY);
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
      dragRef.current = null;
      dragApiRef.current.cancel(drag);
    };
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerType !== 'mouse') return;
      moveDrag(drag, e.clientX, e.clientY);
    };
    const onMouseUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerType !== 'mouse') return;
      finishDrag(drag, e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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
    const receivedHits: DamageNoticeHit[] = [];
    const newLogs = game.log.slice(prev.log.length).map((l) => l.text);
    const damageLine = [...newLogs].reverse().find(isDamageLogLine);
    const newPlays = game.plays.slice(prev.plays.length);
    const enemyPlays = newPlays.filter((p) => p.seat !== game.yourSeat);
    const enemySeatIdxForNotice = game.seats.findIndex((_, i) => i !== game.yourSeat);
    const enemyNameForNotice = enemySeatIdxForNotice >= 0 ? game.seats[enemySeatIdxForNotice].name : 'Adversário';
    let hadDamage = false;
    let hadHeal = false;
    let hadShield = false;
    let hadBuff = false;
    let hadDeath = false;

    game.seats.forEach((seat, i) => {
      const before = prev.seats[i];
      if (!before) return;
      if (seat.hp < before.hp) {
        const amount = before.hp - seat.hp;
        newFx.push({ id: fxId++, kind: 'dmg', value: amount, anchor: `face-${i}`, at: ts });
        if (i === game.yourSeat) receivedHits.push({ target: 'seu comandante', amount, kind: 'hp' });
        hadDamage = true;
      } else if (seat.hp > before.hp) {
        newFx.push({ id: fxId++, kind: 'heal', value: seat.hp - before.hp, anchor: `face-${i}`, at: ts });
        hadHeal = true;
      }
      // escudo diminuindo = dano absorvido (antes da vida) — agora visível/audível
      if (seat.shield < before.shield) {
        const amount = before.shield - seat.shield;
        newFx.push({ id: fxId++, kind: 'shield', value: amount, anchor: `face-${i}`, at: ts });
        if (i === game.yourSeat) receivedHits.push({ target: 'seu escudo', amount, kind: 'shield' });
        hadShield = true;
      }
      const prevById = new Map(before.board.map((c) => [c.iid, c]));
      for (const c of seat.board) {
        const pc = prevById.get(c.iid);
        if (!pc) continue;
        if (c.health < pc.health) {
          const amount = pc.health - c.health;
          newFx.push({ id: fxId++, kind: 'dmg', value: amount, anchor: `cr-${c.iid}`, at: ts });
          if (i === game.yourSeat) receivedHits.push({ target: CARDS[c.defId].name, amount, kind: 'creature' });
          hadDamage = true;
        } else if (c.health > pc.health) {
          newFx.push({ id: fxId++, kind: 'heal', value: c.health - pc.health, anchor: `cr-${c.iid}`, at: ts });
          hadHeal = true;
        }
        // empoderamento (ex.: Fortalecer +2/+2) — anel de buff one-shot
        if (c.attack > pc.attack || c.baseHealth > pc.baseHealth) {
          newFx.push({ id: fxId++, kind: 'buff', value: 0, anchor: `cr-${c.iid}`, at: ts });
          hadBuff = true;
        }
      }
      before.board.forEach((pc, slot) => {
        if (!seat.board.some((c) => c.iid === pc.iid)) {
          newGhosts.push({ id: fxId++, seatIdx: i, creature: pc, slot, at: ts });
          if (i === game.yourSeat) receivedHits.push({ target: CARDS[pc.defId].name, kind: 'defeat' });
          hadDeath = true;
        }
      });
    });

    // compra: minha mão cresceu (compra de turno, Reforços etc.)
    if (game.hand.length > prev.hand.length) sfx.draw();
    // ganho de energia no meio do turno (Surto/Moeda) — não na virada de turno
    const sameTurn = prev.turnSeat === game.turnSeat;
    const myNow = game.seats[game.yourSeat];
    const myBefore = prev.seats[game.yourSeat];
    if (sameTurn && myNow && myBefore && myNow.energy > myBefore.energy) sfx.energyUp();

    // revelação: cartas jogadas pelo oponente desde o último estado
    if (enemyPlays.length) {
      setReveals((r) => [...r, ...enemyPlays.map((p) => ({ id: fxId++, cardId: p.cardId, at: ts }))]);
      sfx.reveal();
    }

    const fatigueDamage = /\b(fadiga|baralho acabou|sem carta)\b/i.test(damageLine ?? '');
    const receivedFromOpponent =
      receivedHits.length > 0 &&
      !fatigueDamage &&
      (enemyPlays.length > 0 || prev.turnSeat !== game.yourSeat || /^Estertor:/i.test(damageLine ?? ''));
    if (receivedFromOpponent) {
      const lastEnemyPlay = enemyPlays.at(-1);
      const source = lastEnemyPlay ? CARDS[lastEnemyPlay.cardId]?.name ?? 'Carta inimiga' : damageSourceFromLog(damageLine);
      setDamageNotice({
        id: fxId++,
        owner: enemyNameForNotice,
        source,
        detail: damageDetailFromLog(damageLine),
        hits: receivedHits.slice(0, 4),
        at: ts,
      });
    }

    if (newFx.length) setFx((f) => [...f, ...newFx]);
    if (newGhosts.length) setGhosts((g) => [...g, ...newGhosts]);
    if (hadDeath) sfx.death();
    if (hadDamage) sfx.damage();
    else if (hadHeal) sfx.heal();
    if (hadShield) sfx.shield();
    if (hadBuff) sfx.buff();

    // "venceu a mesa": a mesa inimiga foi zerada (sem fim de jogo) — momento de virada
    const enemyIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
    if (
      enemyIdx >= 0 && game.status === 'active' &&
      prev.seats[enemyIdx] && prev.seats[enemyIdx].board.length > 0 &&
      game.seats[enemyIdx].board.length === 0
    ) {
      setBanner({ text: 'Venceu a mesa!', at: ts });
      sfx.tableWin();
    }

    if (prev.turnSeat !== game.turnSeat && game.status === 'active') {
      const mine = game.turnSeat === game.yourSeat;
      setBanner({ text: mine ? 'Seu turno!' : `Turno de ${game.seats[game.turnSeat].name}`, at: ts });
      if (mine) sfx.myTurn();
      setSelection(null);
      setHover(null);
    }
  }, [game]);

  // ensino contextual one-shot: explica Provocar e fadiga na 1ª vez que surgem
  useEffect(() => {
    if (!game || game.yourSeat < 0 || game.status !== 'active') return;
    const seen = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return true; } };
    const mark = (k: string) => { try { localStorage.setItem(k, '1'); } catch { /* ignore */ } };
    const enemyIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
    const mine = game.seats[game.yourSeat];
    if (
      enemyIdx >= 0 && !seen('lc_taught_taunt') &&
      game.seats[enemyIdx].board.some((c) => CARDS[c.defId].keywords?.includes('taunt'))
    ) {
      setTeach({ id: 'taunt', text: 'Provocar: criaturas com Provocar precisam ser atacadas antes das outras. Derrote-a primeiro.', at: Date.now() });
      mark('lc_taught_taunt');
      return;
    }
    if (mine && mine.fatigue > 0 && !seen('lc_taught_fatigue')) {
      setTeach({ id: 'fatigue', text: 'Fadiga: seu baralho esgotou — cada compra agora tira vida. Feche a partida logo.', at: Date.now() });
      mark('lc_taught_fatigue');
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
  // últimos 10s do seu turno: cue de ícone (timer) reduced-motion-safe + aviso a11y
  const timeUrgent = myTurn && secondsLeft <= 10 && secondsLeft > 0;

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
    setLift(null);
    setHoverCost(0);
    setHandFocus(null);
    clearInspect('hand');
  }

  function focusHandCard(iid: string, defId: string) {
    sfx.click();
    setSelection(null);
    setHover(null);
    setMouse(null);
    setLift(null);
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
    if ((e.target as Element).closest('.creature-info')) return;
    dragRef.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      ...origin,
      startX: e.clientX,
      startY: e.clientY,
      mode: 'pending',
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
        else clearInspect('hand');
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
    : {
      tone: 'wait',
      title: 'Planeje a resposta',
      body: `${enemy.name} tem ${enemy.handCount} ${enemy.handCount === 1 ? 'carta' : 'cartas'} na mão.`,
    };

  // prévia de dano em TODOS os alvos válidos ao selecionar — decisão
  // informada sem depender de hover (essencial no toque)
  const staticFacePreview = targetingEnemy && hover?.kind !== 'face' ? previewFor({ kind: 'face' }) : null;
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
      className={`game-screen ${selection ? 'is-aiming' : ''} ${handFocus ? 'has-hand-focus' : ''}`}
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
          <div className={myTurn ? 'turn-pill mine' : 'turn-pill'}>
            <span className={timeUrgent ? 'time-urgent' : ''} role="timer">
              {game.status !== 'active'
                ? 'Partida encerrada'
                : myTurn
                  ? <>{timeUrgent && <IcoTimer className="ic" />} Seu turno · {secondsLeft}s</>
                  : `Turno de ${game.seats[game.turnSeat].name} · ${secondsLeft}s`}
            </span>
            {/* aviso único para leitor de tela ao entrar nos últimos 10s (sem repetir a cada segundo) */}
            <span className="sr-only" role="status" aria-live="assertive">
              {timeUrgent ? 'Tempo do seu turno acabando' : ''}
            </span>
            <span className="timer-track">
              <span
                className={`timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`}
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
              {turnCoach.tone === 'attack' || turnCoach.tone === 'lethal'
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
        />

        <div className="hand" ref={handRef}>
          {game.hand.map((c, i) => {
            const off = i - (game.hand.length - 1) / 2;
            const isSelected = selection?.kind === 'hand' && selection.iid === c.iid;
            const isFocused = handFocus?.iid === c.iid;
            const affordable = CARDS[c.defId].cost <= me.energy;
            const lifting = lift?.iid === c.iid;
            const intent = affordable && myTurn ? handIntent(c.defId, isSelected) : null;
            return (
              <CardView
                key={c.iid}
                defId={c.defId}
                anchorId={`hand-${c.iid}`}
                playable={myTurn && affordable}
                selected={isSelected || isFocused}
                lifting={lifting}
                className={myTurn && !affordable ? 'unaffordable' : undefined}
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
        && !lift
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

      {damageNotice && <DamageNoticePanel notice={damageNotice} />}
      {banner && <div className="turn-banner" key={banner.at} role="status" aria-live="assertive">{banner.text}</div>}
      {teach && (
        <div className="teach-toast" key={teach.id} role="status" aria-live="polite">
          <span>{teach.text}</span>
          <button className="btn small ghost" onClick={() => setTeach(null)} aria-label="Fechar dica"><IcoClose /></button>
        </div>
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showCodex && <CodexView onClose={() => setShowCodex(false)} />}
      {showTutorial && !s.gameOver && <Tutorial onClose={() => setShowTutorial(false)} />}
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

function DamageNoticePanel({ notice }: { notice: DamageNotice }) {
  return (
    <div className="damage-notice" role="status" aria-live="assertive">
      <span className="damage-notice-icon"><IcoWarning /></span>
      <span className="damage-notice-copy">
        <strong>Dano recebido de {notice.owner}</strong>
        <span><b>{notice.source}</b>: {notice.detail}</span>
      </span>
      <span className="damage-notice-hits">
        {notice.hits.map((hit, i) => (
          <span key={`${hit.kind}-${hit.target}-${i}`} className={`damage-hit ${hit.kind}`}>
            {hit.kind === 'shield'
              ? <><IcoShield className="ic" /> {hit.target} absorveu {hit.amount}</>
              : hit.kind === 'defeat'
                ? <><IcoDeath className="ic" /> {hit.target} caiu</>
                : <><IcoAttack className="ic" /> {hit.target} −{hit.amount}</>}
          </span>
        ))}
      </span>
    </div>
  );
}

function FxLayer({ fx }: { fx: FloatFx[] }) {
  // prefixo de forma (▼/▲ + ícone) além da cor: leitura segura para daltônicos
  return (
    <>
      {fx.map((f) => (
        <span key={f.id} className={`float-fx ${f.kind}`}>
          {f.kind === 'dmg' ? `▼ -${f.value}`
            : f.kind === 'heal' ? `▲ +${f.value}`
              : f.kind === 'shield' ? <><IcoShield className="ic" /> -{f.value}</>
                : <IcoBuff className="ic" />}
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
        −{p.selfDmg}{p.selfDies && <> <IcoDeath className="ic" /></>}
      </span>
    );
  }
  return (
    <span className={`preview-chip ${dim ? 'static' : ''} ${p.lethal ? 'lethal' : p.targetDies ? 'dies' : ''}`}>
      −{p.targetDmg}
      {p.targetDies && <> <IcoDeath className="ic" /></>}
      {p.overflow ? <> <IcoOverflow className="ic" />{p.overflow}</> : null}
      {p.lethal && <> <IcoLethal className="ic" /> LETAL</>}
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
  const shielded = fx.some((f) => f.kind === 'shield');
  const title = commanderTitle(seat.commander);
  const deckRisk = seat.fatigue > 0 || seat.deckCount <= 3;
  return (
    <div className={`hero-plate ${isEnemy ? 'enemy' : ''}`} style={accentVars(seat.accent, seat.accentStyle)}>
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
          shielded ? 'shielded' : '',
        ].join(' ')}
        data-anchor={`face-${seatIdx}`}
        onClick={onFaceClick}
        disabled={!onFaceClick}
        onMouseEnter={onHover && targetable ? () => onHover(true) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}
        title={blocked ? 'Protegido por Provocar' : undefined}
      >
        <Avatar
          className="portrait-avatar"
          iconId={seat.commander || seat.avatar}
          photo={null}
          frame={seat.frame}
          accent={seat.accent}
          accentStyle={seat.accentStyle}
          fill
          alt={seat.name}
        />
        <span className="hp-orb">{seat.hp}</span>
        {seat.shield > 0 && <span className="shield-orb"><IcoShield />{seat.shield}</span>}
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
        <span
          className={`meta-chip ${deckRisk ? 'deck-risk' : ''}`}
          title={seat.fatigue > 0
            ? `Fadiga ${seat.fatigue}: cada compra sem carta causa dano`
            : `Cartas no deck: ${seat.deckCount}`}
        >
          <IcoDeck className="ic" /> {seat.deckCount}
        </span>
        {isEnemy && <span className="meta-chip" title="Cartas na mão"><IcoHand className="ic" /> {seat.handCount}</span>}
        {seat.attackBonus > 0 && (
          <span className="meta-chip buff" title="Estandarte de Guerra"><IcoBanner className="ic" /> +{seat.attackBonus}</span>
        )}
        {seat.fatigue > 0 && <span className="meta-chip warn" title="Fadiga"><IcoDeath className="ic" /> {seat.fatigue}</span>}
      </div>
    </div>
  );
}

function Creature({ c, bonus, mine, selected, buffTarget, blocked, warn, posIndex, lunging, preview, previewDim, retaliation, onHover, fx, onClick, onPointerDown, onMouseDown, onInspect, style }: {
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
  onMouseDown?: (e: React.MouseEvent) => void;
  onInspect?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}) {
  const def = CARDS[c.defId];
  const hit = fx.some((f) => f.kind === 'dmg');
  const healed = fx.some((f) => f.kind === 'heal');
  const buffed = fx.some((f) => f.kind === 'buff');
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
    mine && !c.canAttack ? 'exhausted' : '',
    buffTarget && mine ? 'buff-target' : '',
    blocked ? 'blocked' : '',
    warn ? 'cant-attack' : '',
    lunging ? 'lunging' : '',
    isTaunt ? 'taunt' : '',
    c.health < c.baseHealth ? 'wounded' : '',
    hit ? 'hit struck' : '',
    healed ? 'healed' : '',
    buffed ? 'buffed-flash' : '',
  ].join(' ');
  return (
    <div
      role="button"
      tabIndex={0}
      className={classes}
      data-anchor={`cr-${c.iid}`}
      style={style}
      onClick={onClick}
      onPointerDownCapture={onPointerDown}
      onMouseDownCapture={onMouseDown}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.target as HTMLElement).closest('.creature-info')) return;
        e.preventDefault();
        onClick();
      }}
      title={
        blocked
          ? 'Protegido por Provocar — ataque o Golem primeiro'
          : mine && !c.canAttack
            ? 'Essa criatura não pode atacar agora (acabou de entrar ou já atacou neste turno)'
            : posIndex
              ? `${def.name} · posição ${posIndex} na mesa`
              : creatureHint(def)
      }
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      <button
        type="button"
        className="creature-info"
        aria-label={`Ver carta: ${def.name}`}
        title={def.text ? `${def.name}: ${def.text}` : `Ver carta: ${def.name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onInspect?.(e);
        }}
      >
        <IcoRules />
      </button>
      {isTaunt && <span className="taunt-badge" title="Provocar"><IcoShield /></span>}
      {c.ward && (
        <span className="ward-badge" title="Escudo Arcano: o próximo dano será anulado"><IcoWard /></span>
      )}
      {posIndex && (
        <span className="pos-badge" title={`Posição ${posIndex} na mesa — cópia idêntica em campo`}>
          {posIndex}
        </span>
      )}
      <CardArt defId={c.defId} className="creature-art" loading="eager" fetchPriority="auto" />
      <span className="creature-name">{def.name}</span>
      <span className={`stat-gem atk ${atkBuffed ? 'buffed' : ''}`}>{c.attack + bonus}</span>
      <span className={`stat-gem hp ${hpHurt ? 'hurt' : hpBuffed ? 'buffed' : ''}`}>{c.health}</span>
      {mine && c.canAttack && <span className="ready-dot" title="Pronta para atacar" />}
      {preview && <PreviewChip p={preview} dim={previewDim} />}
      {retaliation && <PreviewChip p={retaliation} self />}
      <FxLayer fx={fx} />
    </div>
  );
}

function GhostCreature({ g }: { g: Ghost }) {
  const def = CARDS[g.creature.defId];
  return (
    // order = slot*2 - 1: a caveira fica imediatamente antes de quem assumiu
    // o lugar, animando a morte na posição exata em que a carta estava.
    <span className="creature ghost" style={{ order: g.slot * 2 - 1 }}>
      <CardArt defId={g.creature.defId} className="creature-art" loading="eager" fetchPriority="auto" />
      <span className="creature-name">{def.name}</span>
      <span className="ghost-skull"><IcoDeath /></span>
    </span>
  );
}

/** Segundos da fase de mulligan (casa com MULLIGAN_SECONDS do motor). */
const MULLIGAN_SECONDS = 30;

/** Fase de mulligan: ajustar a mão inicial (trocar cartas) antes do turno 1. */
function MulliganOverlay({ game, me }: { game: GameViewState; me: SeatView }) {
  const [swap, setSwap] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now());
  const confirmed = me.mulliganDone;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000));
  const pct = Math.min(100, (secondsLeft / MULLIGAN_SECONDS) * 100);

  function toggle(iid: string, defId: string) {
    if (confirmed || CARDS[defId].token) return; // a Moeda não é trocável
    setSwap((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) next.delete(iid);
      else next.add(iid);
      return next;
    });
  }

  function confirmMulligan() {
    sfx.mulligan();
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
        <p className="mulligan-tip">
          <IcoHint className="ic" /> Dica: cartas baratas (custo ≤2) dão jogadas cedo; segure as caras para os turnos seguintes.
        </p>
        {!confirmed && (
          <div className="mulligan-timer" title="Tempo para confirmar a mão">
            <span className="timer-track">
              <span className={`timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`} style={{ width: `${pct}%` }} />
            </span>
            <span className={`mulligan-secs ${secondsLeft <= 10 ? 'urgent' : ''}`}>{secondsLeft}s</span>
          </div>
        )}
        {confirmed ? (
          <p className="mulligan-waiting">Mão confirmada — aguardando o oponente…</p>
        ) : (
          <button className="btn primary big mulligan-confirm" onClick={confirmMulligan}>
            {swap.size ? `Trocar ${swap.size} e começar` : 'Manter a mão e começar'}
          </button>
        )}
        <div className="mulligan-hand">
          {game.hand.map((c) => {
            const def = CARDS[c.defId];
            const token = !!def.token;
            const picked = swap.has(c.iid);
            // tag de custo: ajuda a decidir o que trocar (sem ser regra)
            const costTag = token ? null
              : def.cost <= 2 ? <><IcoEnergy className="ic" /> barata</>
                : def.cost >= 5 ? <><IcoExpensive className="ic" /> cara</>
                  : null;
            return (
              <div key={c.iid} className={`mulligan-slot ${picked ? 'swapping' : ''} ${token ? 'locked' : ''}`}>
                {costTag && <span className="mulligan-cost-tag">{costTag}</span>}
                <CardView
                  defId={c.defId}
                  selected={picked}
                  onClick={confirmed || token ? undefined : () => toggle(c.iid, c.defId)}
                />
                <span className="mulligan-flag">{token ? <><IcoCoin className="ic" /> fixa</> : picked ? <><IcoSwap className="ic" /> trocar</> : 'manter'}</span>
              </div>
            );
          })}
        </div>
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
    fatigue: won
      ? 'O baralho do oponente acabou e a fadiga consumiu a última vida.'
      : 'Seu baralho acabou e a fadiga consumiu sua última vida.',
  };
  const reasonLabel: Record<string, string> = {
    hp: 'Vida zerada',
    surrender: 'Desistência',
    timeout: 'Tempo / reconexão',
    fatigue: 'Fadiga',
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
        <div className="go-emblem">{won ? <IcoVictory /> : <IcoDeath />}</div>
        <h2>{won ? 'Vitória!' : 'Derrota'}</h2>
        <p>{reasonText[result.reason] ?? 'A partida foi encerrada.'}</p>
        <div className={`go-reason go-reason-${result.reason}`}>
          <span>{reasonLabel[result.reason] ?? 'Fim da partida'}</span>
          <strong>{won ? 'Resultado favorável' : 'Ponto de melhoria'}</strong>
        </div>
        <p className="go-lesson">{gameOverLesson(result.reason, won)}</p>
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
          const stats = result.stats?.[myId];
          const mvp = result.mvp?.[myId];
          if (!stats) return null;
          return (
            <div className="go-recap">
              {mvp && CARDS[mvp.defId] && (
                <div className="go-mvp">
                  <CardArt defId={mvp.defId} className="go-mvp-art" loading="eager" fetchPriority="auto" />
                  <div className="go-mvp-info">
                    <span className="go-mvp-name"><IcoStar className="ic" /> {CARDS[mvp.defId].name}</span>
                    <span className="go-mvp-line">
                      {mvp.damage} de dano{mvp.kills > 0 ? ` · ${mvp.kills} abate${mvp.kills > 1 ? 's' : ''}` : ''}
                    </span>
                  </div>
                </div>
              )}
              <div className="go-stats">
                <span><b>{stats.creaturesSummoned}</b> criaturas</span>
                <span><b>{stats.spellsCast}</b> magias</span>
                <span><b>{stats.damageDealt}</b> dano</span>
                {stats.shieldAbsorbed > 0 && <span><b>{stats.shieldAbsorbed}</b> escudo</span>}
              </div>
            </div>
          );
        })()}
        {(() => {
          const newly = (myId && result.unlocked?.[myId]) || [];
          return newly.length ? (
            <div className="go-unlocks">
              <p className="go-unlocks-title"><IcoSparkle className="ic" /> Conquista desbloqueada!</p>
              {newly.map((a) => <span key={a} className="go-unlock"><IcoMedal className="ic" /> {achievementLabel(a)}</span>)}
            </div>
          ) : null;
        })()}
        {(() => {
          // oponente = a outra chave do mapa de MMR; habilita revanche/amizade/perfil
          const opponentId = Object.keys(result.mmr).find((id) => id !== myId);
          const opponentName = opponentId
            ? s.game?.seats.find((st) => st.playerId === opponentId)?.name ?? 'oponente'
            : null;
          const isFriend = !!opponentId && (s.profile?.friends?.includes(opponentId) ?? false);
          const rematch = s.rematch;
          return (
            <>
              {opponentId && (
                <p className="go-opponent">
                  vs{' '}
                  <button className="link-btn" onClick={() => viewProfile(opponentId)}>
                    {opponentName}
                  </button>
                </p>
              )}
              {rematch?.status === 'incoming' ? (
                <div className="go-rematch-incoming">
                  <p>
                    {rematch.from && <CosmeticIcon id={rematch.from.avatar} size={18} className="inline-ico" />}
                    {' '}{rematch.from?.name} quer revanche!
                  </p>
                  <div className="go-actions">
                    <button className="btn primary" onClick={() => { sfx.click(); requestRematch(); }}><IcoCheck className="ic" /> Aceitar revanche</button>
                    <button className="btn ghost" onClick={() => declineRematch()}>Recusar</button>
                  </div>
                </div>
              ) : rematch?.status === 'sent' ? (
                <p className="go-rematch-sent"><IcoRematch className="ic" /> Revanche enviada — aguardando o oponente…</p>
              ) : null}
              <div className="go-actions">
                {opponentId && rematch?.status !== 'incoming' && rematch?.status !== 'sent' && (
                  <button className="btn" onClick={() => { sfx.click(); requestRematch(); }}><IcoRematch className="ic" /> Revanche</button>
                )}
                {opponentId && !isFriend && (
                  <button className="btn ghost" onClick={() => addFriend(opponentId)}><IcoAddFriend className="ic" /> Amigo</button>
                )}
              </div>
              <button className="btn primary big" onClick={() => { sfx.click(); dismissGameOver(); }}>
                <IcoAttack className="ic" /> Jogar de novo
              </button>
            </>
          );
        })()}
      </div>
    </div>
  );
}
