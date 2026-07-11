import { resumeHere, useAppState } from './store';
import { LoginView } from './views/LoginView';
import { HomeView } from './views/HomeView';
import { RoomView } from './views/RoomView';
import { GameView } from './views/GameView';
import { PlayerProfileCard } from './components/PlayerProfile';

export function App() {
  const s = useAppState();

  let view;
  // link mágico de redefinição tem precedência (mesmo logado, troca a senha)
  if (s.resetToken) view = <LoginView />;
  // sem sessão, onboarding pendente (nome vazio) ou convidado criando conta
  else if (!s.token || s.accountPrompt || (s.profile && !s.profile.name)) view = <LoginView />;
  else if (s.recoveringGame && !s.game) view = (
    <main className="match-recovery-screen" role="status" aria-live="polite">
      <div className="match-recovery-sigil" aria-hidden="true"><span /></div>
      <span className="match-recovery-kicker">Conexão protegida</span>
      <h1>Retomando seu Embate</h1>
      <p>Sua vaga permanece reservada enquanto restauramos a arena.</p>
      <div className="match-recovery-progress"><span /></div>
    </main>
  );
  else if (s.game) view = <GameView />;
  else if (s.room) view = <RoomView />;
  else view = <HomeView />;

  return (
    <>
      {view}
      <PlayerProfileCard />
      {s.toast && <div className="toast">{s.toast}</div>}
      {s.token && !s.connected && !s.recoveringGame && (s.replaced ? (
        <div className="conn-banner">
          O jogo foi aberto em outra aba ou dispositivo.{' '}
          <button type="button" onClick={resumeHere}>Jogar nesta aba</button>
        </div>
      ) : (
        <div className="conn-banner">Reconectando ao servidor…</div>
      ))}
    </>
  );
}
