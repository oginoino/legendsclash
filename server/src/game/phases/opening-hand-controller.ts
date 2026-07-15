import { CARDS, STARTING_HAND } from '@legendsclash/shared';
import type { CardInstanceFactory } from '../cards/card-instance-factory.js';
import { GameError } from '../errors.js';
import type { Seat } from '../types.js';
import type { TurnClock } from '../timing/turn-clock.js';

/** Segundos da fase de troca antes do primeiro turno. */
export const MULLIGAN_SECONDS = 30;

type OpeningStatus = 'mulligan' | 'active' | 'finished';

export interface OpeningHandContext {
  seats: Seat[];
  botIds: readonly string[];
  clock: TurnClock;
  status(): OpeningStatus;
  setStatus(status: 'mulligan' | 'active'): void;
  seatOf(playerId: string): number;
  draw(seat: Seat, silent: boolean): void;
  addLog(text: string): void;
  beginFirstTurn(): void;
  onUpdate(): void;
}

/** Distribui a mao inicial e coordena a fase de troca antes do turno 1. */
export class OpeningHandController {
  constructor(
    private readonly context: OpeningHandContext,
    private readonly cards: Pick<CardInstanceFactory, 'create' | 'shuffle'>,
  ) {}

  start(useMulligan: boolean): void {
    this.context.seats.forEach((seat, index) => {
      for (let card = 0; card < STARTING_HAND; card++) {
        this.context.draw(seat, true);
      }
      // Compensa a iniciativa sem conceder outra compra permanente ao baralho.
      if (index !== 0) seat.hand.push(this.cards.create('t_moeda'));
    });
    this.context.addLog(
      `Partida iniciada: ${this.context.seats.map((seat) => seat.player.name).join(' vs ')}`,
    );

    if (!useMulligan) {
      this.context.beginFirstTurn();
      this.context.onUpdate();
      return;
    }

    this.context.setStatus('mulligan');
    this.armTimer();
    this.context.addLog('Fase de troca: ajuste a mão inicial');
    for (const playerId of this.context.botIds) {
      try { this.confirm(playerId, []); } catch { /* a IA nunca bloqueia a abertura */ }
    }
    this.context.onUpdate();
  }

  confirm(playerId: string, iids: string[]): void {
    if (this.context.status() !== 'mulligan') {
      throw new GameError('Não é a fase de troca de mão.');
    }
    const seatIndex = this.context.seatOf(playerId);
    if (seatIndex < 0) throw new GameError('Você não está nesta partida.');
    const seat = this.context.seats[seatIndex];
    if (seat.mulliganDone) throw new GameError('Você já confirmou sua mão.');

    const requestedIds = new Set(iids);
    const swapping = seat.hand.filter(
      (card) => requestedIds.has(card.iid) && !CARDS[card.defId].token,
    );
    if (swapping.length) {
      const swappingIds = new Set(swapping.map((card) => card.iid));
      seat.hand = seat.hand.filter((card) => !swappingIds.has(card.iid));
      // Compra antes de devolver para impedir que a mesma carta volte na troca.
      for (let card = 0; card < swapping.length; card++) {
        this.context.draw(seat, true);
      }
      seat.deck.push(...swapping);
      this.cards.shuffle(seat.deck);
    }

    seat.mulliganDone = true;
    this.context.addLog(
      `${seat.player.name} confirmou a mão${swapping.length ? ` (trocou ${swapping.length})` : ''}`,
    );
    if (this.context.seats.every((candidate) => candidate.out || candidate.mulliganDone)) {
      this.finish();
    } else {
      this.context.onUpdate();
    }
  }

  restoreTimer(ms = MULLIGAN_SECONDS * 1000): void {
    this.armTimer(ms);
  }

  private armTimer(ms = MULLIGAN_SECONDS * 1000): void {
    this.context.clock.arm(ms, () => this.forceFinish());
  }

  private forceFinish(): void {
    if (this.context.status() !== 'mulligan') return;
    for (const seat of this.context.seats) seat.mulliganDone = true;
    this.context.addLog('Tempo de troca esgotado — mãos confirmadas');
    this.finish();
  }

  private finish(): void {
    this.context.clock.clear();
    this.context.setStatus('active');
    this.context.beginFirstTurn();
    this.context.onUpdate();
  }
}
