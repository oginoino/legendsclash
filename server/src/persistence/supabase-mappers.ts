import type { League, MatchHistoryEntry } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
  FACTION_TILTS,
  normalizeIconId,
} from '@legendsclash/shared';
import { leagueOf } from '../elo.js';
import type { EventRecord, ReportRecord, SessionRecord, UserRecord } from './contracts.js';

export interface PlayerRow {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  commander?: string | null;
  accent?: string | null;
  photo?: string | null;
  frame?: string | null;
  accent_style?: string | null;
  profile_cover?: string | null;
  faction?: unknown;
  auth_user_id?: string | null;
  mmr: number;
  league?: unknown;
  wins: number;
  losses: number;
  muted?: string[] | null;
  friends?: string[] | null;
  created_at: string;
  streak?: number | null;
  last_play_day?: number | null;
}

export interface MatchHistoryRow {
  match_id: string;
  player_id: string;
  opponent_id: string;
  opponent_name: string;
  won: boolean;
  reason: MatchHistoryEntry['reason'];
  mmr_delta: number;
  turns: number;
  duration_ms: number;
  ended_at: string;
}

export interface SessionRow {
  token_hash: string;
  player_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export function coerceLeague(value: unknown, mmr: number): League {
  return value === 'Bronze' || value === 'Prata' || value === 'Ouro'
    ? value
    : leagueOf(mmr) as League;
}

export function matchHistoryFromRow(row: MatchHistoryRow): MatchHistoryEntry {
  return {
    matchId: row.match_id,
    opponentId: row.opponent_id,
    opponentName: row.opponent_name,
    won: row.won,
    reason: row.reason,
    mmrDelta: row.mmr_delta,
    turns: row.turns,
    durationMs: row.duration_ms,
    endedAt: new Date(row.ended_at).getTime(),
  };
}

export function userFromPlayerRow(
  row: PlayerRow,
  history: MatchHistoryEntry[] = [],
): UserRecord {
  const faction = typeof row.faction === 'string'
    && (row.faction === '' || FACTION_TILTS[row.faction])
    ? row.faction
    : '';

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: normalizeIconId(row.avatar),
    commander: normalizeIconId(row.commander ?? row.avatar),
    accent: row.accent ?? DEFAULT_ACCENT,
    photo: row.photo ?? null,
    frame: row.frame ?? DEFAULT_FRAME,
    accentStyle: row.accent_style ?? DEFAULT_ACCENT_STYLE,
    profileCover: row.profile_cover ?? DEFAULT_PROFILE_COVER,
    faction,
    authUserId: row.auth_user_id ?? null,
    guest: false,
    mmr: row.mmr,
    league: coerceLeague(row.league, row.mmr),
    wins: row.wins,
    losses: row.losses,
    muted: row.muted ?? [],
    friends: row.friends ?? [],
    history,
    createdAt: new Date(row.created_at).getTime(),
    streak: row.streak ?? 0,
    lastPlayDay: row.last_play_day ?? 0,
  };
}

export function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    tokenHash: row.token_hash,
    playerId: row.player_id,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    lastSeenAt: new Date(row.last_seen_at).getTime(),
  };
}

export function playerRowFromUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    commander: user.commander,
    accent: user.accent,
    photo: user.photo,
    frame: user.frame,
    accent_style: user.accentStyle,
    profile_cover: user.profileCover,
    faction: user.faction,
    auth_user_id: user.authUserId,
    mmr: user.mmr,
    wins: user.wins,
    losses: user.losses,
    muted: user.muted,
    friends: user.friends,
    created_at: new Date(user.createdAt).toISOString(),
    streak: user.streak,
    last_play_day: user.lastPlayDay,
  };
}

export function matchHistoryRowFromEntry(userId: string, entry: MatchHistoryEntry) {
  return {
    match_id: entry.matchId,
    player_id: userId,
    opponent_id: entry.opponentId,
    opponent_name: entry.opponentName,
    won: entry.won,
    reason: entry.reason,
    mmr_delta: entry.mmrDelta,
    turns: entry.turns,
    duration_ms: entry.durationMs,
    ended_at: new Date(entry.endedAt).toISOString(),
  };
}

export function reportRowFromRecord(report: ReportRecord) {
  return {
    reporter_id: report.reporterId,
    reported_id: report.reportedId,
    reason: report.reason,
    context: report.context,
    created_at: new Date(report.at).toISOString(),
  };
}

export function sessionRowFromRecord(session: SessionRecord) {
  return {
    token_hash: session.tokenHash,
    player_id: session.playerId,
    created_at: new Date(session.createdAt).toISOString(),
    expires_at: new Date(session.expiresAt).toISOString(),
    last_seen_at: new Date(session.lastSeenAt).toISOString(),
  };
}

export function eventRowFromRecord(event: EventRecord) {
  return {
    type: event.type,
    user_id: event.userId,
    match_id: event.matchId,
    props: event.props,
    created_at: new Date(event.at).toISOString(),
  };
}
