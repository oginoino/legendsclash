import { describe, expect, it } from 'vitest';
import {
  isPlayDropReadyAt,
  pendingDragIntent,
} from '../src/features/game/drag-gesture-model';

const mouse = { pointerType: 'mouse', startX: 100, startY: 100 };
const touch = { pointerType: 'touch', startX: 100, startY: 100 };

describe('pendingDragIntent', () => {
  it('preserva o clique do mouse dentro do limiar e ativa no limite', () => {
    expect(pendingDragIntent(mouse, 107, 100)).toBe('pending');
    expect(pendingDragIntent(mouse, 108, 100)).toBe('activate');
  });

  it('tolera a oscilação maior de um toque sem iniciar gesto', () => {
    expect(pendingDragIntent(touch, 110, 91)).toBe('pending');
  });

  it('entrega o movimento horizontal do dedo à rolagem da mão', () => {
    expect(pendingDragIntent(touch, 124, 90)).toBe('pan');
  });

  it('trata movimento para baixo como rolagem, não como jogada', () => {
    expect(pendingDragIntent(touch, 100, 118)).toBe('pan');
  });

  it('ativa somente a intenção vertical para cima depois do limiar touch', () => {
    expect(pendingDragIntent(touch, 100, 86)).toBe('activate');
    expect(pendingDragIntent(touch, 108, 86)).toBe('activate');
  });

  it('usa o limiar preciso de ponteiro para caneta', () => {
    expect(pendingDragIntent({ ...mouse, pointerType: 'pen' }, 108, 100)).toBe('activate');
  });
});

describe('isPlayDropReadyAt', () => {
  it('exige a elevação precisa para mouse e toque', () => {
    expect(isPlayDropReadyAt({
      drag: mouse, isCreature: false, x: 100, y: 53,
    })).toBe(false);
    expect(isPlayDropReadyAt({
      drag: mouse, isCreature: false, x: 100, y: 52,
    })).toBe(true);
    expect(isPlayDropReadyAt({
      drag: touch, isCreature: false, x: 100, y: 45,
    })).toBe(false);
    expect(isPlayDropReadyAt({
      drag: touch, isCreature: false, x: 100, y: 44,
    })).toBe(true);
  });

  it('não exige a geometria da mesa para cartas sem criatura', () => {
    expect(isPlayDropReadyAt({
      drag: { ...touch, startY: 200 },
      isCreature: false,
      x: 400,
      y: 100,
    })).toBe(true);
  });

  it('exige a mesa no toque de criatura e tolera 24px ao redor dela', () => {
    const drag = { ...touch, startY: 200 };
    const rowRect = { left: 20, right: 80, top: 10, bottom: 60 };
    expect(isPlayDropReadyAt({ drag, isCreature: true, x: 20, y: 50 })).toBe(false);
    expect(isPlayDropReadyAt({ drag, isCreature: true, rowRect, x: -4, y: 84 })).toBe(true);
    expect(isPlayDropReadyAt({ drag, isCreature: true, rowRect, x: -5, y: 84 })).toBe(false);
    expect(isPlayDropReadyAt({ drag, isCreature: true, rowRect, x: -4, y: 85 })).toBe(false);
  });

  it('mantém o desktop independente dos limites visuais da mesa', () => {
    expect(isPlayDropReadyAt({
      drag: { ...mouse, startY: 200 },
      isCreature: true,
      x: 1_000,
      y: 100,
    })).toBe(true);
  });
});
