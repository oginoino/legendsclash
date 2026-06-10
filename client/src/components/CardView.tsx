import { CARDS } from '@legendsclash/shared';
import { CardArt } from './CardArt';

const TYPE_LABEL: Record<string, string> = {
  creature: 'Criatura',
  spell: 'Magia',
  artifact: 'Artefato',
  tactic: 'Tática',
};

const KEYWORD_LABEL: Record<string, string> = {
  taunt: '🛡 Provocar',
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
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}

export function CardView({ defId, playable, selected, lifting, onClick, style, anchorId, onMouseEnter, onMouseLeave, onPointerDown }: Props) {
  const def = CARDS[defId];
  if (!def) return null;
  const classes = [
    'card',
    `card-${def.type}`,
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
      <CardArt defId={defId} className="card-art" />
      <span className="card-name">{def.name}</span>
      <span className="card-type">{TYPE_LABEL[def.type]}</span>
      {def.keywords?.map((k) => (
        <span key={k} className="keyword-chip">{KEYWORD_LABEL[k] ?? k}</span>
      ))}
      <span className="card-text">{def.text}</span>
      {def.type === 'creature' && (
        <span className="card-stats">
          <b className="atk">⚔ {def.attack}</b>
          <b className="hp">❤ {def.health}</b>
        </span>
      )}
    </button>
  );
}
