import { describe, expect, it } from 'vitest';
import type { ClientMsg, Profile } from '@legendsclash/shared';
import { createServerMessageHandler } from '../src/network/server-message-handler';
import { appStateReducer, createInitialAppState } from '../src/state/app-state';
import type { AppState, AppStateAction } from '../src/state/app-state';

const profile: Profile = {
  id: 'player-1',
  name: 'Aurelia',
  email: 'aurelia@example.com',
  avatar: 'dragon',
  commander: 'guardian',
  accent: '#d8af45',
  photo: null,
  frame: 'none',
  accentStyle: 'solid',
  profileCover: 'default',
  faction: 'guardiao',
  guest: false,
  mmr: 1000,
  league: 'Bronze',
  wins: 2,
  losses: 1,
  streak: 2,
  playedToday: true,
  achievements: [],
  muted: [],
  friends: [],
};

const activeGame = {
  matchId: 'match-1',
  status: 'active',
} as NonNullable<AppState['game']>;
const finishedGame = {
  matchId: 'match-1',
  status: 'finished',
} as NonNullable<AppState['game']>;
const gameOver = {
  matchId: 'match-1',
  winnerId: profile.id,
  mmr: {},
} as NonNullable<AppState['gameOver']>;
const chatMessage = {
  from: { id: 'player-2', name: 'Selene', avatar: 'mage' },
  text: 'Boa partida.',
  at: 100,
} as AppState['chat'][number];
const leaderboardEntry = { id: 'rank-1' } as AppState['leaderboard'][number];
const historyEntry = { matchId: 'match-1' } as AppState['history'][number];
const publicProfile = {
  id: 'player-2',
  name: 'Selene',
} as NonNullable<AppState['viewedProfile']>;

function setup(patch: Partial<AppState> = {}) {
  let state: AppState = {
    ...createInitialAppState({
      token: 'session-token',
      resetToken: null,
      faction: 'feiticeiro',
      recoveringGame: false,
    }),
    ...patch,
  };
  const actions: AppStateAction[] = [];
  const sent: ClientMsg[] = [];
  const toasts: string[] = [];
  const activeMatches: Array<string | null> = [];
  const persistedFactions: string[] = [];
  const effects = { logout: 0, joinPendingRoom: 0 };

  const handler = createServerMessageHandler({
    getState: () => state,
    dispatch: (action) => {
      actions.push(action);
      state = appStateReducer(state, action);
    },
    send: (message) => sent.push(message),
    showToast: (message) => toasts.push(message),
    logout: () => { effects.logout += 1; },
    rememberActiveMatch: (matchId) => activeMatches.push(matchId),
    persistFaction: (factionId) => persistedFactions.push(factionId),
    joinPendingRoom: () => { effects.joinPendingRoom += 1; },
  });

  return {
    actions,
    activeMatches,
    effects,
    handler,
    persistedFactions,
    sent,
    state: () => state,
    toasts,
  };
}

describe('ServerMessageHandler', () => {
  it('aplica o handshake e migra a facção legada do dispositivo', () => {
    const context = setup();
    const accountWithoutFaction = { ...profile, faction: '' };

    context.handler({
      t: 'hello:ok',
      profile: accountWithoutFaction,
      content: { factions: true, cosmetics: true },
    });

    expect(context.state()).toMatchObject({
      connected: true,
      profile: accountWithoutFaction,
      faction: 'feiticeiro',
      factionsEnabled: true,
      cosmeticsEnabled: true,
    });
    expect(context.persistedFactions).toEqual(['feiticeiro']);
    expect(context.sent).toEqual([
      { t: 'leaderboard:get' },
      { t: 'history:get' },
      { t: 'faction:pick', factionId: 'feiticeiro' },
    ]);
    expect(context.effects.joinPendingRoom).toBe(1);
  });

  it('prioriza a facção persistida e roteia perfil, fila e sala', () => {
    const context = setup();

    context.handler({ t: 'hello:ok', profile });
    context.handler({ t: 'profile', profile: { ...profile, name: 'Aurelia Prime' } });
    context.handler({ t: 'queue:status', inQueue: true, size: 3 });
    context.handler({
      t: 'room:state',
      room: { code: 'ABCD', members: [], seats: 2 },
    });

    expect(context.state()).toMatchObject({
      profile: { name: 'Aurelia Prime' },
      faction: 'guardiao',
      inQueue: true,
      queueSize: 3,
      waitingAlone: false,
      room: { code: 'ABCD' },
    });
    expect(context.persistedFactions).toEqual(['guardiao', 'guardiao']);
    expect(context.sent).toEqual([{ t: 'leaderboard:get' }, { t: 'history:get' }]);
  });

  it('ignora pong, notifica erros comuns e encerra sessão expirada', () => {
    const context = setup();

    context.handler({ t: 'pong' });
    context.handler({ t: 'error', message: 'Jogada inválida.' });
    context.handler({ t: 'error', message: 'Sessão expirada. Entre novamente.' });

    expect(context.actions).toEqual([]);
    expect(context.toasts).toEqual(['Jogada inválida.']);
    expect(context.effects.logout).toBe(1);
  });

  it('registra partidas ativas e comunica interrupções confirmadas pelo servidor', () => {
    const context = setup();

    context.handler({ t: 'game:state', view: activeGame });
    expect(context.state().game).toBe(activeGame);
    expect(context.activeMatches).toEqual(['match-1']);

    context.handler({ t: 'game:state', view: null });
    expect(context.state().game).toBeNull();
    expect(context.activeMatches).toEqual(['match-1', null]);
    expect(context.toasts).toEqual(['A partida anterior foi encerrada no servidor.']);
  });

  it('preserva um resultado aberto e não mantém ticket de partida finalizada', () => {
    const resultOpen = setup({ game: activeGame, gameOver });
    resultOpen.handler({ t: 'game:state', view: null });

    expect(resultOpen.state().game).toBe(activeGame);
    expect(resultOpen.toasts).toEqual([]);
    expect(resultOpen.activeMatches).toEqual([null]);

    const finished = setup();
    finished.handler({ t: 'game:state', view: finishedGame });
    expect(finished.state().game).toBe(finishedGame);
    expect(finished.activeMatches).toEqual([null]);
  });

  it('aplica o resultado e atualiza os dados competitivos', () => {
    const context = setup({ game: activeGame });

    context.handler({ t: 'game:over', result: gameOver });

    expect(context.state().gameOver).toBe(gameOver);
    expect(context.activeMatches).toEqual([null]);
    expect(context.sent).toEqual([{ t: 'leaderboard:get' }, { t: 'history:get' }]);
  });

  it('roteia chat e confirmação de denúncia com feedback', () => {
    const context = setup();

    context.handler({ t: 'chat:message', message: chatMessage });
    context.handler({ t: 'chat:report:ok' });

    expect(context.state().chat).toEqual([chatMessage]);
    expect(context.state().reportSent).toBe(true);
    expect(context.toasts).toEqual([
      'Denúncia registrada. Obrigado por ajudar a manter a comunidade saudável.',
    ]);
  });

  it('roteia ranking, histórico, revanche e perfil público', () => {
    const context = setup();
    const incoming = { id: 'player-2', name: 'Selene', avatar: 'mage' };

    context.handler({
      t: 'leaderboard',
      entries: [leaderboardEntry],
      myRank: 21,
      around: [leaderboardEntry],
    });
    context.handler({ t: 'history', entries: [historyEntry] });
    context.handler({ t: 'rematch:state', status: 'incoming', from: incoming });
    context.handler({ t: 'rematch:state', status: 'unavailable' });
    context.handler({ t: 'rematch:state', status: 'declined' });
    context.handler({ t: 'profile:view', profile: publicProfile });

    expect(context.state()).toMatchObject({
      leaderboard: [leaderboardEntry],
      myRank: 21,
      around: [leaderboardEntry],
      history: [historyEntry],
      rematch: { status: 'declined' },
      viewedProfile: publicProfile,
    });
    expect(context.toasts).toEqual([
      'Oponente indisponível para a revanche.',
      'O oponente recusou a revanche.',
    ]);
  });
});
