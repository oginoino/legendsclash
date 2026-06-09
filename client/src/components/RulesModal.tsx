/**
 * Onboarding em uma tela: "fácil de aprender, difícil de dominar" começa por
 * regras que cabem numa leitura de 30 segundos.
 */
export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel rules-modal" onClick={(e) => e.stopPropagation()}>
        <h2>📖 Como jogar</h2>
        <div className="rules-grid">
          <section>
            <h4>🎯 Objetivo</h4>
            <p>Reduza a vida do oponente de <b>30 a 0</b>. Partidas duram ~10 minutos.</p>
          </section>
          <section>
            <h4>🔄 Seu turno</h4>
            <p>
              A cada turno você <b>compra 1 carta</b> e ganha <b>+1 de energia máxima</b> (até 10).
              Jogue cartas, ataque e encerre — você tem <b>60 segundos</b>.
            </p>
          </section>
          <section>
            <h4>🃏 Tipos de carta</h4>
            <p>
              <b className="k-creature">Criaturas</b> ficam na mesa e lutam ·{' '}
              <b className="k-spell">Magias</b> têm efeito imediato ·{' '}
              <b className="k-artifact">Artefatos</b> dão bônus permanentes ·{' '}
              <b className="k-tactic">Táticas</b> dobram suas opções.
            </p>
          </section>
          <section>
            <h4>⚔️ Combate</h4>
            <p>
              Criaturas <b>não atacam no turno em que entram</b> e atacam <b>1x por turno</b>.
              No combate, as duas criaturas se ferem ao mesmo tempo.{' '}
              <b>Criaturas em campo protegem o comandante</b>: enquanto o inimigo
              tiver criaturas, nem ataques nem magias podem mirar a vida dele.
            </p>
          </section>
          <section>
            <h4>↯ Dano excedente</h4>
            <p>
              Ao destruir a <b>última criatura</b> inimiga, o dano que sobrar do
              golpe atravessa e desconta da vida do comandante. Com <b>Provocar</b>{' '}
              em campo (Golem de Pedra), ele deve ser atacado antes das outras criaturas.
            </p>
          </section>
          <section>
            <h4>💡 Dicas</h4>
            <p>
              Passe o mouse sobre um alvo para ver a <b>prévia do dano</b> antes de
              confirmar. Deck vazio causa <b>fadiga</b> crescente — administre suas compras.
            </p>
          </section>
        </div>
        <button className="btn primary" onClick={onClose}>Entendi, vamos jogar!</button>
      </div>
    </div>
  );
}
