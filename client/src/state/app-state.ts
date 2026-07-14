import type {
  ChatMessage,
  GameView,
  LeaderboardEntry,
  MatchHistoryEntry,
  MatchResult,
  Profile,
  PublicProfile,
  RoomState,
} from '@legendsclash/shared';

/** Estado da oferta de revanche (pós-partida). */
export interface RematchState {
  status: 'sent' | 'incoming' | 'unavailable' | 'declined';
  from?: { id: string; name: string; avatar: string };
}

/**
 * Estado do cliente + conexão WebSocket. O servidor continua autoritativo;
 * este estado contém apenas o snapshot necessário para apresentação.
 */
export interface AppState {
  token: string | null;
  profile: Profile | null;
  connected: boolean;
  inQueue: boolean;
  queueSize: number;
  /** Você é o único na fila — a UI sugere convidar um amigo. */
  waitingAlone: boolean;
  room: RoomState | null;
  game: GameView | null;
  gameOver: MatchResult | null;
  chat: ChatMessage[];
  leaderboard: LeaderboardEntry[];
  /** Posição do jogador no ranking e vizinhos por MMR (alvo de subida). */
  myRank: number | null;
  around: LeaderboardEntry[];
  history: MatchHistoryEntry[];
  toast: string | null;
  reportSent: boolean;
  /** Convidado pediu a tela de conta sem perder a sessão atual. */
  accountPrompt: boolean;
  /** Conexão assumida por outra aba/dispositivo. */
  replaced: boolean;
  /** Token do link mágico de redefinição. */
  resetToken: string | null;
  rematch: RematchState | null;
  viewedProfile: PublicProfile | null;
  factionsEnabled: boolean;
  cosmeticsEnabled: boolean;
  /** Facção escolhida pelo jogador ('' = neutro). */
  faction: string;
  /** A aba recarregou durante uma partida e aguarda o servidor. */
  recoveringGame: boolean;
}

export interface AppStateBootstrap {
  token: string | null;
  resetToken: string | null;
  faction: string;
  recoveringGame: boolean;
}

export function createInitialAppState({
  token,
  resetToken,
  faction,
  recoveringGame,
}: AppStateBootstrap): AppState {
  return {
    token,
    profile: null,
    connected: false,
    inQueue: false,
    queueSize: 0,
    waitingAlone: false,
    room: null,
    game: null,
    gameOver: null,
    chat: [],
    leaderboard: [],
    myRank: null,
    around: [],
    history: [],
    toast: null,
    reportSent: false,
    accountPrompt: false,
    replaced: false,
    resetToken,
    rematch: null,
    viewedProfile: null,
    factionsEnabled: false,
    cosmeticsEnabled: false,
    faction,
    recoveringGame,
  };
}

export type LocalStateAction =
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'session/adopt'; token: string; profile: Profile | null }
  | { type: 'session/logout' }
  | { type: 'game/dismiss-result' };

export type ServerStateAction =
  | {
    type: 'server/hello';
    profile: Profile;
    factionsEnabled: boolean;
    cosmeticsEnabled: boolean;
    faction: string;
  }
  | { type: 'server/profile'; profile: Profile; faction: string }
  | {
    type: 'server/queue-status';
    inQueue: boolean;
    queueSize: number;
    waitingAlone: boolean;
  }
  | { type: 'server/room-state'; room: RoomState | null }
  | { type: 'server/game-state'; game: GameView | null }
  | { type: 'server/game-over'; result: MatchResult }
  | { type: 'server/chat-message'; message: ChatMessage }
  | { type: 'server/report-sent' }
  | {
    type: 'server/leaderboard';
    entries: LeaderboardEntry[];
    myRank: number | null;
    around: LeaderboardEntry[];
  }
  | { type: 'server/history'; entries: MatchHistoryEntry[] }
  | { type: 'server/rematch'; rematch: RematchState }
  | { type: 'server/profile-view'; profile: PublicProfile };

export type AppStateAction = LocalStateAction | ServerStateAction;

export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'session/adopt':
      return {
        ...state,
        token: action.token,
        profile: action.profile,
        accountPrompt: false,
        connected: false,
        room: null,
        game: null,
        gameOver: null,
        chat: [],
        history: [],
        inQueue: false,
        replaced: false,
      };
    case 'session/logout':
      return {
        ...state,
        token: null,
        profile: null,
        connected: false,
        room: null,
        game: null,
        gameOver: null,
        chat: [],
        inQueue: false,
        history: [],
        accountPrompt: false,
        replaced: false,
        recoveringGame: false,
      };
    case 'game/dismiss-result':
      return {
        ...state,
        game: null,
        gameOver: null,
        chat: [],
        rematch: null,
      };
    case 'server/hello':
      return {
        ...state,
        connected: true,
        profile: action.profile,
        factionsEnabled: action.factionsEnabled,
        cosmeticsEnabled: action.cosmeticsEnabled,
        faction: action.faction,
      };
    case 'server/profile':
      return { ...state, profile: action.profile, faction: action.faction };
    case 'server/queue-status':
      return {
        ...state,
        inQueue: action.inQueue,
        queueSize: action.queueSize,
        waitingAlone: action.waitingAlone,
      };
    case 'server/room-state':
      return {
        ...state,
        room: action.room,
        chat: action.room && state.room?.code === action.room.code ? state.chat : [],
      };
    case 'server/game-state': {
      if (!action.game) {
        return state.game && !state.gameOver
          ? { ...state, game: null, chat: [], recoveringGame: false }
          : { ...state, recoveringGame: false };
      }
      const entering = !state.game || state.game.matchId !== action.game.matchId;
      return {
        ...state,
        game: action.game,
        recoveringGame: false,
        inQueue: false,
        room: null,
        ...(entering ? { chat: [], gameOver: null, rematch: null } : {}),
      };
    }
    case 'server/game-over':
      return { ...state, gameOver: action.result, recoveringGame: false };
    case 'server/chat-message':
      return { ...state, chat: [...state.chat, action.message].slice(-100) };
    case 'server/report-sent':
      return { ...state, reportSent: true };
    case 'server/leaderboard':
      return {
        ...state,
        leaderboard: action.entries,
        myRank: action.myRank,
        around: action.around,
      };
    case 'server/history':
      return { ...state, history: action.entries };
    case 'server/rematch':
      return { ...state, rematch: action.rematch };
    case 'server/profile-view':
      return { ...state, viewedProfile: action.profile };
  }
}
