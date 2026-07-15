import { randomInt } from 'node:crypto';
import {
  CARDS,
  MAX_ENERGY,
  MAX_HAND,
  MAX_BOARD,
  STARTING_HP,
} from '@legendsclash/shared';
import type { Target } from '@legendsclash/shared';
import { GameError } from '../errors.js';
import type { Creature, Seat } from '../types.js';

export interface CardEffectsContext {
  seats: Seat[];
  draw(seat: Seat): void;
  damagePlayer(seat: Seat, amount: number): void;
  addLog(text: string): void;
  creatureLabel(seat: Seat, creature: Creature): string;
  newInstanceId(): string;
}

/**
 * Resolve efeitos de cartas e palavras-chave sem conhecer ciclo de turno,
 * transporte ou persistencia da partida.
 */
export class CardEffects {
  constructor(private readonly context: CardEffectsContext) {}

  resolve(casterIdx: number, defId: string, target?: Target): void {
    const caster = this.context.seats[casterIdx];
    const def = CARDS[defId];

    const enemyCreature = (): { seat: Seat; creature: Creature } => {
      if (!target || target.iid === undefined) throw new GameError('Escolha uma criatura inimiga.');
      if (target.seat === casterIdx) throw new GameError('O alvo deve ser inimigo.');
      const seat = this.context.seats[target.seat];
      const creature = seat?.board.find((card) => card.iid === target.iid);
      if (!creature) throw new GameError('Alvo inválido.');
      return { seat, creature };
    };

    switch (defId) {
      case 's_faisca':
      case 's_bola_de_fogo': {
        const damage = (defId === 's_faisca' ? 2 : 5) + caster.spellBonus;
        if (!target || target.seat === casterIdx) throw new GameError('Escolha um alvo inimigo.');
        const enemy = this.context.seats[target.seat];
        if (!enemy || enemy.out) throw new GameError('Alvo inválido.');
        if (!target.iid && enemy.board.length > 0 && !def.pierce) {
          throw new GameError('As criaturas inimigas protegem o comandante.');
        }
        if (target.iid) {
          const creature = enemy.board.find((card) => card.iid === target.iid);
          if (!creature) throw new GameError('Alvo inválido.');
          const dealt = this.hurtCreature(enemy, creature, damage);
          if (dealt > 0) {
            this.context.addLog(
              `${def.name} causou ${dealt} de dano em ${this.context.creatureLabel(enemy, creature)}`,
            );
          }
          this.cleanupBoard(enemy);
        } else {
          this.context.damagePlayer(enemy, damage);
          caster.stats.damageDealt += damage;
          this.context.addLog(`${def.name} causou ${damage} de dano em ${enemy.player.name}`);
        }
        break;
      }
      case 's_bencao':
        caster.hp = Math.min(STARTING_HP, caster.hp + 4);
        this.context.addLog(`${caster.player.name} restaurou 4 de vida`);
        break;
      case 's_tempestade': {
        const hit = this.damageAllEnemyCreatures(casterIdx, 2 + caster.spellBonus);
        this.context.addLog(`${def.name} atingiu ${hit} criatura(s) inimiga(s)`);
        break;
      }
      case 's_maremoto': {
        const hit = this.damageAllEnemyCreatures(casterIdx, 3 + caster.spellBonus);
        this.context.addLog(`${def.name} atingiu ${hit} criatura(s) inimiga(s)`);
        break;
      }
      case 's_lanca_gelo': {
        const { seat, creature } = enemyCreature();
        const dealt = this.hurtCreature(seat, creature, 3 + caster.spellBonus);
        if (dealt > 0) {
          this.context.addLog(
            `${def.name} causou ${dealt} de dano em ${this.context.creatureLabel(seat, creature)}`,
          );
        }
        this.cleanupBoard(seat);
        break;
      }
      case 's_julgamento': {
        const { seat, creature } = enemyCreature();
        const dealt = this.hurtCreature(seat, creature, 3 + caster.spellBonus);
        if (dealt > 0) {
          this.context.addLog(
            `${def.name} causou ${dealt} de dano em ${this.context.creatureLabel(seat, creature)}`,
          );
        }
        this.cleanupBoard(seat);
        caster.hp = Math.min(STARTING_HP, caster.hp + 2);
        this.context.addLog(`${caster.player.name} restaurou 2 de vida`);
        break;
      }
      case 's_canto':
        for (const creature of caster.board) {
          creature.attack += 1;
          creature.health += 1;
          creature.baseHealth += 1;
        }
        this.context.addLog(`${def.name}: as criaturas de ${caster.player.name} ganharam +1/+1`);
        break;
      case 's_pacto':
        this.context.draw(caster);
        this.context.draw(caster);
        this.context.draw(caster);
        caster.hp -= 3;
        this.context.addLog(`${caster.player.name} comprou 3 cartas e pagou 3 de vida ao Vazio`);
        break;
      case 's_fortalecer': {
        if (!target || target.seat !== casterIdx || !target.iid) {
          throw new GameError('Escolha uma criatura aliada.');
        }
        const creature = caster.board.find((card) => card.iid === target.iid);
        if (!creature) throw new GameError('Alvo inválido.');
        creature.attack += 2;
        creature.health += 2;
        creature.baseHealth += 2;
        this.context.addLog(`${this.context.creatureLabel(caster, creature)} recebeu +2/+2`);
        break;
      }
      case 't_reforcos':
        this.context.draw(caster);
        this.context.draw(caster);
        this.context.addLog(`${caster.player.name} comprou 2 cartas`);
        break;
      case 't_surto':
        caster.energy = Math.min(MAX_ENERGY, caster.energy + 2);
        this.context.addLog(`${caster.player.name} ganhou 2 de energia`);
        break;
      case 't_moeda':
        caster.energy = Math.min(MAX_ENERGY, caster.energy + 1);
        this.context.addLog(`${caster.player.name} usou a Moeda do Tempo (+1 de energia)`);
        break;
      case 't_recuo': {
        const { seat, creature } = enemyCreature();
        this.bounceToHand(seat, creature);
        break;
      }
      case 't_matilha':
        this.summonToken(caster, 'c_filhote');
        this.summonToken(caster, 'c_filhote');
        this.context.addLog(`${caster.player.name} chamou a matilha`);
        break;
      case 't_abordagem': {
        if (!target || target.seat !== casterIdx || !target.iid) {
          throw new GameError('Escolha uma criatura aliada.');
        }
        const creature = caster.board.find((card) => card.iid === target.iid);
        if (!creature) throw new GameError('Alvo inválido.');
        creature.attack += 1;
        if (!creature.attacked) creature.canAttack = true;
        this.context.addLog(
          `${this.context.creatureLabel(caster, creature)} ganhou +1 de ataque e está pronta para a abordagem`,
        );
        break;
      }
      case 't_saque':
        this.context.draw(caster);
        caster.energy = Math.min(MAX_ENERGY, caster.energy + 1);
        this.context.addLog(`${caster.player.name} seguiu o mapa: +1 carta e +1 de energia`);
        break;
      default:
        throw new GameError('Efeito desconhecido.');
    }
  }

  /** Resolve Grito de Batalha ao invocar uma criatura. */
  triggerBattlecry(casterIdx: number, defId: string, selfIid: string): void {
    const caster = this.context.seats[casterIdx];
    switch (defId) {
      case 'c_arqueira': {
        const pick = this.randomEnemyCreature(casterIdx);
        if (!pick) return;
        const dealt = this.hurtCreature(pick.seat, pick.creature, 1);
        if (dealt > 0) {
          this.context.addLog(
            `Grito de Batalha: a flecha causou 1 de dano em ${this.context.creatureLabel(pick.seat, pick.creature)}`,
          );
        }
        this.cleanupBoard(pick.seat);
        break;
      }
      case 'c_maga': {
        const pick = this.randomEnemyCreature(casterIdx);
        if (!pick) return;
        const dealt = this.hurtCreature(pick.seat, pick.creature, 2);
        if (dealt > 0) {
          this.context.addLog(
            `Grito de Batalha: a maga causou 2 de dano em ${this.context.creatureLabel(pick.seat, pick.creature)}`,
          );
        }
        this.cleanupBoard(pick.seat);
        break;
      }
      case 'c_arquimago': {
        const hit = this.damageAllEnemyCreatures(casterIdx, 2);
        this.context.addLog(`Grito de Batalha: a Fratura sangrou sobre ${hit} criatura(s) inimiga(s)`);
        break;
      }
      case 'c_cleriga':
        caster.hp = Math.min(STARTING_HP, caster.hp + 3);
        this.context.addLog(`Grito de Batalha: ${caster.player.name} restaurou 3 de vida`);
        break;
      case 'c_sentinela':
        this.context.draw(caster);
        this.context.addLog(`Grito de Batalha: ${caster.player.name} comprou 1 carta`);
        break;
      case 'c_bardo': {
        let buffed = 0;
        for (const creature of caster.board) {
          if (creature.iid === selfIid) continue;
          creature.attack += 1;
          creature.health += 1;
          creature.baseHealth += 1;
          buffed++;
        }
        if (buffed > 0) {
          this.context.addLog(`Grito de Batalha: a canção deu +1/+1 a ${buffed} criatura(s)`);
        }
        break;
      }
      case 'c_corsaria':
        caster.energy = Math.min(MAX_ENERGY, caster.energy + 1);
        this.context.addLog(`Grito de Batalha: ${caster.player.name} ganhou 1 de energia`);
        break;
      case 'c_sereia': {
        const pick = this.randomEnemyCreature(casterIdx);
        if (!pick) return;
        this.context.addLog('Grito de Batalha: o canto da sereia ecoou');
        this.bounceToHand(pick.seat, pick.creature);
        break;
      }
    }
  }

  /** Aplica dano respeitando Escudo Arcano, sem remover a criatura da mesa. */
  hurtCreature(owner: Seat, creature: Creature, amount: number): number {
    if (amount <= 0) return 0;
    if (creature.ward) {
      creature.ward = false;
      this.context.addLog(
        `O Escudo Arcano de ${this.context.creatureLabel(owner, creature)} absorveu o golpe`,
      );
      return 0;
    }
    creature.health -= amount;
    return amount;
  }

  /** Remove criaturas derrotadas e resolve seus Estertores na ordem da mesa. */
  cleanupBoard(seat: Seat): void {
    const dead = seat.board.filter((creature) => creature.health <= 0);
    for (const creature of dead) {
      this.context.addLog(`${this.context.creatureLabel(seat, creature)} foi destruída`);
    }
    seat.board = seat.board.filter((creature) => creature.health > 0);
    for (const creature of dead) {
      if (CARDS[creature.defId].keywords?.includes('deathrattle')) {
        this.triggerDeathrattle(seat, creature);
      }
    }
  }

  private summonToken(seat: Seat, defId: string): boolean {
    if (seat.board.length >= MAX_BOARD) return false;
    const def = CARDS[defId];
    const keywords = def.keywords ?? [];
    seat.board.push({
      iid: this.context.newInstanceId(),
      defId,
      attack: def.attack!,
      health: def.health!,
      baseHealth: def.health!,
      canAttack: false,
      attacked: false,
      ward: keywords.includes('ward') || undefined,
    });
    return true;
  }

  private damageAllEnemyCreatures(casterIdx: number, damage: number): number {
    let hit = 0;
    this.context.seats.forEach((seat, seatIdx) => {
      if (seatIdx === casterIdx || seat.out) return;
      for (const creature of [...seat.board]) {
        this.hurtCreature(seat, creature, damage);
        hit++;
      }
      this.cleanupBoard(seat);
    });
    return hit;
  }

  private randomEnemyCreature(casterIdx: number): { seat: Seat; creature: Creature } | null {
    const targets: Array<{ seat: Seat; creature: Creature }> = [];
    this.context.seats.forEach((seat, seatIdx) => {
      if (seatIdx === casterIdx || seat.out) return;
      for (const creature of seat.board) targets.push({ seat, creature });
    });
    if (!targets.length) return null;
    return targets[randomInt(targets.length)];
  }

  private bounceToHand(seat: Seat, creature: Creature): void {
    const label = this.context.creatureLabel(seat, creature);
    seat.board = seat.board.filter((card) => card.iid !== creature.iid);
    if (seat.hand.length < MAX_HAND) {
      seat.hand.push({ iid: creature.iid, defId: creature.defId });
      this.context.addLog(`${label} foi devolvida à mão de ${seat.player.name}`);
    } else {
      this.context.addLog(`${label} não coube na mão cheia de ${seat.player.name} e foi destruída`);
    }
  }

  private triggerDeathrattle(seat: Seat, creature: Creature): void {
    switch (creature.defId) {
      case 'c_cavaleiro':
        if (this.summonToken(seat, 'c_recruta')) {
          this.context.addLog(
            `Estertor: um ${CARDS.c_recruta.name} toma o lugar de ${CARDS.c_cavaleiro.name}`,
          );
        }
        break;
      case 'c_fada':
        this.context.draw(seat);
        this.context.addLog(`Estertor: ${seat.player.name} comprou 1 carta`);
        break;
      case 'c_cultista': {
        const ownerIdx = this.context.seats.indexOf(seat);
        this.context.seats.forEach((enemy, enemyIdx) => {
          if (enemyIdx === ownerIdx || enemy.out) return;
          this.context.damagePlayer(enemy, 2);
          seat.stats.damageDealt += 2;
          this.context.addLog(`Estertor: ${CARDS.c_cultista.name} causou 2 de dano em ${enemy.player.name}`);
        });
        break;
      }
      case 'c_aguaviva': {
        const ownerIdx = this.context.seats.indexOf(seat);
        const hit = this.damageAllEnemyCreatures(ownerIdx, 1);
        if (hit > 0) this.context.addLog(`Estertor: o clarão da água-viva atingiu ${hit} criatura(s)`);
        break;
      }
      case 'c_kraken': {
        let summoned = 0;
        if (this.summonToken(seat, 'c_tentaculo')) summoned++;
        if (this.summonToken(seat, 'c_tentaculo')) summoned++;
        if (summoned > 0) {
          this.context.addLog(`Estertor: ${summoned} Tentáculo(s) do Kraken emergem em seu lugar`);
        }
        break;
      }
    }
  }
}
