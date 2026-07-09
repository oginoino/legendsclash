import { CARDS, keywordDesc, keywordLabel } from '@legendsclash/shared';
import type { ImageFetchPriority } from './CardArt';
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
  as?: 'button' | 'div';
  playable?: boolean;
  selected?: boolean;
  className?: string;
  /** Carta sendo levantada pelo gesto de arrasto (segue o dedo, sem transição). */
  lifting?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  anchorId?: string;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  imageLoading?: 'eager' | 'lazy';
  imagePriority?: ImageFetchPriority;
}

export function CardView({
  defId,
  as = 'button',
  playable,
  selected,
  className,
  lifting,
  onClick,
  style,
  anchorId,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  imageLoading = 'eager',
  imagePriority = 'auto',
}: Props) {
  const def = CARDS[defId];
  if (!def) return null;
  const textClass = def.text.length > 118 ? 'text-dense-2' : def.text.length > 82 ? 'text-dense-1' : '';
  const classes = [
    'card',
    `card-${def.type}`,
    `rarity-${def.rarity}`,
    textClass,
    playable ? 'playable' : '',
    selected ? 'selected' : '',
    lifting ? 'lifting' : '',
    className ?? '',
  ].join(' ');

  const content = (
    <>
      <span className="card-cost">{def.cost}</span>
      <span className="card-name">{def.name}</span>
      <span className="card-ornament" title={`Raridade: ${RARITY_LABEL[def.rarity]}`}>
        <i className="rarity-gem" />
      </span>
      <CardArt defId={defId} className="card-art" loading={imageLoading} fetchPriority={imagePriority} />
      <span className="card-meta">
        <span className="card-type">{TYPE_LABEL[def.type]}</span>
        {!!def.keywords?.length && (
          <span className="card-keywords">
            {def.keywords.map((k) => (
              <span key={k} className="keyword-chip" title={keywordDesc(k)}>{keywordLabel(k)}</span>
            ))}
          </span>
        )}
      </span>
      <span className="card-text">{def.text}</span>
      {def.type === 'creature' && (
        <>
          <span className="stat-gem atk">{def.attack}</span>
          <span className="stat-gem hp">{def.health}</span>
        </>
      )}
      <span className="card-shine" aria-hidden />
    </>
  );

  if (as === 'div') {
    return (
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        className={classes}
        onClick={onClick}
        style={style}
        data-anchor={anchorId}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onPointerDown={onPointerDown}
        onKeyDown={onClick ? (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onClick();
        } : undefined}
      >
        {content}
      </div>
    );
  }

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
      {content}
    </button>
  );
}
