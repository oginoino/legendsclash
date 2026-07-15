import { CARDS, MAX_BOARD } from '@legendsclash/shared';
import type { CombatAction, Target } from '@legendsclash/shared';
import type { CardEffects } from '../effects/card-effects.js';
import { GameError } from '../errors.js';
import type { CardInstance, Seat } from '../types.js';

export interface CardPlayContext {
  seats: Seat[];
  effects: Pick<CardEffects, 'resolve' | 'triggerBattlecry'>;
  addLog(text: string): void;
  recordPlay(seatIndex: number, cardId: string): void;
  recordAction(action: Omit<CombatAction, 'seq' | 'at'>): void;
}

/** Valida e executa uma carta que ja passou pela autorizacao de turno. */
export class CardPlayController {
  constructor(private readonly context: CardPlayContext) {}

  play(seatIndex: number, iid: string, target?: Target): void {
    const seat = this.context.seats[seatIndex];
    const handIndex = seat.hand.findIndex((card) => card.iid === iid);
    if (handIndex < 0) throw new GameError('Carta não está na sua mão.');

    const card = seat.hand[handIndex];
    const definition = CARDS[card.defId];
    if (seat.energy < definition.cost) throw new GameError('Energia insuficiente.');

    switch (definition.type) {
      case 'creature':
        this.summon(seatIndex, card);
        break;
      case 'spell':
      case 'tactic':
        this.context.effects.resolve(seatIndex, definition.id, target);
        break;
      case 'artifact':
        this.equip(seat, definition.id, definition.name);
        break;
    }

    if (definition.type === 'creature') seat.stats.creaturesSummoned++;
    else if (definition.type === 'spell') seat.stats.spellsCast++;

    seat.energy -= definition.cost;
    seat.hand.splice(handIndex, 1);
    this.context.recordPlay(seatIndex, definition.id);
    this.context.recordAction({
      seat: seatIndex,
      kind: 'card',
      sourceDefId: definition.id,
      sourceIid: card.iid,
      target: target ? { ...target } : undefined,
    });
  }

  private summon(seatIndex: number, card: CardInstance): void {
    const seat = this.context.seats[seatIndex];
    if (seat.board.length >= MAX_BOARD) {
      throw new GameError('Mesa cheia (máx. 6 criaturas).');
    }

    const definition = CARDS[card.defId];
    const keywords = definition.keywords ?? [];
    seat.board.push({
      iid: card.iid,
      defId: card.defId,
      attack: definition.attack!,
      health: definition.health!,
      baseHealth: definition.health!,
      canAttack: keywords.includes('charge'),
      attacked: false,
      ward: keywords.includes('ward') || undefined,
    });
    this.context.addLog(`${seat.player.name} invocou ${definition.name}`);
    if (keywords.includes('battlecry')) {
      this.context.effects.triggerBattlecry(seatIndex, definition.id, card.iid);
    }
  }

  private equip(seat: Seat, defId: string, name: string): void {
    if (defId === 'a_escudo') {
      seat.shield += 4;
    } else if (defId === 'a_estandarte') {
      seat.attackBonus += 1;
      seat.artifacts.push(defId);
    } else if (defId === 'a_relicario') {
      seat.regen += 1;
      seat.artifacts.push(defId);
    } else if (defId === 'a_orbe') {
      seat.spellBonus += 1;
      seat.artifacts.push(defId);
    } else if (defId === 'a_figura') {
      seat.shieldRegen += 1;
      seat.artifacts.push(defId);
    }
    this.context.addLog(`${seat.player.name} equipou ${name}`);
  }
}
