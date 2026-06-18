import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { App } from './app.js';
import { createAuthService, handleAuthRoute } from './auth.js';

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
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const store = await Store.create();
const app = new App(store);
const auth = createAuthService(store);

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

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Não encontrado.' });

    // Arquivos estáticos do cliente (build do Vite), com fallback de SPA
    // para que o convite por link (/room/CODIGO) funcione.
    if (existsSync(CLIENT_DIST)) {
      const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      let filePath = join(CLIENT_DIST, safePath);
      if (!filePath.startsWith(CLIENT_DIST) || !existsSync(filePath) || extname(filePath) === '') {
        filePath = join(CLIENT_DIST, 'index.html');
      }
      const content = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
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

// Encerramento gracioso: um deploy/restart (systemd manda SIGTERM) tira os
// jogadores das partidas em andamento de volta ao menu sem perda de Elo, em vez
// de matar o processo com as batalhas em memória ainda ativas.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — encerrando partidas e fechando o servidor`);
  app.shutdown();
  wss.close();
  server.close(() => process.exit(0));
  // backstop: se algo travar o close, sai mesmo assim
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
