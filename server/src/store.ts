import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { League, MatchHistoryEntry, Profile, PublicProfile } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT, DEFAULT_ACCENT_STYLE, DEFAULT_AVATAR, DEFAULT_COMMANDER, DEFAULT_FRAME, DEFAULT_PROFILE_COVER,
  FACTION_TILTS,
  isValidAccent, isValidAccentStyle, isValidAvatar, isValidCommander, isValidFrame, isValidProfileCover,
  achievementsOf, accentStyleUnlocked, accentUnlocked, commanderUnlocked, frameUnlocked, profileCoverUnlocked,
  normalizeIconId,
} from '@legendsclash/shared';
import { BASE_MMR, leagueOf } from './elo.js';
import type {
  DbShape,
  EventRecord,
  Persistence,
  RankingSnapshot,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './persistence/contracts.js';
import {
  eventRowFromRecord,
  matchHistoryFromRow,
  matchHistoryRowFromEntry,
  playerRowFromUser,
  reportRowFromRecord,
  sessionFromRow,
  sessionRowFromRecord,
  userFromPlayerRow,
} from './persistence/supabase-mappers.js';
import { JsonPersistence } from './persistence/json-persistence.js';

export type {
  EventRecord,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './persistence/contracts.js';

/** Dia epoch UTC (base do cálculo da sequência diária). */
export function epochDay(ts: number): number {
  return Math.floor(ts / 86_400_000);
}

/**
 * Avança a sequência diária ao jogar: +1 se foi no dia seguinte ao último,
 * reinicia em 1 se houve intervalo, inalterada se já jogou hoje. Função pura
 * (testável sem relógio).
 */
export function advanceStreak(
  streak: number,
  lastPlayDay: number,
  today: number,
): { streak: number; lastPlayDay: number } {
  if (lastPlayDay === today) return { streak, lastPlayDay };
  return { streak: lastPlayDay === today - 1 ? streak + 1 : 1, lastPlayDay: today };
}

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
        list.push(matchHistoryFromRow(row));
      }
      byPlayer.set(row.player_id, list);
    }

    const users: UserRecord[] = (players ?? []).map((row) => (
      userFromPlayerRow(row, byPlayer.get(row.id) ?? [])
    ));
    const sessionRecords: SessionRecord[] = (sessions ?? []).map(sessionFromRow);

    console.log(`[store] Supabase conectado: ${users.length} jogadores, ${sessionRecords.length} sessões ativas`);
    // denúncias e eventos são write-only para o servidor do jogo (análise por SQL)
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
    const idx = ranked.findIndex((u) => u.id === userId);
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

// ─── Store: cache em memória + write-through ────────────────────

/** Vida de uma sessão; renovada (deslizante) a cada uso espaçado. */
const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Convidados são efêmeros: sessão mais curta, só em memória. */
const GUEST_SESSION_TTL_MS = 24 * 3600_000;
/** Renovação grava no banco no máximo 1x/hora por sessão. */
const SESSION_TOUCH_MS = 3600_000;
/** Buffer de eventos em memória (debug/testes); a verdade é o banco. */
const EVENTS_MEMORY_CAP = 500;

export class Store {
  private db: DbShape = { users: [], reports: [], sessions: [], events: [] };
  private byId = new Map<string, UserRecord>();
  private sessions = new Map<string, SessionRecord>(); // tokenHash → sessão

  private constructor(private persistence: Persistence) {}

  /** Escolhe o backend pela configuração do ambiente e carrega o estado. */
  static async create(jsonPath?: string): Promise<Store> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const forceLocal = process.env.LC_LOCAL === '1' || process.env.LEGENDSCLASH_E2E === '1';
    const useSupabase = !!(url && key) && !forceLocal;
    const localPath = jsonPath ?? process.env.LC_DB_PATH;
    const persistence = useSupabase
      ? new SupabasePersistence(url!, key!)
      : new JsonPersistence(localPath);
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
      avatar: DEFAULT_AVATAR,
      commander: DEFAULT_COMMANDER,
      accent: DEFAULT_ACCENT,
      photo: null,
      frame: DEFAULT_FRAME,
      accentStyle: DEFAULT_ACCENT_STYLE,
      profileCover: DEFAULT_PROFILE_COVER,
      faction: '',
      authUserId,
      guest: false,
      mmr: BASE_MMR,
      league: leagueOf(BASE_MMR) as League,
      wins: 0,
      losses: 0,
      muted: [],
      friends: [],
      history: [],
      createdAt: Date.now(),
      streak: 0,
      lastPlayDay: 0,
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
    // o avatar vem do cliente (picker) — aceita id válido (ou legado), senão padrão
    const id = isValidAvatar(avatar) ? normalizeIconId(avatar) : DEFAULT_AVATAR;
    const user: UserRecord = {
      id: randomBytes(8).toString('hex'),
      email: '',
      name: name.trim().slice(0, 24),
      avatar: id,
      commander: isValidCommander(id) ? id : DEFAULT_COMMANDER,
      accent: DEFAULT_ACCENT,
      photo: null,
      frame: DEFAULT_FRAME,
      accentStyle: DEFAULT_ACCENT_STYLE,
      profileCover: DEFAULT_PROFILE_COVER,
      faction: '',
      authUserId: null,
      guest: true,
      mmr: BASE_MMR,
      league: leagueOf(BASE_MMR) as League,
      wins: 0,
      losses: 0,
      muted: [],
      friends: [],
      history: [],
      createdAt: Date.now(),
      streak: 0,
      lastPlayDay: 0,
    };
    this.byId.set(user.id, user);
    return user;
  }

  updateProfile(userId: string, name: string, avatar: string): UserRecord | undefined {
    const u = this.byId.get(userId);
    if (!u) return undefined;
    u.name = name.trim().slice(0, 24);
    if (avatar && isValidAvatar(avatar)) u.avatar = normalizeIconId(avatar);
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
    patch: { name?: string; avatar?: string; commander?: string; accent?: string; frame?: string; accentStyle?: string; profileCover?: string },
  ): UserRecord | undefined {
    const u = this.byId.get(userId);
    if (!u) return undefined;
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 24);
      if (name) u.name = name;
    }
    // cosméticos por mérito: comandante/cor/moldura/estilo podem exigir uma conquista
    // (anti-abuso: só aplica se o jogador realmente desbloqueou — derivado de V/partidas).
    const earned = achievementsOf(u.wins, u.wins + u.losses);
    if (patch.avatar && isValidAvatar(patch.avatar)) u.avatar = normalizeIconId(patch.avatar);
    if (patch.commander && isValidCommander(patch.commander) && commanderUnlocked(normalizeIconId(patch.commander), earned)) {
      u.commander = normalizeIconId(patch.commander);
    }
    if (patch.accent && isValidAccent(patch.accent) && accentUnlocked(patch.accent, earned)) {
      u.accent = patch.accent;
    }
    if (patch.frame && isValidFrame(patch.frame) && frameUnlocked(patch.frame, earned)) {
      u.frame = patch.frame;
    }
    if (patch.accentStyle && isValidAccentStyle(patch.accentStyle) && accentStyleUnlocked(patch.accentStyle, earned)) {
      u.accentStyle = patch.accentStyle;
    }
    if (patch.profileCover && isValidProfileCover(patch.profileCover) && profileCoverUnlocked(patch.profileCover, earned)) {
      u.profileCover = patch.profileCover;
    }
    if (!u.guest) this.persistence.saveUser(u);
    return u;
  }

  /**
   * Define (ou remove, com null) a foto de perfil. A foto já vem validada e
   * hospedada (URL do Storage ou data-URL local) pela rota de upload — aqui só
   * grava no registro e persiste.
   */
  setPhoto(userId: string, photo: string | null): UserRecord | undefined {
    const u = this.byId.get(userId);
    if (!u) return undefined;
    u.photo = photo;
    if (!u.guest) this.persistence.saveUser(u);
    return u;
  }

  /** Sobe a foto ao backend de persistência e devolve a URL pública. */
  uploadAvatar(userId: string, bytes: Buffer, contentType: string): Promise<string> {
    return this.persistence.uploadAvatar(userId, bytes, contentType);
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
    target.commander = guest.commander;
    target.accent = guest.accent;
    target.photo = guest.photo;
    target.frame = guest.frame;
    target.accentStyle = guest.accentStyle;
    target.profileCover = guest.profileCover;
    target.faction = guest.faction;
    target.mmr = guest.mmr;
    target.league = guest.league ?? leagueOf(guest.mmr) as League;
    target.wins = guest.wins;
    target.losses = guest.losses;
    target.muted = [...guest.muted];
    target.friends = [...guest.friends];
    target.history = [...guest.history];
    target.streak = guest.streak;
    target.lastPlayDay = guest.lastPlayDay;
    this.persistence.saveUser(target);
    // partidas da sessão entram no histórico persistido, em ordem cronológica
    for (let i = target.history.length - 1; i >= 0; i--) {
      this.persistence.saveMatch(target.id, target.history[i]);
    }
    this.removeSessionRecord(Store.hashToken(guestToken));
    this.recordEvent('guest_to_account', {
      userId: target.id,
      props: { mmr: target.mmr, matches: target.wins + target.losses },
    });
    return true;
  }

  // ─── Snapshot de runtime (convidados sobrevivem a restarts) ──────
  // Convidado existe só em memória por design; sem isso, todo deploy o
  // deslogava e apagava o progresso da sessão. Ver snapshot.ts.

  /** Convidados vivos + suas sessões, para o snapshot de runtime. */
  exportGuests(): { users: UserRecord[]; sessions: SessionRecord[] } {
    const users = [...this.byId.values()].filter((u) => u.guest);
    const ids = new Set(users.map((u) => u.id));
    const sessions = [...this.sessions.values()].filter((s) => ids.has(s.playerId));
    return { users, sessions };
  }

  /**
   * Reimporta convidados do processo anterior. A validade é a da própria
   * sessão (expiresAt); convidado sem sessão viva é inalcançável e não volta.
   * Retorna quantos convidados foram restaurados.
   */
  importGuests(users: UserRecord[], sessions: SessionRecord[]): number {
    const now = Date.now();
    const alive = sessions.filter((s) => s.expiresAt > now && !this.sessions.has(s.tokenHash));
    const reachable = new Set(alive.map((s) => s.playerId));
    let restored = 0;
    for (const u of users) {
      if (!u.guest || this.byId.has(u.id) || !reachable.has(u.id)) continue;
      u.profileCover ??= DEFAULT_PROFILE_COVER;
      u.faction ??= '';
      u.league ??= leagueOf(u.mmr) as League;
      this.byId.set(u.id, u);
      restored++;
    }
    for (const s of alive) {
      if (!this.byId.get(s.playerId)?.guest) continue;
      this.sessions.set(s.tokenHash, s);
      this.db.sessions.push(s);
    }
    return restored;
  }

  userById(id: string): UserRecord | undefined {
    return this.byId.get(id);
  }

  /** Persiste a tradição como identidade pública e fonte da composição do deck. */
  setFaction(userId: string, factionId: string): UserRecord | undefined {
    const u = this.byId.get(userId);
    if (!u || (factionId !== '' && !FACTION_TILTS[factionId])) return undefined;
    u.faction = factionId;
    if (!u.guest) this.persistence.saveUser(u);
    return u;
  }

  /**
   * Telemetria de produto (write-through). Alimenta D1/D7 e a validação de
   * balanceamento (winrate por assento) via SQL — o servidor nunca relê. Mantém
   * um buffer curto em memória para debug/testes; a fonte de verdade é o banco.
   */
  recordEvent(
    type: string,
    opts: { userId?: string | null; matchId?: string | null; props?: Record<string, unknown> } = {},
  ): void {
    const event: EventRecord = {
      type,
      userId: opts.userId ?? null,
      matchId: opts.matchId ?? null,
      props: opts.props ?? {},
      at: Date.now(),
    };
    this.db.events.push(event);
    if (this.db.events.length > EVENTS_MEMORY_CAP) this.db.events.shift();
    this.persistence.saveEvent(event);
  }

  /** Buffer recente de eventos em memória (debug/testes). */
  recentEvents(): EventRecord[] {
    return this.db.events;
  }

  recordMatch(userId: string, entry: MatchHistoryEntry, newMmr: number, won: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    u.mmr = newMmr;
    u.league = leagueOf(newMmr) as League;
    if (won) u.wins++; else u.losses++;
    u.history.unshift(entry);
    u.history = u.history.slice(0, 50);
    // sequência diária: jogar uma partida mantém/avança a sequência (gancho D7)
    const adv = advanceStreak(u.streak, u.lastPlayDay, epochDay(Date.now()));
    u.streak = adv.streak;
    u.lastPlayDay = adv.lastPlayDay;
    // convidado acumula só em memória: vira conta (promoção) ou se perde
    if (u.guest) return;
    this.persistence.saveUser(u);
    this.persistence.saveMatch(userId, entry);
  }

  setMuted(userId: string, targetId: string, muted: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    if (muted && !u.muted.includes(targetId) && u.muted.length < 500) u.muted.push(targetId);
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

  /**
   * Posição (1-based) do jogador no ranking global e seus vizinhos por MMR (±span).
   * Dá um alvo de subida a quem está fora do top-20. Null se o jogador ainda não
   * pontua (convidado ou sem partidas).
   */
  rankView(userId: string, span = 3): { rank: number; around: UserRecord[] } | null {
    const ranked = [...this.db.users]
      .filter((u) => u.wins + u.losses > 0)
      .sort((a, b) => b.mmr - a.mmr);
    const idx = ranked.findIndex((u) => u.id === userId);
    if (idx < 0) return null;
    return { rank: idx + 1, around: ranked.slice(Math.max(0, idx - span), idx + span + 1) };
  }

  /**
   * Ranking para o cliente. Em produção, quando a persistência suporta consulta
   * fresca, lê diretamente do Supabase para refletir MMR/liga persistidos mesmo
   * após deploys, múltiplos processos ou ajustes administrativos. Se a leitura
   * falhar, cai no cache em memória para não quebrar a UX.
   */
  async rankingSnapshot(userId: string, limit = 20, span = 3): Promise<RankingSnapshot> {
    if (this.persistence.loadRanking) {
      try {
        return await this.persistence.loadRanking(userId, limit, span);
      } catch (err) {
        console.error('[store] ranking persistido indisponível; usando cache:', err);
      }
    }
    const rv = this.rankView(userId, span);
    return {
      entries: this.leaderboard(limit),
      myRank: rv?.rank,
      around: rv?.around,
    };
  }

  profileOf(u: UserRecord): Profile {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      commander: u.commander,
      accent: u.accent,
      photo: u.photo,
      frame: u.frame,
      accentStyle: u.accentStyle,
      profileCover: u.profileCover,
      faction: u.faction,
      guest: u.guest,
      mmr: u.mmr,
      league: u.league ?? leagueOf(u.mmr) as League,
      wins: u.wins,
      losses: u.losses,
      streak: u.streak,
      playedToday: u.lastPlayDay === epochDay(Date.now()),
      achievements: achievementsOf(u.wins, u.wins + u.losses),
      muted: u.muted,
      friends: u.friends,
    };
  }

  /** Card de perfil público (oponente) — sem e-mail nem lista de silenciados. */
  publicProfileOf(u: UserRecord): PublicProfile {
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      commander: u.commander,
      accent: u.accent,
      photo: u.photo,
      frame: u.frame,
      accentStyle: u.accentStyle,
      profileCover: u.profileCover,
      faction: u.faction,
      league: u.league ?? leagueOf(u.mmr) as League,
      mmr: u.mmr,
      wins: u.wins,
      losses: u.losses,
      achievements: achievementsOf(u.wins, u.wins + u.losses),
      streak: u.streak,
    };
  }

  /** Adiciona/remove um amigo (cap defensivo). Convidado guarda só em memória. */
  setFriend(userId: string, friendId: string, add: boolean): void {
    const u = this.byId.get(userId);
    if (!u || userId === friendId) return;
    if (add && !u.friends.includes(friendId) && u.friends.length < 500) u.friends.push(friendId);
    if (!add) u.friends = u.friends.filter((id) => id !== friendId);
    if (!u.guest) this.persistence.saveUser(u);
  }
}
