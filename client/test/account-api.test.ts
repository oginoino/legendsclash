import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '@legendsclash/shared';
import { createAccountApi } from '../src/api/account-api';

const profile = { id: 'player-1', name: 'Aurelia' } as Profile;
const session = { token: 'session-token', profile, needsProfile: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFetcher(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const response = queue.shift();
    if (!response) throw new Error('Resposta HTTP não configurada para o teste.');
    return response;
  });
}

describe('accountApi', () => {
  it('serializa os fluxos que criam ou recuperam uma sessão', async () => {
    const fetcher = createFetcher(
      jsonResponse(session),
      jsonResponse(session),
      jsonResponse(session),
      jsonResponse(session),
    );
    const api = createAccountApi(fetcher as unknown as typeof fetch);

    await expect(api.loginAsGuest('Aurelia', 'dragon')).resolves.toEqual(session);
    await expect(api.registerAccount(
      'aurelia@example.com',
      'password-123',
      'guest-token',
    )).resolves.toEqual(session);
    await expect(api.loginAccount(
      'aurelia@example.com',
      'password-123',
    )).resolves.toEqual(session);
    await expect(api.resetPassword(
      'recovery-token',
      'new-password',
    )).resolves.toEqual(session);

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/auth/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Aurelia', avatar: 'dragon' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer guest-token',
      },
      body: JSON.stringify({ email: 'aurelia@example.com', password: 'password-123' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'aurelia@example.com', password: 'password-123' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'recovery-token', password: 'new-password' }),
    });
  });

  it('mantém recuperação de senha e onboarding com contratos distintos', async () => {
    const resetResult = { ok: true, devLink: '/auth/reset#access_token=dev' };
    const fetcher = createFetcher(
      jsonResponse(resetResult),
      jsonResponse({ profile }),
    );
    const api = createAccountApi(fetcher as unknown as typeof fetch);

    await expect(api.requestPasswordReset('aurelia@example.com')).resolves.toEqual(resetResult);
    await expect(api.completeProfile(
      'Aurelia',
      'dragon',
      'session-token',
    )).resolves.toEqual({ profile });

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/auth/forgot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'aurelia@example.com' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/auth/profile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer session-token',
      },
      body: JSON.stringify({ name: 'Aurelia', avatar: 'dragon' }),
    });
  });

  it('envia e remove avatar com autenticação e formatos preservados', async () => {
    const fetcher = createFetcher(
      jsonResponse({ profile }),
      jsonResponse({ profile }),
    );
    const api = createAccountApi(fetcher as unknown as typeof fetch);

    await expect(api.uploadAvatarPhoto(
      'data:image/webp;base64,AAAA',
      'session-token',
    )).resolves.toEqual({ profile });
    await expect(api.removeAvatarPhoto('session-token')).resolves.toEqual({ profile });

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/avatar/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer session-token',
      },
      body: JSON.stringify({ data: 'data:image/webp;base64,AAAA' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/avatar/remove', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token' },
    });
  });

  it('propaga o erro do servidor e usa a mensagem específica em resposta inválida', async () => {
    const fetcher = createFetcher(
      jsonResponse({ error: 'Credenciais inválidas.' }, 401),
      new Response('indisponível', { status: 503 }),
    );
    const api = createAccountApi(fetcher as unknown as typeof fetch);

    await expect(api.loginAccount(
      'aurelia@example.com',
      'wrong-password',
    )).rejects.toThrow('Credenciais inválidas.');
    await expect(api.uploadAvatarPhoto(
      'data:image/webp;base64,AAAA',
      'session-token',
    )).rejects.toThrow('Falha ao enviar a foto.');
  });

  it('revoga a sessão sem transformar falha HTTP em bloqueio do logout local', async () => {
    const fetcher = createFetcher(new Response(null, { status: 500 }));
    const api = createAccountApi(fetcher as unknown as typeof fetch);

    await expect(api.revokeSession('session-token')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token' },
    });
  });
});
