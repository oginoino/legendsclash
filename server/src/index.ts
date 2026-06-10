import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { App } from './app.js';

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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });

    // Login do MVP: e-mail + nome + avatar. Google OAuth está no roadmap Next.
    if (url.pathname === '/api/auth' && req.method === 'POST') {
      const body = (await readBody(req)) as { email?: string; name?: string; avatar?: string };
      const email = String(body.email ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(res, 400, { error: 'Informe um e-mail válido.' });
      }
      const user = store.loginOrRegister(email, String(body.name ?? ''), String(body.avatar ?? ''));
      return json(res, 200, { token: user.token, profile: store.profileOf(user) });
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
wss.on('connection', (ws) => app.handleConnection(ws));

server.listen(PORT, () => {
  console.log(`⚔️  Legends Clash — servidor autoritativo em http://localhost:${PORT}`);
});
