import { randomInt } from 'node:crypto';
import { deckComposition } from '@legendsclash/shared';
import type { CardInstance, MatchSnapshot } from '../types.js';

type RandomIndex = (upperExclusive: number) => number;

/** Cria IDs e decks; a instancia de producao e compartilhada entre partidas. */
export class CardInstanceFactory {
  private nextInstanceId: number;

  constructor(
    private readonly randomIndex: RandomIndex = (upperExclusive) => randomInt(upperExclusive),
    firstInstanceId = 1,
  ) {
    this.nextInstanceId = firstInstanceId;
  }

  nextId(): string {
    return `i${this.nextInstanceId++}`;
  }

  create(defId: string): CardInstance {
    return { iid: this.nextId(), defId };
  }

  observeId(iid: string): void {
    const numericId = /^i(\d+)$/.exec(iid)?.[1];
    if (!numericId) return;
    this.nextInstanceId = Math.max(this.nextInstanceId, Number(numericId) + 1);
  }

  observeSnapshot(snapshot: MatchSnapshot): void {
    for (const seat of snapshot.seats) {
      for (const card of [...seat.deck, ...seat.hand, ...seat.board]) {
        this.observeId(card.iid);
      }
      for (const [iid] of seat.creatureLog) this.observeId(iid);
    }
  }

  buildDeck(factionId?: string, includeComeback = false): CardInstance[] {
    const deck: CardInstance[] = [];
    for (const [defId, copies] of deckComposition(factionId, includeComeback)) {
      for (let copy = 0; copy < copies; copy++) deck.push(this.create(defId));
    }
    this.shuffle(deck);
    return deck;
  }

  /** Fisher-Yates com a fonte aleatoria configurada para esta fabrica. */
  shuffle<T>(items: T[]): void {
    for (let index = items.length - 1; index > 0; index--) {
      const randomIndex = this.randomIndex(index + 1);
      [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
    }
  }
}

export const cardInstances = new CardInstanceFactory();
