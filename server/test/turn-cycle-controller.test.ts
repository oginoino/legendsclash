import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ARTIFACT_SHIELD,
  MAX_TURNS,
  TurnCycleController,
} from '../src/game/phases/turn-cycle-controller.js';
import { TurnClock } from '../src/game/timing/turn-clock.js';
import type { Seat } from '../src/game/types.js';

const clocks: TurnClock[] = [];

afterEach(() => {
  for (const clock of clocks.splice(0)) clock.clear();
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
    deck: [{ iid: `${id}-card`, defId: 'c_lobo' }],
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
  botIds?: string[];
  turnSeat?: number;
  turnNumber?: number;
  turnSeconds?: number;
}

function setup(options: SetupOptions = {}) {
  const seats = options.seats ?? [seat('p0'), seat('p1')];
  const botIds = options.botIds ?? [];
  const clock = new TurnClock();
  const logs: string[] = [];
  const clearBot = vi.fn();
  const scheduleBot = vi.fn();
  let active = true;
  let turnSeat = options.turnSeat ?? 0;
  let turnNumber = options.turnNumber ?? 0;
  let checks = 0;
  let updates = 0;
  let tiebreaks = 0;
  clocks.push(clock);

  const controller = new TurnCycleController({
    seats,
    botIds,
    clock,
    turnSeconds: options.turnSeconds ?? 60,
    isActive: () => active,
    currentTurnSeat: () => turnSeat,
    setTurnSeat: (next) => { turnSeat = next; },
    nextTurnNumber: () => ++turnNumber,
    draw: (target) => {
      const drawn = target.deck.pop();
      if (drawn) target.hand.push(drawn);
    },
    addLog: (text) => logs.push(text),
    resolveByTiebreak: () => { tiebreaks++; active = false; },
    checkEnd: () => { checks++; },
    clearBot,
    scheduleBot,
    onUpdate: () => { updates++; },
  });

  return {
    controller,
    seats,
    clock,
    logs,
    clearBot,
    scheduleBot,
    deactivate: () => { active = false; },
    get active() { return active; },
    get turnSeat() { return turnSeat; },
    get turnNumber() { return turnNumber; },
    get checks() { return checks; },
    get updates() { return updates; },
    get tiebreaks() { return tiebreaks; },
  };
}

describe('TurnCycleController', () => {
  it('inicia energia, compra e prontidao na ordem do turno', () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.seats[0].board.push({
      iid: 'wolf', defId: 'c_lobo', attack: 3, health: 2, baseHealth: 2,
      canAttack: false, attacked: true,
    });

    harness.controller.begin(0);

    expect(harness.turnNumber).toBe(1);
    expect(harness.seats[0]).toMatchObject({ maxEnergy: 1, energy: 1 });
    expect(harness.seats[0].hand).toEqual([{ iid: 'p0-card', defId: 'c_lobo' }]);
    expect(harness.seats[0].board[0]).toMatchObject({ canAttack: true, attacked: false });
    expect(harness.logs).toContain('Turno 1: vez de Jogador p0');
    expect(harness.checks).toBe(1);
    expect(harness.clock.view().timeLeftMs).toBe(60_000);
  });

  it('aplica regeneracao sem ultrapassar os limites', () => {
    vi.useFakeTimers();
    const target = seat('p0');
    target.hp = 29;
    target.regen = 3;
    target.shield = MAX_ARTIFACT_SHIELD - 1;
    target.shieldRegen = 4;
    const harness = setup({ seats: [target, seat('p1')] });

    harness.controller.begin(0);

    expect(target.hp).toBe(30);
    expect(target.shield).toBe(MAX_ARTIFACT_SHIELD);
    expect(harness.logs).toContain('Relicário da Aurora restaurou 1 de vida a Jogador p0');
    expect(harness.logs).toContain('Figura de Proa: Sereia concedeu 1 de escudo a Jogador p0');
  });

  it('avanca em fila circular e pula assentos eliminados', () => {
    vi.useFakeTimers();
    const seats = [seat('p0'), seat('p1'), seat('p2')];
    seats[1].out = true;
    const harness = setup({ seats });

    harness.controller.advance();

    expect(harness.clearBot).toHaveBeenCalledOnce();
    expect(harness.turnSeat).toBe(2);
    expect(harness.turnNumber).toBe(1);
  });

  it('encerra o turno por timeout e publica uma atualizacao', () => {
    vi.useFakeTimers();
    const harness = setup({ turnSeconds: 2 });
    harness.controller.begin(0);

    vi.advanceTimersByTime(2_000);

    expect(harness.logs).toContain('Jogador p0 ficou sem tempo — turno encerrado');
    expect(harness.turnSeat).toBe(1);
    expect(harness.turnNumber).toBe(2);
    expect(harness.updates).toBe(1);
  });

  it('agenda a IA no inicio e ao restaurar o turno dela', () => {
    vi.useFakeTimers();
    const harness = setup({ botIds: ['p1'], turnSeat: 1 });
    harness.controller.begin(1);
    expect(harness.scheduleBot).toHaveBeenCalledWith('p1');
    harness.scheduleBot.mockClear();

    harness.controller.restoreTimer(5_000);

    expect(harness.clock.view().timeLeftMs).toBe(5_000);
    expect(harness.scheduleBot).toHaveBeenCalledWith('p1');
  });

  it('aciona o desempate antes de executar um turno acima do limite', () => {
    vi.useFakeTimers();
    const harness = setup({ turnNumber: MAX_TURNS });

    harness.controller.begin(0);

    expect(harness.turnNumber).toBe(MAX_TURNS + 1);
    expect(harness.tiebreaks).toBe(1);
    expect(harness.active).toBe(false);
    expect(harness.seats[0]).toMatchObject({ maxEnergy: 0, energy: 0, hand: [] });
    expect(harness.clock.view().timeLeftMs).toBe(0);
  });
});
