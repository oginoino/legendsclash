import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardInstanceFactory } from '../src/game/cards/card-instance-factory.js';
import {
  MULLIGAN_SECONDS,
  OpeningHandController,
} from '../src/game/phases/opening-hand-controller.js';
import { TurnClock } from '../src/game/timing/turn-clock.js';
import type { CardInstance, Seat } from '../src/game/types.js';

const clocks: TurnClock[] = [];

afterEach(() => {
  for (const clock of clocks.splice(0)) clock.clear();
  vi.useRealTimers();
});

function card(iid: string, defId = 'c_lobo'): CardInstance {
  return { iid, defId };
}

function seat(id: string, deckSize = 10): Seat {
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
    deck: Array.from({ length: deckSize }, (_, index) => card(`${id}-${index + 1}`)),
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
    mulliganDone: false,
    stats: { creaturesSummoned: 0, spellsCast: 0, damageDealt: 0, shieldAbsorbed: 0 },
    creatureLog: new Map(),
  };
}

function setup(botIds: string[] = []) {
  const seats = [seat('p0'), seat('p1')];
  const clock = new TurnClock();
  const cards = new CardInstanceFactory((upperExclusive) => upperExclusive - 1, 100);
  const logs: string[] = [];
  let status: 'mulligan' | 'active' | 'finished' = 'active';
  let turnsStarted = 0;
  let updates = 0;
  clocks.push(clock);

  const controller = new OpeningHandController({
    seats,
    botIds,
    clock,
    status: () => status,
    setStatus: (next) => { status = next; },
    seatOf: (playerId) => seats.findIndex((candidate) => candidate.player.id === playerId),
    draw: (target) => {
      const drawn = target.deck.pop();
      if (drawn) target.hand.push(drawn);
    },
    addLog: (text) => logs.push(text),
    beginFirstTurn: () => { turnsStarted++; },
    onUpdate: () => { updates++; },
  }, cards);

  return {
    controller,
    cards,
    seats,
    logs,
    get status() { return status; },
    get turnsStarted() { return turnsStarted; },
    get updates() { return updates; },
  };
}

describe('OpeningHandController', () => {
  it('distribui a mao e compensa apenas quem joga depois', () => {
    const harness = setup();
    harness.controller.start(false);

    expect(harness.seats[0].hand).toHaveLength(4);
    expect(harness.seats[0].hand.some((item) => item.defId === 't_moeda')).toBe(false);
    expect(harness.seats[1].hand).toHaveLength(5);
    expect(harness.seats[1].hand.filter((item) => item.defId === 't_moeda')).toHaveLength(1);
    expect(harness.seats.map((item) => item.deck.length)).toEqual([6, 6]);
    expect(harness.turnsStarted).toBe(1);
    expect(harness.updates).toBe(1);
  });

  it('compra substitutas antes de devolver as cartas e preserva o token', () => {
    vi.useFakeTimers();
    const harness = setup();
    const shuffle = vi.spyOn(harness.cards, 'shuffle');
    harness.controller.start(true);
    const coin = harness.seats[1].hand.find((item) => item.defId === 't_moeda')!;
    const originalCards = harness.seats[1].hand.filter((item) => item !== coin);

    harness.controller.confirm('p1', harness.seats[1].hand.map((item) => item.iid));

    expect(harness.seats[1].hand).toHaveLength(5);
    expect(harness.seats[1].hand).toContainEqual(coin);
    expect(harness.seats[1].hand).not.toEqual(expect.arrayContaining(originalCards));
    expect(harness.seats[1].deck).toEqual(expect.arrayContaining(originalCards));
    expect(shuffle).toHaveBeenCalledOnce();
    expect(harness.status).toBe('mulligan');
  });

  it('inicia o turno 1 somente depois que todos confirmam', () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.controller.start(true);

    harness.controller.confirm('p0', []);
    expect(harness.status).toBe('mulligan');
    expect(harness.turnsStarted).toBe(0);
    harness.controller.confirm('p1', []);

    expect(harness.status).toBe('active');
    expect(harness.turnsStarted).toBe(1);
    expect(harness.updates).toBe(3);
  });

  it('auto-confirma a mao da IA sem liberar o turno humano', () => {
    vi.useFakeTimers();
    const harness = setup(['p1']);
    harness.controller.start(true);

    expect(harness.seats[0].mulliganDone).toBe(false);
    expect(harness.seats[1].mulliganDone).toBe(true);
    expect(harness.status).toBe('mulligan');
    expect(harness.turnsStarted).toBe(0);
  });

  it('confirma todas as maos quando o tempo se esgota', () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.controller.start(true);

    vi.advanceTimersByTime(MULLIGAN_SECONDS * 1000);

    expect(harness.seats.every((item) => item.mulliganDone)).toBe(true);
    expect(harness.status).toBe('active');
    expect(harness.turnsStarted).toBe(1);
    expect(harness.logs).toContain('Tempo de troca esgotado — mãos confirmadas');
  });

  it('preserva os erros publicos de fase, participante e confirmacao duplicada', () => {
    vi.useFakeTimers();
    const harness = setup();
    expect(() => harness.controller.confirm('p0', [])).toThrow('Não é a fase de troca de mão.');
    harness.controller.start(true);
    expect(() => harness.controller.confirm('externo', [])).toThrow('Você não está nesta partida.');
    harness.controller.confirm('p0', []);
    expect(() => harness.controller.confirm('p0', [])).toThrow('Você já confirmou sua mão.');
  });
});
