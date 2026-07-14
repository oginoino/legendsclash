export interface PasswordProvider {
  /** true = contas em memoria (dev/testes), sem Supabase. */
  readonly local: boolean;
  register(email: string, password: string): Promise<{ authUserId: string | null }>;
  login(email: string, password: string): Promise<{ authUserId: string | null }>;
  /**
   * Dispara a redefinicao de senha. `redirectTo` e a pagina que recebe o link
   * magico. Nunca revela se o e-mail existe; quando ha um link a entregar fora
   * de producao (provider local), devolve-o para console/testes.
   */
  requestPasswordReset(email: string, redirectTo: string): Promise<{ resetLink?: string }>;
  /**
   * Conclui a redefinicao: `token` e o access_token do link magico (Supabase)
   * ou o token opaco do provider local. Retorna o dono para emitir a sessao.
   */
  resetPassword(token: string, newPassword: string): Promise<{ email: string; authUserId: string | null }>;
}

/** Caminho da pagina de redefinicao (SPA) que recebe o link magico. */
export const RESET_PATH = '/auth/reset';
