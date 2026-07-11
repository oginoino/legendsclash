import { useEffect, useRef, useState } from 'react';
import { achievementLabel, commanderTitle } from '@legendsclash/shared';
import type { Bus } from '../sounds';
import { logout, openAccountPrompt, useAppState } from '../store';
import { Avatar, Sigil, accentVars, profileCoverVars } from '../cosmetics';
import { FACTIONS } from '../lore';
import {
  IcoAchievement, IcoBack, IcoCheck, IcoHaptics, IcoHint, IcoMedal, IcoMotion,
  IcoMusic, IcoMuted, IcoPreferences, IcoProfile, IcoReset, IcoSound, IcoSparkle,
  IcoStreak,
} from '../icons';
import {
  DEFAULT_VOLUMES, getVolume, resetVolumes, setVolume, sfx, subscribeVolume,
} from '../sounds';
import {
  resetLearningProgress, resetPreferences, triggerHaptic, updatePreferences, usePreferences,
} from '../preferences';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LeagueBadge } from '../components/LeagueBadge';
import { ProfileModal } from '../components/ProfileModal';

type ProfileTab = 'overview' | 'preferences';

function progression(mmr: number, league: string): { label: string; pct: number } {
  if (league === 'Ouro' || mmr >= 1300) return { label: 'Liga máxima alcançada', pct: 100 };
  const low = mmr >= 1100 ? 1100 : 900;
  const high = mmr >= 1100 ? 1300 : 1100;
  const next = mmr >= 1100 ? 'Ouro' : 'Prata';
  return {
    label: `${Math.max(0, high - mmr)} MMR até ${next}`,
    pct: Math.max(0, Math.min(100, ((mmr - low) / (high - low)) * 100)),
  };
}

function PreferenceSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`preference-switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function AudioRow({
  bus,
  label,
  description,
  value,
  onChange,
  onToggleMute,
}: {
  bus: Bus;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  onToggleMute: () => void;
}) {
  const Icon = bus === 'music' ? IcoMusic : IcoSound;
  const percent = Math.round(value * 100);
  return (
    <div className="audio-preference-row">
      <span className="preference-leading" aria-hidden="true"><Icon /></span>
      <div className="preference-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        className="preference-icon-button"
        onClick={onToggleMute}
        aria-label={value > 0 ? `Silenciar ${label.toLowerCase()}` : `Ativar ${label.toLowerCase()}`}
        title={value > 0 ? 'Silenciar' : 'Ativar'}
      >
        {value > 0 ? <Icon /> : <IcoMuted />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`Volume de ${label.toLowerCase()}`}
        style={{ '--audio-level': `${percent}%` } as React.CSSProperties}
      />
      <output>{percent}%</output>
    </div>
  );
}

export function ProfileView({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const p = s.profile;
  const preferences = usePreferences();
  const [tab, setTab] = useState<ProfileTab>('overview');
  const [showCustomize, setShowCustomize] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'logout' | null>(null);
  const [learningReset, setLearningReset] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(() => getVolume('sfx'));
  const [musicVolume, setMusicVolume] = useState(() => getVolume('music'));
  const audibleRef = useRef<Record<Bus, number>>({
    sfx: sfxVolume > 0 ? sfxVolume : DEFAULT_VOLUMES.sfx,
    music: musicVolume > 0 ? musicVolume : DEFAULT_VOLUMES.music,
  });

  useEffect(() => subscribeVolume(() => {
    setSfxVolume(getVolume('sfx'));
    setMusicVolume(getVolume('music'));
  }), []);

  if (!p) return <div className="centered">Carregando perfil...</div>;

  const profileId = p.id;
  const games = p.wins + p.losses;
  const winRate = games > 0 ? Math.round((p.wins / games) * 100) : 0;
  const rankProgress = progression(p.mmr, p.league);
  const faction = s.faction ? FACTIONS[s.faction] : null;
  const identityStyle = {
    ...accentVars(p.accent, p.accentStyle),
    ...profileCoverVars(p.profileCover),
  } as React.CSSProperties;

  function changeVolume(bus: Bus, value: number) {
    if (value > 0) audibleRef.current[bus] = value;
    setVolume(bus, value);
  }

  function toggleMute(bus: Bus) {
    const current = getVolume(bus);
    changeVolume(bus, current > 0 ? 0 : audibleRef.current[bus]);
  }

  function resetAll() {
    resetPreferences();
    resetVolumes();
    audibleRef.current = { ...DEFAULT_VOLUMES };
    setConfirm(null);
  }

  function replayLearning() {
    resetLearningProgress(profileId);
    setLearningReset(true);
  }

  return (
    <div className="profile-page" style={identityStyle}>
      <header className="profile-page-header">
        <button type="button" className="btn ghost profile-back" onClick={onClose}>
          <IcoBack className="ic" /> Voltar
        </button>
        <span className="logo small" aria-label="Legends Clash">LEGENDS<span>CLASH</span></span>
        <span className="profile-device-note"><IcoCheck className="ic" /> Preferências salvas neste dispositivo</span>
      </header>

      <main className="profile-page-main">
        <section className="profile-page-hero" aria-labelledby="profile-name">
          <Avatar
            className="profile-page-avatar"
            iconId={p.avatar}
            photo={p.photo}
            frame={p.frame}
            accent={p.accent}
            accentStyle={p.accentStyle}
            size={108}
            alt={p.name}
          />
          <div className="profile-page-identity">
            <span className="profile-page-kicker">Perfil do comandante</span>
            <h1 id="profile-name">{p.name}</h1>
            <div className="profile-page-byline">
              <span>{commanderTitle(p.commander) ?? 'Comandante de Aurélia'}</span>
              <span>{faction ? faction.name : 'Sem tradição fixa'}</span>
            </div>
            <div className="profile-page-badges">
              <span><LeagueBadge league={p.league} /> {p.mmr} MMR</span>
              <span><IcoStreak className="ic" /> {p.streak} {p.streak === 1 ? 'dia' : 'dias'}</span>
              {p.guest && <span className="guest-badge">Convidado</span>}
            </div>
          </div>
          <button type="button" className="btn profile-customize" onClick={() => setShowCustomize(true)}>
            <IcoSparkle className="ic" /> Personalizar identidade
          </button>
        </section>

        <nav className="profile-page-tabs" role="tablist" aria-label="Perfil e preferências">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'overview'}
            className={tab === 'overview' ? 'active' : ''}
            onClick={() => setTab('overview')}
          >
            <IcoProfile className="ic" /> Visão geral
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'preferences'}
            className={tab === 'preferences' ? 'active' : ''}
            onClick={() => setTab('preferences')}
          >
            <IcoPreferences className="ic" /> Preferências
          </button>
        </nav>

        {tab === 'overview' ? (
          <div className="profile-overview" role="tabpanel">
            <div className="profile-overview-grid">
              <section className="profile-page-section profile-progression" aria-labelledby="progress-title">
                <div className="profile-section-heading">
                  <span className="preference-leading"><IcoMedal /></span>
                  <div>
                    <span>Progressão competitiva</span>
                    <h2 id="progress-title">Sua jornada nas ligas</h2>
                  </div>
                </div>
                <div className="profile-rank-line">
                  <LeagueBadge league={p.league} />
                  <strong>{p.mmr} MMR</strong>
                  <span>{rankProgress.label}</span>
                </div>
                <div className="profile-progress-track" aria-label={rankProgress.label}>
                  <span style={{ width: `${rankProgress.pct}%` }} />
                </div>
                <div className="profile-stat-grid">
                  <span><strong>{games}</strong> partidas</span>
                  <span><strong>{p.wins}</strong> vitórias</span>
                  <span><strong>{winRate}%</strong> aproveitamento</span>
                </div>
              </section>

              <section className="profile-page-section profile-loadout" aria-labelledby="loadout-title">
                <div className="profile-section-heading">
                  <Avatar
                    iconId={p.commander}
                    photo={null}
                    frame={p.frame}
                    accent={p.accent}
                    accentStyle={p.accentStyle}
                    size={54}
                  />
                  <div>
                    <span>Identidade na arena</span>
                    <h2 id="loadout-title">{commanderTitle(p.commander) ?? 'Seu comandante'}</h2>
                  </div>
                </div>
                <dl className="profile-loadout-list">
                  <div><dt>Tradição</dt><dd>{faction ? <><Sigil id={faction.sigil} className="ic" /> {faction.name}</> : 'Livre'}</dd></div>
                  <div><dt>Estilo</dt><dd>{p.accentStyle === 'solid' ? 'Cor sólida' : 'Assinatura especial'}</dd></div>
                  <div><dt>Conquistas</dt><dd>{p.achievements.length}</dd></div>
                </dl>
                <button type="button" className="btn ghost" onClick={() => setShowCustomize(true)}>
                  <IcoSparkle className="ic" /> Editar apresentação
                </button>
              </section>
            </div>

            <section className="profile-page-section profile-achievements" aria-labelledby="achievements-title">
              <div className="profile-section-heading">
                <span className="preference-leading"><IcoAchievement /></span>
                <div>
                  <span>Marcos da jornada</span>
                  <h2 id="achievements-title">Conquistas</h2>
                </div>
              </div>
              {p.achievements.length > 0 ? (
                <div className="profile-achievement-list">
                  {p.achievements.map((achievement) => (
                    <span className="profile-achievement" key={achievement}>
                      <IcoAchievement /> {achievementLabel(achievement)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="profile-empty-copy">Suas conquistas aparecerão aqui conforme os Embates avançarem.</p>
              )}
            </section>

            <section className="profile-page-section profile-account" aria-labelledby="account-title">
              <div>
                <span className="profile-section-label">Conta</span>
                <h2 id="account-title">{p.guest ? 'Progresso desta sessão' : p.email}</h2>
                <p>{p.guest
                  ? 'Crie uma conta para preservar ranking, histórico e personalizações entre dispositivos.'
                  : 'Seu progresso competitivo e sua identidade pública ficam vinculados a esta conta.'}</p>
              </div>
              <div className="profile-account-actions">
                {p.guest && <button type="button" className="btn primary" onClick={() => { onClose(); openAccountPrompt(); }}>Criar conta</button>}
                <button type="button" className="btn ghost" onClick={() => setConfirm('logout')}>Sair</button>
              </div>
            </section>
          </div>
        ) : (
          <div className="profile-preferences" role="tabpanel">
            <div className="profile-preferences-intro">
              <span className="profile-page-kicker">Experiência pessoal</span>
              <h2>Faça a arena responder do seu jeito</h2>
              <p>As mudanças são aplicadas imediatamente e ficam apenas neste dispositivo.</p>
            </div>

            <section className="preference-section" aria-labelledby="audio-title">
              <div className="preference-section-heading">
                <span className="preference-leading"><IcoSound /></span>
                <div><span>Atmosfera</span><h3 id="audio-title">Áudio</h3></div>
                <button type="button" className="btn small ghost" onClick={() => sfx.play()} disabled={sfxVolume <= 0}>
                  <IcoSound className="ic" /> Testar efeitos
                </button>
              </div>
              <div className="preference-rows">
                <AudioRow
                  bus="sfx"
                  label="Efeitos"
                  description="Ações, impactos, turnos e confirmações."
                  value={sfxVolume}
                  onChange={(value) => changeVolume('sfx', value)}
                  onToggleMute={() => toggleMute('sfx')}
                />
                <AudioRow
                  bus="music"
                  label="Música"
                  description="Trilha ambiente durante menus e Embates."
                  value={musicVolume}
                  onChange={(value) => changeVolume('music', value)}
                  onToggleMute={() => toggleMute('music')}
                />
              </div>
            </section>

            <section className="preference-section" aria-labelledby="interaction-title">
              <div className="preference-section-heading">
                <span className="preference-leading"><IcoHaptics /></span>
                <div><span>Controle</span><h3 id="interaction-title">Interação</h3></div>
              </div>
              <div className="preference-rows">
                <div className="preference-row">
                  <span className="preference-leading"><IcoHaptics /></span>
                  <div className="preference-copy">
                    <strong>Resposta tátil</strong>
                    <span>Confirma quando uma carta encaixa em um destino válido no toque.</span>
                  </div>
                  <PreferenceSwitch
                    checked={preferences.haptics}
                    label="Resposta tátil"
                    onChange={(checked) => {
                      updatePreferences({ haptics: checked });
                      if (checked) window.setTimeout(() => triggerHaptic(14), 0);
                    }}
                  />
                </div>
                <div className="preference-row">
                  <span className="preference-leading"><IcoMotion /></span>
                  <div className="preference-copy">
                    <strong>Movimento reduzido</strong>
                    <span>Suaviza transições, pulsos e celebrações sem esconder informação de jogo.</span>
                  </div>
                  <PreferenceSwitch
                    checked={preferences.reducedMotion}
                    label="Movimento reduzido"
                    onChange={(checked) => updatePreferences({ reducedMotion: checked })}
                  />
                </div>
              </div>
            </section>

            <section className="preference-section" aria-labelledby="guidance-title">
              <div className="preference-section-heading">
                <span className="preference-leading"><IcoHint /></span>
                <div><span>Aprendizado</span><h3 id="guidance-title">Orientação de batalha</h3></div>
              </div>
              <div className="preference-rows">
                <div className="preference-row">
                  <span className="preference-leading"><IcoHint /></span>
                  <div className="preference-copy">
                    <strong>Dicas contextuais</strong>
                    <span>Explica efeitos importantes na primeira vez em que aparecem.</span>
                  </div>
                  <PreferenceSwitch
                    checked={preferences.battleHints}
                    label="Dicas contextuais"
                    onChange={(checked) => updatePreferences({ battleHints: checked })}
                  />
                </div>
                <div className="preference-row preference-row-action">
                  <span className="preference-leading"><IcoReset /></span>
                  <div className="preference-copy">
                    <strong>Rever introdução</strong>
                    <span>{learningReset ? 'Pronto. O tutorial reaparecerá na próxima partida.' : 'Restaura o tutorial inicial e as explicações de Provocar e Fadiga.'}</span>
                  </div>
                  <button type="button" className="btn ghost" onClick={replayLearning} disabled={learningReset}>
                    <IcoReset className="ic" /> {learningReset ? 'Restaurado' : 'Restaurar'}
                  </button>
                </div>
              </div>
            </section>

            <div className="preferences-reset-line">
              <div>
                <strong>Voltar ao padrão</strong>
                <span>Restaura áudio, movimento, resposta tátil e dicas.</span>
              </div>
              <button type="button" className="btn ghost" onClick={() => setConfirm('reset')}>
                <IcoReset className="ic" /> Redefinir preferências
              </button>
            </div>
          </div>
        )}
      </main>

      {showCustomize && <ProfileModal onClose={() => setShowCustomize(false)} />}
      {confirm === 'reset' && (
        <ConfirmDialog
          title="Redefinir preferências?"
          message="Áudio, movimento, resposta tátil e dicas voltarão aos valores recomendados. Seu perfil e progresso não serão alterados."
          confirmLabel="Redefinir"
          icon={<IcoPreferences />}
          onConfirm={resetAll}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'logout' && (
        <ConfirmDialog
          title="Sair desta conta?"
          message={p.guest ? 'O progresso desta sessão de convidado pode não estar disponível depois.' : 'Você poderá entrar novamente com sua conta e continuar seu progresso.'}
          confirmLabel="Sair agora"
          tone="danger"
          icon={<IcoProfile />}
          onConfirm={() => { onClose(); logout(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
