import { useEffect, useRef, useState } from 'react';
import { getVolume, setVolume, type Bus } from '../sounds';

/**
 * Controle de som: um botão 🔊/🔇 que abre um popover com dois sliders
 * (Efeitos e Música), substituindo o antigo liga/desliga único. O ícone
 * reflete o estado de SFX (mudo quando 0). Fecha ao clicar fora ou Esc.
 */
export function SoundControl({ className = 'btn small ghost' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [sfxVol, setSfx] = useState(() => getVolume('sfx'));
  const [musicVol, setMusic] = useState(() => getVolume('music'));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function change(bus: Bus, value: number) {
    setVolume(bus, value);
    if (bus === 'sfx') setSfx(value); else setMusic(value);
  }

  const muted = sfxVol <= 0;
  return (
    <div className="sound-control" ref={ref}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((o) => !o)}
        title="Som"
        aria-label="Ajustar som"
        aria-expanded={open}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      {open && (
        <div className="volume-popover" role="group" aria-label="Volume">
          <label className="volume-row">
            <span>🔊 Efeitos</span>
            <input
              type="range" min={0} max={1} step={0.05} value={sfxVol}
              onChange={(e) => change('sfx', Number(e.target.value))}
              aria-label="Volume dos efeitos"
            />
          </label>
          <label className="volume-row">
            <span>🎵 Música</span>
            <input
              type="range" min={0} max={1} step={0.05} value={musicVol}
              onChange={(e) => change('music', Number(e.target.value))}
              aria-label="Volume da música"
            />
          </label>
        </div>
      )}
    </div>
  );
}
