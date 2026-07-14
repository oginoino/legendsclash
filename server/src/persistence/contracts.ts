import type { League, MatchHistoryEntry } from '@legendsclash/shared';

export interface UserRecord {
  id: string;
  /** Vazio em convidados. */
  email: string;
  /** Vazio = onboarding pendente: o jogador ainda não escolheu nome/avatar. */
  name: string;
  avatar: string;
  /** Retrato do comandante na arena e cor de destaque (personalização). */
  commander: string;
  accent: string;
  /** Foto de perfil (URL no Storage ou data-URL no modo local); null = sem foto. */
  photo: string | null;
  /** Moldura decorativa (id em FRAMES). */
  frame: string;
  /** Estilo de cor do realce (id em ACCENT_STYLES). */
  accentStyle: string;
  /** Capa pública do perfil/card social (id em PROFILE_COVERS). */
  profileCover: string;
  /** Tradição pública e inclinação de deck; vazio = neutro. */
  faction: string;
  /** Vínculo com auth.users do Supabase (login por senha). Null em convidados/contas legadas/modo local. */
  authUserId: string | null;
  /**
   * Convidado: existe só em memória (nunca persiste, não entra no ranking,
   * não acumula histórico). Some quando a sessão expira ou no restart.
   */
  guest: boolean;
  mmr: number;
  /** Liga persistida no Supabase; no modo local pode ser derivada do MMR. */
  league?: League;
  wins: number;
  losses: number;
  muted: string[];
  /** Amigos adicionados (ids) — continuidade social pós-partida. */
  friends: string[];
  history: MatchHistoryEntry[];
  createdAt: number;
  /** Sequência de dias consecutivos com partida (gancho de retorno). */
  streak: number;
  /** Último dia (epoch UTC) com partida — base do cálculo da sequência. */
  lastPlayDay: number;
}

/** Sessão de login: o banco guarda só o sha-256 do token entregue ao cliente. */
export interface SessionRecord {
  tokenHash: string;
  playerId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export interface ReportRecord {
  reporterId: string;
  reportedId: string;
  reason: string;
  /** Últimas mensagens do denunciado na sala/partida. */
  context: string;
  at: number;
}

/** Evento de telemetria de produto (funil). Append-only; consultado via SQL. */
export interface EventRecord {
  type: string;
  /** Ator; null em eventos de partida sem ator único. */
  userId: string | null;
  matchId: string | null;
  props: Record<string, unknown>;
  at: number;
}

export interface DbShape {
  users: UserRecord[];
  reports: ReportRecord[];
  sessions: SessionRecord[];
  events: EventRecord[];
}

export interface RankingSnapshot {
  entries: UserRecord[];
  myRank?: number;
  around?: UserRecord[];
}

export interface Persistence {
  load(): Promise<DbShape>;
  /** Leitura fresca do ranking quando o backend suporta consulta persistida. */
  loadRanking?(userId: string, limit: number, span: number): Promise<RankingSnapshot>;
  /** Write-through assíncrono: erros são logados, nunca derrubam a partida. */
  saveUser(user: UserRecord): void;
  saveMatch(userId: string, entry: MatchHistoryEntry): void;
  saveReport(report: ReportRecord): void;
  saveSession(session: SessionRecord): void;
  deleteSession(tokenHash: string): void;
  saveEvent(event: EventRecord): void;
  /**
   * Sobe a foto de perfil e devolve a URL pública. Em prod vai ao Supabase
   * Storage; no modo local devolve a própria data-URL (sem storage externo).
   */
  uploadAvatar(userId: string, bytes: Buffer, contentType: string): Promise<string>;
}
