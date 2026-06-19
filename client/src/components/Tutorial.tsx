import { useState } from 'react';
import type { IconType } from 'react-icons';
import { IcoCardType, IcoAttack, IcoFinish } from '../icons';

/**
 * Tutorial da 1ª partida: um guia curto (3 passos) mostrado uma única vez por
 * dispositivo (flag em localStorage). Cobre as mecânicas não-óbvias — energia,
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

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  function finish() {
    try {
      localStorage.setItem('lc_tutorial_done', '1');
    } catch {
      // localStorage indisponível: tudo bem, o tutorial só não será suprimido
    }
    onClose();
  }

  return (
    <div className="overlay">
      <div className="panel tutorial">
        <div className="tutorial-icon"><s.icon /></div>
        <h2>{s.title}</h2>
        <p className="tutorial-text">{s.text}</p>
        <div className="tutorial-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`tutorial-dot ${i === step ? 'on' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button className="link-btn tutorial-skip" onClick={finish}>Pular tutorial</button>
          {last ? (
            <button className="btn primary" onClick={finish}>Começar a jogar</button>
          ) : (
            <button className="btn primary" onClick={() => setStep(step + 1)}>Próximo</button>
          )}
        </div>
      </div>
    </div>
  );
}
