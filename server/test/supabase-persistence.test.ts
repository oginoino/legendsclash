import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchHistoryEntry } from '@legendsclash/shared';
import type { EventRecord, ReportRecord, SessionRecord } from '../src/persistence/contracts.js';
import {
  type MatchHistoryRow,
  type PlayerRow,
  type SessionRow,
  userFromPlayerRow,
} from '../src/persistence/supabase-mappers.js';
import { SupabasePersistence } from '../src/persistence/supabase-persistence.js';

interface QueryError {
  message: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

interface QueryCall {
  table: string;
  method: string;
  args: unknown[];
}

class FakeQuery {
  constructor(
    private table: string,
    private result: QueryResult,
    private calls: QueryCall[],
  ) {}

  select(...args: unknown[]) { return this.record('select', args); }
  order(...args: unknown[]) { return this.record('order', args); }
  limit(...args: unknown[]) { return this.record('limit', args); }
  gt(...args: unknown[]) { return this.record('gt', args); }
  lte(...args: unknown[]) { return this.record('lte', args); }
  or(...args: unknown[]) { return this.record('or', args); }
  upsert(...args: unknown[]) { return this.record('upsert', args); }
  insert(...args: unknown[]) { return this.record('insert', args); }
  delete(...args: unknown[]) { return this.record('delete', args); }
  eq(...args: unknown[]) { return this.record('eq', args); }

  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }

  private record(method: string, args: unknown[]): this {
    this.calls.push({ table: this.table, method, args });
    return this;
  }
}

class FakeSupabaseClient {
  readonly calls: QueryCall[] = [];
  readonly upload = vi.fn<(
    path: string,
    body: Buffer,
    options: Record<string, unknown>,
  ) => Promise<QueryResult>>(async () => ({ data: { path: 'avatar.webp' }, error: null }));
  readonly getPublicUrl = vi.fn<(path: string) => { data: { publicUrl: string } }>(
    () => ({ data: { publicUrl: 'https://cdn.example.com/avatar.webp' } }),
  );
  readonly storageFrom = vi.fn((_bucket: string) => ({
    upload: this.upload,
    getPublicUrl: this.getPublicUrl,
  }));
  readonly storage = { from: this.storageFrom };

  private results = new Map<string, QueryResult[]>();

  enqueue(table: string, ...results: QueryResult[]): void {
    const queue = this.results.get(table) ?? [];
    queue.push(...results);
    this.results.set(table, queue);
  }

  from(table: string): FakeQuery {
    const result = this.results.get(table)?.shift() ?? { data: null, error: null };
    return new FakeQuery(table, result, this.calls);
  }

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

const NOW = Date.UTC(2026, 6, 14, 12);
const NOW_ISO = new Date(NOW).toISOString();

function playerRow(
  id: string,
  mmr: number,
  wins = 1,
  losses = 0,
): PlayerRow {
  return {
    id,
    email: `${id}@example.com`,
    name: id.toUpperCase(),
    avatar: 'shield',
    mmr,
    wins,
    losses,
    created_at: NOW_ISO,
  };
}

function historyRow(index: number): MatchHistoryRow {
  return {
    match_id: `match-${index}`,
    player_id: 'player-1',
    opponent_id: `opponent-${index}`,
    opponent_name: `Oponente ${index}`,
    won: index % 2 === 0,
    reason: 'hp',
    mmr_delta: index % 2 === 0 ? 16 : -16,
    turns: 10 + index,
    duration_ms: 120_000 + index,
    ended_at: new Date(NOW - index * 1_000).toISOString(),
  };
}

function sessionRow(): SessionRow {
  return {
    token_hash: 'token-hash',
    player_id: 'player-1',
    created_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    last_seen_at: NOW_ISO,
  };
}

function adapter(fake: FakeSupabaseClient): SupabasePersistence {
  return new SupabasePersistence(
    'https://project.supabase.co',
    'service-role-test-key',
    fake.asClient(),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SupabasePersistence', () => {
  it('carrega dominio, limita historico e agenda limpeza de sessoes expiradas', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fake = new FakeSupabaseClient();
    fake.enqueue('players', { data: [playerRow('player-1', 1180)], error: null });
    fake.enqueue('match_history', {
      data: Array.from({ length: 52 }, (_, index) => historyRow(index)),
      error: null,
    });
    fake.enqueue(
      'sessions',
      { data: [sessionRow()], error: null },
      { data: null, error: null },
    );

    const db = await adapter(fake).load();
    await Promise.resolve();

    expect(db.users).toHaveLength(1);
    expect(db.users[0]).toMatchObject({ id: 'player-1', league: 'Prata' });
    expect(db.users[0].history).toHaveLength(50);
    expect(db.users[0].history[0].matchId).toBe('match-0');
    expect(db.sessions).toEqual([{
      tokenHash: 'token-hash',
      playerId: 'player-1',
      createdAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      lastSeenAt: NOW,
    }]);
    expect(db.reports).toEqual([]);
    expect(db.events).toEqual([]);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { table: 'match_history', method: 'order', args: ['ended_at', { ascending: false }] },
      { table: 'match_history', method: 'limit', args: [5000] },
      { table: 'sessions', method: 'gt', args: ['expires_at', NOW_ISO] },
      { table: 'sessions', method: 'delete', args: [] },
      { table: 'sessions', method: 'lte', args: ['expires_at', NOW_ISO] },
    ]));
  });

  it('preserva filtros, desempates e janela ao carregar o ranking', async () => {
    const fake = new FakeSupabaseClient();
    fake.enqueue('players', {
      data: [
        playerRow('player-1', 1400, 8, 2),
        playerRow('player-2', 1300, 7, 3),
        playerRow('player-3', 1200, 6, 4),
        playerRow('player-4', 1100, 5, 5),
      ],
      error: null,
    });

    const ranking = await adapter(fake).loadRanking('player-3', 2, 1);

    expect(ranking.entries.map((user) => user.id)).toEqual(['player-1', 'player-2']);
    expect(ranking.myRank).toBe(3);
    expect(ranking.around?.map((user) => user.id)).toEqual([
      'player-2',
      'player-3',
      'player-4',
    ]);
    expect(fake.calls.map(({ method, args }) => [method, ...args])).toEqual([
      ['select', '*'],
      ['or', 'wins.gt.0,losses.gt.0'],
      ['order', 'mmr', { ascending: false }],
      ['order', 'wins', { ascending: false }],
      ['order', 'losses', { ascending: true }],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('roteia escritas para as tabelas e operacoes corretas', async () => {
    const fake = new FakeSupabaseClient();
    const persistence = adapter(fake);
    const user = userFromPlayerRow(playerRow('player-1', 1180));
    const match: MatchHistoryEntry = {
      matchId: 'match-1',
      opponentId: 'player-2',
      opponentName: 'PLAYER-2',
      won: true,
      reason: 'hp',
      mmrDelta: 16,
      turns: 18,
      durationMs: 320_000,
      endedAt: NOW,
    };
    const report: ReportRecord = {
      reporterId: 'player-1',
      reportedId: 'player-2',
      reason: 'spam',
      context: 'contexto',
      at: NOW,
    };
    const session: SessionRecord = {
      tokenHash: 'token-hash',
      playerId: 'player-1',
      createdAt: NOW,
      expiresAt: NOW + 60_000,
      lastSeenAt: NOW,
    };
    const event: EventRecord = {
      type: 'match_finished',
      userId: 'player-1',
      matchId: 'match-1',
      props: { won: true },
      at: NOW,
    };

    persistence.saveUser(user);
    persistence.saveMatch('player-1', match);
    persistence.saveReport(report);
    persistence.saveSession(session);
    persistence.deleteSession('token-hash');
    persistence.saveEvent(event);
    await Promise.resolve();

    expect(fake.calls.map(({ table, method }) => [table, method])).toEqual([
      ['players', 'upsert'],
      ['match_history', 'insert'],
      ['reports', 'insert'],
      ['sessions', 'upsert'],
      ['sessions', 'delete'],
      ['sessions', 'eq'],
      ['events', 'insert'],
    ]);
    expect(fake.calls[0].args[0]).toMatchObject({
      id: 'player-1',
      accent_style: 'solid',
      profile_cover: 'aurelia',
    });
    expect(fake.calls[5].args).toEqual(['token_hash', 'token-hash']);
  });

  it('envia avatar ao bucket com upsert e devolve URL com cache busting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fake = new FakeSupabaseClient();
    const bytes = Buffer.from([0, 1, 2]);

    const url = await adapter(fake).uploadAvatar('player-1', bytes, 'image/webp');

    expect(fake.storageFrom).toHaveBeenCalledWith('avatars');
    expect(fake.upload).toHaveBeenCalledWith('player-1.webp', bytes, {
      upsert: true,
      contentType: 'image/webp',
      cacheControl: '3600',
    });
    expect(fake.getPublicUrl).toHaveBeenCalledWith('player-1.webp');
    expect(url).toBe(`https://cdn.example.com/avatar.webp?v=${NOW}`);
  });

  it('propaga erros de leitura e upload com contexto do adaptador', async () => {
    const readFake = new FakeSupabaseClient();
    readFake.enqueue('players', { data: null, error: { message: 'indisponivel' } });
    await expect(adapter(readFake).load()).rejects.toThrow(
      '[store] falha ao carregar players: indisponivel',
    );

    const uploadFake = new FakeSupabaseClient();
    uploadFake.upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'bucket ausente' },
    });
    await expect(adapter(uploadFake).uploadAvatar(
      'player-1',
      Buffer.from([0]),
      'image/png',
    )).rejects.toThrow('upload de avatar falhou: bucket ausente');
  });
});
