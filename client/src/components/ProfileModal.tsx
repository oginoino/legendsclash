import type { CSSProperties, ChangeEvent } from 'react';
import { useRef, useState } from 'react';
import {
  ACCENTS, ACCENT_STYLES, ACCENT_STYLE_UNLOCKS, ACCENT_UNLOCKS, AVATARS, COMMANDERS,
  COMMANDER_UNLOCKS, FRAMES, FRAME_UNLOCKS, PROFILE_COVERS, PROFILE_COVER_UNLOCKS,
  accentStyleUnlocked, accentUnlocked, achievementLabel, achievementProgress, commanderTitle,
  commanderUnlocked, cosmeticTier, frameUnlocked, profileCoverUnlocked,
} from '@legendsclash/shared';
import { GiLaurelsTrophy, GiPadlock, GiStarFormation } from 'react-icons/gi';
import {
  pickFaction, removeAvatarPhoto, updateProfile, uploadAvatarPhoto, useAppState,
} from '../store';
import {
  Avatar, CosmeticPortrait, Sigil, accentVars, downscaleImage, profileCoverVars,
} from '../cosmetics';
import { FACTIONS } from '../lore';

type CustomizeTab = 'identity' | 'tradition' | 'commander' | 'style';

function TierBadge({ req }: { req: string | undefined }) {
  const tier = cosmeticTier(req);
  if (tier === 'common') return null;
  const Icon = tier === 'legendary' ? GiLaurelsTrophy : GiStarFormation;
  return <span className={`cz-tier cz-tier--${tier}`} title="Cosmético de prestígio"><Icon /></span>;
}

function progressBar(req: string | undefined, wins: number, games: number) {
  if (!req) return null;
  const prog = achievementProgress(req, wins, games);
  if (!prog) return null;
  return (
    <span className="cz-progress" title={`${prog.current}/${prog.target}`}>
      <span style={{ width: `${(prog.current / prog.target) * 100}%` }} />
    </span>
  );
}

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
  const [profileCover, setProfileCover] = useState(p?.profileCover ?? PROFILE_COVERS[0].id);
  const [faction, setFaction] = useState(p?.faction ?? '');
  const [tab, setTab] = useState<CustomizeTab>('identity');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!p) return null;
  const earned = p.achievements ?? [];
  const games = p.wins + p.losses;
  const selectedFaction = faction ? FACTIONS[faction] : null;
  const previewStyle = {
    ...accentVars(accent, accentStyle),
    ...profileCoverVars(profileCover),
  } as CSSProperties;
  const tabs: Array<{ id: CustomizeTab; label: string }> = [
    { id: 'identity', label: 'Identidade' },
    { id: 'tradition', label: 'Tradição' },
    { id: 'commander', label: 'Comandante' },
    { id: 'style', label: 'Estilo' },
  ];

  function save() {
    const current = s.profile;
    if (!current) return;
    const trimmed = name.trim();
    updateProfile({
      name: trimmed && trimmed !== current.name ? trimmed : undefined,
      avatar: avatar !== current.avatar ? avatar : undefined,
      commander: commander !== current.commander ? commander : undefined,
      accent: accent !== current.accent ? accent : undefined,
      frame: v2 && frame !== current.frame ? frame : undefined,
      accentStyle: v2 && accentStyle !== current.accentStyle ? accentStyle : undefined,
      profileCover: profileCover !== current.profileCover ? profileCover : undefined,
    });
    if (faction !== current.faction) pickFaction(faction);
    onClose();
  }

  async function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
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
        style={previewStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Personalizar</h2>

        <div className="commander-preview identity-preview">
          <Avatar
            iconId={commander}
            photo={null}
            frame={v2 ? frame : 'none'}
            accent={accent}
            accentStyle={accentStyle}
            size={72}
          />
          <div className="commander-id">
            <strong>{name.trim() || 'Sua lenda'}</strong>
            <span className="commander-title">{commanderTitle(commander) ?? 'Comandante'}</span>
            <span className="commander-tradition">
              {selectedFaction ? selectedFaction.name : 'Sem tradição fixa'}
            </span>
          </div>
        </div>

        <div className="cz-tabs" role="tablist" aria-label="Seções de personalização">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`cz-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'identity' && (
          <>
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
                      {photoBusy ? 'Enviando...' : p.photo ? 'Trocar foto' : 'Enviar foto'}
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
                  <span className="cz-avatar-portrait">
                    <CosmeticPortrait id={a.id} />
                  </span>
                </button>
              ))}
            </div>

            <h4>Capa do perfil</h4>
            <div className="cz-covers">
              {PROFILE_COVERS.map((cover) => {
                const locked = !profileCoverUnlocked(cover.id, earned);
                const req = PROFILE_COVER_UNLOCKS[cover.id];
                return (
                  <button
                    key={cover.id}
                    type="button"
                    className={`cz-cover ${cover.id === profileCover ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                    style={profileCoverVars(cover.id)}
                    disabled={locked}
                    onClick={() => !locked && setProfileCover(cover.id)}
                    title={locked ? `Desbloqueie: ${achievementLabel(req)}` : cover.label}
                  >
                    <span>{locked ? <GiPadlock /> : cover.label}</span>
                    {progressBar(req, p.wins, games)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === 'tradition' && (
          <>
            <h4>Tradição</h4>
            <div className="cz-traditions">
              <button
                type="button"
                className={`cz-tradition ${faction === '' ? 'sel' : ''}`}
                onClick={() => setFaction('')}
              >
                <span className="cz-tradition-sigil"><GiStarFormation /></span>
                <strong>Sem tradição fixa</strong>
                <small>Deck neutro e identidade livre para explorar Aurélia.</small>
              </button>
              {Object.values(FACTIONS).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`cz-tradition ${faction === f.id ? 'sel' : ''}`}
                  style={{ '--accent': f.color } as CSSProperties}
                  onClick={() => setFaction(f.id)}
                >
                  <span className="cz-tradition-sigil"><Sigil id={f.sigil} className="ic" /></span>
                  <strong>{f.name}</strong>
                  <small>{f.motto}</small>
                </button>
              ))}
            </div>
            <p className="cz-note">
              {selectedFaction
                ? selectedFaction.blurb
                : 'A tradição define o tom narrativo do seu perfil e, quando o conteúdo de facções está ativo, inclina seu deck sem criar vantagem injusta.'}
            </p>
          </>
        )}

        {tab === 'commander' && (
          <>
            <h4>Comandante na arena</h4>
            <div className="cz-grid commanders">
              {COMMANDERS.map((c) => {
                const unlockReq = COMMANDER_UNLOCKS[c.id];
                const locked = !commanderUnlocked(c.id, earned);
                const req = locked ? achievementLabel(unlockReq) : '';
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`cz-cmd ${c.id === commander ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                    title={locked ? `Desbloqueie: ${req}` : c.title}
                    disabled={locked}
                    onClick={() => !locked && setCommander(c.id)}
                  >
                    {!locked && <TierBadge req={unlockReq} />}
                    <span className="cz-cmd-portrait">
                      {locked ? <GiPadlock /> : <CosmeticPortrait id={c.id} />}
                    </span>
                    <span className="cz-cmd-title">{locked ? req : c.title}</span>
                    {progressBar(unlockReq, p.wins, games)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === 'style' && (
          <>
            <h4>Cor de destaque</h4>
            <div className="cz-swatches">
              {ACCENTS.map((col) => {
                const locked = !accentUnlocked(col, earned);
                const req = ACCENT_UNLOCKS[col];
                return (
                  <button
                    key={col}
                    type="button"
                    className={`cz-swatch ${col === accent ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                    style={{ background: col }}
                    disabled={locked}
                    onClick={() => !locked && setAccent(col)}
                    title={locked ? `Desbloqueie: ${achievementLabel(req)}` : `Cor ${col}`}
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
                    const req = ACCENT_STYLE_UNLOCKS[st.id];
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
                        title={locked ? `Desbloqueie: ${achievementLabel(req)}` : st.label}
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
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`cz-frame ${f.id === frame ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                        title={locked ? `Desbloqueie: ${achievementLabel(unlockReq)}` : f.label}
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
