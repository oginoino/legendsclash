import { CARDS } from '@legendsclash/shared';

const TYPE_LABEL: Record<string, string> = {
  creature: 'Criatura',
  spell: 'Magia',
  artifact: 'Artefato',
  tactic: 'Tática',
};

interface Props {
  defId: string;
  playable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  anchorId?: string;
}

export function CardView({ defId, playable, selected, onClick, style, anchorId }: Props) {
  const def = CARDS[defId];
  if (!def) return null;
  const classes = [
    'card',
    `card-${def.type}`,
    playable ? 'playable' : '',
    selected ? 'selected' : '',
  ].join(' ');

  return (
    <button className={classes} onClick={onClick} disabled={!onClick} style={style} data-anchor={anchorId}>
      <span className="card-cost">{def.cost}</span>
      <span className="card-art">{def.art}</span>
      <span className="card-name">{def.name}</span>
      <span className="card-type">{TYPE_LABEL[def.type]}</span>
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
