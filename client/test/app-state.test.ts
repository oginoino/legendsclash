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

const game = { matchId: 'match-1' } as NonNullable<AppState['game']>;
const nextGame = { matchId: 'match-2' } as NonNullable<AppState['game']>;
const gameOver = { matchId: 'match-1' } as NonNullable<AppState['gameOver']>;
const historyEntry = { matchId: 'match-1' } as AppState['history'][number];
const leaderboardEntry = { id: 'rank-1' } as AppState['leaderboard'][number];
const viewedProfile = { id: 'player-2', name: 'Selene' } as NonNullable<AppState['viewedProfile']>;

function chatMessage(index: number): AppState['chat'][number] {
  return {
    from: { id: 'player-2', name: 'Selene', avatar: 'mage' },
    text: `Mensagem ${index}`,
    at: index,
  };
}

const firstChatMessage = chatMessage(1);

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
        chat: [firstChatMessage],
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
        chat: [firstChatMessage],
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

  it('aplica identidade, conteúdo e fila recebidos do servidor', () => {
    let state = appStateReducer(initialState(), {
      type: 'server/hello',
      profile,
      factionsEnabled: true,
      cosmeticsEnabled: true,
      faction: 'feiticeiro',
    });

    expect(state).toMatchObject({
      connected: true,
      profile,
      factionsEnabled: true,
      cosmeticsEnabled: true,
      faction: 'feiticeiro',
    });

    const updatedProfile = { ...profile, name: 'Aurelia Prime', faction: 'guardiao' };
    state = appStateReducer(state, {
      type: 'server/profile',
      profile: updatedProfile,
      faction: 'guardiao',
    });
    state = appStateReducer(state, {
      type: 'server/queue-status',
      inQueue: true,
      queueSize: 4,
      waitingAlone: false,
    });

    expect(state).toMatchObject({
      profile: updatedProfile,
      faction: 'guardiao',
      inQueue: true,
      queueSize: 4,
      waitingAlone: false,
    });
  });

  it('preserva o chat na mesma sala e limpa ao trocar de sala', () => {
    const previous = appStateReducer(initialState(), {
      type: 'patch',
      patch: {
        room: { code: 'ABCD', members: [], seats: 2 },
        chat: [firstChatMessage],
      },
    });
    const sameRoom = appStateReducer(previous, {
      type: 'server/room-state',
      room: { code: 'ABCD', members: [], seats: 2 },
    });
    const nextRoom = appStateReducer(sameRoom, {
      type: 'server/room-state',
      room: { code: 'EFGH', members: [], seats: 2 },
    });

    expect(sameRoom.chat).toBe(previous.chat);
    expect(nextRoom.room?.code).toBe('EFGH');
    expect(nextRoom.chat).toEqual([]);
  });

  it('limpa contexto transitório somente ao entrar em outra partida', () => {
    const previous = appStateReducer(initialState(), {
      type: 'patch',
      patch: {
        game,
        gameOver,
        chat: [firstChatMessage],
        rematch: { status: 'incoming' },
        inQueue: true,
        room: { code: 'ABCD', members: [], seats: 2 },
        recoveringGame: true,
      },
    });
    const sameMatch = appStateReducer(previous, {
      type: 'server/game-state',
      game,
    });
    const anotherMatch = appStateReducer(previous, {
      type: 'server/game-state',
      game: nextGame,
    });

    expect(sameMatch).toMatchObject({
      game,
      gameOver,
      chat: [firstChatMessage],
      rematch: { status: 'incoming' },
      inQueue: false,
      room: null,
      recoveringGame: false,
    });
    expect(anotherMatch).toMatchObject({
      game: nextGame,
      gameOver: null,
      chat: [],
      rematch: null,
      inQueue: false,
      room: null,
      recoveringGame: false,
    });
  });

  it('remove batalha ausente sem apagar um resultado ainda aberto', () => {
    const active = appStateReducer(initialState(), {
      type: 'patch',
      patch: { game, chat: [firstChatMessage], recoveringGame: true },
    });
    const interrupted = appStateReducer(active, {
      type: 'server/game-state',
      game: null,
    });
    const finished = appStateReducer(active, {
      type: 'server/game-over',
      result: gameOver,
    });
    const resultOpen = appStateReducer(active, {
      type: 'patch',
      patch: { gameOver },
    });
    const resultPreserved = appStateReducer(resultOpen, {
      type: 'server/game-state',
      game: null,
    });

    expect(interrupted).toMatchObject({ game: null, chat: [], recoveringGame: false });
    expect(finished).toMatchObject({ game, gameOver, recoveringGame: false });
    expect(resultPreserved).toMatchObject({
      game,
      gameOver,
      chat: [firstChatMessage],
      recoveringGame: false,
    });
  });

  it('limita o chat e aplica snapshots sociais sem mutar o estado anterior', () => {
    const messages = Array.from({ length: 100 }, (_, index) => chatMessage(index));
    const previous = appStateReducer(initialState(), {
      type: 'patch',
      patch: { chat: messages },
    });
    const incoming = chatMessage(100);
    let next = appStateReducer(previous, {
      type: 'server/chat-message',
      message: incoming,
    });
    next = appStateReducer(next, { type: 'server/report-sent' });
    next = appStateReducer(next, {
      type: 'server/leaderboard',
      entries: [leaderboardEntry],
      myRank: 21,
      around: [leaderboardEntry],
    });
    next = appStateReducer(next, { type: 'server/history', entries: [historyEntry] });
    next = appStateReducer(next, {
      type: 'server/rematch',
      rematch: { status: 'incoming', from: { id: 'player-2', name: 'Selene', avatar: 'mage' } },
    });
    next = appStateReducer(next, {
      type: 'server/profile-view',
      profile: viewedProfile,
    });

    expect(previous.chat).toHaveLength(100);
    expect(next.chat).toHaveLength(100);
    expect(next.chat[0]).toEqual(chatMessage(1));
    expect(next.chat[99]).toBe(incoming);
    expect(next).toMatchObject({
      reportSent: true,
      leaderboard: [leaderboardEntry],
      myRank: 21,
      around: [leaderboardEntry],
      history: [historyEntry],
      rematch: { status: 'incoming' },
      viewedProfile,
    });
  });
});
