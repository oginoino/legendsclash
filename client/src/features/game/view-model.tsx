import { CARDS, keywordDesc, keywordLabel } from '@legendsclash/shared';
import type { CreatureOnBoard } from '@legendsclash/shared';

type HandFocus = { iid: string; defId: string } | null;

type InspectCard = {
  iid: string;
  defId: string;
  x: number;
  y: number;
  source: 'hand' | 'creature';
};

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
  if (reason === 'turns') {
    return won
      ? 'O jogo terminou por limite de turnos. Sua vantagem de vida e presença de mesa garantiram a vitória — em partidas mais longas, buscar dano direto ajuda a fechar antes do teto.'
      : 'A partida acabou no limite de turnos. Para evitar depender do desempate, tente aplicar pressão mais cedo: priorize criaturas de ataque alto e reduza a vida do oponente antes que os turnos se esgotem.';
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

/** Inspeção no hover só com mouse real — no toque o mouseover sintético do
 *  tap deixaria o overlay preso na tela (não há mouseleave correspondente). */
const CAN_HOVER = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export {
  CAN_HOVER,
  TAUNT_COOLDOWN_MS,
  creatureHint,
  dupPositions,
  gameOverLesson,
  handIntent,
};

export type {
  HandFocus,
  InspectCard,
};
