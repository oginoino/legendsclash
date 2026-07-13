import { CARDS } from '@legendsclash/shared';
import type { CardDef, CardInHand, CreatureOnBoard } from '@legendsclash/shared';
import type { DragCardVisual } from './drag-gesture-model';
import { noTargetActionLabel } from './targeting-model';
import type { Selection } from './targeting-model';
import type { HandFocus, InspectCard } from './view-model';

export type AimMode = 'lethal' | 'attack' | 'support' | 'spell';

export interface TargetHint {
  mode: 'attack' | 'support' | 'spell';
  title: string;
  body: string;
}

export interface HandConfirm {
  mode: 'play';
  title: string;
  body: string;
  actionLabel: string;
}

export function deriveTargetHint({
  faceShielded,
  mustHitTaunt,
  selectedAttacker,
  selectedCard,
  selection,
  tauntFocusName,
}: {
  faceShielded: boolean;
  mustHitTaunt: boolean;
  selectedAttacker: Pick<CreatureOnBoard, 'defId'> | null;
  selectedCard: CardDef | null | undefined;
  selection: Selection;
  tauntFocusName: string;
}): TargetHint | null {
  if (selection?.kind === 'attacker') {
    return {
      mode: 'attack',
      title: selectedAttacker ? CARDS[selectedAttacker.defId].name : 'Ataque selecionado',
      body: mustHitTaunt
        ? `${tauntFocusName} está protegendo a mesa. Ataque Provocar primeiro.`
        : faceShielded
          ? 'As criaturas inimigas protegem o comandante. Remova a mesa para abrir dano direto.'
          : 'Mesa livre. Escolha um alvo e confirme pela prévia de dano.',
    };
  }

  if (selection?.kind !== 'hand' || !selectedCard) return null;
  return {
    mode: selectedCard.target === 'friendly-creature' ? 'support' : 'spell',
    title: selectedCard.name,
    body: selectedCard.target === 'friendly-creature'
      ? 'Escolha uma criatura aliada para receber o efeito.'
      : faceShielded && !selectedCard.pierce
        ? 'As criaturas inimigas bloqueiam o comandante. Mire uma criatura primeiro.'
        : 'Escolha o melhor alvo usando a prévia de dano.',
  };
}

export function deriveHandConfirm({
  focusedCard,
  handFocus,
  myTurn,
  touchPlayConfirm,
}: {
  focusedCard: CardDef | null | undefined;
  handFocus: HandFocus;
  myTurn: boolean;
  touchPlayConfirm: boolean;
}): HandConfirm | null {
  if (!touchPlayConfirm || !handFocus || !focusedCard || !myTurn) return null;
  return {
    mode: 'play',
    title: focusedCard.name,
    body: 'Revise antes de jogar.',
    actionLabel: noTargetActionLabel(handFocus.defId),
  };
}

export function visibleInspection({
  dragCard,
  gameActive,
  hand,
  inspect,
  selection,
}: {
  dragCard: DragCardVisual | null;
  gameActive: boolean;
  hand: CardInHand[];
  inspect: InspectCard | null;
  selection: Selection;
}): InspectCard | null {
  if (!inspect || dragCard || !gameActive) return null;
  if (selection && inspect.source !== 'creature') return null;
  if (inspect.source === 'hand' && !hand.some((card) => card.iid === inspect.iid)) return null;
  return inspect;
}

export function deriveAimMode({
  lethal,
  selection,
  targetingFriendly,
}: {
  lethal: boolean;
  selection: Selection;
  targetingFriendly: boolean;
}): AimMode {
  if (lethal) return 'lethal';
  if (selection?.kind === 'attacker') return 'attack';
  return targetingFriendly ? 'support' : 'spell';
}
