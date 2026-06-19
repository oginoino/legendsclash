import { useState } from 'react';
import {
  ACCENTS, ACCENT_UNLOCKS, AVATARS, COMMANDERS, COMMANDER_UNLOCKS,
  accentUnlocked, achievementLabel, achievementProgress, commanderTitle, commanderUnlocked, cosmeticTier,
} from '@legendsclash/shared';
import { updateProfile, useAppState } from '../store';

const TIER_BADGE = { common: '', rare: '⭐', legendary: '🏅' } as const;

/**
 * Personalização do jogador: perfil (nome + avatar) e comandante (retrato + cor
 * de destaque exibidos na arena). Envia só os campos alterados; o servidor
 * valida contra as listas de cosméticos do shared.
 */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const p = s.profile;
  const [name, setName] = useState(p?.name ?? '');
  const [avatar, setAvatar] = useState(p?.avatar ?? AVATARS[0]);
  const [commander, setCommander] = useState(p?.commander ?? COMMANDERS[0].portrait);
  const [accent, setAccent] = useState(p?.accent ?? ACCENTS[0]);
  if (!p) return null;
  const earned = p.achievements ?? [];
  const games = p.wins + p.losses;

  function save() {
    const trimmed = name.trim();
    updateProfile({
      name: trimmed && trimmed !== p!.name ? trimmed : undefined,
      avatar: avatar !== p!.avatar ? avatar : undefined,
      commander: commander !== p!.commander ? commander : undefined,
      accent: accent !== p!.accent ? accent : undefined,
    });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="panel customize-modal"
        style={{ ['--cz-accent' as string]: accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Personalizar</h2>

        <div className="commander-preview">
          <span className="commander-medallion">{commander}</span>
          <div className="commander-id">
            <strong>{name.trim() || 'Sua lenda'}</strong>
            <span className="commander-title">{commanderTitle(commander) ?? 'Comandante'}</span>
          </div>
        </div>

        <label className="cz-field">
          Nome de jogador
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        </label>

        <h4>Avatar do perfil</h4>
        <div className="cz-grid">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              className={`cz-chip ${a === avatar ? 'sel' : ''}`}
              onClick={() => setAvatar(a)}
            >
              {a}
            </button>
          ))}
        </div>

        <h4>Comandante na arena</h4>
        <div className="cz-grid commanders">
          {COMMANDERS.map((c) => {
            const unlockReq = COMMANDER_UNLOCKS[c.portrait];
            const locked = !commanderUnlocked(c.portrait, earned);
            const req = locked ? achievementLabel(unlockReq) : '';
            const prog = locked ? achievementProgress(unlockReq, p.wins, games) : null;
            const tier = TIER_BADGE[cosmeticTier(unlockReq)];
            return (
              <button
                key={c.portrait}
                type="button"
                className={`cz-cmd ${c.portrait === commander ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                title={locked ? `🔒 Desbloqueie: ${req}${prog ? ` (${prog.current}/${prog.target})` : ''}` : c.title}
                disabled={locked}
                onClick={() => !locked && setCommander(c.portrait)}
              >
                {!locked && tier && <span className="cz-tier" title="Cosmético de prestígio">{tier}</span>}
                <span className="cz-cmd-portrait">{locked ? '🔒' : c.portrait}</span>
                <span className="cz-cmd-title">{locked ? req : c.title}</span>
                {prog && (
                  <span className="cz-progress" title={`${prog.current}/${prog.target}`}>
                    <span style={{ width: `${(prog.current / prog.target) * 100}%` }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <h4>Cor de destaque</h4>
        <div className="cz-swatches">
          {ACCENTS.map((col) => {
            const locked = !accentUnlocked(col, earned);
            const prog = locked ? achievementProgress(ACCENT_UNLOCKS[col], p.wins, games) : null;
            return (
              <button
                key={col}
                type="button"
                className={`cz-swatch ${col === accent ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                style={{ background: col }}
                disabled={locked}
                onClick={() => !locked && setAccent(col)}
                title={locked ? `🔒 Desbloqueie: ${achievementLabel(ACCENT_UNLOCKS[col])}${prog ? ` (${prog.current}/${prog.target})` : ''}` : `Cor ${col}`}
                aria-label={`Cor ${col}${locked ? ' (bloqueada)' : ''}`}
              />
            );
          })}
        </div>

        <div className="cz-actions">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={!name.trim()}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
