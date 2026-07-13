import type * as React from 'react';
import { CARDS, keywordDesc, keywordLabel } from '@legendsclash/shared';
import type { CreatureOnBoard } from '@legendsclash/shared';
import {
  IcoAttack, IcoBanner, IcoDeath, IcoEvents, IcoShield, IcoSparkle, IcoSurrender, IcoTimer,
} from '../../icons';

type HandFocus = { iid: string; defId: string } | null;

type InspectCard = {
  iid: string;
  defId: string;
  x: number;
  y: number;
  source: 'hand' | 'creature';
};

type LogTone = 'turn' | 'damage' | 'summon' | 'spell' | 'fatigue' | 'shield' | 'surrender' | 'neutral';
type CoachTone = 'wait' | 'end' | 'play' | 'attack' | 'lethal' | 'bot';
type HandIntentTone = 'neutral' | 'good' | 'target' | 'support';

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

/** Cadência mínima entre provocações (anti-spam local). */
const TAUNT_COOLDOWN_MS = 2500;

/** Movimento mínimo (px) para mouse virar arrasto em vez de clique. */
const DRAG_THRESHOLD_PX = 8;
/** O dedo oscila mais que o mouse: uma margem maior preserva o tap intencional. */
const TOUCH_DRAG_THRESHOLD_PX = 14;
/** Deslocamento vertical mínimo para assumir que o dedo quer sair da mão. */
const TOUCH_VERTICAL_INTENT_PX = 10;
/** Margem ao redor de um alvo para compensar a área escondida sob o dedo. */
const TOUCH_TARGET_MAGNET_PX = 32;
/** Tolerância fora da borda visual da mesa ao soltar uma criatura. */
const TOUCH_DROP_SLOP_PX = 24;

function formatTurnClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
/** Inspeção no hover só com mouse real — no toque o mouseover sintético do
 *  tap deixaria o overlay preso na tela (não há mouseleave correspondente). */
const CAN_HOVER = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
/** Fluxo mobile/touch: tap foca a carta; jogar sem alvo exige CTA explícito. */
const TOUCH_CONFIRM_QUERY = '(hover: none), (pointer: coarse)';
/** Elevação mínima (px) para "soltar pra jogar" uma carta sem alvo. */
const PLAY_LIFT_PX = 48;
const TOUCH_PLAY_LIFT_PX = 56;

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


/**
 * Gesto de arrasto em andamento (mouse ou dedo — Pointer Events unificam).
 * `pending` ainda pode virar clique; `pan` pertence à rolagem da mão;
 * `target` mira com a seta; `lift` levanta uma carta sem alvo para jogá-la;
 * `dead` consome o gesto sem ação (feedback de erro já dado).
 */
interface DragState {
  pointerId: number;
  pointerType: string;
  kind: 'hand' | 'creature';
  iid: string;
  defId: string;
  startX: number;
  startY: number;
  mode: 'pending' | 'pan' | 'target' | 'lift' | 'dead';
  captureEl?: HTMLElement | null;
  lockedTarget?: string | null;
}

interface DragCardVisual {
  iid: string;
  defId: string;
  x: number;
  y: number;
  mode: 'target' | 'play';
  valid: boolean;
  label: string;
  pointerType: string;
  magnetized: boolean;
}

export {
  CAN_HOVER,
  DRAG_THRESHOLD_PX,
  PACE_CHIP_STYLE,
  PACE_CHIP_TEXT_STYLE,
  PACE_CHIP_TIGHT_STYLE,
  PACE_HUD_STYLE,
  PLAY_LIFT_PX,
  TAUNT_COOLDOWN_MS,
  TOUCH_CONFIRM_QUERY,
  TOUCH_DRAG_THRESHOLD_PX,
  TOUCH_DROP_SLOP_PX,
  TOUCH_PLAY_LIFT_PX,
  TOUCH_TARGET_MAGNET_PX,
  TOUCH_VERTICAL_INTENT_PX,
  creatureHint,
  dupPositions,
  formatTurnClock,
  gameOverLesson,
  handIntent,
  logIcon,
  logTone,
};

export type {
  CoachTone,
  DragCardVisual,
  DragState,
  HandFocus,
  InspectCard,
};
