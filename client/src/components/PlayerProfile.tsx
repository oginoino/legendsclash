import { achievementLabel } from '@legendsclash/shared';
import { GiFlame, GiRibbonMedal, GiThreeFriends } from 'react-icons/gi';
import { addFriend, closeProfile, removeFriend, useAppState } from '../store';
import { Avatar } from '../cosmetics';
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
          <Avatar
            className="pp-portrait"
            iconId={p.commander}
            photo={p.photo}
            frame={p.frame}
            accent={p.accent}
            accentStyle={p.accentStyle}
            size={66}
            alt={p.name}
          />
          <div className="pp-id">
            <strong className="pp-name">{p.name}</strong>
            <span className="pp-sub">
              <LeagueBadge league={p.league} /> {p.mmr} MMR · {p.wins}V {p.losses}D
            </span>
          </div>
        </div>
        {p.streak > 0 && <p className="pp-streak"><GiFlame /> {p.streak} dias de sequência</p>}
        {p.achievements.length > 0 && (
          <div className="pp-achievements">
            {p.achievements.map((a) => <span key={a} className="pp-ach"><GiRibbonMedal /> {achievementLabel(a)}</span>)}
          </div>
        )}
        <div className="pp-actions">
          {!isSelf && (isFriend
            ? <button className="btn ghost" onClick={() => removeFriend(p.id)}>Remover amigo</button>
            : <button className="btn" onClick={() => addFriend(p.id)}><GiThreeFriends /> Adicionar amigo</button>)}
          <button className="btn ghost" onClick={closeProfile}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
