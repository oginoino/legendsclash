import { CARDS } from '@legendsclash/shared';
import type { MatchEndReason, MatchMvp } from '@legendsclash/shared';
import type { EngineResult, Seat } from '../types.js';

type MatchStatus = 'mulligan' | 'active' | 'finished';

export interface MatchOutcomeContext {
  seats: Seat[];
  maxTurns: number;
  startedAt: number;
  status(): MatchStatus;
  setStatus(status: 'finished'): void;
  turnNumber(): number;
  setResult(result: EngineResult): void;
  clearClock(): void;
  clearBot(): void;
  clearReconnect(): void;
  addLog(text: string): void;
  onFinish(result: EngineResult): void;
}

/** Resolve eliminacoes, morte subita e o resultado terminal da partida. */
export class MatchOutcomeController {
  constructor(private readonly context: MatchOutcomeContext) {}

  check(reasonHint?: MatchEndReason): void {
    if (this.context.status() === 'finished') return;
    if (this.context.status() === 'active') this.refreshComeback();

    for (const seat of this.context.seats) {
      if (!seat.out && seat.hp <= 0) {
        seat.out = true;
        this.context.addLog(`${seat.player.name} ficou sem vida`);
      }
    }

    const alive = this.aliveSeats();
    if (alive.length > 1) return;

    this.context.setStatus('finished');
    this.context.clearClock();
    this.context.clearBot();
    this.context.clearReconnect();

    const winnerSeat = alive.length === 1 ? alive[0].index : 0;
    const result: EngineResult = {
      winnerSeat,
      reason: reasonHint ?? 'hp',
      turns: this.context.turnNumber(),
      durationMs: Date.now() - this.context.startedAt,
      stats: this.context.seats.map((seat) => ({ ...seat.stats })),
      mvp: this.context.seats.map((seat) => this.mvpOf(seat)),
    };
    this.context.setResult(result);
    this.context.addLog(`Vitória de ${this.context.seats[winnerSeat].player.name}!`);
    this.context.onFinish(result);
  }

  /**
   * No teto de turnos, prioriza vida, ataque em campo e por fim o assento mais
   * antigo. O motivo publico continua sendo `hp` para preservar o protocolo.
   */
  resolveByTiebreak(): void {
    const alive = this.aliveSeats();
    if (alive.length <= 1) return;

    const score = (seat: Seat) => (
      seat.hp * 1000 + seat.board.reduce((sum, creature) => sum + creature.attack, 0)
    );
    alive.sort((left, right) => (
      score(right.seat) - score(left.seat) || left.index - right.index
    ));
    for (let index = 1; index < alive.length; index++) alive[index].seat.out = true;
    this.context.addLog(
      `Limite de ${this.context.maxTurns} turnos atingido — vitória por vantagem (morte súbita)`,
    );
    this.check();
  }

  /** Resistência alterna o bonus sem acumular e concede Investida ao ativar. */
  private refreshComeback(): void {
    for (const seat of this.context.seats) {
      const active = seat.hp <= 10 && !seat.out;
      for (const creature of seat.board) {
        if (!CARDS[creature.defId].keywords?.includes('comeback')) continue;
        if (active && !creature.comebackOn) {
          creature.attack += 2;
          creature.comebackOn = true;
          if (!creature.attacked) creature.canAttack = true;
        } else if (!active && creature.comebackOn) {
          creature.attack -= 2;
          creature.comebackOn = false;
        }
      }
    }
  }

  private aliveSeats(): Array<{ seat: Seat; index: number }> {
    return this.context.seats
      .map((seat, index) => ({ seat, index }))
      .filter(({ seat }) => !seat.out);
  }

  private mvpOf(seat: Seat): MatchMvp | null {
    let best: MatchMvp | null = null;
    for (const entry of seat.creatureLog.values()) {
      if (
        !best
        || entry.dmg > best.damage
        || (entry.dmg === best.damage && entry.kills > best.kills)
      ) {
        best = { defId: entry.defId, damage: entry.dmg, kills: entry.kills };
      }
    }
    return best;
  }
}
