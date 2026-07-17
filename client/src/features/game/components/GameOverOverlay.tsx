import { CARDS, achievementLabel } from '@legendsclash/shared';
import { CardArt } from '../../../components/CardArt';
import { LeagueBadge } from '../../../components/LeagueBadge';
import { CosmeticIcon } from '../../../cosmetics';
import {
  IcoAddFriend, IcoAttack, IcoCheck, IcoDeath, IcoMedal, IcoRematch, IcoSparkle, IcoStar, IcoVictory,
} from '../../../icons';
import {
  addFriend, declineRematch, dismissGameOver, requestRematch, useAppState, viewProfile,
} from '../../../store';
import { sfx } from '../../../sounds';
import { gameOverLesson } from '../view-model';

function GameOverOverlay() {
  const s = useAppState();
  const result = s.gameOver;
  const myId = s.profile?.id;
  if (!result || !myId) return null;

  const won = result.winnerId === myId;
  const my = result.mmr[myId];
  const stats = result.stats?.[myId];
  const mvp = result.mvp?.[myId];
  const newly = result.unlocked?.[myId] ?? [];
  const opponentId = Object.keys(result.mmr).find((id) => id !== myId);
  const opponentName = opponentId
    ? s.game?.seats.find((seat) => seat.playerId === opponentId)?.name ?? 'oponente'
    : null;
  const isFriend = !!opponentId && (s.profile?.friends?.includes(opponentId) ?? false);
  const rematch = s.rematch;
  const reasonText: Record<string, string> = {
    hp: won ? 'Você zerou a vida do oponente!' : 'Sua vida chegou a zero.',
    surrender: won ? 'O oponente desistiu da partida.' : 'Você desistiu da partida.',
    timeout: won ? 'O oponente não voltou a tempo.' : 'Você ficou desconectado por muito tempo.',
    fatigue: won
      ? 'O baralho do oponente acabou e a fadiga consumiu a última vida.'
      : 'Seu baralho acabou e a fadiga consumiu sua última vida.',
    turns: won
      ? 'O limite de turnos foi atingido! Você venceu por ter mais vida e ataque em campo.'
      : 'O limite de turnos foi atingido. Seu oponente tinha mais vantagem no campo.',
  };
  const reasonLabel: Record<string, string> = {
    hp: 'Vida zerada',
    surrender: 'Desistência',
    timeout: 'Tempo / reconexão',
    fatigue: 'Baralho esgotado — Fadiga',
    turns: 'Limite de turnos',
  };

  return (
    <div className={`overlay game-over-overlay ${result.reason === 'fatigue' ? 'game-over-fatigue' : ''}`}>
      {won && (
        <div className="confetti">
          {Array.from({ length: 18 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 53) % 100}%`,
                animationDelay: `${(i % 6) * 0.25}s`,
                background: ['#e3b341', '#4d8dff', '#3fb950', '#b083f0', '#f85149'][i % 5],
              }}
            />
          ))}
        </div>
      )}
      <div
        className={`panel game-over ${won ? 'won' : 'lost'}`}
        role="dialog"
        aria-modal="true"
        aria-live="assertive"
        aria-labelledby="game-over-title"
      >
        <header className="go-header">
          <div className="go-emblem">{won ? <IcoVictory /> : <IcoDeath />}</div>
          <h2 id="game-over-title">{won ? 'Vitória!' : 'Derrota'}</h2>
          <p>{reasonText[result.reason] ?? 'A partida foi encerrada.'}</p>
        </header>
        <div className="go-scroll" tabIndex={0} aria-label="Resumo da partida">
          <div className={`go-reason go-reason-${result.reason}`}>
            <span>{reasonLabel[result.reason] ?? 'Fim da partida'}</span>
            <strong>{won ? 'Resultado favorável' : 'Ponto de melhoria'}</strong>
          </div>
          <p className="go-lesson">{gameOverLesson(result.reason, won)}</p>
          <p className="dim">{result.turns} turnos · {Math.max(1, Math.round(result.durationMs / 60000))} min</p>
          {my && (
            <p className="mmr-change">
              MMR: {my.before} → <strong>{my.after}</strong>{' '}
              <span className={my.delta >= 0 ? 'delta up' : 'delta down'}>
                ({my.delta >= 0 ? '+' : ''}{my.delta})
              </span>
              <br />
              <LeagueBadge league={my.league} />
            </p>
          )}
          {stats && (
            <div className="go-recap">
              {mvp && CARDS[mvp.defId] && (
                <div className="go-mvp">
                  <CardArt defId={mvp.defId} className="go-mvp-art" loading="eager" fetchPriority="auto" />
                  <div className="go-mvp-info">
                    <span className="go-mvp-name"><IcoStar className="ic" /> {CARDS[mvp.defId].name}</span>
                    <span className="go-mvp-line">
                      {mvp.damage} de dano{mvp.kills > 0 ? ` · ${mvp.kills} abate${mvp.kills > 1 ? 's' : ''}` : ''}
                    </span>
                  </div>
                </div>
              )}
              <div className="go-stats">
                <span><b>{stats.creaturesSummoned}</b> criaturas</span>
                <span><b>{stats.spellsCast}</b> magias</span>
                <span><b>{stats.damageDealt}</b> dano</span>
                {stats.shieldAbsorbed > 0 && <span><b>{stats.shieldAbsorbed}</b> escudo</span>}
              </div>
            </div>
          )}
          {newly.length > 0 && (
            <div className="go-unlocks">
              <p className="go-unlocks-title"><IcoSparkle className="ic" /> Conquista desbloqueada!</p>
              {newly.map((a) => <span key={a} className="go-unlock"><IcoMedal className="ic" /> {achievementLabel(a)}</span>)}
            </div>
          )}
          {opponentId && (
            <p className="go-opponent">
              vs{' '}
              <button className="link-btn" onClick={() => viewProfile(opponentId)}>
                {opponentName}
              </button>
            </p>
          )}
          {rematch?.status === 'sent' && (
            <p className="go-rematch-sent"><IcoRematch className="ic" /> Revanche enviada — aguardando o oponente…</p>
          )}
        </div>
        <footer className="go-footer">
          {rematch?.status === 'incoming' && (
            <div className="go-rematch-incoming">
              <p>
                {rematch.from && <CosmeticIcon id={rematch.from.avatar} size={18} className="inline-ico" />}
                {' '}{rematch.from?.name} quer revanche!
              </p>
              <div className="go-actions">
                <button className="btn primary" onClick={() => { sfx.click(); requestRematch(); }}><IcoCheck className="ic" /> Aceitar revanche</button>
                <button className="btn ghost" onClick={() => declineRematch()}>Recusar</button>
              </div>
            </div>
          )}
          <div className="go-actions">
            {opponentId && rematch?.status !== 'incoming' && rematch?.status !== 'sent' && (
              <button className="btn" onClick={() => { sfx.click(); requestRematch(); }}><IcoRematch className="ic" /> Revanche</button>
            )}
            {opponentId && !isFriend && (
              <button className="btn ghost" onClick={() => addFriend(opponentId)}><IcoAddFriend className="ic" /> Amigo</button>
            )}
          </div>
          <button className="btn primary big" onClick={() => { sfx.click(); dismissGameOver(); }}>
            <IcoAttack className="ic" /> Jogar de novo
          </button>
        </footer>
      </div>
    </div>
  );
}

export { GameOverOverlay };
