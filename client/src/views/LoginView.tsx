import { useEffect, useState } from 'react';
import { AVATARS } from '@legendsclash/shared';
import { completeProfile, dismissAuthCallback, requestOtp, useAppState } from '../store';

/**
 * Login por link mágico: e-mail → "link enviado" (o clique no e-mail volta
 * em /auth/callback) → perfil (apenas no primeiro acesso). Sem senha.
 */
type Step = 'email' | 'sent' | 'profile';

const RESEND_COOLDOWN_MS = 60_000;

export function LoginView() {
  const s = useAppState();
  const needsProfile = !!(s.token && s.profile && !s.profile.name);
  const [step, setStep] = useState<Step>(needsProfile ? 'profile' : 'email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  // sessão restaurada com perfil incompleto: cai direto no passo final
  useEffect(() => {
    if (needsProfile) setStep('profile');
  }, [needsProfile]);

  // relógio do botão "Reenviar link"
  useEffect(() => {
    if (step !== 'sent') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

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

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      await requestOtp(email);
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
      setStep('sent');
    });
  }

  function resendLink() {
    run(async () => {
      await requestOtp(email);
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    });
  }

  function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    run(() => completeProfile(name, avatar));
  }

  const cb = s.authCallback;

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="logo">
          LEGENDS<span>CLASH</span>
        </h1>
        <p className="tagline">Duelo de cartas em tempo real — partidas de ~10 minutos, justas e sociais.</p>

        {cb?.status === 'pending' && (
          <div className="login-callback">
            <div className="spinner" />
            <p className="login-step-info">Validando seu link de acesso…</p>
          </div>
        )}

        {cb?.status === 'error' && (
          <div className="login-callback">
            <div className="sent-icon">⛓️‍💥</div>
            <p className="form-error">{cb.message}</p>
            <button
              className="btn primary"
              onClick={() => {
                dismissAuthCallback();
                setError(null);
                setStep('email');
              }}
            >
              Pedir um novo link
            </button>
          </div>
        )}

        {!cb && step === 'email' && (
          <form onSubmit={submitEmail}>
            <label>
              E-mail
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                autoFocus
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              {busy ? 'Enviando…' : 'Receber link de acesso'}
            </button>
            <p className="login-note">Sem senha: enviamos um link mágico para o seu e-mail a cada login.</p>
            <p className="login-note credits">
              Arte das cartas: ícones de{' '}
              <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>{' '}
              (CC BY 3.0)
            </p>
          </form>
        )}

        {!cb && step === 'sent' && (
          <div className="login-sent">
            <div className="sent-icon">📨</div>
            <p className="login-step-info">
              Enviamos um link de acesso para <strong>{email}</strong>.
            </p>
            <p className="login-note">
              Abra seu e-mail neste dispositivo e toque no link para entrar. Ele vale por 10 minutos.
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="login-links">
              <button
                type="button"
                className="btn small ghost"
                disabled={busy || resendIn > 0}
                onClick={resendLink}
              >
                {resendIn > 0 ? `Reenviar link (${resendIn}s)` : 'Reenviar link'}
              </button>
              <button
                type="button"
                className="btn small ghost"
                disabled={busy}
                onClick={() => { setError(null); setStep('email'); }}
              >
                Trocar e-mail
              </button>
            </div>
            <p className="login-note">Não chegou? Confira a caixa de spam.</p>
          </div>
        )}

        {!cb && step === 'profile' && (
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
            <div className="avatar-picker">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={a === avatar ? 'avatar selected' : 'avatar'}
                  onClick={() => setAvatar(a)}
                >
                  {a}
                </button>
              ))}
            </div>
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
