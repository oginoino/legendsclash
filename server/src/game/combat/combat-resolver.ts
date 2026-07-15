import { CARDS, STARTING_HP } from '@legendsclash/shared';
import type { CombatAction, Target } from '@legendsclash/shared';
import type { CardEffects } from '../effects/card-effects.js';
import { GameError } from '../errors.js';
import type { Creature, Seat } from '../types.js';

export interface CombatContext {
  seats: Seat[];
  cardEffects: Pick<CardEffects, 'hurtCreature' | 'cleanupBoard'>;
  damagePlayer(seat: Seat, amount: number): void;
  addLog(text: string): void;
  creatureLabel(seat: Seat, creature: Creature): string;
  recordAction(action: Omit<CombatAction, 'seq' | 'at'>): void;
}

/** Resolve uma intencao de ataque sem conhecer turno, timer ou transporte. */
export class CombatResolver {
  constructor(private readonly context: CombatContext) {}

  resolveAttack(attackerSeatIdx: number, attackerIid: string, target: Target): void {
    const attackerSeat = this.context.seats[attackerSeatIdx];
    const attacker = attackerSeat.board.find((creature) => creature.iid === attackerIid);
    if (!attacker) throw new GameError('Criatura não encontrada.');
    if (!attacker.canAttack) throw new GameError('Essa criatura ainda não pode atacar.');
    if (attacker.attacked) throw new GameError('Essa criatura já atacou neste turno.');
    if (target.seat === attackerSeatIdx) throw new GameError('Não é possível atacar a si mesmo.');

    const defenderSeat = this.context.seats[target.seat];
    if (!defenderSeat || defenderSeat.out) throw new GameError('Alvo inválido.');
    if (!target.iid && defenderSeat.board.length > 0) {
      throw new GameError('As criaturas inimigas protegem o comandante — derrote-as primeiro.');
    }

    const taunts = defenderSeat.board.filter((creature) => (
      CARDS[creature.defId].keywords?.includes('taunt')
    ));
    if (target.iid && taunts.length > 0 && !taunts.some((creature) => creature.iid === target.iid)) {
      throw new GameError('Provocar: ataque primeiro a criatura com Provocar.');
    }

    const power = attacker.attack + attackerSeat.attackBonus;
    const attackerName = this.context.creatureLabel(attackerSeat, attacker);

    if (target.iid) {
      this.resolveCreatureCombat(attackerSeat, attacker, defenderSeat, target.iid, power, attackerName);
    } else {
      this.context.damagePlayer(defenderSeat, power);
      attackerSeat.stats.damageDealt += power;
      this.bumpCreature(attackerSeat, attacker, power, 0);
      this.context.addLog(`${attackerName} causou ${power} de dano em ${defenderSeat.player.name}`);
      this.lifestealHeal(attackerSeat, attacker, power);
    }

    attacker.attacked = true;
    this.context.recordAction({
      seat: attackerSeatIdx,
      kind: 'attack',
      sourceDefId: attacker.defId,
      sourceIid: attacker.iid,
      target: { ...target },
    });
  }

  private resolveCreatureCombat(
    attackerSeat: Seat,
    attacker: Creature,
    defenderSeat: Seat,
    defenderIid: string,
    power: number,
    attackerName: string,
  ): void {
    const defender = defenderSeat.board.find((creature) => creature.iid === defenderIid);
    if (!defender) throw new GameError('Alvo inválido.');

    const defenderName = this.context.creatureLabel(defenderSeat, defender);
    const wasLast = defenderSeat.board.length === 1;
    const excess = power - defender.health;
    const retaliation = defender.attack + defenderSeat.attackBonus;
    this.context.addLog(`${attackerName} atacou ${defenderName}`);

    const dealtToDefender = this.context.cardEffects.hurtCreature(defenderSeat, defender, power);
    const dealtToAttacker = this.context.cardEffects.hurtCreature(attackerSeat, attacker, retaliation);
    const defenderDied = defender.health <= 0;
    this.bumpCreature(attackerSeat, attacker, dealtToDefender, defenderDied ? 1 : 0);
    if (dealtToAttacker > 0) {
      this.context.addLog(`${defenderName} revidou: ${attackerName} sofreu ${dealtToAttacker} de dano`);
    }

    this.lifestealHeal(attackerSeat, attacker, dealtToDefender);
    this.lifestealHeal(defenderSeat, defender, dealtToAttacker);
    this.context.cardEffects.cleanupBoard(attackerSeat);
    this.context.cardEffects.cleanupBoard(defenderSeat);

    if (wasLast && defenderDied && excess > 0) {
      this.context.damagePlayer(defenderSeat, excess);
      attackerSeat.stats.damageDealt += excess;
      this.context.addLog(`O dano excedente atingiu ${defenderSeat.player.name} (−${excess})`);
    }
  }

  private bumpCreature(seat: Seat, creature: Creature, damage: number, kills: number): void {
    const entry = seat.creatureLog.get(creature.iid)
      ?? { defId: creature.defId, dmg: 0, kills: 0 };
    entry.dmg += damage;
    entry.kills += kills;
    seat.creatureLog.set(creature.iid, entry);
  }

  private lifestealHeal(owner: Seat, creature: Creature, dealt: number): void {
    if (dealt <= 0 || !CARDS[creature.defId].keywords?.includes('lifesteal')) return;
    if (owner.out || owner.hp <= 0) return;
    const healed = Math.min(STARTING_HP - owner.hp, dealt);
    if (healed <= 0) return;
    owner.hp += healed;
    this.context.addLog(
      `Drenar: ${CARDS[creature.defId].name} restaurou ${healed} de vida a ${owner.player.name}`,
    );
  }
}
