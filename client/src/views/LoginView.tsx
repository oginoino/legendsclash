import { useEffect, useState } from 'react';
import { AVATARS } from '@legendsclash/shared';
import {
  closeAccountPrompt, completeProfile, loginAccount, loginAsGuest,
  registerAccount, useAppState,
} from '../store';
import { CosmeticIcon } from '../cosmetics';
import { IcoPlay } from '../icons';

/**
 * Porta de entrada: jogar é imediato (convidado escolhe nome e avatar).
 * Conta por e-mail + senha é opcional: guarda o progresso e entra no
 * ranking. Convidado que cria conta herda a sessão (promoção) e pula o
 * onboarding; `profile` é só para conta criada do zero.
 */
type Mode = 'welcome' | 'signin' | 'signup' | 'profile';

export function LoginView() {
  const s = useAppState();
  const needsProfile = !!(s.token && s.profile && !s.profile.name);
  const fromGuest = !!(s.accountPrompt && s.profile);

  const [mode, setMode] = useState<Mode>(
    needsProfile ? 'profile' : s.accountPrompt ? 'signup' : 'welcome',
  );
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0].id);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // sessão restaurada com perfil incompleto: cai direto no passo final
  useEffect(() => {
    if (needsProfile) setMode('profile');
  }, [needsProfile]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submitGuest(e: React.FormEvent) {
    e.preventDefault();
    run(() => loginAsGuest(name, avatar));
  }

  function submitAccount(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      if (mode === 'signup') await registerAccount(email, password);
      else await loginAccount(email, password);
      // conta nova segue para o perfil via needsProfile; conta antiga vai à home
    });
  }

  function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    run(() => completeProfile(name, avatar));
  }

  function switchMode(next: Mode) {
    setError(null);
    setMode(next);
  }

  const avatarPicker = (
    <div className="avatar-picker">
      {AVATARS.map((a) => (
        <button
          key={a.id}
          type="button"
          className={a.id === avatar ? 'avatar selected' : 'avatar'}
          title={a.label}
          aria-label={a.label}
          data-avatar={a.id}
          onClick={() => setAvatar(a.id)}
        >
          <CosmeticIcon id={a.id} size={26} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="logo">
          LEGENDS<span>CLASH</span>
        </h1>
        <p className="tagline">Duelo de cartas em tempo real — partidas de ~10 minutos, justas e sociais.</p>

        {mode === 'welcome' && (
          <form onSubmit={submitGuest}>
            <label>
              Nome de jogador
              <input
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como quer ser chamado?"
                maxLength={24}
                autoFocus
                required
              />
            </label>
            {avatarPicker}
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary big" disabled={busy || !name.trim()}>
              {busy ? 'Entrando…' : <><IcoPlay className="ic" /> Jogar agora</>}
            </button>
            <p className="login-note">Sem cadastro: você entra como convidado e já pode duelar.</p>
            <div className="divider">já é uma lenda?</div>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => switchMode('signin')}
            >
              Entrar ou criar conta
            </button>
            <p className="login-note">
              Conta guarda seu progresso entre sessões e coloca você no ranking.
            </p>
            <p className="login-note credits">
              Arte das cartas: ícones de{' '}
              <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>{' '}
              (CC BY 3.0)
            </p>
          </form>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <form onSubmit={submitAccount}>
            <p className="login-step-info">
              {mode === 'signup'
                ? fromGuest
                  ? 'Crie sua conta: o progresso desta sessão vai junto — histórico, MMR e ranking.'
                  : 'Crie sua conta: progresso salvo e vaga no ranking.'
                : 'Bem-vindo de volta! Entre com seu e-mail e senha.'}
            </p>
            <label>
              E-mail
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                autoComplete="email"
                autoFocus
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Mínimo de 8 caracteres' : 'Sua senha'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              {busy ? 'Aguarde…' : mode === 'signup' ? 'Criar conta' : 'Entrar'}
            </button>
            <div className="login-links">
              {mode === 'signup' ? (
                <button type="button" className="btn small ghost" onClick={() => switchMode('signin')}>
                  Já tenho conta
                </button>
              ) : (
                <button type="button" className="btn small ghost" onClick={() => switchMode('signup')}>
                  Criar conta nova
                </button>
              )}
              <button
                type="button"
                className="btn small ghost"
                onClick={() => (fromGuest ? closeAccountPrompt() : switchMode('welcome'))}
              >
                {fromGuest ? '← Voltar ao jogo' : '← Jogar sem conta'}
              </button>
            </div>
          </form>
        )}

        {mode === 'profile' && (
          <form onSubmit={submitProfile}>
            <p className="login-step-info">Quase lá! Escolha como você aparece na arena.</p>
            <label>
              Nome de jogador
              <input
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como quer ser chamado?"
                maxLength={24}
                autoFocus
                required
              />
            </label>
            {avatarPicker}
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy || !name.trim()}>
              {busy ? 'Salvando…' : 'Começar a jogar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
