import { achievementLabel } from '@legendsclash/shared';
import { addFriend, closeProfile, removeFriend, useAppState } from '../store';
import { LeagueBadge } from './LeagueBadge';

/**
 * Card de perfil público de um oponente (clique no nome). Mostra identidade,
 * liga/MMR/V-D, sequência e conquistas — sem e-mail (visão redigida). Permite
 * adicionar/remover como amigo.
 */
export function PlayerProfileCard() {
  const s = useAppState();
  const p = s.viewedProfile;
  if (!p) return null;
  const isSelf = s.profile?.id === p.id;
  const isFriend = s.profile?.friends?.includes(p.id) ?? false;

  return (
    <div className="overlay" onClick={closeProfile}>
      <div className="panel player-profile" onClick={(e) => e.stopPropagation()}>
        <div className="pp-head">
          <span className="pp-portrait" style={{ ['--accent' as string]: p.accent }}>{p.commander}</span>
          <div className="pp-id">
            <strong className="pp-name">{p.name}</strong>
            <span className="pp-sub">
              <LeagueBadge league={p.league} /> {p.mmr} MMR · {p.wins}V {p.losses}D
            </span>
          </div>
        </div>
        {p.streak > 0 && <p className="pp-streak">🔥 {p.streak} dias de sequência</p>}
        {p.achievements.length > 0 && (
          <div className="pp-achievements">
            {p.achievements.map((a) => <span key={a} className="pp-ach">🏅 {achievementLabel(a)}</span>)}
          </div>
        )}
        <div className="pp-actions">
          {!isSelf && (isFriend
            ? <button className="btn ghost" onClick={() => removeFriend(p.id)}>Remover amigo</button>
            : <button className="btn" onClick={() => addFriend(p.id)}>➕ Adicionar amigo</button>)}
          <button className="btn ghost" onClick={closeProfile}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
