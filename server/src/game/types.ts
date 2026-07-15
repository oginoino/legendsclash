import type {
  CombatAction,
  GameLogEntry,
  MatchEndReason,
  MatchMvp,
  MatchStats,
} from '@legendsclash/shared';

export interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  commander: string;
  accent: string;
  photo: string | null;
  frame: string;
  accentStyle: string;
  mmr: number;
  /** So a primeira partida pode solicitar a pausa de onboarding. */
  tutorialEligible?: boolean;
}

export interface CardInstance {
  iid: string;
  defId: string;
}

export interface Creature extends CardInstance {
  attack: number;
  health: number;
  baseHealth: number;
  canAttack: boolean;
  attacked: boolean;
  /** Resistencia: bonus de ataque ativo enquanto o dono esta em <=10 de vida. */
  comebackOn?: boolean;
  /** Escudo Arcano: anula o proximo dano que a criatura sofreria. */
  ward?: boolean;
}

export interface Seat {
  player: MatchPlayer;
  hp: number;
  shield: number;
  energy: number;
  maxEnergy: number;
  deck: CardInstance[];
  hand: CardInstance[];
  board: Creature[];
  artifacts: string[];
  attackBonus: number;
  spellBonus: number;
  regen: number;
  shieldRegen: number;
  fatigue: number;
  connected: boolean;
  out: boolean;
  mulliganDone: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectDeadline: number | null;
  stats: MatchStats;
  creatureLog: Map<string, { defId: string; dmg: number; kills: number }>;
}

/** Estado persistivel de um assento, sem timer nem socket. */
export interface SeatSnapshot {
  player: MatchPlayer;
  hp: number;
  shield: number;
  energy: number;
  maxEnergy: number;
  deck: CardInstance[];
  hand: CardInstance[];
  board: Creature[];
  artifacts: string[];
  attackBonus: number;
  spellBonus: number;
  regen: number;
  shieldRegen: number;
  fatigue: number;
  out: boolean;
  mulliganDone: boolean;
  reconnectDeadline: number | null;
  stats: MatchStats;
  creatureLog: Array<[string, { defId: string; dmg: number; kills: number }]>;
}

/** Conteudo variavel da partida: faccao por jogador e carta de Resistencia. */
export interface MatchContent {
  factions?: Record<string, string>;
  comeback?: boolean;
}

/** Partida serializada para sobreviver a troca de processo. */
export interface MatchSnapshot {
  id: string;
  startedAt: number;
  status: 'mulligan' | 'active';
  turnSeat: number;
  turnNumber: number;
  turnSeconds: number;
  turnTimeLeftMs?: number;
  tutorialOpenPlayerIds?: string[];
  useMulligan: boolean;
  botIds: string[];
  content: MatchContent;
  seats: SeatSnapshot[];
  log: GameLogEntry[];
  plays: Array<{ seat: number; cardId: string; at: number }>;
  actions?: CombatAction[];
  actionSeq?: number;
}

export interface EngineResult {
  winnerSeat: number;
  reason: MatchEndReason;
  turns: number;
  durationMs: number;
  stats: MatchStats[];
  mvp: (MatchMvp | null)[];
}
