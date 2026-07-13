import { describe, expect, it } from 'vitest';
import { resolveAimArrow } from '../src/features/game/aim-geometry-model';

describe('resolveAimArrow', () => {
  const rects = new Map([
    ['cr-attacker', { left: 10, top: 20, width: 40, height: 60 }],
    ['cr-defender', { left: 110, top: 120, width: 20, height: 40 }],
    ['face-1', { left: 210, top: 220, width: 80, height: 100 }],
  ]);
  const rectForAnchor = (anchor: string) => rects.get(anchor) ?? null;

  it('não cria a seta sem seleção, ponteiro ou origem visível', () => {
    expect(resolveAimArrow({
      enemySeatIdx: 1,
      hover: null,
      hoverValid: false,
      mouse: { x: 50, y: 60 },
      rectForAnchor,
      selection: null,
    })).toEqual({ arrow: null, lockOn: false });
    expect(resolveAimArrow({
      enemySeatIdx: 1,
      hover: null,
      hoverValid: false,
      mouse: null,
      rectForAnchor,
      selection: { kind: 'attacker', iid: 'attacker' },
    })).toEqual({ arrow: null, lockOn: false });
    expect(resolveAimArrow({
      enemySeatIdx: 1,
      hover: null,
      hoverValid: false,
      mouse: { x: 50, y: 60 },
      rectForAnchor,
      selection: { kind: 'attacker', iid: 'missing' },
    })).toEqual({ arrow: null, lockOn: false });
  });

  it('segue o ponteiro a partir do centro da origem', () => {
    expect(resolveAimArrow({
      enemySeatIdx: 1,
      hover: { kind: 'creature', iid: 'defender' },
      hoverValid: false,
      mouse: { x: 300, y: 400 },
      rectForAnchor,
      selection: { kind: 'attacker', iid: 'attacker' },
    })).toEqual({
      arrow: { x1: 30, y1: 50, x2: 300, y2: 400 },
      lockOn: false,
    });
  });

  it('trava no centro de criatura e comandante quando o alvo é válido', () => {
    expect(resolveAimArrow({
      enemySeatIdx: 1,
      hover: { kind: 'creature', iid: 'defender' },
      hoverValid: true,
      mouse: { x: 300, y: 400 },
      rectForAnchor,
      selection: { kind: 'attacker', iid: 'attacker' },
    })).toEqual({
      arrow: { x1: 30, y1: 50, x2: 120, y2: 140 },
      lockOn: true,
    });
    expect(resolveAimArrow({
      enemySeatIdx: 1,
      hover: { kind: 'face' },
      hoverValid: true,
      mouse: { x: 300, y: 400 },
      rectForAnchor,
      selection: { kind: 'attacker', iid: 'attacker' },
    })).toMatchObject({
      arrow: { x2: 250, y2: 270 },
      lockOn: true,
    });
  });
});
