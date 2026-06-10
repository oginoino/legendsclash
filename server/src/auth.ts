import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomInt } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '@legendsclash/shared';
import type { Store } from './store.js';

/**
 * Login por link mágico (e-mail), com sessões próprias do servidor.
 *
 * O servidor media tudo (o cliente nunca fala com o Supabase):
 *
 *   POST /api/auth/otp     { email }        → Supabase envia o e-mail com o link
 *   POST /api/auth/link    { accessToken }  → troca o JWT do link por sessão própria
 *   POST /api/auth/verify  { email, code }  → caminho por código (modo local/SMTP futuro)
 *   POST /api/auth/profile Bearer + {name, avatar} → onboarding do 1º login
 *   POST /api/auth/logout  Bearer           → revoga a sessão
 *
 * O link do e-mail aponta para o verificador do Supabase, que redireciona o
 * navegador para `APP_BASE_URL/auth/callback#access_token=…`; o cliente envia
 * esse JWT (vida curta) para /api/auth/link e recebe a sessão de 30 dias.
 *
 * Em modo local (sem SUPABASE_* ou LC_LOCAL=1) nada de e-mail: o link de
 * acesso (com código embutido) é impresso no console e, fora de produção,
 * exposto em GET /api/auth/dev-code?email= para os testes Playwright.
 */

/** Base pública do app — destino dos links de acesso enviados por e-mail. */
const APP_BASE_URL = (process.env.APP_BASE_URL ?? 'https://srv1745709.hstgr.cloud').replace(/\/+$/, '');
const CALLBACK_PATH = '/auth/callback';

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface OtpProvider {
  /** true = códigos locais em memória (dev/testes), sem e-mail real. */
  readonly local: boolean;
  request(email: string): Promise<void>;
  verify(email: string, code: string): Promise<{ authUserId: string | null }>;
}

// ─── Provider local: dev e testes, sem e-mail ────────────────────

interface LocalCode {
  code: string;
  expiresAt: number;
  attempts: number;
}

const LOCAL_CODE_TTL_MS = 10 * 60_000;
const LOCAL_MAX_ATTEMPTS = 5;

export class LocalOtpProvider implements OtpProvider {
  readonly local = true;
  private codes = new Map<string, LocalCode>();

  constructor(private ttlMs = LOCAL_CODE_TTL_MS) {}

  async request(email: string): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(email, { code, expiresAt: Date.now() + this.ttlMs, attempts: 0 });
    const port = process.env.PORT ?? 8787;
    console.log(`[auth] link de acesso para ${email}: http://localhost:${port}${this.linkFor(email)}`);
  }

  /** Link de acesso local (caminho relativo): mesmo callback do link real. */
  linkFor(email: string): string {
    const code = this.codes.get(email)?.code ?? '';
    return `${CALLBACK_PATH}#local_email=${encodeURIComponent(email)}&local_code=${code}`;
  }

  async verify(email: string, code: string): Promise<{ authUserId: string | null }> {
    const entry = this.codes.get(email);
    if (!entry) throw new AuthError(400, 'Solicite um código primeiro.');
    if (entry.expiresAt <= Date.now()) {
      this.codes.delete(email);
      throw new AuthError(400, 'Código expirado. Solicite um novo.');
    }
    if (entry.attempts >= LOCAL_MAX_ATTEMPTS) {
      this.codes.delete(email);
      throw new AuthError(429, 'Muitas tentativas. Solicite um novo código.');
    }
    if (entry.code !== code) {
      entry.attempts++;
      throw new AuthError(400, 'Código inválido. Confira os 6 dígitos.');
    }
    this.codes.delete(email); // uso único
    return { authUserId: null };
  }

  /** Só para o endpoint de dev/testes — nunca exposto em produção. */
  peek(email: string): string | undefined {
    return this.codes.get(email)?.code;
  }
}

// ─── Provider Supabase Auth (GoTrue) ─────────────────────────────

export class SupabaseOtpProvider implements OtpProvider {
  readonly local = false;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async request(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // o verificador do Supabase redireciona o navegador para cá
        emailRedirectTo: `${APP_BASE_URL}${CALLBACK_PATH}`,
      },
    });
    if (error) throw mapSupabaseError(error, 'request');
  }

  async verify(email: string, code: string): Promise<{ authUserId: string | null }> {
    const { data, error } = await this.client.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error) throw mapSupabaseError(error, 'verify');
    return { authUserId: data.user?.id ?? null };
  }

  /** Valida o JWT que o link mágico entrega no fragment do redirect. */
  async verifyAccessToken(accessToken: string): Promise<{ authUserId: string; email: string | null }> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error) {
      const e = error as { status?: number; name?: string };
      if (e.name === 'AuthRetryableFetchError' || (e.status ?? 0) >= 500) {
        throw mapSupabaseError(error, 'verify');
      }
      throw new AuthError(401, 'Link inválido ou expirado. Peça um novo link de acesso.');
    }
    if (!data.user) throw new AuthError(401, 'Link inválido ou expirado. Peça um novo link de acesso.');
    return { authUserId: data.user.id, email: data.user.email ?? null };
  }
}

/** Traduz falhas do GoTrue em erros estáveis e mensagens pt-BR. */
function mapSupabaseError(error: unknown, phase: 'request' | 'verify'): AuthError {
  const e = error as { status?: number; code?: string; message?: string; name?: string };
  // código errado e código expirado chegam ambos como otp_expired (403)
  if (e.code === 'otp_expired') {
    return new AuthError(400, 'Código inválido ou expirado. Confira os 6 dígitos ou solicite um novo.');
  }
  if (e.status === 429 || e.code === 'over_email_send_rate_limit' || e.code === 'over_request_rate_limit') {
    return new AuthError(429, 'Muitos envios para este e-mail. Aguarde um pouco e tente novamente.');
  }
  if (e.code === 'otp_disabled' || e.code === 'signup_disabled' || e.code === 'email_provider_disabled') {
    console.error('[auth] Supabase Auth mal configurado:', e.code, e.message);
    return new AuthError(503, 'Login por código indisponível no momento.');
  }
  if (e.name === 'AuthRetryableFetchError' || (e.status ?? 0) >= 500) {
    console.error('[auth] Supabase indisponível:', e.message);
    return new AuthError(503, 'Serviço de autenticação indisponível. Tente novamente em instantes.');
  }
  console.error(`[auth] falha inesperada no ${phase}:`, e.code, e.message);
  return new AuthError(
    502,
    phase === 'request'
      ? 'Não foi possível enviar o código agora. Tente novamente.'
      : 'Não foi possível validar o código agora. Tente novamente.',
  );
}

// ─── Serviço: validação, rate limit e sessões ────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RateLimits {
  /** Intervalo mínimo entre envios para o mesmo e-mail. */
  emailCooldownMs: number;
  /** Máximo de envios por IP dentro da janela. */
  ipMax: number;
  ipWindowMs: number;
}

const DEFAULT_LIMITS: RateLimits = { emailCooldownMs: 60_000, ipMax: 10, ipWindowMs: 3600_000 };

export class AuthService {
  private lastSendByEmail = new Map<string, number>();
  private sendsByIp = new Map<string, number[]>();

  constructor(
    private store: Store,
    private provider: OtpProvider,
    private limits: RateLimits | 'off' = DEFAULT_LIMITS,
  ) {}

  get providerIsLocal(): boolean {
    return this.provider.local;
  }

  async requestOtp(emailRaw: string, ip: string): Promise<void> {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError(400, 'Informe um e-mail válido.');
    this.checkLimits(email, ip);
    await this.provider.request(email);
  }

  async verifyCode(
    emailRaw: string,
    codeRaw: string,
  ): Promise<{ token: string; profile: Profile; needsProfile: boolean }> {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError(400, 'Informe um e-mail válido.');
    const code = String(codeRaw ?? '').trim();
    if (!/^\d{6}$/.test(code)) throw new AuthError(400, 'Informe o código de 6 dígitos.');

    const { authUserId } = await this.provider.verify(email, code);
    const { user, isNew } = this.store.findOrCreatePlayerByAuth(email, authUserId);
    const token = this.store.createSession(user.id);
    return {
      token,
      profile: this.store.profileOf(user),
      needsProfile: isNew || !user.name,
    };
  }

  /** Login pelo link mágico: troca o JWT do redirect por uma sessão própria. */
  async loginWithAccessToken(
    accessTokenRaw: string,
  ): Promise<{ token: string; profile: Profile; needsProfile: boolean }> {
    const accessToken = String(accessTokenRaw ?? '').trim();
    if (!accessToken) throw new AuthError(400, 'Link inválido. Peça um novo link de acesso.');
    if (!(this.provider instanceof SupabaseOtpProvider)) {
      // modo local entra pelo link com código embutido (/auth/callback#local_…)
      throw new AuthError(400, 'Login por link indisponível em modo local — use o link do console.');
    }
    const { authUserId, email } = await this.provider.verifyAccessToken(accessToken);
    if (!email) throw new AuthError(401, 'Link inválido ou expirado. Peça um novo link de acesso.');
    const { user, isNew } = this.store.findOrCreatePlayerByAuth(email, authUserId);
    const token = this.store.createSession(user.id);
    return {
      token,
      profile: this.store.profileOf(user),
      needsProfile: isNew || !user.name,
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

  /** Código e link de acesso pendentes — só em modo local e fora de produção. */
  devCode(email: string): { code: string; link: string } {
    const enabled = this.provider.local && process.env.NODE_ENV !== 'production';
    if (!enabled || !(this.provider instanceof LocalOtpProvider)) {
      throw new AuthError(404, 'Não encontrado.');
    }
    const norm = String(email ?? '').trim().toLowerCase();
    const code = this.provider.peek(norm);
    if (!code) throw new AuthError(404, 'Nenhum código pendente para este e-mail.');
    return { code, link: this.provider.linkFor(norm) };
  }

  private checkLimits(email: string, ip: string): void {
    if (this.limits === 'off') return;
    const now = Date.now();

    const lastSend = this.lastSendByEmail.get(email) ?? 0;
    if (now - lastSend < this.limits.emailCooldownMs) {
      throw new AuthError(429, 'Aguarde um momento para reenviar o código.');
    }

    const sends = (this.sendsByIp.get(ip) ?? []).filter(
      (at) => now - at < (this.limits as RateLimits).ipWindowMs,
    );
    if (sends.length >= this.limits.ipMax) {
      throw new AuthError(429, 'Limite de solicitações atingido. Tente novamente mais tarde.');
    }

    this.lastSendByEmail.set(email, now);
    sends.push(now);
    this.sendsByIp.set(ip, sends);
  }
}

// ─── Fábrica e rotas HTTP ────────────────────────────────────────

export function createAuthService(store: Store): AuthService {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const useSupabase = !!(url && key) && process.env.LC_LOCAL !== '1';
  if (useSupabase) {
    console.log('[auth] OTP via Supabase Auth (códigos por e-mail)');
    return new AuthService(store, new SupabaseOtpProvider(url!, key!));
  }
  console.log('[auth] OTP local — códigos impressos no console (modo dev/teste)');
  return new AuthService(store, new LocalOtpProvider(), 'off');
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
      case 'POST /api/auth/otp': {
        const body = await readBody(req);
        await auth.requestOtp(String(body.email ?? ''), clientIp(req));
        json(res, 200, { ok: true });
        return true;
      }
      case 'POST /api/auth/verify': {
        const body = await readBody(req);
        const result = await auth.verifyCode(String(body.email ?? ''), String(body.code ?? ''));
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/link': {
        const body = await readBody(req);
        const result = await auth.loginWithAccessToken(String(body.accessToken ?? ''));
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
      case 'GET /api/auth/dev-code': {
        json(res, 200, auth.devCode(url.searchParams.get('email') ?? ''));
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
