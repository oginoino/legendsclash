import { describe, expect, it } from 'vitest';
import type { CreatureOnBoard, SeatView } from '@legendsclash/shared';
import { deriveGameHud } from '../src/features/game/hud-model';

function creature(overrides: Partial<CreatureOnBoard> = {}): CreatureOnBoard {
  return {
    iid: 'creature-1',
    defId: 'c_lobo',
    attack: 3,
    health: 2,
    baseHealth: 2,
    canAttack: false,
    ...overrides,
  };
}

function seat(overrides: Partial<SeatView> = {}): SeatView {
  return {
    playerId: 'player',
    name: 'Jogador',
    avatar: 'shield',
    commander: 'shield',
    accent: '#4d8dff',
    photo: null,
    frame: '',
    accentStyle: '',
    mmr: 1000,
    hp: 30,
    shield: 0,
    energy: 3,
    maxEnergy: 3,
    deckCount: 20,
    handCount: 5,
    board: [],
    artifacts: [],
    attackBonus: 0,
    fatigue: 0,
    connected: true,
    out: false,
    mulliganDone: true,
    ...overrides,
  };
}

describe('deriveGameHud', () => {
  it('orienta o encerramento quando não restam ações', () => {
    const hud = deriveGameHud({
      hand: [{ iid: 'expensive', defId: 'c_kraken' }],
      player: seat({ energy: 2 }),
      enemy: seat({ playerId: 'enemy', name: 'Rival' }),
      myTurn: true,
    });

    expect(hud.noMovesLeft).toBe(true);
    expect(hud.actionCoach).toEqual({
      done: true,
      label: 'Encerrar',
      aria: 'Sem ações disponíveis. Encerre o turno.',
    });
    expect(hud.turnCoach).toEqual({
      tone: 'end',
      title: 'Sem ações restantes',
      body: 'Encerre o turno para manter o ritmo.',
    });
  });

  it('prioriza a janela de ataque direto e calcula o dano pronto', () => {
    const hud = deriveGameHud({
      hand: [{ iid: 'spark', defId: 's_faisca' }],
      player: seat({
        attackBonus: 1,
        board: [creature({ canAttack: true })],
      }),
      enemy: seat({ playerId: 'enemy', board: [] }),
      myTurn: true,
    });

    expect(hud.readyDamage).toBe(4);
    expect(hud.actionCoach).toMatchObject({ done: false, label: '1 cartas · 1 ataques' });
    expect(hud.turnCoach).toEqual({
      tone: 'lethal',
      title: 'Alvo direto aberto',
      body: 'O comandante inimigo está vulnerável.',
    });
  });

  it('indica a remoção da mesa quando uma criatura protege o comandante', () => {
    const hud = deriveGameHud({
      hand: [],
      player: seat({ board: [creature({ canAttack: true })] }),
      enemy: seat({ playerId: 'enemy', board: [creature({ iid: 'guard' })] }),
      myTurn: true,
    });

    expect(hud.turnCoach).toEqual({
      tone: 'attack',
      title: 'Ataque a mesa',
      body: '1 criatura protege o comandante.',
    });
  });

  it('sugere usar energia quando só há cartas jogáveis', () => {
    const hud = deriveGameHud({
      hand: [{ iid: 'spark', defId: 's_faisca' }],
      player: seat({ energy: 1 }),
      enemy: seat({ playerId: 'enemy' }),
      myTurn: true,
    });

    expect(hud.actionCoach?.aria).toBe('1 carta jogável. 0 atacantes prontos.');
    expect(hud.turnCoach).toEqual({
      tone: 'play',
      title: 'Use sua energia',
      body: '1 carta jogável; priorize presença cedo.',
    });
  });

  it('distingue a deliberação da IA e calcula ameaça e pressão de fadiga', () => {
    const enemy = seat({
      playerId: 'bot:trainer',
      handCount: 1,
      deckCount: 2,
      attackBonus: 2,
      board: [creature({ attack: 3 }), creature({ iid: 'second', attack: 4 })],
    });
    const hud = deriveGameHud({ hand: [], player: seat(), enemy, myTurn: false });

    expect(hud.actionCoach).toBeNull();
    expect(hud.readyDamage).toBe(0);
    expect(hud.enemyBoardDamage).toBe(11);
    expect(hud.enemyFatiguePressure).toBe(true);
    expect(hud.turnCoach).toEqual({
      tone: 'bot',
      title: 'Treinador avaliando a mesa',
      body: '1 carta na mão · 2 na mesa.',
    });
  });
});
