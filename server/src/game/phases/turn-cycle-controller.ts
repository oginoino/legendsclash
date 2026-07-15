import { CARDS, MAX_ENERGY, STARTING_HP } from '@legendsclash/shared';
import type { Seat } from '../types.js';
import type { TurnClock } from '../timing/turn-clock.js';

/** Backstop para partidas travadas por tabuleiros simetricos. */
export const MAX_TURNS = 40;
/** Limite do escudo recorrente para impedir defesa infinita. */
export const MAX_ARTIFACT_SHIELD = 10;

export interface TurnCycleContext {
  seats: Seat[];
  botIds: readonly string[];
  clock: TurnClock;
  turnSeconds: number;
  isActive(): boolean;
  currentTurnSeat(): number;
  setTurnSeat(seatIndex: number): void;
  nextTurnNumber(): number;
  draw(seat: Seat): void;
  addLog(text: string): void;
  resolveByTiebreak(): void;
  checkEnd(): void;
  clearBot(): void;
  scheduleBot(playerId: string): void;
  onUpdate(): void;
}

/** Coordena as fases de inicio, timeout e avanco circular de cada turno. */
export class TurnCycleController {
  constructor(private readonly context: TurnCycleContext) {}

  begin(seatIndex: number): void {
    this.context.setTurnSeat(seatIndex);
    const turnNumber = this.context.nextTurnNumber();
    if (turnNumber > MAX_TURNS) {
      this.context.resolveByTiebreak();
      if (!this.context.isActive()) return;
    }

    const seat = this.context.seats[seatIndex];
    seat.maxEnergy = Math.min(MAX_ENERGY, seat.maxEnergy + 1);
    seat.energy = seat.maxEnergy;
    this.applyRecurringArtifacts(seat);

    this.context.draw(seat);
    if (!this.context.isActive()) return;

    for (const creature of seat.board) {
      creature.canAttack = true;
      creature.attacked = false;
    }

    this.context.addLog(`Turno ${turnNumber}: vez de ${seat.player.name}`);
    this.armTimer();
    this.context.checkEnd();
    if (this.context.isActive() && this.context.botIds.includes(seat.player.id)) {
      this.context.scheduleBot(seat.player.id);
    }
  }

  advance(): void {
    if (!this.context.isActive()) return;
    this.context.clearBot();
    const current = this.context.currentTurnSeat();
    let next = current;
    do {
      next = (next + 1) % this.context.seats.length;
    } while (this.context.seats[next].out && next !== current);
    this.begin(next);
  }

  restoreTimer(ms: number): void {
    this.armTimer(ms);
    const current = this.context.seats[this.context.currentTurnSeat()];
    if (this.context.isActive() && current && this.context.botIds.includes(current.player.id)) {
      this.context.scheduleBot(current.player.id);
    }
  }

  private applyRecurringArtifacts(seat: Seat): void {
    if (seat.regen > 0 && seat.hp > 0 && seat.hp < STARTING_HP) {
      const healed = Math.min(STARTING_HP - seat.hp, seat.regen);
      seat.hp += healed;
      this.context.addLog(
        `${CARDS['a_relicario'].name} restaurou ${healed} de vida a ${seat.player.name}`,
      );
    }
    if (seat.shieldRegen > 0 && seat.shield < MAX_ARTIFACT_SHIELD) {
      const gained = Math.min(MAX_ARTIFACT_SHIELD - seat.shield, seat.shieldRegen);
      seat.shield += gained;
      this.context.addLog(
        `${CARDS['a_figura'].name} concedeu ${gained} de escudo a ${seat.player.name}`,
      );
    }
  }

  private armTimer(ms = this.context.turnSeconds * 1000): void {
    this.context.clock.arm(ms, () => {
      if (!this.context.isActive()) return;
      const seat = this.context.seats[this.context.currentTurnSeat()];
      this.context.addLog(`${seat.player.name} ficou sem tempo — turno encerrado`);
      this.advance();
      this.context.onUpdate();
    });
  }
}
