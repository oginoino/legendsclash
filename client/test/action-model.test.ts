import { describe, expect, it } from 'vitest';
import { CARDS } from '@legendsclash/shared';
import type { CreatureOnBoard } from '@legendsclash/shared';
import { resolveAttackAction, resolvePlayAction } from '../src/features/game/action-model';

function creature(overrides: Partial<CreatureOnBoard> = {}): CreatureOnBoard {
  return {
    iid: 'creature-1',
    defId: 'c_lobo',
    attack: 3,
    health: 2,
    baseHealth: 2,
    canAttack: true,
    ...overrides,
  };
}

describe('resolveAttackAction', () => {
  it('ignora silenciosamente turno inativo e atacante exausto', () => {
    const target = { kind: 'face' as const };
    expect(resolveAttackAction({
      attacker: creature(), enemyBoard: [], enemySeatIdx: 1, myTurn: false, target,
    })).toMatchObject({ ok: false, reason: 'inactive-turn', feedback: 'silent' });
    expect(resolveAttackAction({
      attacker: creature({ canAttack: false }), enemyBoard: [], enemySeatIdx: 1, myTurn: true, target,
    })).toMatchObject({ ok: false, reason: 'exhausted-attacker', feedback: 'silent' });
  });

  it('bloqueia fogo amigo e comandante protegido com feedback de erro', () => {
    const guard = creature({ iid: 'guard' });
    expect(resolveAttackAction({
      attacker: creature(),
      enemyBoard: [],
      enemySeatIdx: 1,
      myTurn: true,
      target: { kind: 'my-creature', c: guard },
    })).toMatchObject({ ok: false, reason: 'friendly-fire', feedback: 'error' });
    expect(resolveAttackAction({
      attacker: creature(),
      enemyBoard: [guard],
      enemySeatIdx: 1,
      myTurn: true,
      target: { kind: 'face' },
    })).toMatchObject({ ok: false, reason: 'guarded-commander', feedback: 'error' });
  });

  it('exige Provocar antes de outro alvo', () => {
    const taunt = creature({ iid: 'taunt', defId: 'c_golem' });
    const other = creature({ iid: 'other' });
    expect(resolveAttackAction({
      attacker: creature(),
      enemyBoard: [taunt, other],
      enemySeatIdx: 1,
      myTurn: true,
      target: { kind: 'enemy-creature', c: other },
    })).toMatchObject({ ok: false, reason: 'taunt-priority', feedback: 'error' });
  });

  it('gera os comandos exatos para criatura e comandante', () => {
    const defender = creature({ iid: 'defender' });
    expect(resolveAttackAction({
      attacker: creature({ iid: 'attacker' }),
      enemyBoard: [defender],
      enemySeatIdx: 1,
      myTurn: true,
      target: { kind: 'enemy-creature', c: defender },
    })).toEqual({
      ok: true,
      command: {
        t: 'game:attack',
        attackerIid: 'attacker',
        target: { seat: 1, iid: 'defender' },
      },
    });
    expect(resolveAttackAction({
      attacker: creature({ iid: 'attacker' }),
      enemyBoard: [],
      enemySeatIdx: 1,
      myTurn: true,
      target: { kind: 'face' },
    })).toEqual({
      ok: true,
      command: { t: 'game:attack', attackerIid: 'attacker', target: { seat: 1 } },
    });
  });
});

describe('resolvePlayAction', () => {
  const base = {
    enemyBoard: [] as CreatureOnBoard[],
    enemySeatIdx: 1,
    energy: 10,
    iid: 'hand-1',
    myTurn: true,
    target: null,
    yourSeat: 0,
  };

  it('distingue turno inativo, energia insuficiente e alvo ausente', () => {
    expect(resolvePlayAction({
      ...base, definition: CARDS.c_recruta, myTurn: false,
    })).toMatchObject({ ok: false, reason: 'inactive-turn', feedback: 'silent' });
    expect(resolvePlayAction({
      ...base, definition: CARDS.c_dragao, energy: 1,
    })).toMatchObject({ ok: false, reason: 'unaffordable', feedback: 'energy' });
    expect(resolvePlayAction({
      ...base, definition: CARDS.s_faisca,
    })).toMatchObject({ ok: false, reason: 'target-required', feedback: 'silent' });
  });

  it('joga carta sem alvo sem adicionar target ao protocolo', () => {
    expect(resolvePlayAction({ ...base, definition: CARDS.c_recruta })).toEqual({
      ok: true,
      command: { t: 'game:play', iid: 'hand-1' },
    });
  });

  it('mapeia corretamente criatura aliada e criatura inimiga', () => {
    const ally = creature({ iid: 'ally' });
    const enemy = creature({ iid: 'enemy' });
    expect(resolvePlayAction({
      ...base,
      definition: CARDS.s_fortalecer,
      target: { kind: 'my-creature', c: ally },
    })).toEqual({
      ok: true,
      command: { t: 'game:play', iid: 'hand-1', target: { seat: 0, iid: 'ally' } },
    });
    expect(resolvePlayAction({
      ...base,
      definition: CARDS.s_julgamento,
      target: { kind: 'enemy-creature', c: enemy },
    })).toEqual({
      ok: true,
      command: { t: 'game:play', iid: 'hand-1', target: { seat: 1, iid: 'enemy' } },
    });
  });

  it('rejeita tipo de alvo incompatível', () => {
    expect(resolvePlayAction({
      ...base,
      definition: CARDS.s_fortalecer,
      target: { kind: 'face' },
    })).toMatchObject({ ok: false, reason: 'invalid-target', feedback: 'error' });
  });

  it('respeita proteção do comandante e perfuração', () => {
    const guard = creature({ iid: 'guard' });
    expect(resolvePlayAction({
      ...base,
      definition: CARDS.s_faisca,
      enemyBoard: [guard],
      target: { kind: 'face' },
    })).toMatchObject({ ok: false, reason: 'guarded-commander', feedback: 'error' });
    expect(resolvePlayAction({
      ...base,
      definition: CARDS.s_bola_de_fogo,
      enemyBoard: [guard],
      target: { kind: 'face' },
    })).toEqual({
      ok: true,
      command: { t: 'game:play', iid: 'hand-1', target: { seat: 1 } },
    });
  });
});
