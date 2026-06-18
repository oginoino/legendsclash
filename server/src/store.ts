import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { League, MatchHistoryEntry, Profile } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT, DEFAULT_COMMANDER, isValidAccent, isValidAvatar, isValidCommander,
} from '@legendsclash/shared';
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
 *   as variáveis não estão configuradas, ou forçado com LC_LOCAL=1 (útil para
 *   desenvolver sem tocar o banco de produção mesmo com .env preenchido).
 */

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
  /** Vínculo com auth.users do Supabase (login por senha). Null em convidados/contas legadas/modo local. */
  authUserId: string | null;
  /**
   * Convidado: existe só em memória (nunca persiste, não entra no ranking,
   * não acumula histórico). Some quando a sessão expira ou no restart.
   */
  guest: boolean;
  mmr: number;
  wins: number;
  losses: number;
  muted: string[];
  history: MatchHistoryEntry[];
  createdAt: number;
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
  context: string; // últimas mensagens do denunciado na sala/partida
  at: number;
}

interface DbShape {
  users: UserRecord[];
  reports: ReportRecord[];
  sessions: SessionRecord[];
}

interface Persistence {
  load(): Promise<DbShape>;
  /** Write-through assíncrono: erros são logados, nunca derrubam a partida. */
  saveUser(user: UserRecord): void;
  saveMatch(userId: string, entry: MatchHistoryEntry): void;
  saveReport(report: ReportRecord): void;
  saveSession(session: SessionRecord): void;
  deleteSession(tokenHash: string): void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'db.json');

// ─── Fallback local: snapshot JSON com escrita debounced ─────────

class JsonPersistence implements Persistence {
  private db: DbShape = { users: [], reports: [], sessions: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private path: string = DEFAULT_DB_PATH) {}

  async load(): Promise<DbShape> {
    if (existsSync(this.path)) {
      this.db = JSON.parse(readFileSync(this.path, 'utf8'));
    }
    // Shape legado: preenche os campos novos e descarta o token eterno.
    this.db.sessions ??= [];
    for (const u of this.db.users) {
      u.authUserId ??= null;
      u.commander ??= u.avatar; // contas anteriores: retrato = avatar do perfil
      u.accent ??= DEFAULT_ACCENT;
      u.guest = false; // só contas persistem; convidados vivem em memória
      delete (u as { token?: string }).token;
    }
    // o Store muta este mesmo objeto; o snapshot sempre grava o estado atual
    return this.db;
  }

  saveUser(): void { this.scheduleSave(); }
  saveMatch(): void { this.scheduleSave(); }
  saveReport(): void { this.scheduleSave(); }
  saveSession(): void { this.scheduleSave(); }
  deleteSession(): void { this.scheduleSave(); }

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

    const nowIso = new Date().toISOString();
    const { data: sessions, error: sessErr } = await this.client
      .from('sessions')
      .select('*')
      .gt('expires_at', nowIso);
    if (sessErr) throw new Error(`[store] falha ao carregar sessões: ${sessErr.message}`);

    // higiene: sessões expiradas saem do banco em segundo plano
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
      commander: p.commander ?? p.avatar,
      accent: p.accent ?? DEFAULT_ACCENT,
      authUserId: p.auth_user_id ?? null,
      guest: false,
      mmr: p.mmr,
      wins: p.wins,
      losses: p.losses,
      muted: p.muted ?? [],
      history: byPlayer.get(p.id) ?? [],
      createdAt: new Date(p.created_at).getTime(),
    }));

    const sessionRecords: SessionRecord[] = (sessions ?? []).map((s) => ({
      tokenHash: s.token_hash,
      playerId: s.player_id,
      createdAt: new Date(s.created_at).getTime(),
      expiresAt: new Date(s.expires_at).getTime(),
      lastSeenAt: new Date(s.last_seen_at).getTime(),
    }));

    console.log(`[store] Supabase conectado: ${users.length} jogadores, ${sessionRecords.length} sessões ativas`);
    // denúncias são write-only para o servidor do jogo
    return { users, reports: [], sessions: sessionRecords };
  }

  saveUser(user: UserRecord): void {
    void this.client
      .from('players')
      .upsert({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        commander: user.commander,
        accent: user.accent,
        auth_user_id: user.authUserId,
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

  saveSession(session: SessionRecord): void {
    void this.client
      .from('sessions')
      .upsert({
        token_hash: session.tokenHash,
        player_id: session.playerId,
        created_at: new Date(session.createdAt).toISOString(),
        expires_at: new Date(session.expiresAt).toISOString(),
        last_seen_at: new Date(session.lastSeenAt).toISOString(),
      })
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
}

// ─── Store: cache em memória + write-through ────────────────────

/** Vida de uma sessão; renovada (deslizante) a cada uso espaçado. */
const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Convidados são efêmeros: sessão mais curta, só em memória. */
const GUEST_SESSION_TTL_MS = 24 * 3600_000;
/** Renovação grava no banco no máximo 1x/hora por sessão. */
const SESSION_TOUCH_MS = 3600_000;

export class Store {
  private db: DbShape = { users: [], reports: [], sessions: [] };
  private byId = new Map<string, UserRecord>();
  private sessions = new Map<string, SessionRecord>(); // tokenHash → sessão

  private constructor(private persistence: Persistence) {}

  /** Escolhe o backend pela configuração do ambiente e carrega o estado. */
  static async create(jsonPath?: string): Promise<Store> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const useSupabase = !!(url && key) && process.env.LC_LOCAL !== '1';
    const persistence = useSupabase
      ? new SupabasePersistence(url!, key!)
      : new JsonPersistence(jsonPath);
    if (!useSupabase) {
      console.log('[store] modo local — snapshot JSON (sem SUPABASE_* no ambiente, ou LC_LOCAL=1)');
    }
    const store = new Store(persistence);
    store.db = await persistence.load();
    const now = Date.now();
    store.db.sessions = store.db.sessions.filter((s) => s.expiresAt > now);
    for (const u of store.db.users) store.byId.set(u.id, u);
    for (const s of store.db.sessions) store.sessions.set(s.tokenHash, s);
    return store;
  }

  // ─── Sessões de login ───────────────────────────────────────────

  private static hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Cria uma sessão para o jogador e retorna o token bruto (vai só ao cliente). */
  createSession(playerId: string): string {
    const guest = this.byId.get(playerId)?.guest ?? false;
    const raw = randomBytes(32).toString('hex');
    const now = Date.now();
    const session: SessionRecord = {
      tokenHash: Store.hashToken(raw),
      playerId,
      createdAt: now,
      expiresAt: now + (guest ? GUEST_SESSION_TTL_MS : SESSION_TTL_MS),
      lastSeenAt: now,
    };
    this.db.sessions.push(session);
    this.sessions.set(session.tokenHash, session);
    if (!guest) this.persistence.saveSession(session);
    return raw;
  }

  /** Resolve um token de sessão; expirada → revogada. Uso renova a expiração. */
  userBySession(rawToken: string): UserRecord | undefined {
    const session = this.sessions.get(Store.hashToken(rawToken));
    if (!session) return undefined;
    const now = Date.now();
    if (session.expiresAt <= now) {
      this.dropSession(session.tokenHash);
      return undefined;
    }
    const user = this.byId.get(session.playerId);
    if (now - session.lastSeenAt > SESSION_TOUCH_MS) {
      session.lastSeenAt = now;
      session.expiresAt = now + (user?.guest ? GUEST_SESSION_TTL_MS : SESSION_TTL_MS);
      if (!user?.guest) this.persistence.saveSession(session);
    }
    return user;
  }

  revokeSession(rawToken: string): void {
    this.dropSession(Store.hashToken(rawToken));
  }

  /** Remove a sessão dos índices em memória (sem efeitos colaterais). */
  private removeSessionRecord(tokenHash: string): boolean {
    if (!this.sessions.delete(tokenHash)) return false;
    this.db.sessions = this.db.sessions.filter((s) => s.tokenHash !== tokenHash);
    return true;
  }

  private dropSession(tokenHash: string): void {
    const session = this.sessions.get(tokenHash);
    if (!this.removeSessionRecord(tokenHash)) return;
    const user = session && this.byId.get(session.playerId);
    if (user?.guest) {
      // convidado sem sessão é inalcançável: libera a memória
      this.byId.delete(user.id);
      return;
    }
    this.persistence.deleteSession(tokenHash);
  }

  // ─── Contas e convidados ────────────────────────────────────────

  /**
   * Localiza (ou cria) o jogador dono do e-mail autenticado no Supabase.
   * Contas legadas (sem auth_user_id) são vinculadas no primeiro login.
   * Conta nova nasce com nome vazio = onboarding pendente (needsProfile).
   */
  findOrCreatePlayerByAuth(email: string, authUserId: string | null): { user: UserRecord; isNew: boolean } {
    const normEmail = email.trim().toLowerCase();
    let user = authUserId
      ? this.db.users.find((u) => u.authUserId === authUserId)
      : undefined;
    user ??= this.db.users.find((u) => u.email === normEmail);
    if (user) {
      if (authUserId && user.authUserId !== authUserId) {
        user.authUserId = authUserId;
        this.persistence.saveUser(user);
      }
      return { user, isNew: false };
    }
    user = {
      id: randomBytes(8).toString('hex'),
      email: normEmail,
      name: '',
      avatar: '🛡️',
      commander: DEFAULT_COMMANDER,
      accent: DEFAULT_ACCENT,
      authUserId,
      guest: false,
      mmr: BASE_MMR,
      wins: 0,
      losses: 0,
      muted: [],
      history: [],
      createdAt: Date.now(),
    };
    this.db.users.push(user);
    this.byId.set(user.id, user);
    this.persistence.saveUser(user);
    return { user, isNew: true };
  }

  /**
   * Convidado: joga sem cadastro. Vive só em `byId` (fora de `db.users`),
   * então nunca persiste nem aparece no ranking; some com a sessão.
   */
  createGuest(name: string, avatar: string): UserRecord {
    const user: UserRecord = {
      id: randomBytes(8).toString('hex'),
      email: '',
      name: name.trim().slice(0, 24),
      avatar: avatar || '🛡️',
      commander: avatar || DEFAULT_COMMANDER,
      accent: DEFAULT_ACCENT,
      authUserId: null,
      guest: true,
      mmr: BASE_MMR,
      wins: 0,
      losses: 0,
      muted: [],
      history: [],
      createdAt: Date.now(),
    };
    this.byId.set(user.id, user);
    return user;
  }

  updateProfile(userId: string, name: string, avatar: string): UserRecord | undefined {
    const u = this.byId.get(userId);
    if (!u) return undefined;
    u.name = name.trim().slice(0, 24);
    if (avatar) u.avatar = avatar;
    if (!u.guest) this.persistence.saveUser(u);
    return u;
  }

  /**
   * Personalização pós-onboarding (perfil + comandante). Cada campo é validado
   * contra as listas de cosméticos do shared — valores fora da lista são
   * ignorados (anti-abuso: nada de texto arbitrário no avatar/retrato alheio).
   */
  updateCosmetics(
    userId: string,
    patch: { name?: string; avatar?: string; commander?: string; accent?: string },
  ): UserRecord | undefined {
    const u = this.byId.get(userId);
    if (!u) return undefined;
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 24);
      if (name) u.name = name;
    }
    if (patch.avatar && isValidAvatar(patch.avatar)) u.avatar = patch.avatar;
    if (patch.commander && isValidCommander(patch.commander)) u.commander = patch.commander;
    if (patch.accent && isValidAccent(patch.accent)) u.accent = patch.accent;
    this.persistence.saveUser(u);
    return u;
  }

  /**
   * Promoção: a conta recém-criada herda a identidade e o progresso da
   * sessão de convidado (nome, avatar, MMR, V/D, histórico, silenciados) —
   * agora persistidos. A sessão do convidado é revogada; o registro dele só
   * fica em memória até expirar, caso uma partida ainda o referencie.
   */
  adoptGuestProgress(targetId: string, guestToken: string): boolean {
    const guest = this.userBySession(guestToken);
    if (!guest?.guest) return false;
    const target = this.byId.get(targetId);
    if (!target || target.guest || target.id === guest.id) return false;

    target.name = guest.name;
    target.avatar = guest.avatar;
    target.mmr = guest.mmr;
    target.wins = guest.wins;
    target.losses = guest.losses;
    target.muted = [...guest.muted];
    target.history = [...guest.history];
    this.persistence.saveUser(target);
    // partidas da sessão entram no histórico persistido, em ordem cronológica
    for (let i = target.history.length - 1; i >= 0; i--) {
      this.persistence.saveMatch(target.id, target.history[i]);
    }
    this.removeSessionRecord(Store.hashToken(guestToken));
    return true;
  }

  userById(id: string): UserRecord | undefined {
    return this.byId.get(id);
  }

  recordMatch(userId: string, entry: MatchHistoryEntry, newMmr: number, won: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    u.mmr = newMmr;
    if (won) u.wins++; else u.losses++;
    u.history.unshift(entry);
    u.history = u.history.slice(0, 50);
    // convidado acumula só em memória: vira conta (promoção) ou se perde
    if (u.guest) return;
    this.persistence.saveUser(u);
    this.persistence.saveMatch(userId, entry);
  }

  setMuted(userId: string, targetId: string, muted: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    if (muted && !u.muted.includes(targetId)) u.muted.push(targetId);
    if (!muted) u.muted = u.muted.filter((id) => id !== targetId);
    if (!u.guest) this.persistence.saveUser(u);
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
      commander: u.commander,
      accent: u.accent,
      guest: u.guest,
      mmr: u.mmr,
      league: leagueOf(u.mmr) as League,
      wins: u.wins,
      losses: u.losses,
      muted: u.muted,
    };
  }
}
