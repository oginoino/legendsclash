import { useEffect, useState } from 'react';
import { CARDS } from '@legendsclash/shared';
import type { GameView as GameViewState, SeatView } from '@legendsclash/shared';
import { CardView } from '../../../components/CardView';
import { IcoCoin, IcoEnergy, IcoExpensive, IcoHint, IcoSwap } from '../../../icons';
import { send } from '../../../store';
import { sfx } from '../../../sounds';

/** Segundos da fase de mulligan (casa com MULLIGAN_SECONDS do motor). */
const MULLIGAN_SECONDS = 30;

/** Fase de mulligan: ajustar a mão inicial (trocar cartas) antes do turno 1. */
function MulliganOverlay({ game, me }: { game: GameViewState; me: SeatView }) {
  const [swap, setSwap] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now());
  const confirmed = me.mulliganDone;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000));
  const pct = Math.min(100, (secondsLeft / MULLIGAN_SECONDS) * 100);

  function toggle(iid: string, defId: string) {
    if (confirmed || CARDS[defId].token) return; // a Moeda não é trocável
    setSwap((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) next.delete(iid);
      else next.add(iid);
      return next;
    });
  }

  function confirmMulligan() {
    sfx.mulligan();
    send({ t: 'game:mulligan', iids: [...swap] });
  }

  return (
    <div className="overlay">
      <div className="panel mulligan">
        <h2>Ajuste sua mão inicial</h2>
        <p className="mulligan-hint">
          Toque nas cartas que quer devolver ao baralho — você compra outras no lugar.
          A Moeda do Tempo fica.
        </p>
        <p className="mulligan-tip">
          <IcoHint className="ic" /> Dica: cartas baratas (custo ≤2) dão jogadas cedo; segure as caras para os turnos seguintes.
        </p>
        {!confirmed && (
          <div className="mulligan-timer" title="Tempo para confirmar a mão">
            <span className="timer-track">
              <span className={`timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`} style={{ width: `${pct}%` }} />
            </span>
            <span className={`mulligan-secs ${secondsLeft <= 10 ? 'urgent' : ''}`}>{secondsLeft}s</span>
          </div>
        )}
        {confirmed ? (
          <p className="mulligan-waiting">Mão confirmada — aguardando o oponente…</p>
        ) : (
          <button className="btn primary big mulligan-confirm" onClick={confirmMulligan}>
            {swap.size ? `Trocar ${swap.size} e começar` : 'Manter a mão e começar'}
          </button>
        )}
        <div className="mulligan-hand">
          {game.hand.map((c) => {
            const def = CARDS[c.defId];
            const token = !!def.token;
            const picked = swap.has(c.iid);
            // tag de custo: ajuda a decidir o que trocar (sem ser regra)
            const costTag = token ? null
              : def.cost <= 2 ? <><IcoEnergy className="ic" /> barata</>
                : def.cost >= 5 ? <><IcoExpensive className="ic" /> cara</>
                  : null;
            return (
              <div key={c.iid} className={`mulligan-slot ${picked ? 'swapping' : ''} ${token ? 'locked' : ''}`}>
                {costTag && <span className="mulligan-cost-tag">{costTag}</span>}
                <CardView
                  defId={c.defId}
                  selected={picked}
                  onClick={confirmed || token ? undefined : () => toggle(c.iid, c.defId)}
                />
                <span className="mulligan-flag">{token ? <><IcoCoin className="ic" /> fixa</> : picked ? <><IcoSwap className="ic" /> trocar</> : 'manter'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { MulliganOverlay };
