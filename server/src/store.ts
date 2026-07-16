import type { MatchHistoryEntry, Profile, PublicProfile } from '@legendsclash/shared';
import type {
  DbShape,
  EventRecord,
  Persistence,
  RankingSnapshot,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './persistence/contracts.js';
import { CommunityManager } from './persistence/community-manager.js';
import { JsonPersistence } from './persistence/json-persistence.js';
import { IdentityManager } from './persistence/identity-manager.js';
import { ProfileManager, epochDay, type CosmeticsPatch } from './persistence/profile-manager.js';
import { ProgressionManager, advanceStreak } from './persistence/progression-manager.js';
import { SessionRegistry } from './persistence/session-registry.js';
import { SupabasePersistence } from './persistence/supabase-persistence.js';

export type {
  EventRecord,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './persistence/contracts.js';

export { epochDay };
export { advanceStreak };

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
  private communityManager!: CommunityManager;
  private identityManager!: IdentityManager;
  private profileManager!: ProfileManager;
  private progressionManager!: ProgressionManager;
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
    store.sessionRegistry = new SessionRegistry(store.db, store.byId, persistence);
    store.identityManager = new IdentityManager(
      store.db,
      store.byId,
      persistence,
      store.sessionRegistry,
      (userId, props) => store.recordEvent('guest_to_account', { userId, props }),
    );
    store.communityManager = new CommunityManager(store.db, store.byId, persistence);
    store.profileManager = new ProfileManager(store.byId, persistence);
    store.progressionManager = new ProgressionManager(store.db, store.byId, persistence);
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
    return this.identityManager.findOrCreatePlayerByAuth(email, authUserId);
  }

  /**
   * Convidado: joga sem cadastro. Vive só em `byId` (fora de `db.users`),
   * então nunca persiste nem aparece no ranking; some com a sessão.
   */
  createGuest(name: string, avatar: string): UserRecord {
    return this.identityManager.createGuest(name, avatar);
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
    return this.identityManager.adoptGuestProgress(targetId, guestToken);
  }

  // ─── Snapshot de runtime (convidados sobrevivem a restarts) ──────
  // Convidado existe só em memória por design; sem isso, todo deploy o
  // deslogava e apagava o progresso da sessão. Ver snapshot.ts.

  /** Convidados vivos + suas sessões, para o snapshot de runtime. */
  exportGuests(): { users: UserRecord[]; sessions: SessionRecord[] } {
    return this.identityManager.exportGuests();
  }

  /**
   * Reimporta convidados do processo anterior. A validade é a da própria
   * sessão (expiresAt); convidado sem sessão viva é inalcançável e não volta.
   * Retorna quantos convidados foram restaurados.
   */
  importGuests(users: UserRecord[], sessions: SessionRecord[]): number {
    return this.identityManager.importGuests(users, sessions);
  }

  userById(id: string): UserRecord | undefined {
    return this.identityManager.userById(id);
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
    this.progressionManager.recordMatch(userId, entry, newMmr, won);
  }

  setMuted(userId: string, targetId: string, muted: boolean): void {
    this.communityManager.setMuted(userId, targetId, muted);
  }

  addReport(report: ReportRecord): void {
    this.communityManager.addReport(report);
  }

  leaderboard(limit = 20): UserRecord[] {
    return this.progressionManager.leaderboard(limit);
  }

  /**
   * Posição (1-based) do jogador no ranking global e seus vizinhos por MMR (±span).
   * Dá um alvo de subida a quem está fora do top-20. Null se o jogador ainda não
   * pontua (convidado ou sem partidas).
   */
  rankView(userId: string, span = 3): { rank: number; around: UserRecord[] } | null {
    return this.progressionManager.rankView(userId, span);
  }

  /**
   * Ranking para o cliente. Em produção, quando a persistência suporta consulta
   * fresca, lê diretamente do Supabase para refletir MMR/liga persistidos mesmo
   * após deploys, múltiplos processos ou ajustes administrativos. Se a leitura
   * falhar, cai no cache em memória para não quebrar a UX.
   */
  async rankingSnapshot(userId: string, limit = 20, span = 3): Promise<RankingSnapshot> {
    return this.progressionManager.rankingSnapshot(userId, limit, span);
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
    this.communityManager.setFriend(userId, friendId, add);
  }
}
