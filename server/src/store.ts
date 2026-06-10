import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { League, MatchHistoryEntry, Profile } from '@legendsclash/shared';
import { BASE_MMR, leagueOf } from './elo.js';

/**
 * Persistência do servidor autoritativo.
 *
 * O jogo é tempo real: as leituras precisam ser síncronas e em memória.
 * O Store mantém o estado em memória e faz write-through assíncrono para o
 * backend de persistência escolhido:
 *
 * - PostgreSQL no Supabase (produção): defina SUPABASE_URL e
 *   SUPABASE_SERVICE_ROLE_KEY. Schema em supabase/migrations/. RLS fica
 *   habilitado sem policies públicas — só o servidor (service role) acessa.
 * - Snapshot JSON local (desenvolvimento/testes): fallback automático quando
 *   as variáveis não estão configuradas.
 */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatar: string;
  token: string;
  mmr: number;
  wins: number;
  losses: number;
  muted: string[];
  history: MatchHistoryEntry[];
  createdAt: number;
}

export interface ReportRecord {
  reporterId: string;
  reportedId: string;
  reason: string;
  context: string; // últimas mensagens do denunciado na sala/partida
  at: number;
}

interface DbShape {
  users: UserRecord[];
  reports: ReportRecord[];
}

interface Persistence {
  load(): Promise<DbShape>;
  /** Write-through assíncrono: erros são logados, nunca derrubam a partida. */
  saveUser(user: UserRecord): void;
  saveMatch(userId: string, entry: MatchHistoryEntry): void;
  saveReport(report: ReportRecord): void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'db.json');

// ─── Fallback local: snapshot JSON com escrita debounced ─────────

class JsonPersistence implements Persistence {
  private db: DbShape = { users: [], reports: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private path: string = DEFAULT_DB_PATH) {}

  async load(): Promise<DbShape> {
    if (existsSync(this.path)) {
      this.db = JSON.parse(readFileSync(this.path, 'utf8'));
    }
    // o Store muta este mesmo objeto; o snapshot sempre grava o estado atual
    return this.db;
  }

  saveUser(): void { this.scheduleSave(); }
  saveMatch(): void { this.scheduleSave(); }
  saveReport(): void { this.scheduleSave(); }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.db, null, 2));
      } catch (err) {
        console.error('[store] falha ao salvar snapshot:', err);
      }
    }, 500);
  }
}

// ─── PostgreSQL no Supabase ──────────────────────────────────────

const HISTORY_LIMIT = 50;

class SupabasePersistence implements Persistence {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
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

    const byPlayer = new Map<string, MatchHistoryEntry[]>();
    for (const row of history ?? []) {
      const list = byPlayer.get(row.player_id) ?? [];
      if (list.length < HISTORY_LIMIT) {
        list.push({
          matchId: row.match_id,
          opponentId: row.opponent_id,
          opponentName: row.opponent_name,
          won: row.won,
          reason: row.reason,
          mmrDelta: row.mmr_delta,
          turns: row.turns,
          durationMs: row.duration_ms,
          endedAt: new Date(row.ended_at).getTime(),
        });
      }
      byPlayer.set(row.player_id, list);
    }

    const users: UserRecord[] = (players ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      avatar: p.avatar,
      token: p.token,
      mmr: p.mmr,
      wins: p.wins,
      losses: p.losses,
      muted: p.muted ?? [],
      history: byPlayer.get(p.id) ?? [],
      createdAt: new Date(p.created_at).getTime(),
    }));

    console.log(`[store] Supabase conectado: ${users.length} jogadores carregados`);
    // denúncias são write-only para o servidor do jogo
    return { users, reports: [] };
  }

  saveUser(user: UserRecord): void {
    void this.client
      .from('players')
      .upsert({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        token: user.token,
        mmr: user.mmr,
        wins: user.wins,
        losses: user.losses,
        muted: user.muted,
        created_at: new Date(user.createdAt).toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error('[store] upsert player falhou:', error.message);
      });
  }

  saveMatch(userId: string, entry: MatchHistoryEntry): void {
    void this.client
      .from('match_history')
      .insert({
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
      })
      .then(({ error }) => {
        if (error) console.error('[store] insert match_history falhou:', error.message);
      });
  }

  saveReport(report: ReportRecord): void {
    void this.client
      .from('reports')
      .insert({
        reporter_id: report.reporterId,
        reported_id: report.reportedId,
        reason: report.reason,
        context: report.context,
        created_at: new Date(report.at).toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error('[store] insert report falhou:', error.message);
      });
  }
}

// ─── Store: cache em memória + write-through ────────────────────

export class Store {
  private db: DbShape = { users: [], reports: [] };
  private byToken = new Map<string, UserRecord>();
  private byId = new Map<string, UserRecord>();

  private constructor(private persistence: Persistence) {}

  /** Escolhe o backend pela configuração do ambiente e carrega o estado. */
  static async create(jsonPath?: string): Promise<Store> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const persistence = url && key
      ? new SupabasePersistence(url, key)
      : new JsonPersistence(jsonPath);
    if (!(url && key)) {
      console.log('[store] Supabase não configurado — usando snapshot JSON local');
    }
    const store = new Store(persistence);
    store.db = await persistence.load();
    for (const u of store.db.users) {
      store.byToken.set(u.token, u);
      store.byId.set(u.id, u);
    }
    return store;
  }

  /** Login do MVP: e-mail identifica a conta (Google OAuth é fase Next). */
  loginOrRegister(email: string, name: string, avatar: string): UserRecord {
    const normEmail = email.trim().toLowerCase();
    let user = this.db.users.find((u) => u.email === normEmail);
    if (!user) {
      user = {
        id: randomBytes(8).toString('hex'),
        email: normEmail,
        name: name.trim().slice(0, 24) || 'Jogador',
        avatar: avatar || '🛡️',
        token: randomBytes(24).toString('hex'),
        mmr: BASE_MMR,
        wins: 0,
        losses: 0,
        muted: [],
        history: [],
        createdAt: Date.now(),
      };
      this.db.users.push(user);
      this.byId.set(user.id, user);
      this.byToken.set(user.token, user);
    } else {
      if (name.trim()) user.name = name.trim().slice(0, 24);
      if (avatar) user.avatar = avatar;
    }
    this.persistence.saveUser(user);
    return user;
  }

  userByToken(token: string): UserRecord | undefined {
    return this.byToken.get(token);
  }

  userById(id: string): UserRecord | undefined {
    return this.byId.get(id);
  }

  recordMatch(userId: string, entry: MatchHistoryEntry, newMmr: number, won: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    u.history.unshift(entry);
    u.history = u.history.slice(0, 50);
    u.mmr = newMmr;
    if (won) u.wins++; else u.losses++;
    this.persistence.saveUser(u);
    this.persistence.saveMatch(userId, entry);
  }

  setMuted(userId: string, targetId: string, muted: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    if (muted && !u.muted.includes(targetId)) u.muted.push(targetId);
    if (!muted) u.muted = u.muted.filter((id) => id !== targetId);
    this.persistence.saveUser(u);
  }

  addReport(report: ReportRecord): void {
    this.db.reports.push(report);
    this.persistence.saveReport(report);
  }

  leaderboard(limit = 20): UserRecord[] {
    return [...this.db.users]
      .filter((u) => u.wins + u.losses > 0)
      .sort((a, b) => b.mmr - a.mmr)
      .slice(0, limit);
  }

  profileOf(u: UserRecord): Profile {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      mmr: u.mmr,
      league: leagueOf(u.mmr) as League,
      wins: u.wins,
      losses: u.losses,
      muted: u.muted,
    };
  }
}
