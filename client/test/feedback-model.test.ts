import { describe, expect, it } from 'vitest';
import type { GameView, SeatView } from '@legendsclash/shared';
import { deriveSnapshotFeedback } from '../src/features/game/feedback-model';

function makeSeat(overrides: Partial<SeatView> = {}): SeatView {
  return {
    playerId: 'me',
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

function makeGame(overrides: Partial<GameView> = {}): GameView {
  return {
    matchId: 'match-1',
    yourSeat: 0,
    turnSeat: 0,
    turnNumber: 3,
    turnEndsAt: 60_000,
    turnPaused: false,
    turnTimeLeftMs: 60_000,
    seats: [
      makeSeat(),
      makeSeat({ playerId: 'enemy', name: 'Rival', commander: 'dragon' }),
    ],
    hand: [],
    status: 'active',
    log: [],
    plays: [],
    actions: [],
    ...overrides,
  };
}

function idSequence(): () => number {
  let id = 1;
  return () => id++;
}

describe('deriveSnapshotFeedback', () => {
  it('relaciona um ataque inimigo com dano de escudo e vida', () => {
    const enemy = makeSeat({
      playerId: 'enemy',
      name: 'Rival',
      commander: 'dragon',
      board: [{
        iid: 'enemy-knight',
        defId: 'c_cavaleiro',
        attack: 5,
        health: 4,
        baseHealth: 4,
        canAttack: true,
      }],
    });
    const previous = makeGame({
      seats: [makeSeat({ hp: 30, shield: 2 }), enemy],
    });
    const current = makeGame({
      seats: [makeSeat({ hp: 27, shield: 0 }), enemy],
      log: [{ at: 1_000, text: 'Cavaleiro de Ferro causou 5 de dano no comandante' }],
      actions: [{
        seq: 1,
        seat: 1,
        kind: 'attack',
        sourceDefId: 'c_cavaleiro',
        sourceIid: 'enemy-knight',
        target: { seat: 0 },
        at: 1_000,
      }],
    });

    const feedback = deriveSnapshotFeedback(previous, current, 1_000, idSequence());

    expect(feedback.attackFx).toEqual({ iid: 'enemy-knight', at: 1_000 });
    expect(feedback.effects).toMatchObject([
      { kind: 'dmg', value: 3, anchor: 'face-0' },
      { kind: 'shield', value: 2, anchor: 'face-0' },
    ]);
    expect(feedback.sounds).toEqual(['damage', 'shield']);
    expect(feedback.damageNotice).toMatchObject({
      owner: 'Rival',
      source: 'Cavaleiro de Ferro',
      sourceDefId: 'c_cavaleiro',
      sourceIid: 'enemy-knight',
      actionLabel: 'Ataque',
      summary: '3 de vida perdida',
      incoming: 5,
      hpDamage: 3,
      shieldDamage: 2,
      hpAfter: 27,
      severity: 'heavy',
    });
  });

  it('revela a carta adversária e sinaliza a virada para o jogador', () => {
    const previous = makeGame({ turnSeat: 1 });
    const current = makeGame({
      turnSeat: 0,
      plays: [{ seat: 1, cardId: 's_faisca', at: 2_000 }],
    });

    const feedback = deriveSnapshotFeedback(previous, current, 2_000, idSequence());

    expect(feedback.reveals).toEqual([{ id: 1, cardId: 's_faisca', at: 2_000 }]);
    expect(feedback.banner).toEqual({ text: 'Seu turno!', at: 2_000 });
    expect(feedback.sounds).toEqual(['reveal', 'myTurn']);
    expect(feedback.resetAim).toBe(true);
  });

  it('não atribui dano de fadiga a uma ação do adversário', () => {
    const previous = makeGame({
      seats: [makeSeat({ hp: 10, fatigue: 1 }), makeSeat({ playerId: 'enemy', name: 'Rival' })],
    });
    const current = makeGame({
      seats: [makeSeat({ hp: 9, fatigue: 2 }), makeSeat({ playerId: 'enemy', name: 'Rival' })],
      log: [{ at: 3_000, text: 'Fadiga causou 1 de dano: o baralho acabou' }],
    });

    const feedback = deriveSnapshotFeedback(previous, current, 3_000, idSequence());

    expect(feedback.effects).toMatchObject([{ kind: 'dmg', value: 1, anchor: 'face-0' }]);
    expect(feedback.damageNotice).toBeUndefined();
    expect(feedback.sounds).toEqual(['damage']);
  });

  it('mantém a morte na posição correta e celebra quando a mesa inimiga é limpa', () => {
    const defeated = {
      iid: 'enemy-recruit',
      defId: 'c_recruta',
      attack: 1,
      health: 1,
      baseHealth: 1,
      canAttack: false,
    };
    const previous = makeGame({
      seats: [makeSeat(), makeSeat({ playerId: 'enemy', name: 'Rival', board: [defeated] })],
    });
    const current = makeGame({
      seats: [makeSeat(), makeSeat({ playerId: 'enemy', name: 'Rival', board: [] })],
    });

    const feedback = deriveSnapshotFeedback(previous, current, 4_000, idSequence());

    expect(feedback.ghosts).toMatchObject([{
      seatIdx: 1,
      creature: defeated,
      slot: 0,
      at: 4_000,
    }]);
    expect(feedback.banner).toEqual({ text: 'Venceu a mesa!', at: 4_000 });
    expect(feedback.sounds).toEqual(['death', 'tableWin']);
  });

  it('não reaproveita diferenças visuais entre partidas distintas', () => {
    const previous = makeGame({
      matchId: 'match-anterior',
      seats: [makeSeat({ hp: 30 }), makeSeat({ playerId: 'enemy', name: 'Rival' })],
    });
    const current = makeGame({
      matchId: 'match-nova',
      seats: [makeSeat({ hp: 10 }), makeSeat({ playerId: 'enemy', name: 'Rival' })],
    });

    const feedback = deriveSnapshotFeedback(previous, current, 5_000, idSequence());

    expect(feedback).toEqual({
      effects: [],
      ghosts: [],
      reveals: [],
      sounds: [],
      resetAim: false,
    });
  });
});
