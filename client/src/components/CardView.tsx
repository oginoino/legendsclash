import { CARDS, keywordDesc, keywordLabel } from '@legendsclash/shared';
import { CardArt } from './CardArt';

const TYPE_LABEL: Record<string, string> = {
  creature: 'Criatura',
  spell: 'Magia',
  artifact: 'Artefato',
  tactic: 'Tática',
};

const RARITY_LABEL: Record<string, string> = {
  common: 'Comum',
  rare: 'Rara',
  epic: 'Épica',
  legendary: 'Lendária',
};

interface Props {
  defId: string;
  playable?: boolean;
  selected?: boolean;
  /** Carta sendo levantada pelo gesto de arrasto (segue o dedo, sem transição). */
  lifting?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  anchorId?: string;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}

export function CardView({ defId, playable, selected, lifting, onClick, style, anchorId, onMouseEnter, onMouseLeave, onPointerDown }: Props) {
  const def = CARDS[defId];
  if (!def) return null;
  const classes = [
    'card',
    `card-${def.type}`,
    `rarity-${def.rarity}`,
    playable ? 'playable' : '',
    selected ? 'selected' : '',
    lifting ? 'lifting' : '',
  ].join(' ');

  return (
    <button
      className={classes}
      onClick={onClick}
      disabled={!onClick}
      style={style}
      data-anchor={anchorId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={onPointerDown}
    >
      <span className="card-cost">{def.cost}</span>
      <span className="card-name">{def.name}</span>
      <span className="card-ornament" title={`Raridade: ${RARITY_LABEL[def.rarity]}`}>
        <i className="rarity-gem" />
      </span>
      <CardArt defId={defId} className="card-art" />
      <span className="card-type">{TYPE_LABEL[def.type]}</span>
      {def.keywords?.map((k) => (
        <span key={k} className="keyword-chip" title={keywordDesc(k)}>{keywordLabel(k)}</span>
      ))}
      <span className="card-text">{def.text}</span>
      {def.type === 'creature' && (
        <>
          <span className="stat-gem atk">{def.attack}</span>
          <span className="stat-gem hp">{def.health}</span>
        </>
      )}
      <span className="card-shine" aria-hidden />
    </button>
  );
}
