import { useEffect, useState } from 'react';
import { AVATARS } from '@legendsclash/shared';
import {
  clearResetToken, closeAccountPrompt, completeProfile, loginAccount, loginAsGuest,
  registerAccount, requestPasswordReset, resetPassword, useAppState,
} from '../store';
import { CosmeticIcon } from '../cosmetics';
import { IcoPlay } from '../icons';

/**
 * Porta de entrada: jogar é imediato (convidado escolhe nome e avatar).
 * Conta por e-mail + senha é opcional: guarda o progresso e entra no
 * ranking. Convidado que cria conta herda a sessão (promoção) e pula o
 * onboarding; `profile` é só para conta criada do zero.
 */
type Mode = 'welcome' | 'signin' | 'signup' | 'profile' | 'forgot' | 'reset';

export function LoginView() {
  const s = useAppState();
  const needsProfile = !!(s.token && s.profile && !s.profile.name);
  const fromGuest = !!(s.accountPrompt && s.profile);
  const resetToken = s.resetToken;

  const [mode, setMode] = useState<Mode>(
    resetToken ? 'reset' : needsProfile ? 'profile' : s.accountPrompt ? 'signup' : 'welcome',
  );
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0].id);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "esqueci minha senha" enviado: guarda o link de dev (modo local) quando vier
  const [forgotDone, setForgotDone] = useState<{ devLink?: string } | null>(null);

  // sessão restaurada com perfil incompleto: cai direto no passo final
  useEffect(() => {
    if (needsProfile) setMode('profile');
  }, [needsProfile]);

  // chegou pelo link mágico: abre a tela de nova senha
  useEffect(() => {
    if (resetToken) setMode('reset');
  }, [resetToken]);

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

  function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await requestPasswordReset(email);
      setForgotDone(res ?? {});
    });
  }

  function submitReset(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      await resetPassword(resetToken!, password);
      clearResetToken(); // sai do modo redefinição; adoptSession já levou à sessão nova
    });
  }

  function switchMode(next: Mode) {
    setError(null);
    setForgotDone(null);
    if (next !== 'forgot') setPassword('');
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
          {/* <wbr>: empilha LEGENDS / CLASH só quando a largura não comporta a linha */}
          LEGENDS<wbr /><span>CLASH</span>
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
              {mode === 'signin' && (
                <button type="button" className="btn small ghost" onClick={() => switchMode('forgot')}>
                  Esqueci minha senha
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

        {mode === 'forgot' && (
          forgotDone ? (
            <div className="login-step-info">
              <p>
                Se houver uma conta com <strong>{email}</strong>, enviamos um link para
                redefinir a senha. Confira sua caixa de entrada (e o spam).
              </p>
              {forgotDone.devLink && (
                <p className="login-note">
                  Modo local:{' '}
                  <a href={forgotDone.devLink}>abrir link de redefinição</a>
                </p>
              )}
              <button type="button" className="btn ghost" onClick={() => switchMode('signin')}>
                ← Voltar ao login
              </button>
            </div>
          ) : (
            <form onSubmit={submitForgot}>
              <p className="login-step-info">
                Informe o e-mail da sua conta: enviamos um link para você criar uma nova senha.
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
              {error && <p className="form-error">{error}</p>}
              <button className="btn primary" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar link de redefinição'}
              </button>
              <div className="login-links">
                <button type="button" className="btn small ghost" onClick={() => switchMode('signin')}>
                  ← Voltar ao login
                </button>
              </div>
            </form>
          )
        )}

        {mode === 'reset' && (
          <form onSubmit={submitReset}>
            <p className="login-step-info">Crie uma nova senha para a sua conta.</p>
            <label>
              Nova senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                autoComplete="new-password"
                minLength={8}
                autoFocus
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy || password.length < 8}>
              {busy ? 'Salvando…' : 'Salvar nova senha'}
            </button>
            <div className="login-links">
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  clearResetToken();
                  switchMode('signin');
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
