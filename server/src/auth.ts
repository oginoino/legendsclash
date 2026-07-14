/**
 * Autenticação com sessões próprias do servidor.
 *
 * Jogar não exige cadastro: o convidado escolhe nome/avatar e recebe uma
 * sessão efêmera. Conta (e-mail + senha, Supabase Auth) guarda o progresso
 * e coloca o jogador no ranking. O servidor media tudo (o cliente nunca fala
 * com o Supabase) e nenhum fluxo envia e-mail no cadastro: a conta já nasce
 * confirmada.
 */

export { AuthService, createAuthService } from './auth/auth-service.js';
export type { RateLimits, SessionResult } from './auth/auth-service.js';
export { AuthError } from './auth/errors.js';
export { handleAuthRoute } from './auth/http.js';
export { LocalPasswordProvider } from './auth/local-password-provider.js';
export type { PasswordProvider } from './auth/password-provider.js';
export { RESET_PATH } from './auth/password-provider.js';
export { SupabasePasswordProvider } from './auth/supabase-password-provider.js';
