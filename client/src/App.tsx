import { resumeHere, useAppState } from './store';
import { LoginView } from './views/LoginView';
import { HomeView } from './views/HomeView';
import { RoomView } from './views/RoomView';
import { GameView } from './views/GameView';

export function App() {
  const s = useAppState();

  let view;
  // sem sessão, onboarding pendente (nome vazio) ou convidado criando conta
  if (!s.token || s.accountPrompt || (s.profile && !s.profile.name)) view = <LoginView />;
  else if (s.game) view = <GameView />;
  else if (s.room) view = <RoomView />;
  else view = <HomeView />;

  return (
    <>
      {view}
      {s.toast && <div className="toast">{s.toast}</div>}
      {s.token && !s.connected && (s.replaced ? (
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
