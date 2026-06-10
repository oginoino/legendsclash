import { useState } from 'react';
import { logout, openAccountPrompt, send, useAppState } from '../store';
import { LeagueBadge } from '../components/LeagueBadge';
import { RulesModal } from '../components/RulesModal';

/** Progresso até a próxima liga — a "sensação de progresso" que o Xavier busca. */
function leagueProgress(mmr: number): { label: string; pct: number } | null {
  if (mmr >= 1300) return null; // Ouro: liga máxima
  const [lo, hi, next] = mmr >= 1100 ? [1100, 1300, 'Ouro'] : [900, 1100, 'Prata'];
  const pct = Math.max(0, Math.min(100, ((mmr - lo) / (hi - lo)) * 100));
  return { label: `${hi - mmr} MMR até ${next}`, pct };
}

export function HomeView() {
  const s = useAppState();
  const [joinCode, setJoinCode] = useState('');
  const [showRules, setShowRules] = useState(false);
  const p = s.profile;

  if (!p) return <div className="centered">Carregando perfil…</div>;

  const progress = leagueProgress(p.mmr);

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1 className="logo small">
          LEGENDS<span>CLASH</span>
        </h1>
        <div className="profile-chip">
          <span className="avatar-lg">{p.avatar}</span>
          <div>
            <strong>{p.name}</strong> {p.guest && <span className="guest-badge">convidado</span>}
            <div className="profile-sub">
              <LeagueBadge league={p.league} /> {p.mmr} MMR · {p.wins}V {p.losses}D
            </div>
          </div>
          {p.guest && (
            <button className="btn primary" onClick={openAccountPrompt}>Criar conta</button>
          )}
          <button className="btn ghost" onClick={logout}>Sair</button>
        </div>
      </header>

      <main className="home-main">
        <section className="panel play-panel">
          <h2>Jogar</h2>
          {s.inQueue ? (
            <div className="queue-status">
              <div className="spinner" />
              <p>Buscando oponente do seu nível… ({s.queueSize} na fila)</p>
              <button className="btn ghost" onClick={() => send({ t: 'queue:leave' })}>
                Cancelar busca
              </button>
            </div>
          ) : (
            <>
              <button className="btn primary big" onClick={() => send({ t: 'queue:join' })}>
                ⚔️ Partida ranqueada
              </button>
              <p className="hint">Matchmaking por MMR: você enfrenta gente do seu nível.</p>
              {progress && (
                <div className="league-progress" title={progress.label}>
                  <div className="league-progress-bar">
                    <span style={{ width: `${progress.pct}%` }} />
                  </div>
                  <span className="hint">{progress.label}</span>
                </div>
              )}
              {!progress && <p className="hint">🥇 Você está na liga máxima — defenda o topo!</p>}
              <button className="btn ghost" onClick={() => setShowRules(true)}>
                📖 Como jogar
              </button>
              <div className="divider">ou jogue com amigos</div>
              <button className="btn" onClick={() => send({ t: 'room:create' })}>
                Criar sala privada
              </button>
              <form
                className="join-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (joinCode.trim()) send({ t: 'room:join', code: joinCode.trim() });
                }}
              >
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CÓDIGO"
                  maxLength={6}
                />
                <button className="btn" disabled={!joinCode.trim()}>Entrar</button>
              </form>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Ranking · Ligas</h2>
          {p.guest && (
            <p className="account-cta">
              🔒 Convidados não pontuam no ranking.{' '}
              <button className="link-btn" onClick={openAccountPrompt}>Crie uma conta</button>{' '}
              para disputar as ligas.
            </p>
          )}
          {s.leaderboard.length === 0 ? (
            <p className="hint">Ninguém jogou ainda. Seja a primeira lenda do ranking!</p>
          ) : (
            <table className="board-table">
              <tbody>
                {s.leaderboard.map((e, i) => (
                  <tr key={e.id} className={e.id === p.id ? 'me' : ''}>
                    <td className="pos">{i + 1}</td>
                    <td>{e.avatar} {e.name}</td>
                    <td><LeagueBadge league={e.league} /></td>
                    <td className="num">{e.mmr}</td>
                    <td className="num dim">{e.wins}V {e.losses}D</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Histórico de partidas</h2>
          {p.guest && (
            <p className="account-cta">
              ⏳ Histórico de convidado vale só nesta sessão.{' '}
              <button className="link-btn" onClick={openAccountPrompt}>Crie uma conta</button>{' '}
              para levar seu progresso com você.
            </p>
          )}
          {s.history.length === 0 ? (
            <p className="hint">Suas partidas aparecerão aqui.</p>
          ) : (
            <ul className="history-list">
              {s.history.slice(0, 10).map((h) => (
                <li key={h.matchId + h.endedAt} className={h.won ? 'won' : 'lost'}>
                  <span className="result">{h.won ? 'Vitória' : 'Derrota'}</span>
                  <span>vs {h.opponentName}</span>
                  <span className="dim">{h.turns} turnos · {Math.round(h.durationMs / 60000)} min</span>
                  <span className={h.mmrDelta >= 0 ? 'delta up' : 'delta down'}>
                    {h.mmrDelta >= 0 ? '+' : ''}{h.mmrDelta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
