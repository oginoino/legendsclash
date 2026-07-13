import { describe, expect, it } from 'vitest';
import { pendingDragIntent } from '../src/features/game/drag-gesture-model';

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
