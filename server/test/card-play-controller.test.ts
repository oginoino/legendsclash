import { describe, expect, it, vi } from 'vitest';
import { MAX_BOARD } from '@legendsclash/shared';
import type { CombatAction, Target } from '@legendsclash/shared';
import { CardPlayController } from '../src/game/cards/card-play-controller.js';
import { GameError } from '../src/game/errors.js';
import type { CardInstance, Seat } from '../src/game/types.js';

function card(iid: string, defId: string): CardInstance {
  return { iid, defId };
}

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
    energy: 10,
    maxEnergy: 10,
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

function setup(seats = [seat('p0'), seat('p1')]) {
  const logs: string[] = [];
  const plays: Array<{ seat: number; cardId: string }> = [];
  const actions: Array<Omit<CombatAction, 'seq' | 'at'>> = [];
  const events: string[] = [];
  const effects = {
    resolve: vi.fn((_seatIndex: number, _defId: string, _target?: Target) => {
      events.push('effect');
    }),
    triggerBattlecry: vi.fn(() => {
      events.push('battlecry');
    }),
  };
  const controller = new CardPlayController({
    seats,
    effects,
    addLog: (text) => {
      logs.push(text);
      events.push('log');
    },
    recordPlay: (seatIndex, cardId) => {
      plays.push({ seat: seatIndex, cardId });
      events.push('play');
    },
    recordAction: (action) => {
      actions.push(action);
      events.push('action');
    },
  });

  return { controller, seats, effects, logs, plays, actions, events };
}

describe('CardPlayController', () => {
  it('preserva erros autoritativos sem consumir carta, energia ou registros', () => {
    const missing = setup();
    expect(() => missing.controller.play(0, 'ausente')).toThrow('Carta não está na sua mão.');

    const noEnergy = setup();
    noEnergy.seats[0].hand = [card('dragon', 'c_dragao')];
    noEnergy.seats[0].energy = 1;
    expect(() => noEnergy.controller.play(0, 'dragon')).toThrow('Energia insuficiente.');
    expect(noEnergy.seats[0]).toMatchObject({ energy: 1, hand: [card('dragon', 'c_dragao')] });

    const fullBoard = setup();
    fullBoard.seats[0].hand = [card('wolf', 'c_lobo')];
    fullBoard.seats[0].board = Array.from({ length: MAX_BOARD }, (_, index) => ({
      iid: `board-${index}`,
      defId: 'c_recruta',
      attack: 1,
      health: 2,
      baseHealth: 2,
      canAttack: false,
      attacked: false,
    }));
    expect(() => fullBoard.controller.play(0, 'wolf')).toThrow('Mesa cheia (máx. 6 criaturas).');
    expect(fullBoard.seats[0].hand).toEqual([card('wolf', 'c_lobo')]);
    expect(fullBoard.seats[0].energy).toBe(10);
    expect(fullBoard.plays).toEqual([]);
    expect(fullBoard.actions).toEqual([]);
  });

  it('invoca criatura, dispara Grito de Batalha e registra a jogada concluida', () => {
    const harness = setup();
    harness.seats[0].hand = [card('archer', 'c_arqueira')];

    harness.controller.play(0, 'archer');

    expect(harness.seats[0].board).toEqual([{
      iid: 'archer',
      defId: 'c_arqueira',
      attack: 2,
      health: 3,
      baseHealth: 3,
      canAttack: false,
      attacked: false,
      ward: undefined,
    }]);
    expect(harness.effects.triggerBattlecry).toHaveBeenCalledWith(0, 'c_arqueira', 'archer');
    expect(harness.seats[0]).toMatchObject({ energy: 8, hand: [] });
    expect(harness.seats[0].stats.creaturesSummoned).toBe(1);
    expect(harness.logs).toEqual(['Jogador p0 invocou Arqueira Élfica']);
    expect(harness.plays).toEqual([{ seat: 0, cardId: 'c_arqueira' }]);
    expect(harness.actions).toEqual([{
      seat: 0,
      kind: 'card',
      sourceDefId: 'c_arqueira',
      sourceIid: 'archer',
      target: undefined,
    }]);
    expect(harness.events).toEqual(['log', 'battlecry', 'play', 'action']);
  });

  it('materializa Investida e Escudo Arcano a partir das palavras-chave', () => {
    const harness = setup();
    harness.seats[0].energy = 20;
    harness.seats[0].hand = [
      card('dragon', 'c_dragao'),
      card('serpent', 'c_serpente'),
    ];

    harness.controller.play(0, 'dragon');
    harness.controller.play(0, 'serpent');

    expect(harness.seats[0].board[0]).toMatchObject({
      iid: 'dragon', canAttack: true, ward: undefined,
    });
    expect(harness.seats[0].board[1]).toMatchObject({
      iid: 'serpent', canAttack: false, ward: true,
    });
    expect(harness.seats[0].stats.creaturesSummoned).toBe(2);
  });

  it('despacha magia e tatica, conta apenas magia e clona o alvo publico', () => {
    const harness = setup();
    harness.seats[0].hand = [
      card('spark', 's_faisca'),
      card('loot', 't_saque'),
    ];
    const target: Target = { seat: 1, iid: 'enemy' };

    harness.controller.play(0, 'spark', target);
    expect(harness.effects.resolve).toHaveBeenCalledWith(0, 's_faisca', {
      seat: 1, iid: 'enemy',
    });
    expect(harness.actions[0].target).toEqual({ seat: 1, iid: 'enemy' });
    target.iid = 'mutated';
    expect(harness.actions[0].target).toEqual({ seat: 1, iid: 'enemy' });
    harness.controller.play(0, 'loot');

    expect(harness.effects.resolve).toHaveBeenNthCalledWith(2, 0, 't_saque', undefined);
    expect(harness.seats[0].stats).toMatchObject({ spellsCast: 1, creaturesSummoned: 0 });
    expect(harness.seats[0]).toMatchObject({ energy: 8, hand: [] });
    expect(harness.plays).toEqual([
      { seat: 0, cardId: 's_faisca' },
      { seat: 0, cardId: 't_saque' },
    ]);
    expect(harness.events).toEqual([
      'effect', 'play', 'action',
      'effect', 'play', 'action',
    ]);
  });

  it('mantem custo e carta intactos quando a resolucao do efeito falha', () => {
    const harness = setup();
    harness.seats[0].hand = [card('spark', 's_faisca')];
    harness.effects.resolve.mockImplementation(() => {
      throw new GameError('Alvo inválido.');
    });

    expect(() => harness.controller.play(0, 'spark')).toThrow('Alvo inválido.');

    expect(harness.seats[0]).toMatchObject({
      energy: 10,
      hand: [card('spark', 's_faisca')],
      stats: { spellsCast: 0 },
    });
    expect(harness.plays).toEqual([]);
    expect(harness.actions).toEqual([]);
  });

  it('aplica cada artefato e persiste somente os efeitos recorrentes', () => {
    const harness = setup();
    harness.seats[0].energy = 20;
    harness.seats[0].hand = [
      card('shield', 'a_escudo'),
      card('banner', 'a_estandarte'),
      card('reliquary', 'a_relicario'),
      card('orb', 'a_orbe'),
      card('figurehead', 'a_figura'),
    ];

    for (const iid of ['shield', 'banner', 'reliquary', 'orb', 'figurehead']) {
      harness.controller.play(0, iid);
    }

    expect(harness.seats[0]).toMatchObject({
      energy: 6,
      hand: [],
      shield: 4,
      attackBonus: 1,
      regen: 1,
      spellBonus: 1,
      shieldRegen: 1,
      artifacts: ['a_estandarte', 'a_relicario', 'a_orbe', 'a_figura'],
    });
    expect(harness.logs).toEqual([
      'Jogador p0 equipou Escudo de Aço',
      'Jogador p0 equipou Estandarte de Guerra',
      'Jogador p0 equipou Relicário da Aurora',
      'Jogador p0 equipou Orbe de Éter',
      'Jogador p0 equipou Figura de Proa: Sereia',
    ]);
    expect(harness.plays).toHaveLength(5);
    expect(harness.actions).toHaveLength(5);
  });
});
