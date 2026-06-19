import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from './app.js';
import type { Store } from './store.js';
import { contentFlags } from './content.js';
import { RateLimiter } from './ratelimit.js';

/**
 * Upload da foto de perfil (Personalização v2). A foto é VISÍVEL AO OPONENTE,
 * então o servidor valida formato e tamanho aqui (assinatura de bytes + teto),
 * hospeda no backend de persistência (Supabase Storage em prod, data-URL inline
 * no modo local) e reflete na partida em andamento. Sem moderação de conteúdo
 * automática — apoia-se no sistema de denúncia já existente; por isso fica atrás
 * da flag `LC_COSMETICS_V2`, desligável a quente.
 *
 *   POST /api/avatar/upload  Bearer + { data: <data-URL> }  → { profile }
 *   POST /api/avatar/remove  Bearer                          → { profile }
 */

/** Teto dos bytes decodificados (~512KB). O cliente já reduz para ~256px. */
const MAX_BYTES = 512 * 1024;
const ALLOWED: Record<string, RegExp> = {
  'image/png': /^data:image\/png;base64,/,
  'image/jpeg': /^data:image\/jpe?g;base64,/,
  'image/webp': /^data:image\/webp;base64,/,
};

// anti-flood: poucas trocas de foto por usuário autenticado (token bucket).
// Chaveado por user.id (não por IP): o X-Forwarded-For é falsificável e geraria
// bucket novo a cada request forjado, além de fazer o Map crescer sem limite.
// Mesmo padrão dos limiters de app.ts.
const uploadLimiter = new RateLimiter(6, 0.1); // burst 6, ~1 a cada 10s

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function bearerToken(req: IncomingMessage): string | undefined {
  return /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
}

async function readBody(req: IncomingMessage, limitBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limitBytes) throw new Error('payload grande demais');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('corpo inválido');
  }
}

/**
 * Valida o data-URL e decodifica os bytes. Confere o magic-number real (não só o
 * mime declarado) para PNG/JPEG/WebP, evitando upload de payload disfarçado.
 */
export function decodeImage(dataUrl: string): { bytes: Buffer; contentType: string } {
  const contentType = Object.keys(ALLOWED).find((ct) => ALLOWED[ct].test(dataUrl));
  if (!contentType) throw new Error('Formato não suportado. Use PNG, JPEG ou WebP.');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new Error('Imagem vazia.');
  if (bytes.length > MAX_BYTES) throw new Error('Imagem grande demais (máx. 512KB).');
  const okMagic =
    (contentType === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50) ||
    (contentType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (contentType === 'image/webp' &&
      bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!okMagic) throw new Error('Arquivo de imagem inválido.');
  return { bytes, contentType };
}

/** Atende /api/avatar/*. Retorna false se a rota não for de avatar. */
export async function handleAvatarRoute(
  app: App,
  store: Store,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = `${req.method} ${url.pathname}`;
  if (route !== 'POST /api/avatar/upload' && route !== 'POST /api/avatar/remove') return false;

  // gate da flag: enquanto a personalização v2 não estiver ligada, a rota não existe
  if (!contentFlags.cosmeticsV2) {
    json(res, 404, { error: 'Não encontrado.' });
    return true;
  }

  try {
    const token = bearerToken(req);
    const user = token ? store.userBySession(token) : undefined;
    if (!user) {
      json(res, 401, { error: 'Sessão expirada. Entre novamente.' });
      return true;
    }
    if (!uploadLimiter.take(user.id)) {
      json(res, 429, { error: 'Muitas trocas de foto. Aguarde alguns segundos.' });
      return true;
    }

    if (route === 'POST /api/avatar/remove') {
      const profile = app.applyPhoto(user.id, null);
      json(res, 200, { profile });
      return true;
    }

    // upload: corpo limitado a ~700KB (base64 infla ~33% sobre os 512KB de bytes)
    const body = await readBody(req, 720 * 1024);
    const data = String(body.data ?? '');
    const { bytes, contentType } = decodeImage(data);
    const photoUrl = await store.uploadAvatar(user.id, bytes, contentType);
    const profile = app.applyPhoto(user.id, photoUrl);
    json(res, 200, { profile });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha no upload.';
    // erros de validação são 400; só o limite de payload do readBody escapa como genérico
    json(res, 400, { error: message });
    return true;
  }
}
