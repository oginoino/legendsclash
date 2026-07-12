import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { App } from './app.js';
import { createAuthService, handleAuthRoute } from './auth.js';
import { handleAvatarRoute } from './avatar.js';
import { RuntimeSnapshot } from './snapshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carrega o .env da raiz do repositório (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// PORT) sem dependências externas. É opcional: na ausência do arquivo, usa o
// ambiente do host (produção) ou cai no snapshot JSON local — ver store.ts.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env'));
} catch {
  // .env ausente: segue com process.env como está.
}

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');

// Partidas vivem em memória: um erro não tratado fora do fluxo de um request
// não pode derrubar o processo — perderia todas as batalhas em andamento e
// desconectaria todos os jogadores de uma vez.
process.on('uncaughtException', (err) => {
  console.error('[fatal-evitado] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-evitado] unhandledRejection:', reason);
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

function cacheControl(filePath: string): string {
  const ext = extname(filePath);
  const rel = filePath.slice(CLIENT_DIST.length).replace(/\\/g, '/');
  if (ext === '.html') return 'no-cache';
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]+\.(css|js)$/.test(rel)) {
    return 'public, max-age=31536000, immutable';
  }
  if (rel.startsWith('/assets/audio/') && /\.(mp3|m4a|ogg)$/i.test(rel)) {
    return 'public, max-age=31536000, immutable';
  }
  if (rel.startsWith('/assets/cards/') && /\.(png|webp|jpg|jpeg|svg)$/i.test(rel)) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }
  if (/\.(png|webp|jpg|jpeg|svg|woff2?)$/i.test(rel)) {
    return 'public, max-age=604800';
  }
  return 'no-cache';
}

function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
    || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

const store = await Store.create();
const app = new App(store);
const auth = createAuthService(store);
const runtime = new RuntimeSnapshot(app, store, process.env.LC_RUNTIME_PATH);
runtime.start();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  // Paths malformados (ex.: "GET //" de scanners) lançam em new URL — jamais
  // deixe um request qualquer derrubar o servidor inteiro.
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return json(res, 400, { error: 'URL inválida.' });
  }
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });

    // Convidado, e-mail+senha, perfil e logout — rotas em auth.ts.
    if (url.pathname.startsWith('/api/auth/')) {
      if (await handleAuthRoute(auth, req, res, url)) return;
    }

    // Upload/remoção da foto de perfil (Personalização v2) — rotas em avatar.ts.
    if (url.pathname.startsWith('/api/avatar/')) {
      if (await handleAvatarRoute(app, store, req, res, url)) return;
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Não encontrado.' });

    // Arquivos estáticos do cliente (build do Vite), com fallback de SPA
    // para que o convite por link (/room/CODIGO) funcione.
    if (existsSync(CLIENT_DIST)) {
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(url.pathname);
      } catch {
        return json(res, 400, { error: 'URL inválida.' });
      }
      const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
      let filePath = join(CLIENT_DIST, safePath);
      if (!filePath.startsWith(CLIENT_DIST) || !existsSync(filePath) || extname(filePath) === '') {
        filePath = join(CLIENT_DIST, 'index.html');
      }
      const extension = extname(filePath);
      if (extension === '.mp3') {
        const info = await stat(filePath);
        const headers = {
          'content-type': MIME[extension],
          'cache-control': cacheControl(filePath),
          'accept-ranges': 'bytes',
        };
        const range = req.headers.range;
        if (range) {
          const parsed = parseByteRange(range, info.size);
          if (!parsed) {
            res.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` });
            return res.end();
          }
          const length = parsed.end - parsed.start + 1;
          res.writeHead(206, {
            ...headers,
            'content-range': `bytes ${parsed.start}-${parsed.end}/${info.size}`,
            'content-length': length,
          });
          if (req.method === 'HEAD') return res.end();
          createReadStream(filePath, parsed).pipe(res);
          return;
        }
        res.writeHead(200, { ...headers, 'content-length': info.size });
        if (req.method === 'HEAD') return res.end();
        createReadStream(filePath).pipe(res);
        return;
      }
      const content = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME[extension] ?? 'application/octet-stream',
        'cache-control': cacheControl(filePath),
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(content);
    }

    json(res, 503, { error: 'Cliente não compilado. Rode: npm run build' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'Erro interno.' });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Heartbeat: NATs, proxies e redes móveis derrubam conexões ociosas sem
// avisar — o socket fica "aberto" porém morto. O ping periódico gera tráfego
// que mantém os intermediários vivos e o pong ausente denuncia o socket morto
// (terminate → handleClose → janela de reconexão da partida).
const HEARTBEAT_MS = 30_000;
const alive = new WeakMap<import('ws').WebSocket, boolean>();

wss.on('connection', (ws, req) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  ws.on('message', () => alive.set(ws, true));
  app.handleConnection(ws, req);
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  console.log(`⚔️  Legends Clash — servidor autoritativo em http://localhost:${PORT}`);
});

// Encerramento gracioso: um deploy/restart (systemd manda SIGTERM) salva o
// estado vivo em disco antes de trocar o processo. O boot seguinte restaura.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[runtime] ${signal} recebido — salvando estado vivo antes de sair`);
  runtime.shutdown();
  app.shutdown();
  wss.close();
  server.close(() => process.exit(0));
  // backstop: se algo travar o close, sai mesmo assim
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
