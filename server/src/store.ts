import { randomBytes } from 'node:crypto';
import type { League, MatchHistoryEntry, Profile, PublicProfile } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT, DEFAULT_ACCENT_STYLE, DEFAULT_AVATAR, DEFAULT_COMMANDER, DEFAULT_FRAME, DEFAULT_PROFILE_COVER,
  isValidAvatar, isValidCommander,
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
import { JsonPersistence } from './persistence/json-persistence.js';
import { ProfileManager, epochDay, type CosmeticsPatch } from './persistence/profile-manager.js';
import { SessionRegistry } from './persistence/session-registry.js';
import { SupabasePersistence } from './persistence/supabase-persistence.js';

export type {
  EventRecord,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './persistence/contracts.js';

export { epochDay };

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

// ─── Store: cache em memória + write-through ────────────────────

/** Buffer de eventos em memória (debug/testes); a verdade é o banco. */
const EVENTS_MEMORY_CAP = 500;

export class Store {
  private db: DbShape = { users: [], reports: [], sessions: [], events: [] };
  private byId = new Map<string, UserRecord>();
  private profileManager!: ProfileManager;
  private sessionRegistry!: SessionRegistry;

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
    for (const u of store.db.users) store.byId.set(u.id, u);
    store.profileManager = new ProfileManager(store.byId, persistence);
    store.sessionRegistry = new SessionRegistry(store.db, store.byId, persistence);
    return store;
  }

  // ─── Sessões de login ───────────────────────────────────────────

  /** Cria uma sessão para o jogador e retorna o token bruto (vai só ao cliente). */
  createSession(playerId: string): string {
    return this.sessionRegistry.create(playerId);
  }

  /** Resolve um token de sessão; expirada → revogada. Uso renova a expiração. */
  userBySession(rawToken: string): UserRecord | undefined {
    return this.sessionRegistry.resolve(rawToken);
  }

  revokeSession(rawToken: string): void {
    this.sessionRegistry.revoke(rawToken);
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
    return this.profileManager.updateProfile(userId, name, avatar);
  }

  /**
   * Personalização pós-onboarding (perfil + comandante). Cada campo é validado
   * contra as listas de cosméticos do shared — valores fora da lista são
   * ignorados (anti-abuso: nada de texto arbitrário no avatar/retrato alheio).
   */
  updateCosmetics(
    userId: string,
    patch: CosmeticsPatch,
  ): UserRecord | undefined {
    return this.profileManager.updateCosmetics(userId, patch);
  }

  /**
   * Define (ou remove, com null) a foto de perfil. A foto já vem validada e
   * hospedada (URL do Storage ou data-URL local) pela rota de upload — aqui só
   * grava no registro e persiste.
   */
  setPhoto(userId: string, photo: string | null): UserRecord | undefined {
    return this.profileManager.setPhoto(userId, photo);
  }

  /** Sobe a foto ao backend de persistência e devolve a URL pública. */
  uploadAvatar(userId: string, bytes: Buffer, contentType: string): Promise<string> {
    return this.profileManager.uploadAvatar(userId, bytes, contentType);
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
    this.sessionRegistry.detach(guestToken);
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
    const sessions = this.sessionRegistry.recordsForPlayerIds(ids);
    return { users, sessions };
  }

  /**
   * Reimporta convidados do processo anterior. A validade é a da própria
   * sessão (expiresAt); convidado sem sessão viva é inalcançável e não volta.
   * Retorna quantos convidados foram restaurados.
   */
  importGuests(users: UserRecord[], sessions: SessionRecord[]): number {
    const alive = this.sessionRegistry.restorable(sessions);
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
    this.sessionRegistry.restore(alive.filter((s) => this.byId.get(s.playerId)?.guest));
    return restored;
  }

  userById(id: string): UserRecord | undefined {
    return this.byId.get(id);
  }

  /** Persiste a tradição como identidade pública e fonte da composição do deck. */
  setFaction(userId: string, factionId: string): UserRecord | undefined {
    return this.profileManager.setFaction(userId, factionId);
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
    return this.profileManager.profileOf(u);
  }

  /** Card de perfil público (oponente) — sem e-mail nem lista de silenciados. */
  publicProfileOf(u: UserRecord): PublicProfile {
    return this.profileManager.publicProfileOf(u);
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
