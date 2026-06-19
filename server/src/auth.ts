import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '@legendsclash/shared';
import type { Store } from './store.js';

/**
 * Autenticação com sessões próprias do servidor.
 *
 * Jogar não exige cadastro: o convidado escolhe nome/avatar e recebe uma
 * sessão efêmera. Conta (e-mail + senha, Supabase Auth) guarda o progresso
 * e coloca o jogador no ranking. O servidor media tudo (o cliente nunca
 * fala com o Supabase) e nenhum fluxo envia e-mail: o cadastro já nasce
 * confirmado.
 *
 *   POST /api/auth/guest    { name, avatar }    → sessão de convidado
 *   POST /api/auth/register { email, password } → cria a conta e loga;
 *     com Bearer de convidado, a conta herda o progresso da sessão (promoção)
 *   POST /api/auth/login    { email, password } → sessão de 30 dias
 *   POST /api/auth/profile  Bearer + {name, avatar} → onboarding do 1º acesso
 *   POST /api/auth/logout   Bearer              → revoga a sessão
 *
 * Em modo local (sem SUPABASE_* ou LC_LOCAL=1) as contas vivem em memória
 * (hash scrypt) — suficiente para dev e testes, sem tocar o banco real.
 */

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PasswordProvider {
  /** true = contas em memória (dev/testes), sem Supabase. */
  readonly local: boolean;
  register(email: string, password: string): Promise<{ authUserId: string | null }>;
  login(email: string, password: string): Promise<{ authUserId: string | null }>;
  /**
   * Dispara a redefinição de senha. `redirectTo` é a página que recebe o link
   * mágico. Nunca revela se o e-mail existe; quando há um link a entregar fora
   * de produção (provider local), devolve-o para console/testes.
   */
  requestPasswordReset(email: string, redirectTo: string): Promise<{ resetLink?: string }>;
  /**
   * Conclui a redefinição: `token` é o access_token do link mágico (Supabase)
   * ou o token opaco do provider local. Retorna o dono para emitir a sessão.
   */
  resetPassword(token: string, newPassword: string): Promise<{ email: string; authUserId: string | null }>;
}

/** Caminho da página de redefinição (SPA) que recebe o link mágico. */
export const RESET_PATH = '/auth/reset';

// ─── Provider local: dev e testes, sem Supabase ──────────────────

export class LocalPasswordProvider implements PasswordProvider {
  readonly local = true;
  private accounts = new Map<string, { salt: Buffer; hash: Buffer }>();
  /** Tokens de redefinição em memória (dev/testes): token → e-mail + validade. */
  private resetTokens = new Map<string, { email: string; expiresAt: number }>();

  async register(email: string, password: string): Promise<{ authUserId: string | null }> {
    if (this.accounts.has(email)) {
      throw new AuthError(409, 'Este e-mail já tem uma conta. Entre com a sua senha.');
    }
    this.setPassword(email, password);
    return { authUserId: null };
  }

  async login(email: string, password: string): Promise<{ authUserId: string | null }> {
    const account = this.accounts.get(email);
    if (!account || !timingSafeEqual(account.hash, scryptSync(password, account.salt, 32))) {
      throw new AuthError(401, 'E-mail ou senha incorretos.');
    }
    return { authUserId: null };
  }

  async requestPasswordReset(email: string): Promise<{ resetLink?: string }> {
    // não revela se o e-mail existe: sem conta, nada de link
    if (!this.accounts.has(email)) return {};
    const token = randomBytes(24).toString('hex');
    this.resetTokens.set(token, { email, expiresAt: Date.now() + RESET_TTL_MS });
    // link relativo (mesma origem): funciona no dev/e2e sem depender de APP_BASE_URL
    return { resetLink: `${RESET_PATH}#access_token=${token}&type=recovery` };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ email: string; authUserId: string | null }> {
    const rec = this.resetTokens.get(token);
    if (!rec || rec.expiresAt < Date.now()) {
      throw new AuthError(400, 'Link de redefinição inválido ou expirado. Peça um novo.');
    }
    if (!this.accounts.has(rec.email)) {
      throw new AuthError(400, 'Link de redefinição inválido ou expirado. Peça um novo.');
    }
    this.setPassword(rec.email, newPassword);
    this.resetTokens.delete(token); // uso único
    return { email: rec.email, authUserId: null };
  }

  private setPassword(email: string, password: string): void {
    const salt = randomBytes(16);
    this.accounts.set(email, { salt, hash: scryptSync(password, salt, 32) });
  }
}

/** Validade do link/token de redefinição de senha. */
const RESET_TTL_MS = 30 * 60_000;

// ─── Provider Supabase Auth (GoTrue) ─────────────────────────────

export class SupabasePasswordProvider implements PasswordProvider {
  readonly local = false;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async register(email: string, password: string): Promise<{ authUserId: string | null }> {
    // admin.createUser com email_confirm dispensa SMTP: nenhum e-mail é enviado
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw mapSupabaseError(error, 'register');
    return { authUserId: data.user?.id ?? null };
  }

  async login(email: string, password: string): Promise<{ authUserId: string | null }> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw mapSupabaseError(error, 'login');
    return { authUserId: data.user?.id ?? null };
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<{ resetLink?: string }> {
    // O GoTrue envia o e-mail (SMTP do Supabase) e mascara e-mails inexistentes:
    // a resposta é genérica de qualquer forma. O link cai em `redirectTo` com o
    // access_token de recuperação no fragment (#access_token=...&type=recovery).
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error && error.status !== 422) {
      console.error('[auth] resetPasswordForEmail falhou:', error.message);
    }
    return {}; // nunca devolve link em produção
  }

  async resetPassword(accessToken: string, newPassword: string): Promise<{ email: string; authUserId: string | null }> {
    // Valida o access_token de recuperação contra o GoTrue e identifica o dono;
    // o cliente nunca fala com o Supabase — o servidor faz a troca via admin.
    //
    // getUser aceita qualquer access_token válido do projeto, não só os de
    // recuperação. Aqui isso é aceitável: nesta arquitetura o cliente JAMAIS
    // recebe um access_token do Supabase a não ser pelo fragment do link de
    // recuperação (login normal devolve um token opaco do servidor, não um JWT
    // do GoTrue). Logo, o único token que chega aqui é o de recuperação.
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new AuthError(400, 'Link de redefinição inválido ou expirado. Peça um novo.');
    }
    const { error: updErr } = await this.client.auth.admin.updateUserById(data.user.id, {
      password: newPassword,
    });
    if (updErr) throw mapSupabaseError(updErr, 'login');
    return { email: data.user.email ?? '', authUserId: data.user.id };
  }
}

/** Traduz falhas do GoTrue em erros estáveis e mensagens pt-BR. */
function mapSupabaseError(error: unknown, phase: 'register' | 'login'): AuthError {
  const e = error as { status?: number; code?: string; message?: string; name?: string };
  if (e.code === 'email_exists' || e.code === 'user_already_exists') {
    return new AuthError(409, 'Este e-mail já tem uma conta. Entre com a sua senha.');
  }
  if (e.code === 'invalid_credentials' || e.code === 'email_not_confirmed') {
    return new AuthError(401, 'E-mail ou senha incorretos.');
  }
  if (e.code === 'weak_password') {
    return new AuthError(400, 'Senha fraca demais. Use pelo menos 8 caracteres.');
  }
  if (e.status === 429 || e.code === 'over_request_rate_limit') {
    return new AuthError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }
  if (e.name === 'AuthRetryableFetchError' || (e.status ?? 0) >= 500) {
    console.error('[auth] Supabase indisponível:', e.message);
    return new AuthError(503, 'Serviço de autenticação indisponível. Tente novamente em instantes.');
  }
  console.error(`[auth] falha inesperada no ${phase}:`, e.code, e.message);
  return new AuthError(
    502,
    phase === 'register'
      ? 'Não foi possível criar a conta agora. Tente novamente.'
      : 'Não foi possível entrar agora. Tente novamente.',
  );
}

// ─── Serviço: validação, rate limit e sessões ────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // limite do bcrypt no GoTrue

export interface RateLimits {
  /** Máximo de tentativas de login/registro/convidado por IP na janela. */
  ipMax: number;
  ipWindowMs: number;
}

const DEFAULT_LIMITS: RateLimits = { ipMax: 30, ipWindowMs: 15 * 60_000 };

export interface SessionResult {
  token: string;
  profile: Profile;
  needsProfile: boolean;
}

/** Teto de e-mails de redefinição por endereço (anti-bombing de uma vítima). */
const RESET_EMAIL_MAX = 3;
const RESET_EMAIL_WINDOW_MS = 15 * 60_000;

export class AuthService {
  private attemptsByIp = new Map<string, number[]>();
  private resetsByEmail = new Map<string, number[]>();

  constructor(
    private store: Store,
    private provider: PasswordProvider,
    private limits: RateLimits | 'off' = DEFAULT_LIMITS,
  ) {}

  get providerIsLocal(): boolean {
    return this.provider.local;
  }

  /** Entrar como convidado: nome/avatar e pronto — sem cadastro. */
  guest(nameRaw: string, avatarRaw: string, ip: string): SessionResult {
    this.checkLimits(ip);
    const name = String(nameRaw ?? '').trim().slice(0, 24);
    if (!name) throw new AuthError(400, 'Escolha um nome de 1 a 24 caracteres.');
    // o avatar é um id de cosmético (ex.: 'crossed-swords'); o createGuest valida
    // contra a lista do shared (cap generoso só para limitar o tamanho do input)
    const avatar = String(avatarRaw ?? '').trim().slice(0, 32);
    const user = this.store.createGuest(name, avatar);
    const token = this.store.createSession(user.id);
    return { token, profile: this.store.profileOf(user), needsProfile: false };
  }

  /**
   * Cria a conta. Se vier a sessão de convidado da mesma pessoa
   * (`guestToken`), a conta nova herda o progresso da sessão — promoção.
   */
  async register(
    emailRaw: string,
    passwordRaw: string,
    ip: string,
    guestToken?: string,
  ): Promise<SessionResult> {
    const { email, password } = this.checkCredentials(emailRaw, passwordRaw, ip);
    if (password.length < MIN_PASSWORD) {
      throw new AuthError(400, `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
    }
    const { authUserId } = await this.provider.register(email, password);
    return this.sessionFor(email, authUserId, guestToken);
  }

  async login(emailRaw: string, passwordRaw: string, ip: string): Promise<SessionResult> {
    const { email, password } = this.checkCredentials(emailRaw, passwordRaw, ip);
    const { authUserId } = await this.provider.login(email, password);
    // login em conta existente não herda nada: o progresso dela prevalece
    return this.sessionFor(email, authUserId);
  }

  /**
   * Esqueci minha senha: dispara o link mágico de redefinição. Resposta sempre
   * genérica (não revela se o e-mail existe). Em modo local, devolve o link
   * para console/testes — em produção, nunca.
   */
  async requestPasswordReset(emailRaw: string, ip: string): Promise<{ devLink?: string }> {
    this.checkLimits(ip);
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError(400, 'Informe um e-mail válido.');
    // teto por e-mail (além do limite por IP): impede bombardear uma vítima.
    // Silencioso ao estourar — devolve a mesma resposta genérica (anti-enumeração).
    if (this.resetEmailThrottled(email)) return {};
    const redirectTo = `${appBaseUrl()}${RESET_PATH}`;
    const { resetLink } = await this.provider.requestPasswordReset(email, redirectTo);
    if (resetLink) console.log(`[auth] link de redefinição (${email}): ${resetLink}`);
    return this.provider.local && resetLink ? { devLink: resetLink } : {};
  }

  /**
   * Conclui a redefinição com o token do link mágico e já loga a pessoa com a
   * senha nova (UX: cai direto na home, sem um segundo login).
   */
  async resetPassword(tokenRaw: string, passwordRaw: string, ip: string): Promise<SessionResult> {
    this.checkLimits(ip);
    const token = String(tokenRaw ?? '').trim();
    if (!token) throw new AuthError(400, 'Link de redefinição inválido. Peça um novo.');
    const password = String(passwordRaw ?? '');
    if (password.length < MIN_PASSWORD) {
      throw new AuthError(400, `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
    }
    if (password.length > MAX_PASSWORD) throw new AuthError(400, 'Senha longa demais.');
    const { email, authUserId } = await this.provider.resetPassword(token, password);
    return this.sessionFor(email, authUserId);
  }

  private resetEmailThrottled(email: string): boolean {
    const now = Date.now();
    const hits = (this.resetsByEmail.get(email) ?? []).filter((t) => now - t < RESET_EMAIL_WINDOW_MS);
    this.resetsByEmail.set(email, hits);
    if (hits.length >= RESET_EMAIL_MAX) return true;
    hits.push(now);
    return false;
  }

  /** Conta autenticada → jogador (vinculando contas legadas) → sessão. */
  private sessionFor(email: string, authUserId: string | null, guestToken?: string): SessionResult {
    const { user, isNew } = this.store.findOrCreatePlayerByAuth(email, authUserId);
    // só uma conta recém-nascida herda do convidado (nunca sobrescreve progresso real)
    if (isNew && guestToken) this.store.adoptGuestProgress(user.id, guestToken);
    const token = this.store.createSession(user.id);
    return {
      token,
      profile: this.store.profileOf(user),
      needsProfile: !user.name, // promoção herda o nome → onboarding dispensado
    };
  }

  completeProfile(token: string, nameRaw: string, avatarRaw: string): Profile {
    const user = this.store.userBySession(token);
    if (!user) throw new AuthError(401, 'Sessão expirada. Entre novamente.');
    const name = String(nameRaw ?? '').trim().slice(0, 24);
    if (!name) throw new AuthError(400, 'Escolha um nome de 1 a 24 caracteres.');
    const updated = this.store.updateProfile(user.id, name, String(avatarRaw ?? ''))!;
    return this.store.profileOf(updated);
  }

  logout(token: string): void {
    this.store.revokeSession(token);
  }

  private checkCredentials(
    emailRaw: string,
    passwordRaw: string,
    ip: string,
  ): { email: string; password: string } {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError(400, 'Informe um e-mail válido.');
    const password = String(passwordRaw ?? '');
    if (!password || password.length > MAX_PASSWORD) {
      throw new AuthError(400, 'Informe a senha.');
    }
    this.checkLimits(ip);
    return { email, password };
  }

  private checkLimits(ip: string): void {
    if (this.limits === 'off') return;
    const now = Date.now();
    const attempts = (this.attemptsByIp.get(ip) ?? []).filter(
      (at) => now - at < (this.limits as RateLimits).ipWindowMs,
    );
    if (attempts.length >= this.limits.ipMax) {
      throw new AuthError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }
    attempts.push(now);
    this.attemptsByIp.set(ip, attempts);
  }
}

// ─── Fábrica e rotas HTTP ────────────────────────────────────────

/** Base pública do app: destino do link mágico (mesma var usada no deploy). */
function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://srv1745709.hstgr.cloud').replace(/\/+$/, '');
}

export function createAuthService(store: Store): AuthService {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const useSupabase = !!(url && key) && process.env.LC_LOCAL !== '1';
  if (useSupabase) {
    console.log('[auth] contas via Supabase Auth (e-mail + senha, sem envio de e-mail)');
    return new AuthService(store, new SupabasePasswordProvider(url!, key!));
  }
  console.log('[auth] contas locais em memória (modo dev/teste)');
  return new AuthService(store, new LocalPasswordProvider(), 'off');
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new AuthError(400, 'Corpo da requisição inválido.');
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function bearerToken(req: IncomingMessage): string {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw new AuthError(401, 'Sessão expirada. Entre novamente.');
  return m[1];
}

/** Bearer opcional — o register o usa para promover a sessão de convidado. */
function optionalBearerToken(req: IncomingMessage): string | undefined {
  return /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
}

function clientIp(req: IncomingMessage): string {
  // atrás do Caddy o IP real vem no x-forwarded-for
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** Atende /api/auth/*. Retorna false se a rota não for de autenticação. */
export async function handleAuthRoute(
  auth: AuthService,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = `${req.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'POST /api/auth/guest': {
        const body = await readBody(req);
        const result = auth.guest(String(body.name ?? ''), String(body.avatar ?? ''), clientIp(req));
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/register': {
        const body = await readBody(req);
        const result = await auth.register(
          String(body.email ?? ''),
          String(body.password ?? ''),
          clientIp(req),
          optionalBearerToken(req), // sessão de convidado → promoção
        );
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/login': {
        const body = await readBody(req);
        const result = await auth.login(
          String(body.email ?? ''),
          String(body.password ?? ''),
          clientIp(req),
        );
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/forgot': {
        const body = await readBody(req);
        const result = await auth.requestPasswordReset(String(body.email ?? ''), clientIp(req));
        // resposta genérica (anti-enumeração); devLink só vem em modo local
        json(res, 200, { ok: true, ...result });
        return true;
      }
      case 'POST /api/auth/reset': {
        const body = await readBody(req);
        const result = await auth.resetPassword(
          String(body.token ?? ''),
          String(body.password ?? ''),
          clientIp(req),
        );
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/profile': {
        const token = bearerToken(req);
        const body = await readBody(req);
        const profile = auth.completeProfile(token, String(body.name ?? ''), String(body.avatar ?? ''));
        json(res, 200, { profile });
        return true;
      }
      case 'POST /api/auth/logout': {
        auth.logout(bearerToken(req));
        json(res, 200, { ok: true });
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      json(res, err.status, { error: err.message });
      return true;
    }
    throw err;
  }
}
