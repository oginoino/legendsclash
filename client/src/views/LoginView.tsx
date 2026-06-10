import { useEffect, useState } from 'react';
import { completeProfile, requestOtp, useAppState, verifyOtp } from '../store';

const AVATARS = ['🛡️', '⚔️', '🐺', '🐉', '🏹', '🔮', '🦅', '🌙'];

/**
 * Login por código OTP em três passos: e-mail → código de 6 dígitos →
 * perfil (apenas no primeiro acesso). Sem senha: o e-mail é a conta.
 */
type Step = 'email' | 'code' | 'profile';

const RESEND_COOLDOWN_MS = 60_000;

export function LoginView() {
  const s = useAppState();
  const needsProfile = !!(s.token && s.profile && !s.profile.name);
  const [step, setStep] = useState<Step>(needsProfile ? 'profile' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  // sessão restaurada com perfil incompleto: cai direto no passo final
  useEffect(() => {
    if (needsProfile) setStep('profile');
  }, [needsProfile]);

  // relógio do botão "Reenviar código"
  useEffect(() => {
    if (step !== 'code') return;
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
      setCode('');
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
      setStep('code');
    });
  }

  function resendCode() {
    run(async () => {
      await requestOtp(email);
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    });
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const result = await verifyOtp(email, code);
      if (result.needsProfile) setStep('profile');
      // senão o App troca de tela sozinho (token + perfil completos)
    });
  }

  function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    run(() => completeProfile(name, avatar));
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="logo">
          LEGENDS<span>CLASH</span>
        </h1>
        <p className="tagline">Duelo de cartas em tempo real — partidas de ~10 minutos, justas e sociais.</p>

        {step === 'email' && (
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
              {busy ? 'Enviando…' : 'Receber código'}
            </button>
            <p className="login-note">Sem senha: você recebe um código de 6 dígitos por e-mail a cada login.</p>
            <p className="login-note credits">
              Arte das cartas: ícones de{' '}
              <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>{' '}
              (CC BY 3.0)
            </p>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={submitCode}>
            <p className="login-step-info">
              Enviamos um código de 6 dígitos para <strong>{email}</strong>.
            </p>
            <label>
              Código
              <input
                className="otp-input"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="······"
                autoFocus
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy || code.length !== 6}>
              {busy ? 'Validando…' : 'Entrar'}
            </button>
            <div className="login-links">
              <button
                type="button"
                className="btn small ghost"
                disabled={busy || resendIn > 0}
                onClick={resendCode}
              >
                {resendIn > 0 ? `Reenviar código (${resendIn}s)` : 'Reenviar código'}
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
            <p className="login-note">Não chegou? Veja a caixa de spam — o código vale por 10 minutos.</p>
          </form>
        )}

        {step === 'profile' && (
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
