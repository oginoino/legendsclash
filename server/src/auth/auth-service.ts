import type { Profile } from '@legendsclash/shared';
import type { Store } from '../store.js';
import { AuthError } from './errors.js';
import { LocalPasswordProvider } from './local-password-provider.js';
import { RESET_PATH, type PasswordProvider } from './password-provider.js';
import { SupabasePasswordProvider } from './supabase-password-provider.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

export interface RateLimits {
  /** Maximo de tentativas de login/registro/convidado por IP na janela. */
  ipMax: number;
  ipWindowMs: number;
}

const DEFAULT_LIMITS: RateLimits = { ipMax: 30, ipWindowMs: 15 * 60_000 };

export interface SessionResult {
  token: string;
  profile: Profile;
  needsProfile: boolean;
}

/** Teto de e-mails de redefinicao por endereco (anti-bombing de uma vitima). */
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

  /** Entrar como convidado: nome/avatar e pronto, sem cadastro. */
  guest(nameRaw: string, avatarRaw: string, ip: string): SessionResult {
    this.checkLimits(ip);
    const name = String(nameRaw ?? '').trim().slice(0, 24);
    if (!name) throw new AuthError(400, 'Escolha um nome de 1 a 24 caracteres.');
    const avatar = String(avatarRaw ?? '').trim().slice(0, 32);
    const user = this.store.createGuest(name, avatar);
    const token = this.store.createSession(user.id);
    return { token, profile: this.store.profileOf(user), needsProfile: false };
  }

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
    return this.sessionFor(email, authUserId);
  }

  async requestPasswordReset(emailRaw: string, ip: string): Promise<{ devLink?: string }> {
    this.checkLimits(ip);
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError(400, 'Informe um e-mail válido.');
    if (this.resetEmailThrottled(email)) return {};
    const redirectTo = `${appBaseUrl()}${RESET_PATH}`;
    const { resetLink } = await this.provider.requestPasswordReset(email, redirectTo);
    if (resetLink) console.log(`[auth] link de redefinição (${email}): ${resetLink}`);
    return this.provider.local && resetLink ? { devLink: resetLink } : {};
  }

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

  private resetEmailThrottled(email: string): boolean {
    const now = Date.now();
    const hits = (this.resetsByEmail.get(email) ?? []).filter((t) => now - t < RESET_EMAIL_WINDOW_MS);
    this.resetsByEmail.set(email, hits);
    if (hits.length >= RESET_EMAIL_MAX) return true;
    hits.push(now);
    return false;
  }

  /** Conta autenticada -> jogador -> sessao. */
  private sessionFor(email: string, authUserId: string | null, guestToken?: string): SessionResult {
    const { user, isNew } = this.store.findOrCreatePlayerByAuth(email, authUserId);
    if (isNew && guestToken) this.store.adoptGuestProgress(user.id, guestToken);
    const token = this.store.createSession(user.id);
    return {
      token,
      profile: this.store.profileOf(user),
      needsProfile: !user.name,
    };
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

export function createAuthService(store: Store): AuthService {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const forceLocal = process.env.LC_LOCAL === '1' || process.env.LEGENDSCLASH_E2E === '1';
  const useSupabase = !!(url && key) && !forceLocal;
  if (useSupabase) {
    console.log('[auth] contas via Supabase Auth (e-mail + senha, sem envio de e-mail)');
    return new AuthService(store, new SupabasePasswordProvider(url!, key!));
  }
  console.log('[auth] contas locais em memória (modo dev/teste)');
  return new AuthService(store, new LocalPasswordProvider(), 'off');
}

/** Base publica do app: destino do link magico (mesma var usada no deploy). */
function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://srv1745709.hstgr.cloud').replace(/\/+$/, '');
}
