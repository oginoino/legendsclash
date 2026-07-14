import { describe, expect, it } from 'vitest';
import type { MatchHistoryEntry } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
} from '@legendsclash/shared';
import type { EventRecord, ReportRecord, SessionRecord, UserRecord } from '../src/store.js';
import {
  eventRowFromRecord,
  matchHistoryFromRow,
  matchHistoryRowFromEntry,
  playerRowFromUser,
  reportRowFromRecord,
  sessionFromRow,
  sessionRowFromRecord,
  userFromPlayerRow,
  type PlayerRow,
} from '../src/persistence/supabase-mappers.js';

const CREATED_AT = Date.UTC(2026, 6, 10, 12, 30);

function playerRow(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    id: 'player-1',
    email: 'player@example.com',
    name: 'Gino',
    avatar: 'shield',
    mmr: 1000,
    wins: 4,
    losses: 2,
    created_at: new Date(CREATED_AT).toISOString(),
    ...overrides,
  };
}

function userRecord(): UserRecord {
  return {
    id: 'player-1',
    email: 'player@example.com',
    name: 'Gino',
    avatar: 'wizard',
    commander: 'dragon',
    accent: '#4d8dff',
    photo: 'https://example.com/avatar.webp',
    frame: 'gilded',
    accentStyle: 'duotone',
    profileCover: 'archive',
    faction: 'eter',
    authUserId: 'auth-1',
    guest: false,
    mmr: 1320,
    league: 'Ouro',
    wins: 12,
    losses: 7,
    muted: ['muted-1'],
    friends: ['friend-1'],
    history: [],
    createdAt: CREATED_AT,
    streak: 5,
    lastPlayDay: 20_284,
  };
}

describe('mapeadores de persistencia Supabase', () => {
  it('normaliza linhas legadas e completa defaults sem alterar o dominio', () => {
    const user = userFromPlayerRow(playerRow({
      avatar: '\u{1F6E1}\uFE0F',
      commander: null,
      accent: null,
      photo: null,
      frame: null,
      accent_style: null,
      profile_cover: null,
      faction: 'invalida',
      auth_user_id: null,
      mmr: 1250,
      league: 'Diamante',
      muted: null,
      friends: null,
      streak: null,
      last_play_day: null,
    }));

    expect(user).toMatchObject({
      avatar: 'shield',
      commander: 'shield',
      accent: DEFAULT_ACCENT,
      photo: null,
      frame: DEFAULT_FRAME,
      accentStyle: DEFAULT_ACCENT_STYLE,
      profileCover: DEFAULT_PROFILE_COVER,
      faction: '',
      authUserId: null,
      guest: false,
      league: 'Prata',
      muted: [],
      friends: [],
      streak: 0,
      lastPlayDay: 0,
      createdAt: CREATED_AT,
    });
  });

  it('preserva personalizacao, liga persistida e historico carregado', () => {
    const history: MatchHistoryEntry[] = [{
      matchId: 'match-1',
      opponentId: 'player-2',
      opponentName: 'Aline',
      won: true,
      reason: 'hp',
      mmrDelta: 16,
      turns: 18,
      durationMs: 360_000,
      endedAt: CREATED_AT,
    }];
    const user = userFromPlayerRow(playerRow({
      commander: 'dragon',
      accent: '#4d8dff',
      photo: 'https://example.com/avatar.webp',
      frame: 'gilded',
      accent_style: 'duotone',
      profile_cover: 'archive',
      faction: 'vanguarda',
      auth_user_id: 'auth-1',
      mmr: 1200,
      league: 'Ouro',
      muted: ['muted-1'],
      friends: ['friend-1'],
      streak: 5,
      last_play_day: 20_284,
    }), history);

    expect(user).toMatchObject({
      commander: 'dragon',
      accent: '#4d8dff',
      photo: 'https://example.com/avatar.webp',
      frame: 'gilded',
      accentStyle: 'duotone',
      profileCover: 'archive',
      faction: 'vanguarda',
      authUserId: 'auth-1',
      league: 'Ouro',
      muted: ['muted-1'],
      friends: ['friend-1'],
      streak: 5,
      lastPlayDay: 20_284,
    });
    expect(user.history).toBe(history);
  });

  it('converte historico e sessao do banco com timestamps numericos', () => {
    const history = matchHistoryFromRow({
      match_id: 'match-1',
      player_id: 'player-1',
      opponent_id: 'player-2',
      opponent_name: 'Aline',
      won: false,
      reason: 'fatigue',
      mmr_delta: -14,
      turns: 31,
      duration_ms: 620_000,
      ended_at: new Date(CREATED_AT).toISOString(),
    });
    const session = sessionFromRow({
      token_hash: 'token-hash',
      player_id: 'player-1',
      created_at: new Date(CREATED_AT).toISOString(),
      expires_at: new Date(CREATED_AT + 60_000).toISOString(),
      last_seen_at: new Date(CREATED_AT + 30_000).toISOString(),
    });

    expect(history).toEqual({
      matchId: 'match-1',
      opponentId: 'player-2',
      opponentName: 'Aline',
      won: false,
      reason: 'fatigue',
      mmrDelta: -14,
      turns: 31,
      durationMs: 620_000,
      endedAt: CREATED_AT,
    });
    expect(session).toEqual({
      tokenHash: 'token-hash',
      playerId: 'player-1',
      createdAt: CREATED_AT,
      expiresAt: CREATED_AT + 60_000,
      lastSeenAt: CREATED_AT + 30_000,
    });
  });

  it('serializa o jogador no schema atual sem campos somente de memoria', () => {
    expect(playerRowFromUser(userRecord())).toEqual({
      id: 'player-1',
      email: 'player@example.com',
      name: 'Gino',
      avatar: 'wizard',
      commander: 'dragon',
      accent: '#4d8dff',
      photo: 'https://example.com/avatar.webp',
      frame: 'gilded',
      accent_style: 'duotone',
      profile_cover: 'archive',
      faction: 'eter',
      auth_user_id: 'auth-1',
      mmr: 1320,
      wins: 12,
      losses: 7,
      muted: ['muted-1'],
      friends: ['friend-1'],
      created_at: new Date(CREATED_AT).toISOString(),
      streak: 5,
      last_play_day: 20_284,
    });
  });

  it('serializa historico, denuncia, sessao e evento no schema atual', () => {
    const entry: MatchHistoryEntry = {
      matchId: 'match-1',
      opponentId: 'player-2',
      opponentName: 'Aline',
      won: true,
      reason: 'hp',
      mmrDelta: 16,
      turns: 18,
      durationMs: 360_000,
      endedAt: CREATED_AT,
    };
    const report: ReportRecord = {
      reporterId: 'player-1',
      reportedId: 'player-2',
      reason: 'spam',
      context: 'mensagens recentes',
      at: CREATED_AT,
    };
    const session: SessionRecord = {
      tokenHash: 'token-hash',
      playerId: 'player-1',
      createdAt: CREATED_AT,
      expiresAt: CREATED_AT + 60_000,
      lastSeenAt: CREATED_AT + 30_000,
    };
    const event: EventRecord = {
      type: 'match_finished',
      userId: 'player-1',
      matchId: 'match-1',
      props: { won: true },
      at: CREATED_AT,
    };

    expect(matchHistoryRowFromEntry('player-1', entry)).toEqual({
      match_id: 'match-1',
      player_id: 'player-1',
      opponent_id: 'player-2',
      opponent_name: 'Aline',
      won: true,
      reason: 'hp',
      mmr_delta: 16,
      turns: 18,
      duration_ms: 360_000,
      ended_at: new Date(CREATED_AT).toISOString(),
    });
    expect(reportRowFromRecord(report)).toEqual({
      reporter_id: 'player-1',
      reported_id: 'player-2',
      reason: 'spam',
      context: 'mensagens recentes',
      created_at: new Date(CREATED_AT).toISOString(),
    });
    expect(sessionRowFromRecord(session)).toEqual({
      token_hash: 'token-hash',
      player_id: 'player-1',
      created_at: new Date(CREATED_AT).toISOString(),
      expires_at: new Date(CREATED_AT + 60_000).toISOString(),
      last_seen_at: new Date(CREATED_AT + 30_000).toISOString(),
    });
    expect(eventRowFromRecord(event)).toEqual({
      type: 'match_finished',
      user_id: 'player-1',
      match_id: 'match-1',
      props: { won: true },
      created_at: new Date(CREATED_AT).toISOString(),
    });
  });
});
