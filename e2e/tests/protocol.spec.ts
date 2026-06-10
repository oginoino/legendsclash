import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { uniqueEmail } from './helpers.js';

/**
 * E2E no nível do protocolo WebSocket: valida o contrato servidor-cliente
 * sem navegador — autenticação, salas, chat moderado, partida autoritativa,
 * Elo e ranking, exatamente como um cliente real os consome.
 */

const BASE = 'http://localhost:8787';

interface WsClient {
  send: (m: unknown) => void;
  waitFor: <T = Record<string, unknown>>(pred: (m: T) => boolean, ms?: number) => Promise<T>;
  close: () => void;
}

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const PASSWORD = 'senha-e2e-12345';

/** Conta completa via HTTP: register (e-mail+senha) → profile. */
async function auth(email: string, name: string, avatar: string) {
  const reg = await post('/api/auth/register', { email, password: PASSWORD });
  expect(reg.ok).toBe(true);
  const registered = await reg.json();
  expect(registered.needsProfile).toBe(true); // conta nova nasce sem nome

  const prof = await post('/api/auth/profile', { name, avatar }, registered.token);
  expect(prof.ok).toBe(true);
  const { profile } = await prof.json();
  return { token: registered.token as string, profile };
}

function connect(token: string): Promise<WsClient> {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
  const inbox: unknown[] = [];
  const waiters: Array<[(m: never) => boolean, (m: unknown) => void]> = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const [pred, resolve] = waiters[i];
      if (pred(msg as never)) {
        waiters.splice(i, 1);
        resolve(msg);
      }
    }
  });
  const client: WsClient = {
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor: (pred, ms = 10_000) =>
      new Promise((resolve, reject) => {
        const found = inbox.find((m) => pred(m as never));
        if (found) return resolve(found as never);
        const t = setTimeout(
          () => reject(new Error(`timeout esperando mensagem (${pred.toString().slice(0, 80)})`)),
          ms,
        );
        waiters.push([pred as (m: never) => boolean, (m) => { clearTimeout(t); resolve(m as never); }]);
      }),
    close: () => ws.close(),
  };
  return new Promise((resolve) => {
    ws.on('open', () => {
      client.send({ t: 'hello', token });
      resolve(client);
    });
  });
}

test('contrato completo: login → sala → chat filtrado → partida → Elo → ranking', async () => {
  test.setTimeout(60_000);

  // login: novato nasce Bronze 1000
  const a = await auth(uniqueEmail('xavier'), 'Xavier', '🐺');
  const b = await auth(uniqueEmail('aline'), 'Aline', '🔮');
  expect(a.profile.mmr).toBe(1000);
  expect(a.profile.league).toBe('Bronze');

  const ca = await connect(a.token);
  const cb = await connect(b.token);
  await ca.waitFor((m: { t: string }) => m.t === 'hello:ok');
  await cb.waitFor((m: { t: string }) => m.t === 'hello:ok');

  // sala com código de convite
  ca.send({ t: 'room:create' });
  const roomMsg = await ca.waitFor<{ t: string; room: { code: string } | null }>(
    (m) => m.t === 'room:state' && !!m.room,
  );
  const code = roomMsg.room!.code;
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  cb.send({ t: 'room:join', code });
  await ca.waitFor<{ t: string; room: { members: unknown[] } | null }>(
    (m) => m.t === 'room:state' && m.room?.members.length === 2,
  );

  // filtro de palavras roda no servidor
  cb.send({ t: 'chat:send', text: 'oi, seu idiota' });
  const chat = await ca.waitFor<{ t: string; message: { text: string } }>((m) => m.t === 'chat:message');
  expect(chat.message.text).not.toContain('idiota');
  expect(chat.message.text).toContain('*');

  // partida iniciada: estado redigido (mão do oponente nunca trafega)
  ca.send({ t: 'room:start' });
  const ga = await ca.waitFor<{ t: string; view: GameViewWire }>((m) => m.t === 'game:state');
  const gb = await cb.waitFor<{ t: string; view: GameViewWire }>((m) => m.t === 'game:state');
  expect(ga.view.matchId).toBe(gb.view.matchId);
  expect(gb.view.hand).toHaveLength(5);
  expect(gb.view.seats[ga.view.yourSeat].handCount).toBe(5);
  expect(JSON.stringify(gb.view.seats)).not.toContain('"hand"');

  // validação autoritativa: agir fora do turno é rejeitado
  const idle = ga.view.turnSeat === ga.view.yourSeat ? cb : ca;
  idle.send({ t: 'game:endTurn' });
  await idle.waitFor<{ t: string; message: string }>(
    (m) => m.t === 'error' && m.message === 'Não é o seu turno.',
  );

  // desistência → Elo ±16 entre iguais → ranking e histórico
  cb.send({ t: 'game:surrender' });
  const over = await ca.waitFor<{ t: string; result: MatchResultWire }>((m) => m.t === 'game:over');
  expect(over.result.reason).toBe('surrender');
  expect(over.result.winnerId).toBe(a.profile.id);
  expect(over.result.mmr[a.profile.id].delta).toBe(16);
  expect(over.result.mmr[b.profile.id].delta).toBe(-16);

  ca.send({ t: 'history:get' });
  const hist = await ca.waitFor<{ t: string; entries: Array<{ won: boolean }> }>(
    (m) => m.t === 'history' && m.entries.length > 0,
  );
  expect(hist.entries[0].won).toBe(true);

  ca.send({ t: 'leaderboard:get' });
  const lb = await ca.waitFor<{ t: string; entries: Array<{ mmr: number }> }>(
    (m) => m.t === 'leaderboard' && m.entries.length >= 2,
  );
  expect(lb.entries[0].mmr).toBeGreaterThanOrEqual(lb.entries[1].mmr);

  ca.close();
  cb.close();
});

test('autenticação: senha errada é rejeitada e token revogado derruba o WS', async () => {
  const email = uniqueEmail('seguranca');
  expect((await post('/api/auth/register', { email, password: PASSWORD })).ok).toBe(true);

  // senha errada → 401 em pt-BR, sem revelar se a conta existe
  const bad = await post('/api/auth/login', { email, password: 'senha-errada-99' });
  expect(bad.status).toBe(401);
  expect((await bad.json()).error).toContain('E-mail ou senha incorretos');

  // com a senha certa, entra
  const good = await post('/api/auth/login', { email, password: PASSWORD });
  expect(good.ok).toBe(true);
  const { token } = await good.json();

  // logout revoga a sessão: o WS recusa o token revogado
  expect((await post('/api/auth/logout', {}, token)).ok).toBe(true);
  const c = await connect(token);
  const err = await c.waitFor<{ t: string; message: string }>((m) => m.t === 'error');
  expect(err.message).toBe('Sessão expirada. Entre novamente.');
  c.close();
});

test('convidado: joga e conversa sem cadastro; criar conta herda o progresso da sessão', async () => {
  test.setTimeout(30_000);
  const reg = await post('/api/auth/guest', { name: 'Visitante', avatar: '🐺' });
  expect(reg.ok).toBe(true);
  const guest = await reg.json();
  expect(guest.profile.guest).toBe(true);

  const conta = await auth(uniqueEmail('anfitria'), 'Anfitriã', '🔮');
  const cg = await connect(guest.token);
  const ch = await connect(conta.token);
  await cg.waitFor((m: { t: string }) => m.t === 'hello:ok');
  await ch.waitFor((m: { t: string }) => m.t === 'hello:ok');

  // convidado entra na sala de quem tem conta — jogar é livre
  ch.send({ t: 'room:create' });
  const roomMsg = await ch.waitFor<{ t: string; room: { code: string } | null }>(
    (m) => m.t === 'room:state' && !!m.room,
  );
  cg.send({ t: 'room:join', code: roomMsg.room!.code });
  await ch.waitFor<{ t: string; room: { members: unknown[] } | null }>(
    (m) => m.t === 'room:state' && m.room?.members.length === 2,
  );

  // chat de sala/partida é efêmero: convidado conversa, com o mesmo filtro
  cg.send({ t: 'chat:send', text: 'oi, seu idiota' });
  const chat = await ch.waitFor<{ t: string; message: { text: string } }>(
    (m) => m.t === 'chat:message',
  );
  expect(chat.message.text).not.toContain('idiota');
  expect(chat.message.text).toContain('*');

  // partida real: a anfitriã desiste e o convidado vence
  ch.send({ t: 'room:start' });
  await cg.waitFor((m: { t: string }) => m.t === 'game:state');
  ch.send({ t: 'game:surrender' });
  const over = await cg.waitFor<{ t: string; result: { winnerId: string; mmr: Record<string, { after: number }> } }>(
    (m) => m.t === 'game:over',
  );
  expect(over.result.winnerId).toBe(guest.profile.id);
  expect(over.result.mmr[guest.profile.id].after).toBe(1016);

  // o progresso vive na sessão: histórico em memória, mas fora do ranking
  cg.send({ t: 'history:get' });
  const hist = await cg.waitFor<{ t: string; entries: Array<{ won: boolean }> }>(
    (m) => m.t === 'history' && m.entries.length > 0,
  );
  expect(hist.entries[0].won).toBe(true);
  cg.send({ t: 'leaderboard:get' });
  const lb = await cg.waitFor<{ t: string; entries: Array<{ id: string }> }>(
    (m) => m.t === 'leaderboard',
  );
  expect(lb.entries.map((e) => e.id)).not.toContain(guest.profile.id);

  // promoção: registro com o Bearer do convidado herda tudo — sem onboarding
  const promo = await post(
    '/api/auth/register',
    { email: uniqueEmail('promovido'), password: PASSWORD },
    guest.token,
  );
  expect(promo.ok).toBe(true);
  const promoted = await promo.json();
  expect(promoted.needsProfile).toBe(false);
  expect(promoted.profile.guest).toBe(false);
  expect(promoted.profile.name).toBe('Visitante');
  expect(promoted.profile.mmr).toBe(1016);
  expect(promoted.profile.wins).toBe(1);

  // a sessão de convidado morreu junto com a promoção
  const dead = await connect(guest.token);
  const err = await dead.waitFor<{ t: string; message: string }>((m) => m.t === 'error');
  expect(err.message).toBe('Sessão expirada. Entre novamente.');

  dead.close();
  cg.close();
  ch.close();
});

test('matchmaking pareia dois jogadores da fila', async () => {
  test.setTimeout(30_000);
  const a = await auth(uniqueEmail('fila-a'), 'FilaA', '🛡️');
  const b = await auth(uniqueEmail('fila-b'), 'FilaB', '⚔️');
  const ca = await connect(a.token);
  const cb = await connect(b.token);
  await ca.waitFor((m: { t: string }) => m.t === 'hello:ok');
  await cb.waitFor((m: { t: string }) => m.t === 'hello:ok');

  ca.send({ t: 'queue:join' });
  cb.send({ t: 'queue:join' });
  const ga = await ca.waitFor<{ t: string; view: GameViewWire }>((m) => m.t === 'game:state');
  const gb = await cb.waitFor<{ t: string; view: GameViewWire }>((m) => m.t === 'game:state');
  expect(ga.view.matchId).toBe(gb.view.matchId);

  ca.send({ t: 'game:surrender' });
  await cb.waitFor((m: { t: string }) => m.t === 'game:over');
  ca.close();
  cb.close();
});

interface GameViewWire {
  matchId: string;
  yourSeat: number;
  turnSeat: number;
  hand: unknown[];
  seats: Array<{ handCount: number }>;
}

interface MatchResultWire {
  reason: string;
  winnerId: string;
  mmr: Record<string, { delta: number }>;
}
