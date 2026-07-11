import { useState } from 'react';
import type { IconType } from 'react-icons';
import { IcoCardType, IcoAttack, IcoCheck, IcoFinish, IcoPause } from '../icons';

/**
 * Tutorial da 1ª partida: um guia curto (3 passos) mostrado uma única vez por
 * jogador. Cobre as mecânicas não-óbvias — energia,
 * a proteção do comandante e o fim de turno — para que a primeira derrota não
 * seja por não entender as regras (risco direto de D1/D7).
 */

const STEPS: { icon: IconType; title: string; text: string }[] = [
  {
    icon: IcoCardType,
    title: 'Sua mão e a energia',
    text:
      'Toque numa carta para jogá-la. Cada carta custa energia, e você ganha +1 de energia por ' +
      'turno (até 10). Criaturas só atacam no turno seguinte ao que entram — salvo Investida.',
  },
  {
    icon: IcoAttack,
    title: 'Ataque',
    text:
      'Arraste de uma criatura sua até o alvo (no celular, toque nela e depois no alvo). As ' +
      'criaturas inimigas protegem o comandante — derrote-as primeiro para mirar a vida do oponente.',
  },
  {
    icon: IcoFinish,
    title: 'Encerre o turno',
    text:
      'Terminou suas jogadas? Encerre o turno. Vença zerando a vida do comandante inimigo. ' +
      'Boa sorte, Comandante!',
  },
];

export function Tutorial({ paused, onClose }: { paused: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  function finish() {
    onClose();
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="panel tutorial">
        <div className={`tutorial-pause-status ${paused ? 'active' : 'syncing'}`} role="status">
          <IcoPause className="ic" />
          <span>
            <strong>{paused ? 'Cronômetro pausado' : 'Protegendo seu tempo'}</strong>
            <small>{paused ? 'Tempo de turno preservado' : 'Sincronizando com a partida'}</small>
          </span>
        </div>
        <span className="tutorial-step-label">Fundamentos · {step + 1} de {STEPS.length}</span>
        <div className="tutorial-icon"><s.icon /></div>
        <h2 id="tutorial-title">{s.title}</h2>
        <p className="tutorial-text">{s.text}</p>
        <div
          className="tutorial-dots"
          role="progressbar"
          aria-label="Progresso do tutorial"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          {STEPS.map((_, i) => (
            <span key={i} className={`tutorial-dot ${i <= step ? 'on' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button className="link-btn tutorial-skip" onClick={finish}>Pular tutorial</button>
          {last ? (
            <button className="btn primary" onClick={finish}><IcoCheck className="ic" /> Começar a jogar</button>
          ) : (
            <button className="btn primary" onClick={() => setStep(step + 1)}>Próximo <IcoFinish className="ic" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
