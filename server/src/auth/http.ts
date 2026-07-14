import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from './auth-service.js';
import { AuthError } from './errors.js';

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

function optionalBearerToken(req: IncomingMessage): string | undefined {
  return /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** Atende /api/auth/*. Retorna false se a rota nao for de autenticacao. */
export async function handleAuthRoute(
  auth: AuthService,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = `${req.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'POST /api/auth/guest': {
        const body = await readBody(req);
        const result = auth.guest(String(body.name ?? ''), String(body.avatar ?? ''), clientIp(req));
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/register': {
        const body = await readBody(req);
        const result = await auth.register(
          String(body.email ?? ''),
          String(body.password ?? ''),
          clientIp(req),
          optionalBearerToken(req),
        );
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/login': {
        const body = await readBody(req);
        const result = await auth.login(String(body.email ?? ''), String(body.password ?? ''), clientIp(req));
        json(res, 200, result);
        return true;
      }
      case 'POST /api/auth/forgot': {
        const body = await readBody(req);
        const result = await auth.requestPasswordReset(String(body.email ?? ''), clientIp(req));
        json(res, 200, { ok: true, ...result });
        return true;
      }
      case 'POST /api/auth/reset': {
        const body = await readBody(req);
        const result = await auth.resetPassword(String(body.token ?? ''), String(body.password ?? ''), clientIp(req));
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
