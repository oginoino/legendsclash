import { CARDS, MAX_BOARD } from '@legendsclash/shared';
import type { Target } from '@legendsclash/shared';
import type { Seat } from '../types.js';
import { targetForBotAttack, targetForBotCard } from './bot-policy.js';

/** Pausas entre decisoes para que cada acao da IA seja legivel pelo jogador. */
export const BOT_CADENCE_MS = {
  think: 900,
  card: 1250,
  combat: 1100,
  attack: 900,
  end: 650,
} as const;

type BotTurnPhase = 'cards' | 'combat' | 'end';

interface BotTurnState {
  playerId: string;
  phase: BotTurnPhase;
  cardActions: number;
  attackActions: number;
}

export interface BotTurnContext {
  seats: Seat[];
  seatOf(playerId: string): number;
  isTurnActive(playerId: string): boolean;
  playCard(playerId: string, iid: string, target?: Target): void;
  attack(playerId: string, attackerIid: string, target: Target): void;
  endTurn(playerId: string): void;
}

/** Controla politica e ritmo da IA sem acessar estado privado de Match. */
export class BotTurnController {
  private timer: NodeJS.Timeout | null = null;
  private state: BotTurnState | null = null;

  constructor(private readonly context: BotTurnContext) {}

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = null;
  }

  scheduleTurn(playerId: string): void {
    this.clear();
    this.state = { playerId, phase: 'cards', cardActions: 0, attackActions: 0 };
    this.scheduleStep(BOT_CADENCE_MS.think);
  }

  /** Executa imediatamente para simulacoes e testes do motor. */
  runImmediate(playerId: string): void {
    this.clear();
    const seatIdx = this.context.seatOf(playerId);
    if (seatIdx < 0 || !this.context.isTurnActive(playerId)) return;

    for (let guard = 0; guard < 20 && this.context.isTurnActive(playerId); guard++) {
      if (!this.playOneCard(playerId)) break;
    }
    for (let guard = 0; guard < MAX_BOARD && this.context.isTurnActive(playerId); guard++) {
      if (!this.attackOnce(playerId)) break;
    }
    if (this.context.isTurnActive(playerId)) {
      try { this.context.endTurn(playerId); } catch { /* a IA nunca derruba a partida */ }
    }
  }

  private scheduleStep(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const playerId = this.state?.playerId;
      try {
        this.runPacedStep();
      } catch {
        this.clear();
        if (playerId && this.context.isTurnActive(playerId)) {
          try { this.context.endTurn(playerId); } catch { /* o cronometro ainda garante progresso */ }
        }
      }
    }, delayMs);
  }

  private runPacedStep(): void {
    const state = this.state;
    if (!state || !this.context.isTurnActive(state.playerId)) {
      this.clear();
      return;
    }

    if (state.phase === 'cards') {
      if (state.cardActions < 20 && this.playOneCard(state.playerId)) {
        state.cardActions++;
        if (this.state === state && this.context.isTurnActive(state.playerId)) {
          this.scheduleStep(BOT_CADENCE_MS.card);
        } else {
          this.clear();
        }
        return;
      }
      state.phase = 'combat';
      this.scheduleStep(BOT_CADENCE_MS.combat);
      return;
    }

    if (state.phase === 'combat') {
      if (state.attackActions < MAX_BOARD && this.attackOnce(state.playerId)) {
        state.attackActions++;
        if (this.state === state && this.context.isTurnActive(state.playerId)) {
          this.scheduleStep(BOT_CADENCE_MS.attack);
        } else {
          this.clear();
        }
        return;
      }
      state.phase = 'end';
      this.scheduleStep(BOT_CADENCE_MS.end);
      return;
    }

    const playerId = state.playerId;
    this.state = null;
    if (this.context.isTurnActive(playerId)) {
      try { this.context.endTurn(playerId); } catch { /* a IA nunca derruba a partida */ }
    }
  }

  private playOneCard(playerId: string): boolean {
    const seatIdx = this.context.seatOf(playerId);
    if (seatIdx < 0 || !this.context.isTurnActive(playerId)) return false;
    const seat = this.context.seats[seatIdx];
    for (const card of [...seat.hand]) {
      const def = CARDS[card.defId];
      if (def.cost > seat.energy) continue;
      const wants = def.target ?? 'none';
      const target = wants === 'none' ? undefined : targetForBotCard(this.context.seats, seatIdx, def);
      if (wants !== 'none' && !target) continue;
      try {
        this.context.playCard(playerId, card.iid, target);
        return true;
      } catch { /* carta invalida agora; tenta a proxima */ }
    }
    return false;
  }

  private attackOnce(playerId: string): boolean {
    const seatIdx = this.context.seatOf(playerId);
    if (seatIdx < 0 || !this.context.isTurnActive(playerId)) return false;
    const seat = this.context.seats[seatIdx];
    for (const creature of seat.board) {
      if (!creature.canAttack || creature.attacked) continue;
      const target = targetForBotAttack(this.context.seats, seatIdx);
      if (!target) return false;
      try {
        this.context.attack(playerId, creature.iid, target);
        return true;
      } catch { /* alvo sumiu; tenta a proxima criatura */ }
    }
    return false;
  }
}
