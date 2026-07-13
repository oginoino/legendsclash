import { describe, expect, it } from 'vitest';
import { CARDS } from '@legendsclash/shared';
import {
  deriveAimMode,
  deriveHandConfirm,
  deriveTargetHint,
  visibleInspection,
} from '../src/features/game/presentation-model';

describe('deriveTargetHint', () => {
  const attacker = { defId: 'c_lobo' };

  it('explica a prioridade de Provocar antes das demais rotas de ataque', () => {
    expect(deriveTargetHint({
      faceShielded: true,
      mustHitTaunt: true,
      selectedAttacker: attacker,
      selectedCard: null,
      selection: { kind: 'attacker', iid: 'attacker' },
      tauntFocusName: 'Golem de Pedra',
    })).toEqual({
      mode: 'attack',
      title: CARDS.c_lobo.name,
      body: 'Golem de Pedra está protegendo a mesa. Ataque Provocar primeiro.',
    });
  });

  it('distingue comandante protegido e mesa livre', () => {
    const base = {
      mustHitTaunt: false,
      selectedAttacker: attacker,
      selectedCard: null,
      selection: { kind: 'attacker' as const, iid: 'attacker' },
      tauntFocusName: 'Provocar',
    };
    expect(deriveTargetHint({ ...base, faceShielded: true })?.body)
      .toBe('As criaturas inimigas protegem o comandante. Remova a mesa para abrir dano direto.');
    expect(deriveTargetHint({ ...base, faceShielded: false })?.body)
      .toBe('Mesa livre. Escolha um alvo e confirme pela prévia de dano.');
  });

  it('orienta suporte e magia respeitando perfuração', () => {
    const base = {
      faceShielded: true,
      mustHitTaunt: false,
      selectedAttacker: null,
      selection: { kind: 'hand' as const, iid: 'hand-1' },
      tauntFocusName: 'Provocar',
    };
    expect(deriveTargetHint({ ...base, selectedCard: CARDS.s_fortalecer })).toMatchObject({
      mode: 'support',
      body: 'Escolha uma criatura aliada para receber o efeito.',
    });
    expect(deriveTargetHint({ ...base, selectedCard: CARDS.s_faisca })?.body)
      .toBe('As criaturas inimigas bloqueiam o comandante. Mire uma criatura primeiro.');
    expect(deriveTargetHint({ ...base, selectedCard: CARDS.s_bola_de_fogo })?.body)
      .toBe('Escolha o melhor alvo usando a prévia de dano.');
  });
});

describe('deriveHandConfirm', () => {
  it('só confirma no toque, durante o turno e com uma carta focada', () => {
    const base = {
      focusedCard: CARDS.c_recruta,
      handFocus: { iid: 'hand-1', defId: 'c_recruta' },
      myTurn: true,
      touchPlayConfirm: true,
    };
    expect(deriveHandConfirm(base)).toEqual({
      mode: 'play',
      title: CARDS.c_recruta.name,
      body: 'Revise antes de jogar.',
      actionLabel: 'Invocar',
    });
    expect(deriveHandConfirm({ ...base, myTurn: false })).toBeNull();
    expect(deriveHandConfirm({ ...base, touchPlayConfirm: false })).toBeNull();
    expect(deriveHandConfirm({ ...base, handFocus: null })).toBeNull();
  });
});

describe('visibleInspection', () => {
  const handInspect = {
    iid: 'hand-1', defId: 'c_recruta', x: 100, y: 200, source: 'hand' as const,
  };
  const creatureInspect = {
    iid: 'board-1', defId: 'c_lobo', x: 100, y: 200, source: 'creature' as const,
  };
  const base = {
    dragCard: null,
    gameActive: true,
    hand: [{ iid: 'hand-1', defId: 'c_recruta' }],
    selection: null,
  };

  it('mantém inspeção da mão apenas enquanto a carta ainda existe', () => {
    expect(visibleInspection({ ...base, inspect: handInspect })).toEqual(handInspect);
    expect(visibleInspection({ ...base, hand: [], inspect: handInspect })).toBeNull();
  });

  it('oculta a mão durante mira/arrasto, mas preserva inspeção da mesa na mira', () => {
    const selection = { kind: 'attacker' as const, iid: 'board-1' };
    expect(visibleInspection({ ...base, inspect: handInspect, selection })).toBeNull();
    expect(visibleInspection({ ...base, inspect: creatureInspect, selection })).toEqual(creatureInspect);
    expect(visibleInspection({
      ...base,
      dragCard: {
        iid: 'hand-1', defId: 'c_recruta', x: 0, y: 0, mode: 'play', valid: false,
        label: 'Arraste para invocar', pointerType: 'touch', magnetized: false,
      },
      inspect: creatureInspect,
    })).toBeNull();
  });
});

describe('deriveAimMode', () => {
  it('aplica a precedência letal, ataque, suporte e magia', () => {
    expect(deriveAimMode({ lethal: true, selection: null, targetingFriendly: true })).toBe('lethal');
    expect(deriveAimMode({
      lethal: false, selection: { kind: 'attacker', iid: 'a' }, targetingFriendly: true,
    })).toBe('attack');
    expect(deriveAimMode({ lethal: false, selection: null, targetingFriendly: true })).toBe('support');
    expect(deriveAimMode({ lethal: false, selection: null, targetingFriendly: false })).toBe('spell');
  });
});
