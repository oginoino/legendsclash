import { useAppState } from './store';
import { LoginView } from './views/LoginView';
import { HomeView } from './views/HomeView';
import { RoomView } from './views/RoomView';
import { GameView } from './views/GameView';

export function App() {
  const s = useAppState();

  let view;
  if (!s.token) view = <LoginView />;
  else if (s.game) view = <GameView />;
  else if (s.room) view = <RoomView />;
  else view = <HomeView />;

  return (
    <>
      {view}
      {s.toast && <div className="toast">{s.toast}</div>}
      {s.token && !s.connected && (
        <div className="conn-banner">Reconectando ao servidor…</div>
      )}
    </>
  );
}
