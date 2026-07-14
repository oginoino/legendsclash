import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MatchHistoryEntry } from '@legendsclash/shared';
import type {
  DbShape,
  EventRecord,
  Persistence,
  RankingSnapshot,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './contracts.js';
import {
  eventRowFromRecord,
  matchHistoryFromRow,
  matchHistoryRowFromEntry,
  playerRowFromUser,
  reportRowFromRecord,
  sessionFromRow,
  sessionRowFromRecord,
  userFromPlayerRow,
} from './supabase-mappers.js';

const HISTORY_LIMIT = 50;

/** Adaptador PostgreSQL/Storage usado pelo servidor autoritativo em produção. */
export class SupabasePersistence implements Persistence {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string, client?: SupabaseClient) {
    this.client = client ?? createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async load(): Promise<DbShape> {
    const { data: players, error } = await this.client
      .from('players')
      .select('*');
    if (error) throw new Error(`[store] falha ao carregar players: ${error.message}`);

    const { data: history, error: histErr } = await this.client
      .from('match_history')
      .select('*')
      .order('ended_at', { ascending: false })
      .limit(5000);
    if (histErr) throw new Error(`[store] falha ao carregar histórico: ${histErr.message}`);

    const nowIso = new Date().toISOString();
    const { data: sessions, error: sessErr } = await this.client
      .from('sessions')
      .select('*')
      .gt('expires_at', nowIso);
    if (sessErr) throw new Error(`[store] falha ao carregar sessões: ${sessErr.message}`);

    // Higiene: sessões expiradas saem do banco em segundo plano.
    void this.client
      .from('sessions')
      .delete()
      .lte('expires_at', nowIso)
      .then(({ error: cleanErr }) => {
        if (cleanErr) console.error('[store] limpeza de sessões falhou:', cleanErr.message);
      });

    const byPlayer = new Map<string, MatchHistoryEntry[]>();
    for (const row of history ?? []) {
      const list = byPlayer.get(row.player_id) ?? [];
      if (list.length < HISTORY_LIMIT) {
        list.push(matchHistoryFromRow(row));
      }
      byPlayer.set(row.player_id, list);
    }

    const users: UserRecord[] = (players ?? []).map((row) => (
      userFromPlayerRow(row, byPlayer.get(row.id) ?? [])
    ));
    const sessionRecords: SessionRecord[] = (sessions ?? []).map(sessionFromRow);

    console.log(`[store] Supabase conectado: ${users.length} jogadores, ${sessionRecords.length} sessões ativas`);
    // Denúncias e eventos são write-only para o servidor do jogo (análise por SQL).
    return { users, reports: [], sessions: sessionRecords, events: [] };
  }

  async loadRanking(userId: string, limit: number, span: number): Promise<RankingSnapshot> {
    const { data, error } = await this.client
      .from('players')
      .select('*')
      .or('wins.gt.0,losses.gt.0')
      .order('mmr', { ascending: false })
      .order('wins', { ascending: false })
      .order('losses', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(`[store] falha ao carregar ranking: ${error.message}`);

    const ranked = (data ?? []).map((row) => userFromPlayerRow(row));
    const idx = ranked.findIndex((user) => user.id === userId);
    return {
      entries: ranked.slice(0, limit),
      myRank: idx >= 0 ? idx + 1 : undefined,
      around: idx >= 0 ? ranked.slice(Math.max(0, idx - span), idx + span + 1) : undefined,
    };
  }

  saveUser(user: UserRecord): void {
    void this.client
      .from('players')
      .upsert(playerRowFromUser(user))
      .then(({ error }) => {
        if (error) console.error('[store] upsert player falhou:', error.message);
      });
  }

  saveMatch(userId: string, entry: MatchHistoryEntry): void {
    void this.client
      .from('match_history')
      .insert(matchHistoryRowFromEntry(userId, entry))
      .then(({ error }) => {
        if (error) console.error('[store] insert match_history falhou:', error.message);
      });
  }

  saveReport(report: ReportRecord): void {
    void this.client
      .from('reports')
      .insert(reportRowFromRecord(report))
      .then(({ error }) => {
        if (error) console.error('[store] insert report falhou:', error.message);
      });
  }

  saveSession(session: SessionRecord): void {
    void this.client
      .from('sessions')
      .upsert(sessionRowFromRecord(session))
      .then(({ error }) => {
        if (error) console.error('[store] upsert session falhou:', error.message);
      });
  }

  deleteSession(tokenHash: string): void {
    void this.client
      .from('sessions')
      .delete()
      .eq('token_hash', tokenHash)
      .then(({ error }) => {
        if (error) console.error('[store] delete session falhou:', error.message);
      });
  }

  saveEvent(event: EventRecord): void {
    void this.client
      .from('events')
      .insert(eventRowFromRecord(event))
      .then(({ error }) => {
        if (error) console.error('[store] insert event falhou:', error.message);
      });
  }

  /**
   * Sobe a foto ao bucket público `avatars` (um objeto por jogador, com upsert
   * — substitui em vez de acumular) e devolve a URL pública. O `?v=` quebra o
   * cache de CDN quando o jogador troca a foto.
   */
  async uploadAvatar(userId: string, bytes: Buffer, contentType: string): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}.${ext}`;
    const { error } = await this.client.storage
      .from('avatars')
      .upload(path, bytes, { upsert: true, contentType, cacheControl: '3600' });
    if (error) throw new Error(`upload de avatar falhou: ${error.message}`);
    const { data } = this.client.storage.from('avatars').getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }
}
