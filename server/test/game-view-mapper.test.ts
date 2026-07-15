import { describe, expect, it } from 'vitest';
import type { CombatAction, GameLogEntry, PlayedCard } from '@legendsclash/shared';
import type { MatchPlayer, Seat } from '../src/game/types.js';
import { createGameView } from '../src/game/view/game-view-mapper.js';

function player(id: string): MatchPlayer {
  return {
    id,
    name: `Jogador ${id}`,
    avatar: 'shield',
    commander: 'shield',
    accent: '#e3b341',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    mmr: 1000,
  };
}

function seat(id: string): Seat {
  return {
    player: player(id),
    hp: 30,
    shield: 0,
    energy: 2,
    maxEnergy: 3,
    deck: [{ iid: `deck-${id}`, defId: 'c_lobo' }],
    hand: [{ iid: `hand-${id}`, defId: 's_faisca' }],
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

function source(seats: Seat[], playerId = 'p0') {
  return {
    matchId: 'm1',
    playerId,
    turnSeat: 0,
    turnNumber: 2,
    clock: { endsAt: 123, paused: false, timeLeftMs: 45_000 },
    seats,
    status: 'active' as const,
    log: [] as GameLogEntry[],
    plays: [] as PlayedCard[],
    actions: [] as CombatAction[],
  };
}

describe('game view mapper', () => {
  it('revela somente a mao do jogador solicitante', () => {
    const seats = [seat('p0'), seat('p1')];
    const view = createGameView(source(seats));
    const serialized = JSON.stringify(view);

    expect(view.yourSeat).toBe(0);
    expect(view.hand).toEqual([{ iid: 'hand-p0', defId: 's_faisca' }]);
    expect(view.seats[1].handCount).toBe(1);
    expect(serialized).not.toContain('hand-p1');
    expect(serialized).not.toContain('deck-p1');
  });

  it('nao revela nenhuma mao para um observador fora da partida', () => {
    const view = createGameView(source([seat('p0'), seat('p1')], 'spectator'));
    expect(view.yourSeat).toBe(-1);
    expect(view.hand).toEqual([]);
  });

  it('projeta combate, identidade e valores publicos sem referencias mutaveis', () => {
    const seats = [seat('p0'), seat('p1')];
    seats[0].hp = -3;
    seats[0].artifacts = ['a_estandarte'];
    seats[0].board = [{
      iid: 'board-p0',
      defId: 'c_lobo',
      attack: 4,
      health: 1,
      baseHealth: 2,
      canAttack: true,
      attacked: true,
      ward: true,
    }];

    const view = createGameView(source(seats));
    expect(view.seats[0]).toMatchObject({
      playerId: 'p0',
      hp: 0,
      deckCount: 1,
      handCount: 1,
      artifacts: ['a_estandarte'],
    });
    expect(view.seats[0].board[0]).toMatchObject({ canAttack: false, ward: true });
    expect(view.seats[0].artifacts).not.toBe(seats[0].artifacts);
  });

  it('mantem os limites publicos de historico', () => {
    const input = source([seat('p0'), seat('p1')]);
    input.log = Array.from({ length: 35 }, (_, at) => ({ at, text: `log ${at}` }));
    input.plays = Array.from({ length: 15 }, (_, at) => ({ seat: 0, cardId: 'c_lobo', at }));
    input.actions = Array.from({ length: 30 }, (_, seq) => ({
      seq,
      seat: 0,
      kind: 'card' as const,
      sourceDefId: 'c_lobo',
      at: seq,
    }));

    const view = createGameView(input);
    expect(view.log).toHaveLength(30);
    expect(view.plays).toHaveLength(12);
    expect(view.actions).toHaveLength(24);
    expect(view.log[0].text).toBe('log 5');
  });
});
