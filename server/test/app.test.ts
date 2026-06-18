import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@legendsclash/shared';
import { achievementsOf } from '@legendsclash/shared';
import { Store, advanceStreak } from '../src/store.js';
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

describe('app · moderação e anti-abuso', () => {
  /** Põe dois convidados numa sala (vira recipients de chat) e devolve os sockets. */
  async function pairInRoom(store: Store, connect: () => FakeSocket) {
    const a = store.createGuest('A', '🦊');
    const b = store.createGuest('B', '🦉');
    const wsA = connect();
    wsA.msg({ t: 'hello', token: store.createSession(a.id) });
    const wsB = connect();
    wsB.msg({ t: 'hello', token: store.createSession(b.id) });
    wsA.msg({ t: 'room:create' });
    const code = wsA.byType('room:state').at(-1)!.room!.code;
    wsB.msg({ t: 'room:join', code });
    return { wsA, wsB };
  }

  it('rate-limit do servidor barra flood de chat livre', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const { wsA, wsB } = await pairInRoom(store, connect);

    for (let i = 0; i < 50; i++) wsA.msg({ t: 'chat:send', text: `flood ${i}` });

    const delivered = wsB.byType('chat:message').length;
    expect(delivered).toBeGreaterThan(0); // o burst inicial passa
    expect(delivered).toBeLessThanOrEqual(6); // mas o flood é contido
  });

  it('provocação tipada respeita o cooldown server-side', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const { wsA, wsB } = await pairInRoom(store, connect);

    wsA.msg({ t: 'chat:taunt', id: 'gg' });
    wsA.msg({ t: 'chat:taunt', id: 'gg' }); // dentro do cooldown → descartada

    const taunts = wsB.byType('chat:message').filter((m) => m.message.text.includes('Boa partida'));
    expect(taunts).toHaveLength(1);
  });

  it('report valida o alvo, auto-silencia o denunciado e rejeita auto-denúncia', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const a = store.createGuest('A', '🦊');
    const b = store.createGuest('B', '🦉');
    const wsA = connect();
    wsA.msg({ t: 'hello', token: store.createSession(a.id) });
    const wsB = connect();
    wsB.msg({ t: 'hello', token: store.createSession(b.id) });
    wsA.msg({ t: 'room:create' });
    const code = wsA.byType('room:state').at(-1)!.room!.code;
    wsB.msg({ t: 'room:join', code });

    wsA.msg({ t: 'chat:report', playerId: a.id, reason: 'x' }); // auto-denúncia
    expect(wsA.byType('error').some((e) => e.message.includes('não pode se denunciar'))).toBe(true);

    wsA.msg({ t: 'chat:report', playerId: 'fantasma', reason: 'x' }); // fora da sala
    expect(wsA.byType('error').some((e) => e.message.includes('sala ou partida'))).toBe(true);

    wsA.msg({ t: 'chat:report', playerId: b.id, reason: 'toxico' }); // válido
    expect(wsA.byType('chat:report:ok')).toHaveLength(1);
    expect(store.userById(a.id)!.muted).toContain(b.id); // auto-silenciado
  });

  it('shutdown gracioso tira os jogadores da partida sem Elo e registra match_aborted', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const a = store.createGuest('A', '🦊');
    const b = store.createGuest('B', '🦉');
    const wsA = connect();
    wsA.msg({ t: 'hello', token: store.createSession(a.id) });
    const wsB = connect();
    wsB.msg({ t: 'hello', token: store.createSession(b.id) });
    wsA.msg({ t: 'room:create' });
    const code = wsA.byType('room:state').at(-1)!.room!.code;
    wsB.msg({ t: 'room:join', code });
    wsA.msg({ t: 'room:start' });

    app.shutdown();

    expect(wsA.byType('game:state').at(-1)).toEqual({ t: 'game:state', view: null });
    expect(wsA.byType('game:over')).toHaveLength(0); // sem resultado/Elo
    expect(store.recentEvents().filter((e) => e.type === 'match_aborted')).toHaveLength(2);
  });

  it('rejeita id de provocação fora do catálogo', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const { wsA, wsB } = await pairInRoom(store, connect);

    wsA.msg({ t: 'chat:taunt', id: 'inexistente' });

    expect(wsA.byType('error').some((e) => e.message.includes('Provocação inválida'))).toBe(true);
    expect(wsB.byType('chat:message')).toHaveLength(0);
  });
});

describe('app · telemetria (analytics)', () => {
  it('emite session_start no hello e queue_join ao entrar na fila', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const guest = store.createGuest('Ana', '🦊');
    const ws = connect();
    ws.msg({ t: 'hello', token: store.createSession(guest.id) });
    ws.msg({ t: 'queue:join' });

    const types = store.recentEvents().filter((e) => e.userId === guest.id).map((e) => e.type);
    expect(types).toContain('session_start');
    expect(types).toContain('queue_join');
  });

  it('fila com um jogador sinaliza waitingAlone; o segundo desfaz o sinal', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const a = store.createGuest('A', '🦊');
    const wsA = connect();
    wsA.msg({ t: 'hello', token: store.createSession(a.id) });
    wsA.msg({ t: 'queue:join' });

    expect(wsA.byType('queue:status').at(-1)).toMatchObject({ inQueue: true, size: 1, waitingAlone: true });

    const b = store.createGuest('B', '🦉');
    const wsB = connect();
    wsB.msg({ t: 'hello', token: store.createSession(b.id) });
    wsB.msg({ t: 'queue:join' });

    // a chegada do 2º difunde o novo estado a quem já esperava
    expect(wsA.byType('queue:status').at(-1)).toMatchObject({ size: 2, waitingAlone: false });
    expect(wsB.byType('queue:status').at(-1)).toMatchObject({ waitingAlone: false });
  });

  it('advanceStreak: avança em dias consecutivos, reinicia após intervalo, não conta 2x/dia', () => {
    expect(advanceStreak(0, 0, 20000)).toEqual({ streak: 1, lastPlayDay: 20000 }); // 1ª partida
    expect(advanceStreak(3, 20000, 20001)).toEqual({ streak: 4, lastPlayDay: 20001 }); // dia seguinte
    expect(advanceStreak(3, 20000, 20005)).toEqual({ streak: 1, lastPlayDay: 20005 }); // quebrou
    expect(advanceStreak(3, 20000, 20000)).toEqual({ streak: 3, lastPlayDay: 20000 }); // mesmo dia
  });

  it('recordMatch atualiza a sequência; profileOf expõe streak e playedToday', async () => {
    const store = await Store.create(tmpDbPath());
    const { user } = store.findOrCreatePlayerByAuth('streak@t.test', null);
    expect(store.profileOf(user).streak).toBe(0);
    expect(store.profileOf(user).playedToday).toBe(false);

    store.recordMatch(user.id, {
      matchId: 'm1', opponentId: 'x', opponentName: 'X', won: true,
      reason: 'hp', mmrDelta: 16, turns: 5, durationMs: 1000, endedAt: Date.now(),
    }, user.mmr + 16, true);

    const prof = store.profileOf(store.userById(user.id)!);
    expect(prof.streak).toBe(1);
    expect(prof.playedToday).toBe(true);
  });

  it('achievementsOf deriva conquistas de vitórias e partidas (monotônicas)', () => {
    expect(achievementsOf(0, 0)).toEqual([]);
    expect(achievementsOf(1, 1)).toEqual(['first_win']);
    expect(achievementsOf(10, 12)).toEqual(['first_win', 'veteran_10', 'winner_10']);
    expect(achievementsOf(10, 50)).toEqual(['first_win', 'veteran_10', 'winner_10', 'veteran_50']);
  });

  it('cosmético por mérito: comandante bloqueado é recusado até a conquista', async () => {
    const store = await Store.create(tmpDbPath());
    const { user } = store.findOrCreatePlayerByAuth('merito@t.test', null);
    const base = user.commander;
    // '👑' (Monarca) exige winner_10 → sem vitórias é recusado
    store.updateCosmetics(user.id, { commander: '👑' });
    expect(store.userById(user.id)!.commander).toBe(base);
    // 10 vitórias desbloqueiam
    user.wins = 10;
    store.updateCosmetics(user.id, { commander: '👑' });
    expect(store.userById(user.id)!.commander).toBe('👑');
    expect(store.profileOf(store.userById(user.id)!).achievements).toContain('winner_10');
  });

  it('rankView devolve a posição do jogador e os vizinhos por MMR', async () => {
    const store = await Store.create(tmpDbPath());
    const mk = (name: string, mmr: number) => {
      const { user } = store.findOrCreatePlayerByAuth(`${name}@t.test`, null);
      user.name = name;
      user.mmr = mmr;
      user.wins = 1; // pontua no ranking (jogos > 0)
      return user;
    };
    // a=1500, b=1450, c=1400, d=1350, e=1300
    const ids = [['a', 1500], ['b', 1450], ['c', 1400], ['d', 1350], ['e', 1300]]
      .map(([n, m]) => mk(n as string, m as number).id);

    const rv = store.rankView(ids[2], 1); // 'c', span 1
    expect(rv).not.toBeNull();
    expect(rv!.rank).toBe(3);
    expect(rv!.around.map((u) => u.name)).toEqual(['b', 'c', 'd']);

    // jogador sem partidas não pontua
    const { user: novato } = store.findOrCreatePlayerByAuth('novato@t.test', null);
    expect(store.rankView(novato.id)).toBeNull();
  });

  it('uma partida completa emite match_start, match_end e first_match_completed', async () => {
    const { store, app, connect } = await makeApp();
    dispose = () => app.dispose();
    const a = store.createGuest('A', '🦊');
    const b = store.createGuest('B', '🦉');
    const wsA = connect();
    wsA.msg({ t: 'hello', token: store.createSession(a.id) });
    const wsB = connect();
    wsB.msg({ t: 'hello', token: store.createSession(b.id) });
    wsA.msg({ t: 'room:create' });
    const code = wsA.byType('room:state').at(-1)!.room!.code;
    wsB.msg({ t: 'room:join', code });
    wsA.msg({ t: 'room:start' });

    expect(store.recentEvents().filter((e) => e.type === 'match_start')).toHaveLength(1);

    // a partida começa na fase de mulligan; ambos confirmam para ir ao turno 1
    wsA.msg({ t: 'game:mulligan', iids: [] });
    wsB.msg({ t: 'game:mulligan', iids: [] });

    wsA.msg({ t: 'game:surrender' }); // encerra a partida

    const ends = store.recentEvents().filter((e) => e.type === 'match_end');
    expect(ends).toHaveLength(1);
    expect((ends[0].props as { reason: string }).reason).toBe('surrender');
    // ambos jogavam a primeira partida
    expect(store.recentEvents().filter((e) => e.type === 'first_match_completed')).toHaveLength(2);
  });
});
