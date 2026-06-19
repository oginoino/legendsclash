import { useState } from 'react';
import { CARDS, cardOfDay } from '@legendsclash/shared';
import { logout, openAccountPrompt, pickFaction, send, useAppState } from '../store';
import { Avatar, InlineAvatar, Sigil } from '../cosmetics';
import {
  IcoSparkle,
  IcoStar,
  IcoStreak,
  IcoCheck,
  IcoUnchecked,
  IcoAttack,
  IcoGold,
  IcoBot,
  IcoRules,
  IcoCodex,
  IcoLock,
  IcoHourglass,
} from '../icons';
import { LeagueBadge } from '../components/LeagueBadge';
import { CardArt } from '../components/CardArt';
import { ProfileModal } from '../components/ProfileModal';
import { RulesModal } from '../components/RulesModal';
import { CodexView } from './CodexView';
import { FACTIONS } from '../lore';

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
  const [showCustomize, setShowCustomize] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
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
          <Avatar
            className="avatar-lg"
            iconId={p.avatar}
            photo={p.photo}
            frame={p.frame}
            accent={p.accent}
            accentStyle={p.accentStyle}
            size={52}
            alt={p.name}
          />
          <div>
            <strong>{p.name}</strong> {p.guest && <span className="guest-badge">convidado</span>}
            <div className="profile-sub">
              <LeagueBadge league={p.league} /> {p.mmr} MMR · {p.wins}V {p.losses}D
            </div>
          </div>
          <button className="btn ghost" onClick={() => setShowCustomize(true)}><IcoSparkle className="ic" /> Personalizar</button>
          {p.guest && (
            <button className="btn primary" onClick={openAccountPrompt}>Criar conta</button>
          )}
          <button className="btn ghost" onClick={logout}>Sair</button>
        </div>
      </header>

      <main className="home-main">
        <section className="panel play-panel">
          <h2>Jogar</h2>
          {(() => {
            const cod = cardOfDay(Date.now());
            const def = CARDS[cod];
            return def ? (
              <div className="card-of-day" title={def.text}>
                <CardArt defId={cod} className="cod-art" />
                <div className="cod-info">
                  <span className="cod-label"><IcoStar className="ic" /> Carta do dia</span>
                  <span className="cod-name">{def.name}</span>
                </div>
              </div>
            ) : null;
          })()}
          {!p.guest && (
            <div className="daily-strip">
              <span className="streak" title="Dias seguidos com partida">
                <IcoStreak className="ic" /> {p.streak} {p.streak === 1 ? 'dia' : 'dias'} de sequência
              </span>
              <span className={`daily-mission ${p.playedToday ? 'done' : ''}`}>
                {p.playedToday ? <><IcoCheck className="ic" /> Missão de hoje feita</> : <><IcoUnchecked className="ic" /> Missão: jogue 1 partida hoje</>}
              </span>
            </div>
          )}
          {s.inQueue ? (
            <div className="queue-status">
              <div className="spinner" />
              <p>Buscando oponente do seu nível… ({s.queueSize} na fila)</p>
              {s.waitingAlone && (
                <div className="queue-thin">
                  <p className="hint">
                    Você é o único na fila agora. Chame alguém para jogar já — crie uma sala
                    e mande o link de convite.
                  </p>
                  <button className="btn" onClick={() => send({ t: 'room:create' })}>
                    Criar sala e convidar
                  </button>
                </div>
              )}
              <button className="btn ghost" onClick={() => send({ t: 'queue:leave' })}>
                Cancelar busca
              </button>
            </div>
          ) : (
            <>
              {s.factionsEnabled && (
                <div className="faction-pick">
                  <span className="faction-label">Sua facção (deck inclinado, simétrico):</span>
                  <div className="faction-options">
                    <button type="button" className={`faction-chip ${s.faction === '' ? 'sel' : ''}`} onClick={() => pickFaction('')}>
                      Neutro
                    </button>
                    {Object.values(FACTIONS).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`faction-chip ${s.faction === f.id ? 'sel' : ''}`}
                        onClick={() => pickFaction(f.id)}
                        title={f.motto}
                      >
                        <Sigil id={f.sigil} className="ic" /> {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn primary big" onClick={() => send({ t: 'queue:join' })}>
                <IcoAttack className="ic" /> Partida ranqueada
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
              {!progress && <p className="hint"><IcoGold className="ic" /> Você está na liga máxima — defenda o topo!</p>}
              <button className="btn practice-btn" onClick={() => send({ t: 'practice:start' })}>
                <IcoBot className="ic" /> Treino (vs CPU)
              </button>
              <p className="hint">Aprenda e teste jogadas contra a IA — não afeta seu MMR.</p>
              <div className="home-secondary">
                <button className="btn ghost" onClick={() => setShowRules(true)}>
                  <IcoRules className="ic" /> Como jogar
                </button>
                <button className="btn ghost" onClick={() => setShowCodex(true)}>
                  <IcoCodex className="ic" /> Arquivo de Aurélia
                </button>
              </div>
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
              <IcoLock className="ic" /> Convidados não pontuam no ranking.{' '}
              <button className="link-btn" onClick={openAccountPrompt}>Crie uma conta</button>{' '}
              para disputar as ligas.
            </p>
          )}
          {!p.guest && s.myRank != null && (() => {
            const meIdx = s.around.findIndex((e) => e.id === p.id);
            const above = meIdx > 0 ? s.around[meIdx - 1] : null;
            return (
              <div className="my-rank">
                <p className="my-rank-pos">Sua posição: <strong>#{s.myRank}</strong> · {p.mmr} MMR</p>
                {above ? (
                  <p className="hint">
                    Faltam <strong>{above.mmr - p.mmr + 1}</strong> MMR para ultrapassar <InlineAvatar iconId={above.avatar} photo={above.photo} size={18} /> {above.name}.
                  </p>
                ) : (
                  <p className="hint"><IcoGold className="ic" /> Você lidera o ranking — defenda o topo!</p>
                )}
              </div>
            );
          })()}
          {s.leaderboard.length === 0 ? (
            <p className="hint">Ninguém jogou ainda. Seja a primeira lenda do ranking!</p>
          ) : (
            <table className="board-table">
              <tbody>
                {s.leaderboard.map((e, i) => (
                  <tr key={e.id} className={e.id === p.id ? 'me' : ''}>
                    <td className="pos">{i + 1}</td>
                    <td className="board-player"><InlineAvatar iconId={e.avatar} photo={e.photo} size={20} /> {e.name}</td>
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
              <IcoHourglass className="ic" /> Histórico de convidado vale só nesta sessão.{' '}
              <button className="link-btn" onClick={openAccountPrompt}>Crie uma conta</button>{' '}
              para levar seu progresso com você.
            </p>
          )}
          {s.history.length === 0 ? (
            <p className="hint">Suas partidas aparecerão aqui.</p>
          ) : (
            <ul className="history-list">
              {s.history.slice(0, 10).map((h) => {
                const key = h.matchId + h.endedAt;
                const open = openMatch === key;
                const reason = h.reason === 'hp' ? 'Vida zerada'
                  : h.reason === 'surrender' ? 'Desistência'
                  : 'Tempo esgotado / desconexão';
                return (
                  <li key={key} className={`${h.won ? 'won' : 'lost'} ${open ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="history-row"
                      onClick={() => setOpenMatch(open ? null : key)}
                      aria-expanded={open}
                    >
                      <span className="result">{h.won ? 'Vitória' : 'Derrota'}</span>
                      <span>vs {h.opponentName}</span>
                      <span className="dim">{h.turns} turnos · {Math.round(h.durationMs / 60000)} min</span>
                      <span className={h.mmrDelta >= 0 ? 'delta up' : 'delta down'}>
                        {h.mmrDelta >= 0 ? '+' : ''}{h.mmrDelta}
                      </span>
                    </button>
                    {open && (
                      <div className="history-detail">
                        {h.won ? 'Você venceu' : 'Você perdeu'} · {reason} ·{' '}
                        {new Date(h.endedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showCustomize && <ProfileModal onClose={() => setShowCustomize(false)} />}
      {showCodex && <CodexView onClose={() => setShowCodex(false)} />}
    </div>
  );
}
