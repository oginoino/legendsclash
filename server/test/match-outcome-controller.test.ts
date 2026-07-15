import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchOutcomeController } from '../src/game/outcome/match-outcome-controller.js';
import type { EngineResult, Seat } from '../src/game/types.js';

afterEach(() => {
  vi.useRealTimers();
});

function seat(id: string): Seat {
  return {
    player: {
      id,
      name: `Jogador ${id}`,
      avatar: 'shield',
      commander: 'shield',
      accent: '#e3b341',
      photo: null,
      frame: 'none',
      accentStyle: 'solid',
      mmr: 1000,
    },
    hp: 30,
    shield: 0,
    energy: 0,
    maxEnergy: 0,
    deck: [],
    hand: [],
    board: [],
    artifacts: [],
    attackBonus: 0,
    spellBonus: 0,
    regen: 0,
    shieldRegen: 0,
    fatigue: 0,
    connected: true,
    out: false,
    mulliganDone: true,
    stats: { creaturesSummoned: 0, spellsCast: 0, damageDealt: 0, shieldAbsorbed: 0 },
    creatureLog: new Map(),
  };
}

interface SetupOptions {
  seats?: Seat[];
  status?: 'mulligan' | 'active' | 'finished';
  turnNumber?: number;
  startedAt?: number;
  maxTurns?: number;
}

function setup(options: SetupOptions = {}) {
  const seats = options.seats ?? [seat('p0'), seat('p1')];
  const logs: string[] = [];
  const clearClock = vi.fn();
  const clearBot = vi.fn();
  const clearReconnect = vi.fn();
  const onFinish = vi.fn();
  let status = options.status ?? 'active';
  let result: EngineResult | null = null;

  const controller = new MatchOutcomeController({
    seats,
    maxTurns: options.maxTurns ?? 40,
    startedAt: options.startedAt ?? Date.now(),
    status: () => status,
    setStatus: (next) => { status = next; },
    turnNumber: () => options.turnNumber ?? 0,
    setResult: (next) => { result = next; },
    clearClock,
    clearBot,
    clearReconnect,
    addLog: (text) => logs.push(text),
    onFinish,
  });

  return {
    controller,
    seats,
    logs,
    clearClock,
    clearBot,
    clearReconnect,
    onFinish,
    get status() { return status; },
    get result() { return result; },
  };
}

describe('MatchOutcomeController', () => {
  it('alterna Resistencia de forma idempotente enquanto a partida continua', () => {
    const harness = setup();
    harness.seats[0].hp = 10;
    harness.seats[0].board.push({
      iid: 'renegado',
      defId: 'c_renegado',
      attack: 2,
      health: 3,
      baseHealth: 3,
      canAttack: false,
      attacked: false,
    });

    harness.controller.check();
    harness.controller.check();

    expect(harness.seats[0].board[0]).toMatchObject({
      attack: 4,
      comebackOn: true,
      canAttack: true,
    });
    expect(harness.status).toBe('active');
    expect(harness.onFinish).not.toHaveBeenCalled();

    harness.seats[0].hp = 11;
    harness.controller.check();
    expect(harness.seats[0].board[0]).toMatchObject({ attack: 2, comebackOn: false });
  });

  it('nao reavalia Resistencia durante a troca da mao', () => {
    const target = seat('p0');
    target.hp = 5;
    target.board.push({
      iid: 'renegado', defId: 'c_renegado', attack: 2, health: 3, baseHealth: 3,
      canAttack: false, attacked: false,
    });
    const harness = setup({ seats: [target, seat('p1')], status: 'mulligan' });

    harness.controller.check();

    expect(target.board[0].attack).toBe(2);
    expect(target.board[0].comebackOn).toBeUndefined();
  });

  it('encerra, limpa recursos e constroi snapshots de estatisticas e MVP', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const winner = seat('p0');
    const loser = seat('p1');
    winner.stats = { creaturesSummoned: 2, spellsCast: 1, damageDealt: 9, shieldAbsorbed: 3 };
    winner.creatureLog = new Map([
      ['wolf', { defId: 'c_lobo', dmg: 7, kills: 1 }],
      ['dragon', { defId: 'c_dragao', dmg: 7, kills: 2 }],
    ]);
    loser.hp = 0;
    const harness = setup({ seats: [winner, loser], turnNumber: 12, startedAt: 4_000 });

    harness.controller.check('fatigue');

    expect(harness.status).toBe('finished');
    expect(loser.out).toBe(true);
    expect(harness.result).toEqual({
      winnerSeat: 0,
      reason: 'fatigue',
      turns: 12,
      durationMs: 6_000,
      stats: [winner.stats, loser.stats],
      mvp: [{ defId: 'c_dragao', damage: 7, kills: 2 }, null],
    });
    expect(harness.logs).toEqual([
      'Jogador p1 ficou sem vida',
      'Vitória de Jogador p0!',
    ]);
    expect(harness.clearClock).toHaveBeenCalledOnce();
    expect(harness.clearBot).toHaveBeenCalledOnce();
    expect(harness.clearReconnect).toHaveBeenCalledOnce();
    expect(harness.onFinish).toHaveBeenCalledWith(harness.result);

    winner.stats.damageDealt = 99;
    expect(harness.result!.stats[0].damageDealt).toBe(9);
  });

  it('desempata por vida, ataque em campo e indice do assento', () => {
    const seats = [seat('p0'), seat('p1'), seat('p2')];
    seats[0].hp = 20;
    seats[1].hp = 20;
    seats[2].hp = 19;
    seats[0].board.push({
      iid: 'a', defId: 'c_lobo', attack: 3, health: 2, baseHealth: 2,
      canAttack: false, attacked: false,
    });
    seats[1].board.push({
      iid: 'b', defId: 'c_lobo', attack: 5, health: 2, baseHealth: 2,
      canAttack: false, attacked: false,
    });
    seats[2].board.push({
      iid: 'c', defId: 'c_lobo', attack: 100, health: 2, baseHealth: 2,
      canAttack: false, attacked: false,
    });
    const harness = setup({ seats, maxTurns: 55 });

    harness.controller.resolveByTiebreak();

    expect(harness.result?.winnerSeat).toBe(1);
    expect(harness.result?.reason).toBe('hp');
    expect(seats.map((candidate) => candidate.out)).toEqual([true, false, true]);
    expect(harness.logs).toContain(
      'Limite de 55 turnos atingido — vitória por vantagem (morte súbita)',
    );

    const tied = setup();
    tied.controller.resolveByTiebreak();
    expect(tied.result?.winnerSeat).toBe(0);
  });

  it('preserva o fallback do assento zero quando todos foram eliminados', () => {
    const seats = [seat('p0'), seat('p1')];
    for (const candidate of seats) candidate.out = true;
    const harness = setup({ seats });

    harness.controller.check('surrender');
    harness.controller.check('timeout');

    expect(harness.result).toMatchObject({ winnerSeat: 0, reason: 'surrender' });
    expect(harness.onFinish).toHaveBeenCalledOnce();
    expect(harness.clearClock).toHaveBeenCalledOnce();
    expect(harness.logs).toEqual(['Vitória de Jogador p0!']);
  });

  it('nao altera uma partida ja encerrada nem resolve desempate sem oponentes', () => {
    const alreadyFinished = setup({ status: 'finished' });
    alreadyFinished.controller.check();
    expect(alreadyFinished.onFinish).not.toHaveBeenCalled();

    const singleAlive = [seat('p0'), seat('p1')];
    singleAlive[1].out = true;
    const harness = setup({ seats: singleAlive });
    harness.controller.resolveByTiebreak();
    expect(harness.status).toBe('active');
    expect(harness.result).toBeNull();
  });
});
