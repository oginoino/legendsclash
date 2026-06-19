import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchHistoryEntry } from '@legendsclash/shared';
import { Store } from '../src/store.js';
import { AuthError, AuthService, LocalPasswordProvider } from '../src/auth.js';

/**
 * Convidado + conta por e-mail/senha com o provider local (mesmo caminho de
 * dev/e2e). O provider Supabase compartilha o AuthService — só a checagem da
 * senha muda de lugar.
 */

process.env.LC_LOCAL = '1'; // nunca tocar Supabase em testes, mesmo com .env preenchido

const DAY = 24 * 3600_000;

function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'lc-auth-')), 'db.json');
}

async function makeAuth(limits: ConstructorParameters<typeof AuthService>[2] = 'off') {
  const store = await Store.create(tmpDbPath());
  return { store, auth: new AuthService(store, new LocalPasswordProvider(), limits) };
}

function matchEntry(opponentId: string): MatchHistoryEntry {
  return {
    matchId: 'm1', opponentId, opponentName: 'Rival', won: true, reason: 'hp',
    mmrDelta: 16, turns: 9, durationMs: 300_000, endedAt: Date.now(),
  };
}

describe('auth · convidado', () => {
  it('entra com nome e avatar, sem cadastro, e a sessão funciona', async () => {
    const { store, auth } = await makeAuth();
    const result = auth.guest('  Visitante  ', '🐺', '127.0.0.1');

    expect(result.needsProfile).toBe(false);
    expect(result.profile.guest).toBe(true);
    expect(result.profile.name).toBe('Visitante');
    expect(result.profile.email).toBe('');
    expect(result.profile.mmr).toBe(1000);
    expect(store.userBySession(result.token)?.id).toBe(result.profile.id);
  });

  it('exige nome', async () => {
    const { auth } = await makeAuth();
    expect(() => auth.guest('   ', '🐺', '127.0.0.1')).toThrow(
      'Escolha um nome de 1 a 24 caracteres.',
    );
  });

  it('não entra no ranking; progresso fica só na memória da sessão', async () => {
    const { store, auth } = await makeAuth();
    const guest = auth.guest('Visitante', '🐺', '127.0.0.1');
    const acc = await auth.register('lenda@exemplo.com', 'senha-forte-1', '127.0.0.1');

    store.recordMatch(guest.profile.id, matchEntry(acc.profile.id), 1016, true);
    store.recordMatch(acc.profile.id, matchEntry(guest.profile.id), 1016, true);

    const board = store.leaderboard();
    expect(board.map((u) => u.id)).toEqual([acc.profile.id]); // convidado fora

    const guestUser = store.userBySession(guest.token)!;
    expect(guestUser.mmr).toBe(1016); // progresso vivo na sessão…
    expect(guestUser.history).toHaveLength(1); // …inclusive o histórico (em memória)
    expect(store.userBySession(acc.token)!.history).toHaveLength(1);
  });

  it('é efêmero: não persiste e some quando a sessão é revogada', async () => {
    const path = tmpDbPath();
    const store = await Store.create(path);
    const auth = new AuthService(store, new LocalPasswordProvider(), 'off');
    const { token, profile } = auth.guest('Visitante', '🐺', '127.0.0.1');

    vi.useFakeTimers();
    vi.advanceTimersByTime(600); // flush do snapshot debounced (500ms)
    vi.useRealTimers();

    const reloaded = await Store.create(path);
    expect(reloaded.userBySession(token)).toBeUndefined(); // nada no snapshot

    auth.logout(token);
    expect(store.userById(profile.id)).toBeUndefined(); // memória liberada
  });

  it('sessão de convidado expira em 24h', async () => {
    vi.useFakeTimers();
    try {
      const { store, auth } = await makeAuth();
      const { token } = auth.guest('Visitante', '🐺', '127.0.0.1');
      vi.advanceTimersByTime(25 * 3600_000);
      expect(store.userBySession(token)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('auth · promoção: convidado vira conta na mesma sessão', () => {
  it('a conta nova herda nome, avatar, MMR, V/D e histórico — e persiste tudo', async () => {
    vi.useFakeTimers(); // desde o início: o flush debounced do snapshot é um timer
    const path = tmpDbPath();
    try {
      const store = await Store.create(path);
      const auth = new AuthService(store, new LocalPasswordProvider(), 'off');

      const guest = auth.guest('Promovida', 'orb', '127.0.0.1');
      store.recordMatch(guest.profile.id, matchEntry('rival-1'), 1016, true);
      store.recordMatch(guest.profile.id, matchEntry('rival-2'), 1003, false);

      const acc = await auth.register('promo@exemplo.com', 'senha-forte-1', '127.0.0.1', guest.token);
      expect(acc.needsProfile).toBe(false); // identidade herdada: onboarding dispensado
      expect(acc.profile.guest).toBe(false);
      expect(acc.profile.name).toBe('Promovida');
      expect(acc.profile.avatar).toBe('orb');
      expect(acc.profile.mmr).toBe(1003);
      expect(acc.profile.wins).toBe(1);
      expect(acc.profile.losses).toBe(1);

      expect(store.userBySession(guest.token)).toBeUndefined(); // sessão antiga revogada
      expect(store.leaderboard().map((u) => u.id)).toEqual([acc.profile.id]); // agora ranqueia

      vi.advanceTimersByTime(600); // flush do snapshot debounced (500ms)
      const reloaded = await Store.create(path);
      const user = reloaded.userBySession(acc.token)!;
      expect(user.name).toBe('Promovida'); // sobreviveu ao restart…
      expect(user.mmr).toBe(1003);
      expect(user.history).toHaveLength(2); // …com o histórico da sessão de convidado
    } finally {
      vi.useRealTimers();
    }
  });

  it('registro sem sessão de convidado segue pedindo o perfil', async () => {
    const { auth } = await makeAuth();
    const acc = await auth.register('zero@exemplo.com', 'senha-forte-1', '127.0.0.1');
    expect(acc.needsProfile).toBe(true);
  });

  it('token de convidado inválido ou de conta não contamina o registro', async () => {
    const { store, auth } = await makeAuth();
    const outra = await auth.register('fonte@exemplo.com', 'senha-forte-1', '127.0.0.1');
    auth.completeProfile(outra.token, 'Fonte', '⚔️');

    // Bearer de uma CONTA (não convidado) não vira promoção
    const acc = await auth.register('alvo@exemplo.com', 'senha-forte-1', '127.0.0.1', outra.token);
    expect(acc.needsProfile).toBe(true); // nada herdado
    expect(store.userBySession(outra.token)?.name).toBe('Fonte'); // fonte intacta

    // token aleatório é simplesmente ignorado
    const acc2 = await auth.register('alvo2@exemplo.com', 'senha-forte-1', '127.0.0.1', 'token-falso');
    expect(acc2.needsProfile).toBe(true);
  });
});

describe('auth · conta por e-mail e senha', () => {
  it('registro cria a conta, loga e pede o perfil; relogin reaproveita', async () => {
    const { store, auth } = await makeAuth();
    const first = await auth.register('Ana@Exemplo.com', 'senha-forte-1', '127.0.0.1');

    expect(first.needsProfile).toBe(true); // conta nova: nome ainda vazio
    expect(first.profile.guest).toBe(false);
    expect(first.profile.email).toBe('ana@exemplo.com');
    expect(store.userBySession(first.token)?.email).toBe('ana@exemplo.com');

    const profile = auth.completeProfile(first.token, '  Ana das Lendas  ', '🐉');
    expect(profile.name).toBe('Ana das Lendas');

    const second = await auth.login('ana@exemplo.com', 'senha-forte-1', '127.0.0.1');
    expect(second.needsProfile).toBe(false);
    expect(second.profile.id).toBe(first.profile.id); // mesma conta, nova sessão
    expect(second.token).not.toBe(first.token);
    expect(store.userBySession(first.token)?.id).toBe(first.profile.id); // a antiga segue válida
  });

  it('e-mail duplicado não registra de novo', async () => {
    const { auth } = await makeAuth();
    await auth.register('bia@exemplo.com', 'senha-forte-1', '127.0.0.1');
    await expect(auth.register('bia@exemplo.com', 'outra-senha-2', '127.0.0.1')).rejects.toThrow(
      'Este e-mail já tem uma conta. Entre com a sua senha.',
    );
  });

  it('senha errada e conta inexistente falham com a mesma mensagem', async () => {
    const { auth } = await makeAuth();
    await auth.register('eva@exemplo.com', 'senha-forte-1', '127.0.0.1');
    await expect(auth.login('eva@exemplo.com', 'senha-errada', '127.0.0.1')).rejects.toThrow(
      'E-mail ou senha incorretos.',
    );
    await expect(auth.login('nao-existe@exemplo.com', 'tanto-faz-1', '127.0.0.1')).rejects.toThrow(
      'E-mail ou senha incorretos.',
    );
  });

  it('valida e-mail e tamanho da senha com mensagens claras', async () => {
    const { auth } = await makeAuth();
    await expect(auth.register('sem-arroba', 'senha-forte-1', '127.0.0.1')).rejects.toThrow(
      'Informe um e-mail válido.',
    );
    await expect(auth.register('ok@exemplo.com', 'curta', '127.0.0.1')).rejects.toThrow(
      'A senha precisa de pelo menos 8 caracteres.',
    );
    await expect(auth.login('ok@exemplo.com', '', '127.0.0.1')).rejects.toThrow('Informe a senha.');
  });

  it('perfil exige sessão válida e nome não-vazio', async () => {
    const { auth } = await makeAuth();
    const { token } = await auth.register('cad@exemplo.com', 'senha-forte-1', '127.0.0.1');
    expect(() => auth.completeProfile('token-falso', 'Nome', '⚔️')).toThrow(
      'Sessão expirada. Entre novamente.',
    );
    expect(() => auth.completeProfile(token, '   ', '⚔️')).toThrow(
      'Escolha um nome de 1 a 24 caracteres.',
    );
    expect(auth.completeProfile(token, 'x'.repeat(40), '⚔️').name).toHaveLength(24);
  });
});

describe('auth · rate limit por IP', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const LIMITS = { ipMax: 5, ipWindowMs: 15 * 60_000 };

  it('bloqueia a 6ª tentativa na janela; outro IP passa; janela renova', async () => {
    const { auth } = await makeAuth(LIMITS);
    await auth.register('p0@exemplo.com', 'senha-forte-1', '10.0.0.9');
    for (let i = 1; i < 5; i++) {
      await auth.login('p0@exemplo.com', 'senha-forte-1', '10.0.0.9');
    }
    await expect(auth.login('p0@exemplo.com', 'senha-forte-1', '10.0.0.9')).rejects.toThrow(
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    );
    expect(() => auth.guest('Visita', '🐺', '10.0.0.9')).toThrow('Muitas tentativas');
    await expect(auth.login('p0@exemplo.com', 'senha-forte-1', '10.0.0.8')).resolves.toBeDefined();
    vi.advanceTimersByTime(15 * 60_000 + 1000);
    await expect(auth.login('p0@exemplo.com', 'senha-forte-1', '10.0.0.9')).resolves.toBeDefined();
  });

  it('erros de limite carregam status HTTP 429', async () => {
    const { auth } = await makeAuth({ ipMax: 1, ipWindowMs: 60_000 });
    auth.guest('Um', '🐺', '10.0.0.3');
    const err = await auth.login('a@exemplo.com', 'senha-forte-1', '10.0.0.3').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(429);
  });
});

describe('auth · sessões', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('logout revoga a sessão', async () => {
    const { store, auth } = await makeAuth();
    const { token } = await auth.register('out@exemplo.com', 'senha-forte-1', '127.0.0.1');
    expect(store.userBySession(token)).toBeDefined();
    auth.logout(token);
    expect(store.userBySession(token)).toBeUndefined();
  });

  it('sessão de conta expira em 30 dias sem uso', async () => {
    const { store, auth } = await makeAuth();
    const { token } = await auth.register('exp@exemplo.com', 'senha-forte-1', '127.0.0.1');
    vi.advanceTimersByTime(31 * DAY);
    expect(store.userBySession(token)).toBeUndefined();
  });

  it('expiração é deslizante: uso periódico mantém a sessão viva', async () => {
    const { store, auth } = await makeAuth();
    const { token } = await auth.register('viva@exemplo.com', 'senha-forte-1', '127.0.0.1');
    // 2 × 29 dias > 30 dias do TTL original — só sobrevive se o uso renovar
    vi.advanceTimersByTime(29 * DAY);
    expect(store.userBySession(token)).toBeDefined();
    vi.advanceTimersByTime(29 * DAY);
    expect(store.userBySession(token)).toBeDefined();
  });

  it('sessões de conta sobrevivem a restart (snapshot JSON)', async () => {
    const path = tmpDbPath();
    const store = await Store.create(path);
    const auth = new AuthService(store, new LocalPasswordProvider(), 'off');
    const { token, profile } = await auth.register('dur@exemplo.com', 'senha-forte-1', '127.0.0.1');
    auth.completeProfile(token, 'Durona', '🏹');

    vi.advanceTimersByTime(600); // flush do snapshot debounced (500ms)

    const reloaded = await Store.create(path);
    const user = reloaded.userBySession(token);
    expect(user?.id).toBe(profile.id);
    expect(user?.name).toBe('Durona');
  });

  it('carrega snapshot legado sem sessões e com token eterno', async () => {
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
    expect(user.avatar).toBe('wolf'); // emoji legado '🐺' normalizado para id de ícone
    expect(user.mmr).toBe(1100);
    expect(user.guest).toBe(false);
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
