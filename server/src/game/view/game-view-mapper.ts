import type { GameView, SeatView } from '@legendsclash/shared';
import type { Seat } from '../types.js';
import type { TurnClockView } from '../timing/turn-clock.js';

const LOG_LIMIT = 30;
const PLAY_LIMIT = 12;
const ACTION_LIMIT = 24;

export interface GameViewSource {
  matchId: string;
  playerId: string;
  turnSeat: number;
  turnNumber: number;
  clock: TurnClockView;
  seats: Seat[];
  status: GameView['status'];
  log: GameView['log'];
  plays: GameView['plays'];
  actions: GameView['actions'];
}

/** Projeta somente o estado que um cliente pode conhecer. */
export function createGameView(source: GameViewSource): GameView {
  const yourSeat = source.seats.findIndex((seat) => seat.player.id === source.playerId);
  return {
    matchId: source.matchId,
    yourSeat,
    turnSeat: source.turnSeat,
    turnNumber: source.turnNumber,
    turnEndsAt: source.clock.endsAt,
    turnPaused: source.clock.paused,
    turnTimeLeftMs: source.clock.timeLeftMs,
    seats: source.seats.map(toSeatView),
    hand: yourSeat >= 0
      ? source.seats[yourSeat].hand.map((card) => ({ iid: card.iid, defId: card.defId }))
      : [],
    status: source.status,
    log: source.log.slice(-LOG_LIMIT),
    plays: source.plays.slice(-PLAY_LIMIT),
    actions: source.actions.slice(-ACTION_LIMIT),
  };
}

function toSeatView(seat: Seat): SeatView {
  return {
    playerId: seat.player.id,
    name: seat.player.name,
    avatar: seat.player.avatar,
    commander: seat.player.commander,
    accent: seat.player.accent,
    photo: seat.player.photo,
    frame: seat.player.frame,
    accentStyle: seat.player.accentStyle,
    mmr: seat.player.mmr,
    hp: Math.max(0, seat.hp),
    shield: seat.shield,
    energy: seat.energy,
    maxEnergy: seat.maxEnergy,
    deckCount: seat.deck.length,
    handCount: seat.hand.length,
    board: seat.board.map((creature) => ({
      iid: creature.iid,
      defId: creature.defId,
      attack: creature.attack,
      health: creature.health,
      baseHealth: creature.baseHealth,
      canAttack: creature.canAttack && !creature.attacked,
      ward: creature.ward || undefined,
    })),
    artifacts: [...seat.artifacts],
    attackBonus: seat.attackBonus,
    fatigue: seat.fatigue,
    connected: seat.connected,
    out: seat.out,
    mulliganDone: seat.mulliganDone,
  };
}
