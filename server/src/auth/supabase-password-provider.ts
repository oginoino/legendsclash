import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from './errors.js';
import type { PasswordProvider } from './password-provider.js';

export class SupabasePasswordProvider implements PasswordProvider {
  readonly local = false;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async register(email: string, password: string): Promise<{ authUserId: string | null }> {
    // admin.createUser com email_confirm dispensa SMTP: nenhum e-mail e enviado.
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
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error && error.status !== 422) {
      console.error('[auth] resetPasswordForEmail falhou:', error.message);
    }
    return {};
  }

  async resetPassword(accessToken: string, newPassword: string): Promise<{ email: string; authUserId: string | null }> {
    // O cliente nunca recebe um access_token do Supabase no login normal; esse
    // token chega apenas pelo fragment do link de recuperacao.
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

/** Traduz falhas do GoTrue em erros estaveis e mensagens pt-BR. */
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
