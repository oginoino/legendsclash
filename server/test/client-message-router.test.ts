import { describe, expect, it, vi } from 'vitest';
import type { Match } from '../src/game/engine.js';
import type { UserRecord } from '../src/store.js';
import {
  ClientMessageRouter,
  type ClientMessageRouterDependencies,
} from '../src/transport/websocket/client-message-router.js';

function setup() {
  const user = {
    id: 'player-1',
    history: [{ matchId: 'match-1' }],
  } as UserRecord;
  const match = {
    finished: false,
    mulligan: vi.fn(),
    setTutorialOpen: vi.fn(),
    playCard: vi.fn(),
    attack: vi.fn(),
    endTurn: vi.fn(),
    surrender: vi.fn(),
  } as unknown as Match;

  const dependencies: ClientMessageRouterDependencies = {
    matchmaking: { join: vi.fn(), leave: vi.fn() },
    rooms: { create: vi.fn(), join: vi.fn(), leave: vi.fn(), start: vi.fn() },
    chat: {
      send: vi.fn(),
      sendTaunt: vi.fn(),
      setMuted: vi.fn(),
      report: vi.fn(),
    },
    social: {
      requestRematch: vi.fn(),
      declineRematch: vi.fn(),
      setFriend: vi.fn(),
      getProfile: vi.fn(),
    },
    updateProfile: vi.fn(),
    startPractice: vi.fn(),
    withMatch: vi.fn((_user, action) => action(match)),
    matchFor: vi.fn(() => match),
    sendLeaderboard: vi.fn(async () => undefined),
    sendTo: vi.fn(),
    pickFaction: vi.fn(),
  };

  return { user, match, dependencies, router: new ClientMessageRouter(dependencies) };
}

describe('ClientMessageRouter', () => {
  it('encaminha perfil, fila, treino e sala sem alterar os payloads', () => {
    const { user, dependencies, router } = setup();

    router.route(user, { t: 'profile:update', name: 'Aurora', frame: 'runes' });
    router.route(user, { t: 'queue:join' });
    router.route(user, { t: 'queue:leave' });
    router.route(user, { t: 'practice:start' });
    router.route(user, { t: 'room:create' });
    router.route(user, { t: 'room:join', code: 'ETHER' });
    router.route(user, { t: 'room:leave' });
    router.route(user, { t: 'room:start' });

    expect(dependencies.updateProfile).toHaveBeenCalledWith(
      user,
      { t: 'profile:update', name: 'Aurora', frame: 'runes' },
    );
    expect(dependencies.matchmaking.join).toHaveBeenCalledWith(user);
    expect(dependencies.matchmaking.leave).toHaveBeenCalledWith(user);
    expect(dependencies.startPractice).toHaveBeenCalledWith(user);
    expect(dependencies.rooms.create).toHaveBeenCalledWith(user);
    expect(dependencies.rooms.join).toHaveBeenCalledWith(user, 'ETHER');
    expect(dependencies.rooms.leave).toHaveBeenCalledWith(user);
    expect(dependencies.rooms.start).toHaveBeenCalledWith(user);
  });

  it('encaminha chat, moderação e continuidade social', () => {
    const { user, dependencies, router } = setup();

    router.route(user, { t: 'chat:send', text: 'Boa partida' });
    router.route(user, { t: 'chat:taunt', id: 'gg' });
    router.route(user, { t: 'chat:mute', playerId: 'player-2' });
    router.route(user, { t: 'chat:unmute', playerId: 'player-2' });
    router.route(user, { t: 'chat:report', playerId: 'player-2', reason: 'spam' });
    router.route(user, { t: 'rematch:request' });
    router.route(user, { t: 'rematch:decline' });
    router.route(user, { t: 'friend:add', playerId: 'player-2' });
    router.route(user, { t: 'friend:remove', playerId: 'player-2' });
    router.route(user, { t: 'profile:get', playerId: 'player-2' });

    expect(dependencies.chat.send).toHaveBeenCalledWith(user, 'Boa partida');
    expect(dependencies.chat.sendTaunt).toHaveBeenCalledWith(user, 'gg');
    expect(dependencies.chat.setMuted).toHaveBeenNthCalledWith(1, user, 'player-2', true);
    expect(dependencies.chat.setMuted).toHaveBeenNthCalledWith(2, user, 'player-2', false);
    expect(dependencies.chat.report).toHaveBeenCalledWith(user, 'player-2', 'spam');
    expect(dependencies.social.requestRematch).toHaveBeenCalledWith(user);
    expect(dependencies.social.declineRematch).toHaveBeenCalledWith(user);
    expect(dependencies.social.setFriend).toHaveBeenNthCalledWith(1, user, 'player-2', true);
    expect(dependencies.social.setFriend).toHaveBeenNthCalledWith(2, user, 'player-2', false);
    expect(dependencies.social.getProfile).toHaveBeenCalledWith(user, 'player-2');
  });

  it('encaminha todas as ações de partida para a partida autenticada', () => {
    const { user, match, router } = setup();

    router.route(user, { t: 'game:mulligan', iids: ['card-1'] });
    router.route(user, { t: 'game:tutorial', open: true });
    router.route(user, { t: 'game:play', iid: 'card-2', target: { seat: 1, iid: 'enemy-1' } });
    router.route(user, { t: 'game:attack', attackerIid: 'ally-1', target: { seat: 1 } });
    router.route(user, { t: 'game:endTurn' });
    router.route(user, { t: 'game:surrender' });

    expect(match.mulligan).toHaveBeenCalledWith(user.id, ['card-1']);
    expect(match.setTutorialOpen).toHaveBeenCalledWith(user.id, true);
    expect(match.playCard).toHaveBeenCalledWith(user.id, 'card-2', { seat: 1, iid: 'enemy-1' });
    expect(match.attack).toHaveBeenCalledWith(user.id, 'ally-1', { seat: 1 });
    expect(match.endTurn).toHaveBeenCalledWith(user.id);
    expect(match.surrender).toHaveBeenCalledWith(user.id);
  });

  it('ignora tutorial idempotente sem partida ativa', () => {
    const { user, match, dependencies, router } = setup();
    Object.defineProperty(match, 'finished', { value: true });

    router.route(user, { t: 'game:tutorial', open: false });

    expect(dependencies.matchFor).toHaveBeenCalledWith(user.id);
    expect(match.setTutorialOpen).not.toHaveBeenCalled();
  });

  it('encaminha ranking, histórico e tradição', () => {
    const { user, dependencies, router } = setup();

    router.route(user, { t: 'leaderboard:get' });
    router.route(user, { t: 'history:get' });
    router.route(user, { t: 'faction:pick', factionId: 'eter' });

    expect(dependencies.sendLeaderboard).toHaveBeenCalledWith(user);
    expect(dependencies.sendTo).toHaveBeenCalledWith(user.id, {
      t: 'history',
      entries: user.history,
    });
    expect(dependencies.pickFaction).toHaveBeenCalledWith(user, 'eter');
  });
});
