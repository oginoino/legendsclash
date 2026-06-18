import type {
  ChatMessage, GameView, LeaderboardEntry, MatchHistoryEntry,
  MatchResult, Profile, RoomState, Target,
} from './types.js';

// ─── Mensagens cliente → servidor ───────────────────────────────

export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'profile:update'; name?: string; avatar?: string; commander?: string; accent?: string }
  | { t: 'queue:join' }
  | { t: 'queue:leave' }
  | { t: 'room:create' }
  | { t: 'room:join'; code: string }
  | { t: 'room:leave' }
  | { t: 'room:start' }
  | { t: 'chat:send'; text: string }
  | { t: 'chat:mute'; playerId: string }
  | { t: 'chat:unmute'; playerId: string }
  | { t: 'chat:report'; playerId: string; reason: string }
  | { t: 'game:play'; iid: string; target?: Target }
  | { t: 'game:attack'; attackerIid: string; target: Target }
  | { t: 'game:endTurn' }
  | { t: 'game:surrender' }
  | { t: 'leaderboard:get' }
  | { t: 'history:get' };

// ─── Mensagens servidor → cliente ───────────────────────────────

export type ServerMsg =
  | { t: 'hello:ok'; profile: Profile }
  | { t: 'error'; message: string }
  | { t: 'profile'; profile: Profile }
  | { t: 'queue:status'; inQueue: boolean; size: number }
  | { t: 'room:state'; room: RoomState | null }
  | { t: 'game:state'; view: GameView }
  | { t: 'game:over'; result: MatchResult }
  | { t: 'chat:message'; message: ChatMessage }
  | { t: 'chat:report:ok' }
  | { t: 'leaderboard'; entries: LeaderboardEntry[] }
  | { t: 'history'; entries: MatchHistoryEntry[] };
