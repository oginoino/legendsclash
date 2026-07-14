import { CARDS, MAX_BOARD } from '@legendsclash/shared';
import type { CreatureOnBoard, SeatView } from '@legendsclash/shared';
import { IcoCheck, IcoTarget } from '../../../icons';
import type { DragCardVisual, DragOrigin } from '../drag-gesture-model';
import {
  DAMAGE_SOURCE_TTL,
  ENEMY_ATTACK_FX_TTL,
} from '../feedback-model';
import type { DamageNotice, FloatFx, Ghost } from '../feedback-model';
import type {
  CombatPreview,
  HoverTarget,
  Selection,
} from '../targeting-model';
import { Creature, GhostCreature } from './ArenaPieces';

type AttackFx = { iid: string; at: number } | null;
type CantAttackWarn = { iid: string; at: number } | null;
type EffectsFor = (anchor: string) => FloatFx[];
type PreviewFor = (target: HoverTarget) => CombatPreview | null;
type TargetPointerDown = (event: React.PointerEvent, origin: DragOrigin) => void;
type TargetMouseDown = (event: React.MouseEvent, origin: DragOrigin) => void;
type InspectCreature = (creature: CreatureOnBoard, event: React.MouseEvent) => void;

interface EnemyBoardRowProps {
  enemy: SeatView;
  enemySeatIdx: number;
  targeting: boolean;
  draggingTarget: boolean;
  mustHitTaunt: boolean;
  hover: HoverTarget;
  hoverValid: boolean;
  attackFx: AttackFx;
  damageNotice: DamageNotice | null;
  now: number;
  positions: Map<string, number>;
  preview: CombatPreview | null;
  previewFor: PreviewFor;
  effectsFor: EffectsFor;
  ghosts: Ghost[];
  onHover: (target: HoverTarget) => void;
  onCreatureClick: (creature: CreatureOnBoard) => void;
  onInspect: InspectCreature;
}

export function EnemyBoardRow({
  enemy,
  enemySeatIdx,
  targeting,
  draggingTarget,
  mustHitTaunt,
  hover,
  hoverValid,
  attackFx,
  damageNotice,
  now,
  positions,
  preview,
  previewFor,
  effectsFor,
  ghosts,
  onHover,
  onCreatureClick,
  onInspect,
}: EnemyBoardRowProps) {
  const rowGhosts = ghosts.filter((ghost) => ghost.seatIdx === enemySeatIdx);

  return (
    <div className={`board-row enemy-row ${targeting ? 'targetable' : ''} ${draggingTarget && targeting ? 'drop-destinations enemy' : ''}`}>
      {draggingTarget && targeting && enemy.board.length > 0 && (
        <span className="drop-zone-label enemy"><IcoTarget className="ic" /> Destinos possíveis</span>
      )}
      {enemy.board.map((creature, index) => {
        const isTaunt = CARDS[creature.defId].keywords?.includes('taunt');
        const blocked = mustHitTaunt && !isTaunt;
        const hovered = hover?.kind === 'creature' && hover.iid === creature.iid;
        // No toque, cada alvo válido precisa comunicar o resultado sem hover.
        const staticPreview = !hovered && targeting && !blocked
          ? previewFor({ kind: 'creature', iid: creature.iid })
          : null;

        return (
          <Creature
            key={creature.iid}
            c={creature}
            bonus={enemy.attackBonus}
            lunging={attackFx?.iid === creature.iid && now - attackFx.at < ENEMY_ATTACK_FX_TTL}
            sourceActive={damageNotice?.sourceIid === creature.iid && now - damageNotice.at < DAMAGE_SOURCE_TTL}
            blocked={blocked}
            dropTarget={draggingTarget && targeting && !blocked}
            dropHovered={draggingTarget && hoverValid && hovered}
            dropTone="enemy"
            posIndex={positions.get(creature.iid)}
            preview={hovered ? preview : staticPreview}
            previewDim={!hovered && !!staticPreview}
            onHover={(active) => onHover(active ? { kind: 'creature', iid: creature.iid } : null)}
            fx={effectsFor(`cr-${creature.iid}`)}
            onClick={() => onCreatureClick(creature)}
            onInspect={(event) => onInspect(creature, event)}
            style={{ order: index * 2 }}
          />
        );
      })}
      {rowGhosts.map((ghost) => <GhostCreature key={ghost.id} g={ghost} />)}
      {enemy.board.length === 0 && rowGhosts.length === 0 && (
        <div className="board-empty">mesa vazia</div>
      )}
    </div>
  );
}

interface PlayerBoardRowProps {
  player: SeatView;
  playerSeatIdx: number;
  targetingFriendly: boolean;
  draggingTarget: boolean;
  dragCard: DragCardVisual | null;
  selection: Selection;
  hover: HoverTarget;
  hoverValid: boolean;
  attackFx: AttackFx;
  cantAttackWarn: CantAttackWarn;
  now: number;
  positions: Map<string, number>;
  preview: CombatPreview | null;
  effectsFor: EffectsFor;
  ghosts: Ghost[];
  onCreatureClick: (creature: CreatureOnBoard) => void;
  onPointerDown: TargetPointerDown;
  onMouseDown: TargetMouseDown;
  onInspect: InspectCreature;
}

export function PlayerBoardRow({
  player,
  playerSeatIdx,
  targetingFriendly,
  draggingTarget,
  dragCard,
  selection,
  hover,
  hoverValid,
  attackFx,
  cantAttackWarn,
  now,
  positions,
  preview,
  effectsFor,
  ghosts,
  onCreatureClick,
  onPointerDown,
  onMouseDown,
  onInspect,
}: PlayerBoardRowProps) {
  const rowGhosts = ghosts.filter((ghost) => ghost.seatIdx === playerSeatIdx);
  const draggingCreaturePlay = dragCard?.mode === 'play'
    && CARDS[dragCard.defId]?.type === 'creature';

  return (
    <div className={`board-row my-row ${targetingFriendly ? 'friendly-targetable' : ''} ${draggingTarget && targetingFriendly ? 'drop-destinations support' : ''} ${draggingCreaturePlay ? `card-drop-zone ${dragCard.valid ? 'ready' : ''}` : ''}`}>
      {draggingTarget && targetingFriendly && player.board.length > 0 && (
        <span className="drop-zone-label support"><IcoTarget className="ic" /> Criaturas aliadas</span>
      )}
      {draggingCreaturePlay && (
        <span className="drop-zone-label play"><IcoCheck className="ic" /> {player.board.length >= MAX_BOARD ? 'Mesa cheia' : 'Solte para invocar'}</span>
      )}
      {player.board.map((creature, index) => (
        <Creature
          key={creature.iid}
          c={creature}
          bonus={player.attackBonus}
          mine
          selected={selection?.kind === 'attacker' && selection.iid === creature.iid}
          buffTarget={targetingFriendly}
          dropTarget={draggingTarget && targetingFriendly}
          dropHovered={draggingTarget && hoverValid && hover?.kind === 'creature' && hover.iid === creature.iid}
          dropTone="support"
          lunging={attackFx?.iid === creature.iid && now - attackFx.at < 500}
          warn={cantAttackWarn?.iid === creature.iid && now - cantAttackWarn.at < 600}
          posIndex={positions.get(creature.iid)}
          retaliation={preview?.attackerIid === creature.iid ? preview : null}
          fx={effectsFor(`cr-${creature.iid}`)}
          onClick={() => onCreatureClick(creature)}
          onPointerDown={(event) => onPointerDown(event, {
            kind: 'creature',
            iid: creature.iid,
            defId: creature.defId,
          })}
          onMouseDown={(event) => onMouseDown(event, {
            kind: 'creature',
            iid: creature.iid,
            defId: creature.defId,
          })}
          onInspect={(event) => onInspect(creature, event)}
          style={{ order: index * 2 }}
        />
      ))}
      {rowGhosts.map((ghost) => <GhostCreature key={ghost.id} g={ghost} />)}
      {player.board.length === 0 && rowGhosts.length === 0 && (
        <div className="board-empty">invoque criaturas aqui</div>
      )}
    </div>
  );
}
