import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/store.js';
import { AuthError, AuthService, LocalOtpProvider } from '../src/auth.js';

/**
 * Fluxo de login OTP com o provider local (mesmo caminho usado por dev/e2e).
 * O provider Supabase compartilha o AuthService — só a entrega do código muda.
 */

process.env.LC_LOCAL = '1'; // nunca tocar Supabase em testes, mesmo com .env preenchido

const DAY = 24 * 3600_000;

function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'lc-auth-')), 'db.json');
}

async function makeAuth(limits: ConstructorParameters<typeof AuthService>[2] = 'off') {
  const store = await Store.create(tmpDbPath());
  const provider = new LocalOtpProvider();
  return { store, provider, auth: new AuthService(store, provider, limits) };
}

async function loginNew(auth: AuthService, provider: LocalOtpProvider, email: string) {
  await auth.requestOtp(email, '127.0.0.1');
  return auth.verifyCode(email, provider.peek(email)!);
}

describe('auth · fluxo OTP', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('happy path: solicita código, verifica e cria sessão de conta nova', async () => {
    const { store, provider, auth } = await makeAuth();
    await auth.requestOtp('Ana@Exemplo.com', '127.0.0.1');

    const code = provider.peek('ana@exemplo.com');
    expect(code).toMatch(/^\d{6}$/);

    const result = await auth.verifyCode('ana@exemplo.com', code!);
    expect(result.needsProfile).toBe(true); // conta nova: nome ainda vazio
    expect(result.profile.email).toBe('ana@exemplo.com');
    expect(result.profile.mmr).toBe(1000);

    const user = store.userBySession(result.token);
    expect(user?.email).toBe('ana@exemplo.com');
  });

  it('completar o perfil encerra o onboarding; relogin reaproveita a conta', async () => {
    const { store, provider, auth } = await makeAuth();
    const first = await loginNew(auth, provider, 'bia@exemplo.com');

    const profile = auth.completeProfile(first.token, '  Bia das Lendas  ', '🐉');
    expect(profile.name).toBe('Bia das Lendas');
    expect(profile.avatar).toBe('🐉');

    const second = await loginNew(auth, provider, 'bia@exemplo.com');
    expect(second.needsProfile).toBe(false);
    expect(second.profile.id).toBe(first.profile.id); // mesma conta, nova sessão
    expect(second.token).not.toBe(first.token);
    expect(store.userBySession(first.token)?.id).toBe(first.profile.id); // a antiga segue válida
  });

  it('código é de uso único', async () => {
    const { provider, auth } = await makeAuth();
    await auth.requestOtp('uni@exemplo.com', '127.0.0.1');
    const code = provider.peek('uni@exemplo.com')!;
    await auth.verifyCode('uni@exemplo.com', code);
    await expect(auth.verifyCode('uni@exemplo.com', code)).rejects.toThrow(
      'Solicite um código primeiro.',
    );
  });

  it('5 tentativas erradas invalidam o código — até o correto passa a falhar', async () => {
    const { provider, auth } = await makeAuth();
    await auth.requestOtp('eva@exemplo.com', '127.0.0.1');
    const code = provider.peek('eva@exemplo.com')!;
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(auth.verifyCode('eva@exemplo.com', wrong)).rejects.toThrow(
        'Código inválido. Confira os 6 dígitos.',
      );
    }
    await expect(auth.verifyCode('eva@exemplo.com', code)).rejects.toThrow(
      'Muitas tentativas. Solicite um novo código.',
    );
    await expect(auth.verifyCode('eva@exemplo.com', code)).rejects.toThrow(
      'Solicite um código primeiro.',
    );
  });

  it('código expira após o TTL', async () => {
    const { provider, auth } = await makeAuth();
    await auth.requestOtp('tarde@exemplo.com', '127.0.0.1');
    const code = provider.peek('tarde@exemplo.com')!;
    vi.advanceTimersByTime(11 * 60_000); // TTL local: 10 min
    await expect(auth.verifyCode('tarde@exemplo.com', code)).rejects.toThrow(
      'Código expirado. Solicite um novo.',
    );
  });

  it('valida e-mail e formato do código com mensagens claras', async () => {
    const { auth } = await makeAuth();
    await expect(auth.requestOtp('sem-arroba', '127.0.0.1')).rejects.toThrow(
      'Informe um e-mail válido.',
    );
    await expect(auth.verifyCode('ok@exemplo.com', '12ab56')).rejects.toThrow(
      'Informe o código de 6 dígitos.',
    );
    await expect(auth.verifyCode('ok@exemplo.com', '123')).rejects.toThrow(
      'Informe o código de 6 dígitos.',
    );
  });

  it('perfil exige sessão válida e nome não-vazio', async () => {
    const { provider, auth } = await makeAuth();
    const { token } = await loginNew(auth, provider, 'cad@exemplo.com');
    expect(() => auth.completeProfile('token-falso', 'Nome', '⚔️')).toThrow(
      'Sessão expirada. Entre novamente.',
    );
    expect(() => auth.completeProfile(token, '   ', '⚔️')).toThrow(
      'Escolha um nome de 1 a 24 caracteres.',
    );
    expect(auth.completeProfile(token, 'x'.repeat(40), '⚔️').name).toHaveLength(24);
  });
});

describe('auth · rate limits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const LIMITS = { emailCooldownMs: 60_000, ipMax: 10, ipWindowMs: 3600_000 };

  it('reenvio para o mesmo e-mail respeita o cooldown de 60s', async () => {
    const { auth } = await makeAuth(LIMITS);
    await auth.requestOtp('lia@exemplo.com', '10.0.0.1');
    await expect(auth.requestOtp('lia@exemplo.com', '10.0.0.1')).rejects.toThrow(
      'Aguarde um momento para reenviar o código.',
    );
    await auth.requestOtp('outra@exemplo.com', '10.0.0.2'); // outro e-mail passa
    vi.advanceTimersByTime(61_000);
    await expect(auth.requestOtp('lia@exemplo.com', '10.0.0.1')).resolves.toBeUndefined();
  });

  it('cap por IP: 11º envio na janela é bloqueado; outro IP passa', async () => {
    const { auth } = await makeAuth(LIMITS);
    for (let i = 0; i < 10; i++) {
      await auth.requestOtp(`p${i}@exemplo.com`, '10.0.0.9');
    }
    await expect(auth.requestOtp('p10@exemplo.com', '10.0.0.9')).rejects.toThrow(
      'Limite de solicitações atingido. Tente novamente mais tarde.',
    );
    await expect(auth.requestOtp('p10@exemplo.com', '10.0.0.8')).resolves.toBeUndefined();
    vi.advanceTimersByTime(3601_000); // janela expira
    await expect(auth.requestOtp('p11@exemplo.com', '10.0.0.9')).resolves.toBeUndefined();
  });

  it('erros de limite carregam status HTTP 429', async () => {
    const { auth } = await makeAuth(LIMITS);
    await auth.requestOtp('st@exemplo.com', '10.0.0.3');
    const err = await auth.requestOtp('st@exemplo.com', '10.0.0.3').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(429);
  });
});

describe('auth · sessões', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('logout revoga a sessão', async () => {
    const { store, provider, auth } = await makeAuth();
    const { token } = await loginNew(auth, provider, 'out@exemplo.com');
    expect(store.userBySession(token)).toBeDefined();
    auth.logout(token);
    expect(store.userBySession(token)).toBeUndefined();
  });

  it('sessão expira em 30 dias sem uso', async () => {
    const { store, provider, auth } = await makeAuth();
    const { token } = await loginNew(auth, provider, 'exp@exemplo.com');
    vi.advanceTimersByTime(31 * DAY);
    expect(store.userBySession(token)).toBeUndefined();
  });

  it('expiração é deslizante: uso periódico mantém a sessão viva', async () => {
    const { store, provider, auth } = await makeAuth();
    const { token } = await loginNew(auth, provider, 'viva@exemplo.com');
    // 2 × 29 dias > 30 dias do TTL original — só sobrevive se o uso renovar
    vi.advanceTimersByTime(29 * DAY);
    expect(store.userBySession(token)).toBeDefined();
    vi.advanceTimersByTime(29 * DAY);
    expect(store.userBySession(token)).toBeDefined();
  });

  it('sessões sobrevivem a restart (snapshot JSON)', async () => {
    const path = tmpDbPath();
    const store = await Store.create(path);
    const provider = new LocalOtpProvider();
    const auth = new AuthService(store, provider, 'off');
    const { token, profile } = await loginNew(auth, provider, 'dur@exemplo.com');
    auth.completeProfile(token, 'Durona', '🏹');

    vi.advanceTimersByTime(600); // flush do snapshot debounced (500ms)

    const reloaded = await Store.create(path);
    const user = reloaded.userBySession(token);
    expect(user?.id).toBe(profile.id);
    expect(user?.name).toBe('Durona');
  });

  it('carrega snapshot legado (pré-OTP) sem sessões e com token eterno', async () => {
    const path = tmpDbPath();
    writeFileSync(
      path,
      JSON.stringify({
        users: [{
          id: 'abc123', email: 'legado@exemplo.com', name: 'Veterana', avatar: '🐺',
          token: 'token-eterno-antigo', mmr: 1100, wins: 3, losses: 1,
          muted: [], history: [], createdAt: 1700000000000,
        }],
        reports: [],
      }),
    );
    const store = await Store.create(path);
    expect(store.userBySession('token-eterno-antigo')).toBeUndefined(); // eterno morreu
    const { user, isNew } = store.findOrCreatePlayerByAuth('legado@exemplo.com', 'uuid-auth-1');
    expect(isNew).toBe(false); // conta preservada pelo e-mail…
    expect(user.id).toBe('abc123');
    expect(user.mmr).toBe(1100);
    expect(user.authUserId).toBe('uuid-auth-1'); // …e vinculada ao auth.users
  });

  it('reencontra a conta pelo auth_user_id mesmo se o e-mail mudar no Supabase', async () => {
    const store = await Store.create(tmpDbPath());
    const { user } = store.findOrCreatePlayerByAuth('antigo@exemplo.com', 'uuid-7');
    const again = store.findOrCreatePlayerByAuth('novo@exemplo.com', 'uuid-7');
    expect(again.isNew).toBe(false);
    expect(again.user.id).toBe(user.id);
  });
});
