import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_GRACE_MS, type ServerMsg } from '@legendsclash/shared';
import { Match, type EngineResult, type MatchPlayer } from '../src/game/engine.js';
import { Store } from '../src/store.js';
import { App } from '../src/app.js';
import { RuntimeSnapshot } from '../src/snapshot.js';

process.env.LC_LOCAL = '1';

function players(n: number): MatchPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Jogador ${i}`,
    avatar: 'shield',
    commander: 'shield',
    accent: '#e3b341',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    mmr: 1000,
    tutorialEligible: true,
  }));
}

function makeMatch(turnSeconds = 60) {
  let result: EngineResult | null = null;
  const m = new Match(players(2), () => {}, (r) => { result = r; }, turnSeconds);
  return { m, result: () => result };
}

function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  vi.useRealTimers();
});

function track(m: Match): Match {
  cleanups.push(() => m.dispose());
  return m;
}

describe('engine · snapshot da partida', () => {
  it('toSnapshot → restore preserva mesa, mãos, recursos, estatísticas e turno', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_lobo' }, { iid: 'x2', defId: 's_faisca' }];
    m.seats[0].energy = 5;
    m.seats[0].shield = 3;
    m.seats[1].fatigue = 2;
    m.seats[1].attackBonus = 1;
    m.seats[1].spellBonus = 1;
    m.seats[1].artifacts = ['a_estandarte'];
    m.playCard('p0', 'x1');

    const before0 = m.viewFor('p0');
    const before1 = m.viewFor('p1');
    const restored = track(Match.restore(viaJson(m.toSnapshot()), () => {}, () => {}));

    expect(restored.id).toBe(m.id);
    const after0 = restored.viewFor('p0');
    expect(after0.matchId).toBe(before0.matchId);
    expect(after0.turnSeat).toBe(before0.turnSeat);
    expect(after0.turnNumber).toBe(before0.turnNumber);
    expect(after0.hand).toEqual(before0.hand);
    expect(restored.viewFor('p1').hand).toEqual(before1.hand);
    expect(after0.plays).toEqual(before0.plays);
    expect(after0.actions).toEqual(before0.actions);
    for (const i of [0, 1]) {
      const a = after0.seats[i];
      const b = before0.seats[i];
      expect(a.board).toEqual(b.board);
      expect([a.hp, a.shield, a.energy, a.maxEnergy, a.deckCount, a.handCount])
        .toEqual([b.hp, b.shield, b.energy, b.maxEnergy, b.deckCount, b.handCount]);
      expect([a.artifacts, a.attackBonus, a.fatigue])
        .toEqual([b.artifacts, b.attackBonus, b.fatigue]);
      expect(a.connected).toBe(false);
    }

    restored.handleReconnect('p0');
    restored.handleReconnect('p1');
    restored.endTurn('p0');
    expect(restored.viewFor('p0').turnSeat).toBe(1);
  });

  it('restaura snapshot anterior ao histórico estruturado de ações', () => {
    const { m } = makeMatch();
    track(m).start();
    const snap = viaJson(m.toSnapshot());
    delete snap.actions;
    delete snap.actionSeq;
    delete snap.turnTimeLeftMs;
    delete snap.tutorialOpenPlayerIds;
    const restored = track(Match.restore(snap, () => {}, () => {}));
    expect(restored.viewFor('p0').actions).toEqual([]);
  });

  it('preserva pausa e tempo restante do tutorial durante restart', () => {
    vi.useFakeTimers();
    const { m } = makeMatch(60);
    track(m).start();
    vi.advanceTimersByTime(7_000);
    m.setTutorialOpen('p0', true);
    const snap = viaJson(m.toSnapshot());

    const restored = track(Match.restore(snap, () => {}, () => {}));
    expect(restored.viewFor('p0')).toMatchObject({
      turnSeat: 0,
      turnPaused: true,
      turnTimeLeftMs: 53_000,
    });
    vi.advanceTimersByTime(90_000);
    expect(restored.viewFor('p0').turnSeat).toBe(0);

    restored.handleReconnect('p0');
    restored.handleReconnect('p1');
    restored.setTutorialOpen('p0', false);
    vi.advanceTimersByTime(52_999);
    expect(restored.viewFor('p0').turnSeat).toBe(0);
    vi.advanceTimersByTime(2);
    expect(restored.viewFor('p0').turnSeat).toBe(1);
  });

  it('a visão restaurada não vaza a mão do oponente', () => {
    const { m } = makeMatch();
    track(m).start();
    const restored = track(Match.restore(viaJson(m.toSnapshot()), () => {}, () => {}));
    const serialized = JSON.stringify(restored.viewFor('p1'));
    for (const c of restored.seats[0].hand) {
      expect(serialized.includes(`"${c.iid}"`)).toBe(false);
    }
  });

  it('todos reconectando dentro da janela, a partida segue sem derrota', () => {
    vi.useFakeTimers();
    const { m } = makeMatch();
    m.start();
    const snap = viaJson(m.toSnapshot());
    m.dispose();

    const restored = track(Match.restore(snap, () => {}, () => {}));
    vi.advanceTimersByTime(30_000);
    restored.handleReconnect('p0');
    restored.handleReconnect('p1');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
    expect(restored.finished).toBe(false);
  });

  it('ninguém volta: vale a semântica de dupla desconexão (timeout)', () => {
    vi.useFakeTimers();
    const { m } = makeMatch();
    m.start();
    const snap = viaJson(m.toSnapshot());
    m.dispose();

    let result: EngineResult | null = null;
    const restored = track(Match.restore(snap, () => {}, (res) => { result = res; }));
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000);
    expect(restored.finished).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(restored.finished).toBe(true);
    expect(result!.reason).toBe('timeout');
  });

  it('quem já estava desconectado mantém o prazo restante', () => {
    vi.useFakeTimers();
    const { m } = makeMatch();
    m.start();
    m.handleDisconnect('p1');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 60_000);
    const snap = viaJson(m.toSnapshot());
    m.dispose();

    let result: EngineResult | null = null;
    const restored = track(Match.restore(snap, () => {}, (res) => { result = res; }));
    restored.handleReconnect('p0');
    vi.advanceTimersByTime(58_000);
    expect(restored.finished).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(restored.finished).toBe(true);
    expect(result!.winnerSeat).toBe(0);
    expect(result!.reason).toBe('timeout');
  });

  it('prazo vencido durante o restart ganha folga mínima, não derrota instantânea', () => {
    vi.useFakeTimers();
    const { m } = makeMatch();
    m.start();
    m.handleDisconnect('p1');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000);
    const snap = viaJson(m.toSnapshot());
    m.dispose();
    vi.advanceTimersByTime(30_000);

    const restored = track(Match.restore(snap, () => {}, () => {}));
    expect(restored.finished).toBe(false);
    restored.handleReconnect('p0');
    restored.handleReconnect('p1');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
    expect(restored.finished).toBe(false);
  });
});

function tmpPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'lc-snap-')), name);
}

describe('store · convidados no snapshot', () => {
  it('export/import mantém o convidado e a sessão vivos, com progresso', async () => {
    const a = await Store.create(tmpPath('db.json'));
    const guest = a.createGuest('Zé', 'wolf');
    guest.mmr = 1042;
    guest.wins = 3;
    const token = a.createSession(guest.id);

    const payload = viaJson(a.exportGuests());
    const b = await Store.create(tmpPath('db.json'));
    expect(b.importGuests(payload.users, payload.sessions)).toBe(1);

    const back = b.userBySession(token);
    expect(back?.id).toBe(guest.id);
    expect(back?.guest).toBe(true);
    expect(back?.mmr).toBe(1042);
    expect(back?.wins).toBe(3);
  });

  it('sessão expirada não volta — e o convidado órfão tampouco', async () => {
    const a = await Store.create(tmpPath('db.json'));
    const guest = a.createGuest('Zé', 'wolf');
    const token = a.createSession(guest.id);

    const payload = viaJson(a.exportGuests());
    payload.sessions[0].expiresAt = Date.now() - 1;
    const b = await Store.create(tmpPath('db.json'));
    expect(b.importGuests(payload.users, payload.sessions)).toBe(0);
    expect(b.userBySession(token)).toBeUndefined();
    expect(b.userById(guest.id)).toBeUndefined();
  });
});

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: ServerMsg[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMsg);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  msg(m: unknown): void {
    this.emit('message', JSON.stringify(m));
  }

  byType<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  }
}

async function makeArena(dbPath: string, runtimePath: string) {
  const store = await Store.create(dbPath);
  const app = new App(store);
  const runtime = new RuntimeSnapshot(app, store, runtimePath);
  runtime.start();
  cleanups.push(() => { runtime.shutdown(); app.dispose(); });
  const connect = () => {
    const ws = new FakeSocket();
    app.handleConnection(ws as never);
    return ws;
  };
  return { store, app, runtime, connect };
}

type Arena = Awaited<ReturnType<typeof makeArena>>;

function latestView(ws: FakeSocket) {
  return ws.byType('game:state').at(-1)!.view!;
}

function startGuestMatch(arena: Arena) {
  const g1 = arena.store.createGuest('Ana', 'wolf');
  const g2 = arena.store.createGuest('Bia', 'eagle');
  const t1 = arena.store.createSession(g1.id);
  const t2 = arena.store.createSession(g2.id);
  const ws1 = arena.connect();
  ws1.msg({ t: 'hello', token: t1 });
  const ws2 = arena.connect();
  ws2.msg({ t: 'hello', token: t2 });
  ws1.msg({ t: 'room:create' });
  const code = ws1.byType('room:state').at(-1)!.room!.code;
  ws2.msg({ t: 'room:join', code });
  ws1.msg({ t: 'room:start' });
  ws1.msg({ t: 'game:mulligan', iids: [] });
  ws2.msg({ t: 'game:mulligan', iids: [] });
  const turnOwner = latestView(ws1).yourSeat === latestView(ws1).turnSeat ? ws1 : ws2;
  turnOwner.msg({ t: 'game:endTurn' });
  return { g1, g2, t1, t2, ws1, ws2 };
}

describe('runtime · deploy de ponta a ponta', () => {
  it('batalha e convidados sobrevivem ao restart e seguem até o fim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-deploy-'));
    const runtimePath = join(dir, 'runtime.json');

    const before = await makeArena(join(dir, 'db1.json'), runtimePath);
    const { g1, t1, t2, ws1, ws2 } = startGuestMatch(before);
    const progressed = latestView(ws1);

    before.runtime.shutdown();
    before.app.dispose();

    const after = await makeArena(join(dir, 'db2.json'), runtimePath);
    const ws1b = after.connect();
    ws1b.msg({ t: 'hello', token: t1 });
    const ws2b = after.connect();
    ws2b.msg({ t: 'hello', token: t2 });

    expect(ws1b.byType('hello:ok')).toHaveLength(1);
    const restored = latestView(ws1b);
    expect(restored.matchId).toBe(progressed.matchId);
    expect(restored.turnSeat).toBe(progressed.turnSeat);
    expect(restored.turnNumber).toBe(progressed.turnNumber);

    ws2b.msg({ t: 'game:surrender' });
    const over = ws1b.byType('game:over');
    expect(over).toHaveLength(1);
    expect(over[0].result.winnerId).toBe(g1.id);
    expect(ws2.byType('game:over')).toHaveLength(0);
  });

  it('snapshot velho descarta as partidas, mas convidados ainda voltam', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-stale-'));
    const runtimePath = join(dir, 'runtime.json');

    const before = await makeArena(join(dir, 'db1.json'), runtimePath);
    const { t1 } = startGuestMatch(before);
    before.runtime.shutdown();
    before.app.dispose();

    const raw = JSON.parse(readFileSync(runtimePath, 'utf8'));
    raw.savedAt = Date.now() - 11 * 60_000;
    writeFileSync(runtimePath, JSON.stringify(raw));

    const after = await makeArena(join(dir, 'db2.json'), runtimePath);
    const ws = after.connect();
    ws.msg({ t: 'hello', token: t1 });

    expect(ws.byType('hello:ok')).toHaveLength(1);
    expect(ws.byType('game:state')).toEqual([{ t: 'game:state', view: null }]);
  });

  it('snapshot corrompido é ignorado sem derrubar o boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-corrupt-'));
    const runtimePath = join(dir, 'runtime.json');
    writeFileSync(runtimePath, '{lixo');

    const arena = await makeArena(join(dir, 'db.json'), runtimePath);
    const guest = arena.store.createGuest('Ana', 'wolf');
    const ws = arena.connect();
    ws.msg({ t: 'hello', token: arena.store.createSession(guest.id) });
    expect(ws.byType('hello:ok')).toHaveLength(1);
  });
});
