import { describe, expect, it } from 'vitest';
import { deckComposition } from '@legendsclash/shared';
import type { MatchSnapshot } from '../src/game/types.js';
import { CardInstanceFactory } from '../src/game/cards/card-instance-factory.js';

describe('CardInstanceFactory', () => {
  it('gera IDs sequenciais no formato publico atual', () => {
    const factory = new CardInstanceFactory(() => 0);
    expect(factory.nextId()).toBe('i1');
    expect(factory.create('c_lobo')).toEqual({ iid: 'i2', defId: 'c_lobo' });
    expect(factory.nextId()).toBe('i3');
  });

  it('observa IDs restaurados sem regredir a sequencia', () => {
    const factory = new CardInstanceFactory(() => 0, 10);
    factory.observeId('i41');
    factory.observeId('i3');
    factory.observeId('externo');
    expect(factory.nextId()).toBe('i42');
  });

  it('observa cartas e creatureLog de um snapshot', () => {
    const factory = new CardInstanceFactory(() => 0);
    factory.observeSnapshot({
      seats: [{
        deck: [{ iid: 'i8', defId: 'c_lobo' }],
        hand: [{ iid: 'i13', defId: 's_faisca' }],
        board: [],
        creatureLog: [['i21', { defId: 'c_lobo', dmg: 0, kills: 0 }]],
      }],
    } as unknown as MatchSnapshot);
    expect(factory.nextId()).toBe('i22');
  });

  it('constroi a composicao esperada com IDs unicos', () => {
    const factory = new CardInstanceFactory((upperExclusive) => upperExclusive - 1);
    const deck = factory.buildDeck();
    const expected = new Map(deckComposition());
    const counts = new Map<string, number>();
    for (const card of deck) counts.set(card.defId, (counts.get(card.defId) ?? 0) + 1);

    expect(deck).toHaveLength([...expected.values()].reduce((sum, copies) => sum + copies, 0));
    expect(new Set(deck.map((card) => card.iid)).size).toBe(deck.length);
    expect(counts).toEqual(expected);
  });

  it('permite testar Fisher-Yates com aleatoriedade deterministica', () => {
    const factory = new CardInstanceFactory(() => 0);
    const items = [1, 2, 3];
    factory.shuffle(items);
    expect(items).toEqual([2, 3, 1]);
  });
});
