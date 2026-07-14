import type { Profile } from '@legendsclash/shared';

export interface SessionResponse {
  token: string;
  profile: Profile;
  needsProfile: boolean;
}

export interface PasswordResetResponse {
  ok: boolean;
  devLink?: string;
}

export interface ProfileResponse {
  profile: Profile;
}

interface JsonRequest {
  body?: unknown;
  token?: string;
  fallbackMessage: string;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (
    payload
    && typeof payload === 'object'
    && 'error' in payload
    && typeof payload.error === 'string'
  ) return payload.error;
  return fallback;
}

async function postJson<T>(
  fetcher: typeof fetch,
  path: string,
  { body, token, fallbackMessage }: JsonRequest,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetcher(path, {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(payload, fallbackMessage));
  return payload as T;
}

export function createAccountApi(fetcher: typeof fetch = (input, init) => fetch(input, init)) {
  return {
    loginAsGuest(name: string, avatar: string): Promise<SessionResponse> {
      return postJson(fetcher, '/api/auth/guest', {
        body: { name, avatar },
        fallbackMessage: 'Falha na requisição.',
      });
    },

    registerAccount(
      email: string,
      password: string,
      guestToken?: string,
    ): Promise<SessionResponse> {
      return postJson(fetcher, '/api/auth/register', {
        body: { email, password },
        token: guestToken,
        fallbackMessage: 'Falha na requisição.',
      });
    },

    loginAccount(email: string, password: string): Promise<SessionResponse> {
      return postJson(fetcher, '/api/auth/login', {
        body: { email, password },
        fallbackMessage: 'Falha na requisição.',
      });
    },

    requestPasswordReset(email: string): Promise<PasswordResetResponse> {
      return postJson(fetcher, '/api/auth/forgot', {
        body: { email },
        fallbackMessage: 'Falha na requisição.',
      });
    },

    resetPassword(token: string, password: string): Promise<SessionResponse> {
      return postJson(fetcher, '/api/auth/reset', {
        body: { token, password },
        fallbackMessage: 'Falha na requisição.',
      });
    },

    completeProfile(name: string, avatar: string, token: string): Promise<ProfileResponse> {
      return postJson(fetcher, '/api/auth/profile', {
        body: { name, avatar },
        token,
        fallbackMessage: 'Falha na requisição.',
      });
    },

    uploadAvatarPhoto(dataUrl: string, token: string): Promise<ProfileResponse> {
      return postJson(fetcher, '/api/avatar/upload', {
        body: { data: dataUrl },
        token,
        fallbackMessage: 'Falha ao enviar a foto.',
      });
    },

    removeAvatarPhoto(token: string): Promise<ProfileResponse> {
      return postJson(fetcher, '/api/avatar/remove', {
        token,
        fallbackMessage: 'Falha ao remover a foto.',
      });
    },

    async revokeSession(token: string): Promise<void> {
      await fetcher('/api/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
    },
  };
}

export const accountApi = createAccountApi();
