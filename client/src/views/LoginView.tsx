import { useState } from 'react';
import { login } from '../store';

const AVATARS = ['🛡️', '⚔️', '🐺', '🐉', '🏹', '🔮', '🦅', '🌙'];

export function LoginView() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, name, avatar);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="logo">
          LEGENDS<span>CLASH</span>
        </h1>
        <p className="tagline">Duelo de cartas em tempo real — partidas de ~10 minutos, justas e sociais.</p>
        <form onSubmit={submit}>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
              required
            />
          </label>
          <label>
            Nome de jogador
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como quer ser chamado?"
              maxLength={24}
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
          <button className="btn primary" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar e jogar'}
          </button>
          <p className="login-note">Login com Google chega na próxima fase — por enquanto, só o e-mail identifica sua conta.</p>
          <p className="login-note credits">
            Arte das cartas: ícones de{' '}
            <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>{' '}
            (CC BY 3.0)
          </p>
        </form>
      </div>
    </div>
  );
}
