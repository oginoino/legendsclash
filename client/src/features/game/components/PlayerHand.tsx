import { CARDS } from '@legendsclash/shared';
import type { CardInHand } from '@legendsclash/shared';
import { CardView } from '../../../components/CardView';
import type { DragCardVisual, DragOrigin } from '../drag-gesture-model';
import type { Selection } from '../targeting-model';
import { CAN_HOVER, handIntent } from '../view-model';
import type { HandFocus, InspectCard } from '../view-model';

interface PlayerHandProps {
  cards: CardInHand[];
  energy: number;
  myTurn: boolean;
  selection: Selection;
  handFocus: HandFocus;
  dragCard: DragCardVisual | null;
  handRef: React.RefObject<HTMLDivElement>;
  onCardClick: (iid: string, defId: string) => void;
  onPointerDown: (event: React.PointerEvent, origin: DragOrigin) => void;
  onMouseDown: (event: React.MouseEvent, origin: DragOrigin) => void;
  onHoverCostChange: (cost: number) => void;
  onInspect: (card: InspectCard) => void;
  onClearInspect: () => void;
}

export function PlayerHand({
  cards,
  energy,
  myTurn,
  selection,
  handFocus,
  dragCard,
  handRef,
  onCardClick,
  onPointerDown,
  onMouseDown,
  onHoverCostChange,
  onInspect,
  onClearInspect,
}: PlayerHandProps) {
  return (
    <div className="hand" ref={handRef}>
      {cards.map((card, index) => {
        const offset = index - (cards.length - 1) / 2;
        const isSelected = selection?.kind === 'hand' && selection.iid === card.iid;
        const isFocused = handFocus?.iid === card.iid;
        const affordable = CARDS[card.defId].cost <= energy;
        const dragging = dragCard?.iid === card.iid;
        const intent = affordable && myTurn ? handIntent(card.defId, isSelected) : null;

        return (
          <CardView
            key={card.iid}
            defId={card.defId}
            anchorId={`hand-${card.iid}`}
            playable={myTurn && affordable}
            selected={isSelected || isFocused}
            lifting={dragging}
            className={[
              myTurn && !affordable ? 'unaffordable' : '',
              dragging ? 'drag-origin' : '',
            ].filter(Boolean).join(' ') || undefined}
            statusLabel={myTurn && !affordable ? `Falta ${CARDS[card.defId].cost - energy}` : isFocused ? 'Pronta' : intent?.label}
            statusTone={myTurn && !affordable ? 'warn' : isFocused ? 'good' : intent?.tone}
            onClick={() => onCardClick(card.iid, card.defId)}
            onPointerDown={myTurn ? (event) => onPointerDown(event, {
              kind: 'hand',
              iid: card.iid,
              defId: card.defId,
            }) : undefined}
            onMouseDown={myTurn ? (event) => onMouseDown(event, {
              kind: 'hand',
              iid: card.iid,
              defId: card.defId,
            }) : undefined}
            onMouseEnter={(event) => {
              if (myTurn && affordable) onHoverCostChange(CARDS[card.defId].cost);
              if (!CAN_HOVER) return;
              const rect = event.currentTarget.getBoundingClientRect();
              onInspect({
                iid: card.iid,
                defId: card.defId,
                x: rect.left + rect.width / 2,
                y: rect.top - 10,
                source: 'hand',
              });
            }}
            onMouseLeave={() => {
              onHoverCostChange(0);
              onClearInspect();
            }}
            style={isSelected && !dragging ? undefined : {
              transform: `rotate(${offset * 2.5}deg) translateY(${Math.abs(offset) * 5}px)`,
            }}
          />
        );
      })}
    </div>
  );
}
