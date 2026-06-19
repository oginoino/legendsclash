import type { CardType } from './cards.js';

// ─── Identidade e perfil ────────────────────────────────────────

export type League = 'Bronze' | 'Prata' | 'Ouro';

export interface Profile {
  id: string;
  name: string;
  email: string; // vazio em convidados
  avatar: string; // id do ícone escolhido pelo jogador (perfil/listas/chat)
  commander: string; // id do retrato do comandante exibido na arena
  accent: string; // cor-base de destaque do comandante (hex)
  /** Foto de perfil enviada pelo jogador (URL ou data-URL); null = sem foto. */
  photo: string | null;
  /** Moldura decorativa sobre o avatar/retrato (id em FRAMES). */
  frame: string;
  /** Estilo de cor do realce (sólido/gradiente/brilho — id em ACCENT_STYLES). */
  accentStyle: string;
  /** Convidado: joga sem cadastro, mas chat/histórico/ranking pedem conta. */
  guest: boolean;
  mmr: number;
  league: League;
  wins: number;
  losses: number;
  /** Dias consecutivos com partida (gancho de retorno). */
  streak: number;
  /** Já jogou hoje? (missão do dia cumprida) */
  playedToday: boolean;
  /** Conquistas obtidas (ids) — desbloqueiam cosméticos por mérito. */
  achievements: string[];
  muted: string[]; // ids de jogadores silenciados por este usuário
  /** Amigos adicionados (ids) — quem você enfrentou e quis manter por perto. */
  friends: string[];
}

/**
 * Visão pública de um jogador (card de perfil do oponente). Sem e-mail nem
 * lista de silenciados — mesma disciplina de redação das visões de jogo.
 */
export interface PublicProfile {
  id: string;
  name: string;
  avatar: string;
  commander: string;
  accent: string;
  photo: string | null;
  frame: string;
  accentStyle: string;
  league: League;
  mmr: number;
  wins: number;
  losses: number;
  achievements: string[];
  streak: number;
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
  /** Foto de perfil (opcional) — a lista mostra o ícone quando ausente. */
  photo?: string | null;
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
  photo?: string | null;
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
  commander: string; // id do retrato do comandante na arena
  accent: string; // cor-base de destaque do comandante (hex)
  photo: string | null; // foto de perfil (visível ao oponente) ou null
  frame: string; // moldura decorativa (id em FRAMES)
  accentStyle: string; // estilo de cor do realce (id em ACCENT_STYLES)
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
  /** Fase de mulligan: este assento já confirmou a mão inicial. */
  mulliganDone: boolean;
}

export interface GameView {
  matchId: string;
  yourSeat: number;
  turnSeat: number;
  turnNumber: number;
  turnEndsAt: number; // epoch ms — temporizador autoritativo do servidor
  seats: SeatView[];
  hand: CardInHand[];
  /** 'mulligan' = fase de troca da mão inicial, antes do turno 1. */
  status: 'mulligan' | 'active' | 'finished';
  log: GameLogEntry[];
  /** Últimas cartas jogadas (informação pública para os dois lados). */
  plays: PlayedCard[];
}

export interface GameLogEntry {
  at: number;
  text: string;
}

/** Carta jogada (pública) — alimenta a revelação de jogadas do oponente. */
export interface PlayedCard {
  seat: number;
  cardId: string;
  at: number;
}

/** Estatísticas agregadas da partida, por jogador (alimenta o recap pós-jogo). */
export interface MatchStats {
  creaturesSummoned: number;
  spellsCast: number;
  /** Dano causado ao comandante inimigo (o que decide a partida). */
  damageDealt: number;
  /** Dano que o escudo deste jogador absorveu antes da vida. */
  shieldAbsorbed: number;
}

/** Criatura "MVP": a que mais causou dano em combate (desempate por abates). */
export interface MatchMvp {
  defId: string;
  damage: number;
  kills: number;
}

export interface MatchResult {
  matchId: string;
  winnerId: string;
  reason: MatchEndReason;
  turns: number;
  durationMs: number;
  mmr: Record<string, { before: number; after: number; delta: number; league: League }>;
  /** Conquistas recém-obtidas nesta partida, por jogador (celebração no fim). */
  unlocked?: Record<string, string[]>;
  /** Estatísticas da partida por jogador (recap). Opcional ⇒ compatível pra trás. */
  stats?: Record<string, MatchStats>;
  /** Carta MVP por jogador (pode ser null se ninguém atacou). */
  mvp?: Record<string, MatchMvp | null>;
}

/** Alvo de uma carta ou ataque: assento + (opcional) criatura; sem iid = comandante. */
export interface Target {
  seat: number;
  iid?: string;
}

export interface ChatMessage {
  from: { id: string; name: string; avatar: string; photo?: string | null };
  text: string; // já passou pelo filtro de palavras do servidor
  at: number;
}

export type { CardType };
