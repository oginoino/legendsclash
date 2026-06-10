import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@legendsclash/shared';
import { Store } from '../src/store.js';
import { App } from '../src/app.js';

/**
 * Conexão e ressincronização: o contrato que mantém o cliente fora do limbo
 * quando a rede pisca ou o servidor reinicia no meio de uma batalha.
 */

process.env.LC_LOCAL = '1'; // nunca tocar Supabase em testes

function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'lc-app-')), 'db.json');
}

/** Socket falso: captura o que o servidor envia e os fechamentos. */
class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: ServerMsg[] = [];
  closedWith: number | undefined;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMsg);
  }

  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code;
    this.emit('close');
  }

  msg(m: unknown): void {
    this.emit('message', JSON.stringify(m));
  }

  byType<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  }
}

async function makeApp() {
  const store = await Store.create(tmpDbPath());
  const app = new App(store);
  const connect = () => {
    const ws = new FakeSocket();
    app.handleConnection(ws as never);
    return ws;
  };
  return { store, app, connect };
}

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('app · conexão', () => {
  it('responde ping com pong sem exigir autenticação', async () => {
    const { app, connect } = await makeApp();
    dispose = () => app.dispose();

    const ws = connect();
    ws.msg({ t: 'ping' });

    expect(ws.byType('pong')).toHaveLength(1);
    expect(ws.byType('error')).toHaveLength(0);
  });

  it('hello sem partida envia a verdade completa: jogo nulo, fora da fila, sem sala', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const guest = store.createGuest('Ana', '🦊');
    const token = store.createSession(guest.id);

    const ws = connect();
    ws.msg({ t: 'hello', token });

    expect(ws.byType('hello:ok')).toHaveLength(1);
    // destrava clientes que ficaram com batalha/sala fantasma de antes de um restart
    expect(ws.byType('game:state')).toEqual([{ t: 'game:state', view: null }]);
    expect(ws.byType('queue:status')[0]).toMatchObject({ inQueue: false });
    expect(ws.byType('room:state')).toEqual([{ t: 'room:state', room: null }]);
  });

  it('conexão nova substitui a antiga com código 4001 (sem cabo de guerra)', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const guest = store.createGuest('Bia', '🦉');
    const token = store.createSession(guest.id);

    const first = connect();
    first.msg({ t: 'hello', token });
    const second = connect();
    second.msg({ t: 'hello', token });

    expect(first.closedWith).toBe(4001);
    expect(second.byType('hello:ok')).toHaveLength(1);
  });
});
