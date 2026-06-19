import { useRef, useState } from 'react';
import {
  ACCENTS, ACCENT_STYLES, ACCENT_STYLE_UNLOCKS, ACCENT_UNLOCKS, AVATARS, COMMANDERS,
  COMMANDER_UNLOCKS, FRAMES, FRAME_UNLOCKS,
  accentStyleUnlocked, accentUnlocked, achievementLabel, achievementProgress, commanderTitle,
  commanderUnlocked, cosmeticTier, frameUnlocked,
} from '@legendsclash/shared';
import { GiLaurelsTrophy, GiPadlock, GiStarFormation } from 'react-icons/gi';
import {
  removeAvatarPhoto, updateProfile, uploadAvatarPhoto, useAppState,
} from '../store';
import { Avatar, CosmeticIcon, accentVars, downscaleImage } from '../cosmetics';

/** Selo de prestígio do cosmético, agora em ícone (sem emoji). */
function TierBadge({ req }: { req: string | undefined }) {
  const tier = cosmeticTier(req);
  if (tier === 'common') return null;
  const Icon = tier === 'legendary' ? GiLaurelsTrophy : GiStarFormation;
  return <span className={`cz-tier cz-tier--${tier}`} title="Cosmético de prestígio"><Icon /></span>;
}

/**
 * Personalização do jogador: perfil (nome + avatar/foto) e comandante (retrato +
 * cor/estilo + moldura exibidos na arena). Envia só os campos alterados; o
 * servidor valida contra as listas de cosméticos do shared. As seções de foto,
 * moldura e estilo de cor aparecem quando a Personalização v2 está ligada.
 */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const p = s.profile;
  const v2 = s.cosmeticsEnabled;
  const [name, setName] = useState(p?.name ?? '');
  const [avatar, setAvatar] = useState(p?.avatar ?? AVATARS[0].id);
  const [commander, setCommander] = useState(p?.commander ?? COMMANDERS[0].id);
  const [accent, setAccent] = useState(p?.accent ?? ACCENTS[0]);
  const [frame, setFrame] = useState(p?.frame ?? FRAMES[0].id);
  const [accentStyle, setAccentStyle] = useState(p?.accentStyle ?? ACCENT_STYLES[0].id);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
      frame: v2 && frame !== p!.frame ? frame : undefined,
      accentStyle: v2 && accentStyle !== p!.accentStyle ? accentStyle : undefined,
    });
    onClose();
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reescolher o mesmo arquivo
    if (!file) return;
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      const dataUrl = await downscaleImage(file);
      await uploadAvatarPhoto(dataUrl);
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onRemovePhoto() {
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      await removeAvatarPhoto();
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : 'Falha ao remover a foto.');
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="panel customize-modal"
        style={accentVars(accent, accentStyle)}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Personalizar</h2>

        <div className="commander-preview">
          <Avatar
            iconId={commander}
            photo={v2 ? p.photo : null}
            frame={v2 ? frame : 'none'}
            accent={accent}
            accentStyle={accentStyle}
            size={72}
          />
          <div className="commander-id">
            <strong>{name.trim() || 'Sua lenda'}</strong>
            <span className="commander-title">{commanderTitle(commander) ?? 'Comandante'}</span>
          </div>
        </div>

        <label className="cz-field">
          Nome de jogador
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        </label>

        {v2 && (
          <>
            <h4>Foto de perfil</h4>
            <div className="cz-photo">
              <Avatar iconId={avatar} photo={p.photo} frame={frame} accent={accent} accentStyle={accentStyle} size={64} />
              <div className="cz-photo-actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onPickPhoto}
                  hidden
                />
                <button type="button" className="btn" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                  {photoBusy ? 'Enviando…' : p.photo ? 'Trocar foto' : 'Enviar foto'}
                </button>
                {p.photo && (
                  <button type="button" className="btn ghost" disabled={photoBusy} onClick={onRemovePhoto}>
                    Remover
                  </button>
                )}
                <span className="cz-hint">PNG, JPG ou WebP · visível ao oponente</span>
                {photoErr && <span className="cz-err">{photoErr}</span>}
              </div>
            </div>
          </>
        )}

        <h4>Avatar do perfil</h4>
        <div className="cz-grid">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`cz-chip ${a.id === avatar ? 'sel' : ''}`}
              title={a.label}
              aria-label={a.label}
              data-avatar={a.id}
              onClick={() => setAvatar(a.id)}
            >
              <CosmeticIcon id={a.id} size={24} />
            </button>
          ))}
        </div>

        <h4>Comandante na arena</h4>
        <div className="cz-grid commanders">
          {COMMANDERS.map((c) => {
            const unlockReq = COMMANDER_UNLOCKS[c.id];
            const locked = !commanderUnlocked(c.id, earned);
            const req = locked ? achievementLabel(unlockReq) : '';
            const prog = locked ? achievementProgress(unlockReq, p.wins, games) : null;
            return (
              <button
                key={c.id}
                type="button"
                className={`cz-cmd ${c.id === commander ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                title={locked ? `Desbloqueie: ${req}${prog ? ` (${prog.current}/${prog.target})` : ''}` : c.title}
                disabled={locked}
                onClick={() => !locked && setCommander(c.id)}
              >
                {!locked && <TierBadge req={unlockReq} />}
                <span className="cz-cmd-portrait">
                  {locked ? <GiPadlock /> : <CosmeticIcon id={c.id} size={28} />}
                </span>
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
                title={locked ? `Desbloqueie: ${achievementLabel(ACCENT_UNLOCKS[col])}${prog ? ` (${prog.current}/${prog.target})` : ''}` : `Cor ${col}`}
                aria-label={`Cor ${col}${locked ? ' (bloqueada)' : ''}`}
              />
            );
          })}
        </div>

        {v2 && (
          <>
            <h4>Estilo de cor</h4>
            <div className="cz-styles">
              {ACCENT_STYLES.map((st) => {
                const locked = !accentStyleUnlocked(st.id, earned);
                const prog = locked ? achievementProgress(ACCENT_STYLE_UNLOCKS[st.id], p.wins, games) : null;
                const preview = st.gradient
                  ? `linear-gradient(135deg, ${st.gradient[0]}, ${st.gradient[1]})`
                  : accent;
                return (
                  <button
                    key={st.id}
                    type="button"
                    className={`cz-style ${st.id === accentStyle ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                    style={{ ['--prev' as string]: preview }}
                    disabled={locked}
                    onClick={() => !locked && setAccentStyle(st.id)}
                    title={locked ? `Desbloqueie: ${achievementLabel(ACCENT_STYLE_UNLOCKS[st.id])}${prog ? ` (${prog.current}/${prog.target})` : ''}` : st.label}
                  >
                    <span className="cz-style-orb" />
                    <span className="cz-style-name">{locked ? <GiPadlock /> : st.label}</span>
                  </button>
                );
              })}
            </div>

            <h4>Armação</h4>
            <div className="cz-grid frames">
              {FRAMES.map((f) => {
                const unlockReq = FRAME_UNLOCKS[f.id];
                const locked = !frameUnlocked(f.id, earned);
                const prog = locked ? achievementProgress(unlockReq, p.wins, games) : null;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`cz-frame ${f.id === frame ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                    title={locked ? `Desbloqueie: ${achievementLabel(unlockReq)}${prog ? ` (${prog.current}/${prog.target})` : ''}` : f.label}
                    disabled={locked}
                    onClick={() => !locked && setFrame(f.id)}
                  >
                    {!locked && <TierBadge req={unlockReq} />}
                    {locked
                      ? <span className="cz-frame-lock"><GiPadlock /></span>
                      : <Avatar iconId={avatar} photo={p.photo} frame={f.id} accent={accent} accentStyle={accentStyle} size={48} />}
                    <span className="cz-frame-name">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="cz-actions">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={!name.trim()}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
