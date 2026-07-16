import type { ClientMsg, ServerMsg } from '@legendsclash/shared';
import type { AppState, AppStateAction } from '../state/app-state';
import { preloadProfilePhoto } from '../preload';

export interface ServerMessageHandlerDependencies {
  getState(): AppState;
  dispatch(action: AppStateAction): void;
  send(message: ClientMsg): void;
  showToast(message: string): void;
  logout(): void;
  rememberActiveMatch(matchId: string | null): void;
  persistFaction(factionId: string): void;
  joinPendingRoom(): void;
}

/** Maps protocol messages to state actions and the few required browser effects. */
export function createServerMessageHandler(dependencies: ServerMessageHandlerDependencies) {
  return (message: ServerMsg): void => {
    const state = dependencies.getState();

    switch (message.t) {
      case 'hello:ok': {
        const persistedFaction = message.profile.faction ?? '';
        const legacyFaction = state.faction;
        const faction = persistedFaction || legacyFaction;
        dependencies.persistFaction(faction);
        dependencies.dispatch({
          type: 'server/hello',
          profile: message.profile,
          factionsEnabled: !!message.content?.factions,
          cosmeticsEnabled: !!message.content?.cosmetics,
          faction,
        });
        dependencies.send({ t: 'leaderboard:get' });
        dependencies.send({ t: 'history:get' });
        // Pre-carrega a foto do avatar para evitar flash na tela inicial
        preloadProfilePhoto(message.profile.photo);
        // Migra uma escolha antiga do dispositivo para o perfil persistido.
        if (!persistedFaction && legacyFaction) {
          dependencies.send({ t: 'faction:pick', factionId: legacyFaction });
        }
        dependencies.joinPendingRoom();
        break;
      }
      case 'pong':
        break; // o transporte já registrou o sinal de vida
      case 'error':
        if (message.message === 'Sessão expirada. Entre novamente.') {
          dependencies.logout();
          break;
        }
        dependencies.showToast(message.message);
        break;
      case 'profile':
        dependencies.persistFaction(message.profile.faction ?? '');
        dependencies.dispatch({
          type: 'server/profile',
          profile: message.profile,
          faction: message.profile.faction ?? '',
        });
        preloadProfilePhoto(message.profile.photo);
        break;
      case 'queue:status':
        dependencies.dispatch({
          type: 'server/queue-status',
          inQueue: message.inQueue,
          queueSize: message.size,
          waitingAlone: !!message.waitingAlone,
        });
        break;
      case 'room:state':
        dependencies.dispatch({ type: 'server/room-state', room: message.room });
        break;
      case 'game:state':
        if (!message.view) {
          // A verdade do servidor destrava uma batalha fantasma após restart.
          const interrupted = !!state.game && !state.gameOver;
          dependencies.rememberActiveMatch(null);
          dependencies.dispatch({ type: 'server/game-state', game: null });
          if (interrupted) {
            dependencies.showToast('A partida anterior foi encerrada no servidor.');
          }
          break;
        }
        dependencies.rememberActiveMatch(
          message.view.status === 'finished' ? null : message.view.matchId,
        );
        dependencies.dispatch({ type: 'server/game-state', game: message.view });
        break;
      case 'game:over':
        dependencies.rememberActiveMatch(null);
        dependencies.dispatch({ type: 'server/game-over', result: message.result });
        dependencies.send({ t: 'leaderboard:get' });
        dependencies.send({ t: 'history:get' });
        break;
      case 'chat:message':
        dependencies.dispatch({ type: 'server/chat-message', message: message.message });
        break;
      case 'chat:report:ok':
        dependencies.dispatch({ type: 'server/report-sent' });
        dependencies.showToast(
          'Denúncia registrada. Obrigado por ajudar a manter a comunidade saudável.',
        );
        break;
      case 'leaderboard':
        dependencies.dispatch({
          type: 'server/leaderboard',
          entries: message.entries,
          myRank: message.myRank ?? null,
          around: message.around ?? [],
        });
        break;
      case 'history':
        dependencies.dispatch({ type: 'server/history', entries: message.entries });
        break;
      case 'rematch:state':
        dependencies.dispatch({
          type: 'server/rematch',
          rematch: { status: message.status, from: message.from },
        });
        if (message.status === 'unavailable') {
          dependencies.showToast('Oponente indisponível para a revanche.');
        }
        if (message.status === 'declined') {
          dependencies.showToast('O oponente recusou a revanche.');
        }
        break;
      case 'profile:view':
        dependencies.dispatch({ type: 'server/profile-view', profile: message.profile });
        break;
    }
  };
}
