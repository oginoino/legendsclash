import { describe, expect, it } from 'vitest';
import type { CardDef } from '@legendsclash/shared';
import { targetForBotAttack, targetForBotCard } from '../src/game/bot/bot-policy.js';
import type { Creature, Seat } from '../src/game/types.js';

function creature(iid: string, defId = 'c_lobo'): Creature {
  return {
    iid,
    defId,
    attack: 3,
    health: 2,
    baseHealth: 2,
    canAttack: true,
    attacked: false,
  };
}

function seat(id: string, board: Creature[] = []): Seat {
  return {
    player: {
      id,
      name: id,
      avatar: 'a1',
      commander: 'c1',
      accent: '#fff',
      photo: null,
      frame: 'none',
      accentStyle: 'solid',
      mmr: 1000,
    },
    hp: 30,
    shield: 0,
    energy: 1,
    maxEnergy: 1,
    deck: [],
    hand: [],
    board,
    artifacts: [],
    attackBonus: 0,
    spellBonus: 0,
    regen: 0,
    shieldRegen: 0,
    fatigue: 0,
    connected: true,
    out: false,
    mulliganDone: true,
    reconnectTimer: null,
    reconnectDeadline: null,
    stats: { creaturesSummoned: 0, spellsCast: 0, damageDealt: 0, shieldAbsorbed: 0 },
    creatureLog: new Map(),
  };
}

function card(target: CardDef['target'], pierce = false): CardDef {
  return {
    id: 'test',
    name: 'Teste',
    type: 'spell',
    cost: 1,
    rarity: 'common',
    text: '',
    art: '',
    target,
    pierce,
  };
}

describe('politica de alvos do bot', () => {
  it('escolhe a primeira criatura aliada quando a carta exige aliado', () => {
    const seats = [seat('bot', [creature('mine')]), seat('enemy')];
    expect(targetForBotCard(seats, 0, card('friendly-creature')))
      .toEqual({ seat: 0, iid: 'mine' });
  });

  it('nao inventa alvo quando a criatura exigida nao existe', () => {
    const seats = [seat('bot'), seat('enemy')];
    expect(targetForBotCard(seats, 0, card('friendly-creature'))).toBeUndefined();
    expect(targetForBotCard(seats, 0, card('enemy-creature'))).toBeUndefined();
  });

  it('mira criatura protetora, mas dano direto pode mirar o comandante', () => {
    const seats = [seat('bot'), seat('enemy', [creature('guard')])];
    expect(targetForBotCard(seats, 0, card('enemy-any')))
      .toEqual({ seat: 1, iid: 'guard' });
    expect(targetForBotCard(seats, 0, card('enemy-any', true)))
      .toEqual({ seat: 1 });
  });

  it('ataque prioriza Provocar e so mira o comandante com mesa vazia', () => {
    const seats = [
      seat('bot'),
      seat('enemy', [creature('regular'), creature('taunt', 'c_golem')]),
    ];
    expect(targetForBotAttack(seats, 0)).toEqual({ seat: 1, iid: 'taunt' });
    seats[1].board = [];
    expect(targetForBotAttack(seats, 0)).toEqual({ seat: 1 });
  });

  it('ignora assentos eliminados ao escolher o primeiro inimigo', () => {
    const eliminated = seat('out', [creature('ignored')]);
    eliminated.out = true;
    const seats = [seat('bot'), eliminated, seat('active', [creature('target')])];
    expect(targetForBotAttack(seats, 0)).toEqual({ seat: 2, iid: 'target' });
  });
});
