import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AuthError } from './errors.js';
import { RESET_PATH, type PasswordProvider } from './password-provider.js';

/** Validade do link/token de redefinicao de senha. */
const RESET_TTL_MS = 30 * 60_000;

export class LocalPasswordProvider implements PasswordProvider {
  readonly local = true;
  private accounts = new Map<string, { salt: Buffer; hash: Buffer }>();
  /** Tokens de redefinicao em memoria (dev/testes): token -> e-mail + validade. */
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
    // Nao revela se o e-mail existe: sem conta, nada de link.
    if (!this.accounts.has(email)) return {};
    const token = randomBytes(24).toString('hex');
    this.resetTokens.set(token, { email, expiresAt: Date.now() + RESET_TTL_MS });
    // Link relativo (mesma origem): funciona no dev/e2e sem depender de APP_BASE_URL.
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
    this.resetTokens.delete(token);
    return { email: rec.email, authUserId: null };
  }

  private setPassword(email: string, password: string): void {
    const salt = randomBytes(16);
    this.accounts.set(email, { salt, hash: scryptSync(password, salt, 32) });
  }
}
