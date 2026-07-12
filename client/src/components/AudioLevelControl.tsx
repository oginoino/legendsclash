import { useEffect, useId, useRef } from 'react';
import { DEFAULT_VOLUMES, type Bus } from '../sounds';
import { IcoMusic, IcoMuted, IcoSound } from '../icons';

interface AudioLevelControlProps {
  bus: Bus;
  label: string;
  description?: string;
  value: number;
  compact?: boolean;
  onChange: (value: number) => void;
}

/** Controle único de áudio usado nas preferências e dentro da partida. */
export function AudioLevelControl({
  bus,
  label,
  description,
  value,
  compact = false,
  onChange,
}: AudioLevelControlProps) {
  const inputId = useId();
  const Icon = bus === 'music' ? IcoMusic : IcoSound;
  const percent = Math.round(value * 100);
  const audibleRef = useRef(value > 0 ? value : DEFAULT_VOLUMES[bus]);

  useEffect(() => {
    if (value > 0) audibleRef.current = value;
  }, [value]);

  return (
    <div className={`audio-level-control ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className="audio-level-mute"
        onClick={() => onChange(value > 0 ? 0 : audibleRef.current)}
        aria-label={value > 0 ? `Silenciar ${label.toLowerCase()}` : `Ativar ${label.toLowerCase()}`}
        title={value > 0 ? 'Silenciar' : 'Ativar'}
      >
        {value > 0 ? <Icon /> : <IcoMuted />}
      </button>
      <div className="audio-level-copy">
        <label htmlFor={inputId}>{label}</label>
        {description && <span>{description}</span>}
      </div>
      <input
        id={inputId}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`Volume de ${label.toLowerCase()}`}
        style={{ '--audio-level': `${percent}%` } as React.CSSProperties}
      />
      <output htmlFor={inputId}>{percent}%</output>
    </div>
  );
}
