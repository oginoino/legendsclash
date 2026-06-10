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

/** Código OTP pendente — o servidor dos testes roda em modo local. */
async function devCode(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/dev-code?email=${encodeURIComponent(email)}`);
  expect(res.ok).toBe(true);
  return (await res.json()).code;
}

/** Login OTP completo via HTTP: otp → dev-code → verify → profile. */
async function auth(email: string, name: string, avatar: string) {
  const otp = await post('/api/auth/otp', { email });
  expect(otp.ok).toBe(true);

  const verify = await post('/api/auth/verify', { email, code: await devCode(email) });
  expect(verify.ok).toBe(true);
  const verified = await verify.json();
  expect(verified.needsProfile).toBe(true); // conta nova nasce sem nome

  const prof = await post('/api/auth/profile', { name, avatar }, verified.token);
  expect(prof.ok).toBe(true);
  const { profile } = await prof.json();
  return { token: verified.token as string, profile };
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

test('autenticação: código errado é rejeitado e token inválido derruba o WS', async () => {
  const email = uniqueEmail('seguranca');
  expect((await post('/api/auth/otp', { email })).ok).toBe(true);

  // código errado (derivado do verdadeiro para nunca colidir) → 400 em pt-BR
  const real = await devCode(email);
  const wrong = String((Number(real[0]) + 1) % 10) + real.slice(1);
  const bad = await post('/api/auth/verify', { email, code: wrong });
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain('Código inválido');

  // o código continua válido para a tentativa correta
  const good = await post('/api/auth/verify', { email, code: real });
  expect(good.ok).toBe(true);
  const { token } = await good.json();

  // logout revoga a sessão: o WS recusa o token revogado
  expect((await post('/api/auth/logout', {}, token)).ok).toBe(true);
  const c = await connect(token);
  const err = await c.waitFor<{ t: string; message: string }>((m) => m.t === 'error');
  expect(err.message).toBe('Sessão expirada. Entre novamente.');
  c.close();
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
