import { useEffect, useState, type CSSProperties } from 'react';
import { CARDS, cardOfDay } from '@legendsclash/shared';
import { openAccountPrompt, pickFaction, send, useAppState, viewProfile } from '../store';
import { Avatar, InlineAvatar, Sigil, profileCoverVars } from '../cosmetics';
import {
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
  IcoRealm,
  IcoShield,
  IcoProfile,
} from '../icons';
import { LeagueBadge } from '../components/LeagueBadge';
import { CardArt } from '../components/CardArt';
import { RulesModal } from '../components/RulesModal';
import { CodexView } from './CodexView';
import { ProfileView } from './ProfileView';
import { CARD_LORE, FACTIONS, WORLD } from '../lore';

/** Progresso até a próxima liga — a "sensação de progresso" que o Xavier busca. */
function leagueProgress(mmr: number): { label: string; pct: number } | null {
  if (mmr >= 1300) return null; // Ouro: liga máxima
  const [lo, hi, next] = mmr >= 1100 ? [1100, 1300, 'Ouro'] : [900, 1100, 'Prata'];
  const pct = Math.max(0, Math.min(100, ((mmr - lo) / (hi - lo)) * 100));
  return { label: `${hi - mmr} MMR até ${next}`, pct };
}

const HOME_FACTION_ORDER = ['vanguarda', 'silvanos', 'eter', 'profundezas', 'mares'];

function shortFactionName(name: string): string {
  return name.replace(/^(A |O |Os )/, '').replace(' da Aurora', '').replace(' do Éter', '');
}

function chapterForHome(league: string, playedToday: boolean, streak: number, factionName?: string) {
  const tradition = factionName
    ? `Sua tradição ativa é ${factionName}; o Arquivo ajuda a ler melhor o tom desse deck.`
    : 'Você ainda está livre de tradição fixa; explore as facções antes de escolher um estilo.';
  if (!playedToday) {
    return {
      label: 'Chamado do dia',
      title: 'O Cristal ainda não brilhou hoje',
      text: `${tradition} Uma partida registrada hoje mantém sua jornada em movimento.`,
    };
  }
  if (streak >= 3) {
    return {
      label: `${streak} dias de sequência`,
      title: 'Aurélia já reconhece seu estandarte',
      text: `${tradition} Continue a sequência para transformar presença diária em domínio de ritmo.`,
    };
  }
  if (league === 'Ouro') {
    return {
      label: 'Liga máxima',
      title: 'Agora a história é defender o topo',
      text: `${tradition} No Ouro, cada Embate vira reputação: jogue limpo, conte dano e preserve recursos.`,
    };
  }
  if (league === 'Prata') {
    return {
      label: 'Ascensão',
      title: 'Você atravessou a primeira muralha',
      text: `${tradition} A Prata recompensa quem planeja dois turnos à frente e reconhece quando trocar mesa por vida.`,
    };
  }
  return {
    label: 'Primeiras crônicas',
    title: 'A lenda ainda está sendo escrita',
    text: `${tradition} Use treino, facções e histórico para entender quais linhas combinam com seu comandante.`,
  };
}

export function HomeView() {
  const s = useAppState();
  const [joinCode, setJoinCode] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showProfile, setShowProfile] = useState(() => location.hash === '#profile');
  const [showCodex, setShowCodex] = useState(false);
  const [codexInitialFaction, setCodexInitialFaction] = useState<string | null>(null);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const p = s.profile;

  useEffect(() => {
    const syncProfileRoute = () => setShowProfile(location.hash === '#profile');
    window.addEventListener('popstate', syncProfileRoute);
    return () => window.removeEventListener('popstate', syncProfileRoute);
  }, []);

  const openProfile = () => {
    if (location.hash !== '#profile') history.pushState({ lcView: 'profile' }, '', '#profile');
    setShowProfile(true);
  };

  const closeProfile = () => {
    if (location.hash === '#profile' && history.state?.lcView === 'profile') history.back();
    else {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      setShowProfile(false);
    }
  };

  if (!p) return <div className="centered">Carregando perfil…</div>;
  if (showProfile) return <ProfileView onClose={closeProfile} />;

  const progress = leagueProgress(p.mmr);
  const dailyCardId = cardOfDay(Date.now());
  const dailyCard = CARDS[dailyCardId];
  const dailyLore = CARD_LORE[dailyCardId];
  const chosenFaction = s.faction ? FACTIONS[s.faction] : null;
  const chapter = chapterForHome(p.league, p.playedToday, p.streak, chosenFaction?.name);
  const openCodex = (factionId?: string) => {
    setCodexInitialFaction(factionId ?? null);
    setShowCodex(true);
  };

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1 className="logo small">
          LEGENDS<span>CLASH</span>
        </h1>
        <div className="profile-chip profile-chip-cover" style={profileCoverVars(p.profileCover)}>
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
          <button className="btn ghost" onClick={openProfile}><IcoProfile className="ic" /> Perfil</button>
          {p.guest && (
            <button className="btn primary" onClick={openAccountPrompt}>Criar conta</button>
          )}
        </div>
      </header>

      <section className="home-vista" aria-label="Panorama de Aurélia">
        <div className="home-vista-copy">
          <span className="home-vista-kicker">Aurélia</span>
          <strong>O céu partiu. As cartas decidirão quem fica com os cristais.</strong>
          <span>{dailyCard ? `Hoje em destaque: ${dailyCard.name}${dailyLore ? ` — ${dailyLore.epithet}` : ''}` : 'Escolha seu próximo duelo.'}</span>
          <div className="home-vista-actions">
            <button className="btn small ghost" onClick={() => openCodex()}><IcoCodex className="ic" /> Arquivo</button>
            <button className="btn small ghost" onClick={() => setShowRules(true)}><IcoRules className="ic" /> Regras</button>
          </div>
        </div>
        <div className="home-vista-meta">
          <span><LeagueBadge league={p.league} /> {p.mmr} MMR</span>
          {!p.guest && s.myRank != null ? <span>Ranking #{s.myRank}</span> : <span>Ranqueada disponível</span>}
        </div>
      </section>

      <section className="home-world" aria-label="Contexto de Aurélia">
        <div className="home-chapter">
          <span className="home-world-kicker"><IcoRealm className="ic" /> {chapter.label}</span>
          <strong>{chapter.title}</strong>
          <p>{chapter.text}</p>
        </div>
        <div className="home-traditions">
          <div className="home-traditions-head">
            <span><IcoShield className="ic" /> Tradições de Aurélia</span>
            {chosenFaction && <em>{shortFactionName(chosenFaction.name)} ativa</em>}
          </div>
          <div className="home-tradition-grid">
            {HOME_FACTION_ORDER.map((fid) => {
              const f = FACTIONS[fid];
              return (
                <button
                  key={fid}
                  type="button"
                  className={`home-tradition ${s.faction === fid ? 'chosen' : ''}`}
                  style={{ '--accent': f.color } as React.CSSProperties}
                  onClick={() => openCodex(fid)}
                  title={`Abrir ${f.name} no Arquivo`}
                >
                  <Sigil id={f.sigil} className="ic" />
                  <span>{shortFactionName(f.name)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <main className="home-main">
        <div className="home-main-column home-main-column-play">
        <section className="panel play-panel home-play-panel">
          <h2>Jogar</h2>
          {dailyCard ? (
            <div className="card-of-day" title={dailyCard.text}>
              <CardArt defId={dailyCardId} className="cod-art" loading="eager" fetchPriority="high" />
              <div className="cod-info">
                <span className="cod-label"><IcoStar className="ic" /> Carta do dia</span>
                <span className="cod-name">{dailyCard.name}</span>
              </div>
            </div>
          ) : null}
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
                <button className="btn ghost" onClick={() => openCodex()}>
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
        </div>

        <div className="home-main-column home-main-column-story">
        <section className="panel lore-panel home-lore-panel">
          <h2>Jornada do Comandante</h2>
          <div className="home-story-beats">
            {WORLD.storyBeats.map((beat, i) => (
              <button key={beat.title} type="button" className="home-story-beat" onClick={() => openCodex()}>
                <span className="home-story-index">{i + 1}</span>
                <span>
                  <em>{beat.kicker}</em>
                  <strong>{beat.title}</strong>
                  <small>{beat.text}</small>
                </span>
              </button>
            ))}
          </div>
          <button className="btn ghost lore-panel-cta" onClick={() => openCodex()}>
            <IcoCodex className="ic" /> Explorar história e cartas
          </button>
        </section>

        <section className="panel home-history-panel">
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
                  : h.reason === 'fatigue' ? 'Fadiga / baralho esgotado'
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
        </div>

        <div className="home-main-column home-main-column-ranking">
        <section className="panel home-ranking-panel">
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
                {s.leaderboard.map((e, i) => {
                  const faction = e.faction ? FACTIONS[e.faction] : null;
                  const identityStyle = {
                    ...profileCoverVars(e.profileCover),
                    '--tradition-color': faction?.color ?? '#7183a1',
                  } as CSSProperties;
                  return (
                    <tr key={e.id} className={e.id === p.id ? 'me' : ''}>
                      <td className="pos">{i + 1}</td>
                      <td className="board-player">
                        <button
                          type="button"
                          className="board-player-button"
                          style={identityStyle}
                          onClick={e.id === p.id ? openProfile : () => viewProfile(e.id)}
                          aria-label={`Ver perfil de ${e.name}`}
                        >
                          <InlineAvatar iconId={e.avatar} photo={e.photo} size={24} />
                          <span className="board-player-copy">
                            <strong>{e.name}</strong>
                            <small>
                              {faction ? <><Sigil id={faction.sigil} className="ic" /> {faction.name.replace(/^(A |O |Os )/, '')}</> : 'Tradição livre'}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td><LeagueBadge league={e.league} /></td>
                      <td className="num">{e.mmr}</td>
                      <td className="num dim">{e.wins}V {e.losses}D</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        </div>
      </main>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showCodex && <CodexView initialFaction={codexInitialFaction} onClose={() => setShowCodex(false)} />}
    </div>
  );
}
