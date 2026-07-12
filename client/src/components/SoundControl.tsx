import { useEffect, useRef, useState } from 'react';
import { getVolume, setVolume, subscribeVolume, type Bus } from '../sounds';
import { IcoMuted, IcoSound, IcoMusic } from '../icons';
import { AudioLevelControl } from './AudioLevelControl';

/**
 * Controle de som: um botão (alto-falante/mudo) que abre um popover com dois sliders
 * (Efeitos e Música), substituindo o antigo liga/desliga único. O ícone
 * reflete o estado de SFX (mudo quando 0). Fecha ao clicar fora ou Esc.
 */
export function SoundControl({ className = 'btn small ghost' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [sfxVol, setSfx] = useState(() => getVolume('sfx'));
  const [musicVol, setMusic] = useState(() => getVolume('music'));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeVolume(() => {
    setSfx(getVolume('sfx'));
    setMusic(getVolume('music'));
  }), []);

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

  const muted = sfxVol <= 0 && musicVol <= 0;
  return (
    <div className="sound-control" ref={ref}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((o) => !o)}
        title="Som"
        aria-label="Ajustar som"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {muted ? <IcoMuted /> : <IcoSound />}
      </button>
      {open && (
        <div className="volume-popover" role="dialog" aria-label="Áudio da partida">
          <div className="volume-popover-heading">
            <span><IcoMusic className="ic" /> Áudio da partida</span>
            <small>Aplicado em todo o jogo</small>
          </div>
          <AudioLevelControl bus="sfx" label="Efeitos" value={sfxVol} compact onChange={(value) => change('sfx', value)} />
          <AudioLevelControl bus="music" label="Música" value={musicVol} compact onChange={(value) => change('music', value)} />
        </div>
      )}
    </div>
  );
}
