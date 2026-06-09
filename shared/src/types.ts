import type { CardType } from './cards.js';

// ─── Identidade e perfil ────────────────────────────────────────

export type League = 'Bronze' | 'Prata' | 'Ouro';

export interface Profile {
  id: string;
  name: string;
  email: string;
  avatar: string; // emoji escolhido pelo jogador
  mmr: number;
  league: League;
  wins: number;
  losses: number;
  muted: string[]; // ids de jogadores silenciados por este usuário
}

export interface MatchHistoryEntry {
  matchId: string;
  opponentName: string;
  opponentId: string;
  won: boolean;
  reason: MatchEndReason;
  mmrDelta: number;
  turns: number;
  durationMs: number;
  endedAt: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  avatar: string;
  mmr: number;
  league: League;
  wins: number;
  losses: number;
}

// ─── Lobby / salas ──────────────────────────────────────────────

export interface RoomMember {
  id: string;
  name: string;
  avatar: string;
  mmr: number;
  league: League;
  isHost: boolean;
}

export interface RoomState {
  code: string;
  members: RoomMember[];
  /** Salas são modeladas por assentos (arquitetura N-player); o MVP usa 2. */
  seats: number;
}

// ─── Estado de jogo (visão redigida por jogador) ────────────────

export type MatchEndReason = 'hp' | 'surrender' | 'timeout';

export interface CardInHand {
  iid: string; // id da instância
  defId: string;
}

export interface CreatureOnBoard {
  iid: string;
  defId: string;
  attack: number;
  health: number;
  baseHealth: number;
  canAttack: boolean;
}

export interface SeatView {
  playerId: string;
  name: string;
  avatar: string;
  mmr: number;
  hp: number;
  shield: number;
  energy: number;
  maxEnergy: number;
  deckCount: number;
  handCount: number;
  board: CreatureOnBoard[];
  artifacts: string[]; // defIds de artefatos ativos
  attackBonus: number;
  fatigue: number;
  connected: boolean;
  out: boolean;
}

export interface GameView {
  matchId: string;
  yourSeat: number;
  turnSeat: number;
  turnNumber: number;
  turnEndsAt: number; // epoch ms — temporizador autoritativo do servidor
  seats: SeatView[];
  hand: CardInHand[];
  status: 'active' | 'finished';
  log: GameLogEntry[];
}

export interface GameLogEntry {
  at: number;
  text: string;
}

export interface MatchResult {
  matchId: string;
  winnerId: string;
  reason: MatchEndReason;
  turns: number;
  durationMs: number;
  mmr: Record<string, { before: number; after: number; delta: number; league: League }>;
}

/** Alvo de uma carta ou ataque: assento + (opcional) criatura; sem iid = comandante. */
export interface Target {
  seat: number;
  iid?: string;
}

export interface ChatMessage {
  from: { id: string; name: string; avatar: string };
  text: string; // já passou pelo filtro de palavras do servidor
  at: number;
}

export type { CardType };
