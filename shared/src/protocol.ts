import type {
  ChatMessage, GameView, LeaderboardEntry, MatchHistoryEntry,
  MatchResult, Profile, RoomState, Target,
} from './types.js';

// ─── Mensagens cliente → servidor ───────────────────────────────

export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'profile:update'; name?: string; avatar?: string; commander?: string; accent?: string }
  // keepalive do cliente: detecta conexão morta e mantém NAT/proxy abertos
  | { t: 'ping' }
  | { t: 'queue:join' }
  | { t: 'queue:leave' }
  | { t: 'room:create' }
  | { t: 'room:join'; code: string }
  | { t: 'room:leave' }
  | { t: 'room:start' }
  | { t: 'chat:send'; text: string }
  // provocação tipada: só ids do catálogo TAUNTS; cooldown aplicado no servidor
  | { t: 'chat:taunt'; id: string }
  | { t: 'chat:mute'; playerId: string }
  | { t: 'chat:unmute'; playerId: string }
  | { t: 'chat:report'; playerId: string; reason: string }
  | { t: 'game:mulligan'; iids: string[] } // cartas a devolver ao baralho na troca inicial
  | { t: 'game:play'; iid: string; target?: Target }
  | { t: 'game:attack'; attackerIid: string; target: Target }
  | { t: 'game:endTurn' }
  | { t: 'game:surrender' }
  | { t: 'leaderboard:get' }
  | { t: 'history:get' };

// ─── Mensagens servidor → cliente ───────────────────────────────

export type ServerMsg =
  | { t: 'hello:ok'; profile: Profile }
  | { t: 'pong' }
  | { t: 'error'; message: string }
  | { t: 'profile'; profile: Profile }
  // waitingAlone: você é o único na fila — sugere convidar um amigo (escape p/ 1ª sessão)
  | { t: 'queue:status'; inQueue: boolean; size: number; waitingAlone?: boolean }
  | { t: 'room:state'; room: RoomState | null }
  // view null = verdade do servidor: você não está em partida (destrava
  // clientes que ficaram com uma batalha fantasma após restart do servidor)
  | { t: 'game:state'; view: GameView | null }
  | { t: 'game:over'; result: MatchResult }
  | { t: 'chat:message'; message: ChatMessage }
  | { t: 'chat:report:ok' }
  // myRank/around: posição do jogador e seus vizinhos por MMR (alvo de subida
  // para quem está fora do top-20) — derivado do mesmo Elo, só apresentação.
  | { t: 'leaderboard'; entries: LeaderboardEntry[]; myRank?: number; around?: LeaderboardEntry[] }
  | { t: 'history'; entries: MatchHistoryEntry[] };
