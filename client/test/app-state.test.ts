import { describe, expect, it } from 'vitest';
import type { Profile } from '@legendsclash/shared';
import {
  appStateReducer,
  createInitialAppState,
} from '../src/state/app-state';
import type { AppState } from '../src/state/app-state';

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

const game = { matchId: 'match-1' } as AppState['game'];
const gameOver = { matchId: 'match-1' } as AppState['gameOver'];
const chatMessage = { id: 'chat-1' } as AppState['chat'][number];
const historyEntry = { matchId: 'match-1' } as AppState['history'][number];
const leaderboardEntry = { id: 'rank-1' } as AppState['leaderboard'][number];

function initialState() {
  return createInitialAppState({
    token: 'old-token',
    resetToken: null,
    faction: 'guardiao',
    recoveringGame: false,
  });
}

describe('appStateReducer', () => {
  it('cria snapshots iniciais independentes com os dados de bootstrap', () => {
    const first = initialState();
    const second = initialState();

    expect(first).toMatchObject({
      token: 'old-token',
      faction: 'guardiao',
      connected: false,
      recoveringGame: false,
    });
    expect(first.chat).not.toBe(second.chat);
    expect(first.history).not.toBe(second.history);
    expect(first.leaderboard).not.toBe(second.leaderboard);
  });

  it('aplica patches sem alterar o snapshot anterior', () => {
    const previous = initialState();
    const next = appStateReducer(previous, {
      type: 'patch',
      patch: { connected: true, queueSize: 3, waitingAlone: true },
    });

    expect(next).not.toBe(previous);
    expect(next).toMatchObject({ connected: true, queueSize: 3, waitingAlone: true });
    expect(previous).toMatchObject({ connected: false, queueSize: 0, waitingAlone: false });
    expect(next.chat).toBe(previous.chat);
  });

  it('adota uma sessão limpando apenas o contexto da identidade anterior', () => {
    const previous = appStateReducer(initialState(), {
      type: 'patch',
      patch: {
        accountPrompt: true,
        connected: true,
        inQueue: true,
        replaced: true,
        room: { code: 'ABCD', members: [], seats: 2 },
        game,
        gameOver,
        chat: [chatMessage],
        history: [historyEntry],
        leaderboard: [leaderboardEntry],
        recoveringGame: true,
      },
    });

    const next = appStateReducer(previous, {
      type: 'session/adopt',
      token: 'new-token',
      profile,
    });

    expect(next).toMatchObject({
      token: 'new-token',
      profile,
      accountPrompt: false,
      connected: false,
      inQueue: false,
      replaced: false,
      room: null,
      game: null,
      gameOver: null,
      chat: [],
      history: [],
      recoveringGame: true,
    });
    expect(next.leaderboard).toBe(previous.leaderboard);
  });

  it('remove a sessão e preserva preferências e dados públicos já carregados', () => {
    const previous = appStateReducer(initialState(), {
      type: 'patch',
      patch: {
        profile,
        connected: true,
        inQueue: true,
        accountPrompt: true,
        replaced: true,
        recoveringGame: true,
        leaderboard: [leaderboardEntry],
      },
    });

    const next = appStateReducer(previous, { type: 'session/logout' });

    expect(next).toMatchObject({
      token: null,
      profile: null,
      connected: false,
      inQueue: false,
      accountPrompt: false,
      replaced: false,
      recoveringGame: false,
      faction: 'guardiao',
    });
    expect(next.leaderboard).toBe(previous.leaderboard);
  });

  it('fecha o resultado sem apagar identidade e progressão carregadas', () => {
    const previous = appStateReducer(initialState(), {
      type: 'patch',
      patch: {
        profile,
        game,
        gameOver,
        chat: [chatMessage],
        rematch: { status: 'incoming' },
      },
    });

    const next = appStateReducer(previous, { type: 'game/dismiss-result' });

    expect(next).toMatchObject({
      profile,
      game: null,
      gameOver: null,
      chat: [],
      rematch: null,
    });
  });
});
