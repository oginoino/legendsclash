import { STARTING_HP } from '@legendsclash/shared';
import type {
  CardInstance,
  MatchContent,
  MatchPlayer,
  MatchSnapshot,
  Seat,
  SeatSnapshot,
} from '../types.js';

const LOG_LIMIT = 100;
const PLAY_LIMIT = 12;
const ACTION_LIMIT = 24;

export interface RestoredMatchState {
  status: MatchSnapshot['status'];
  turnSeat: number;
  turnNumber: number;
  log: MatchSnapshot['log'];
  plays: MatchSnapshot['plays'];
  actions: NonNullable<MatchSnapshot['actions']>;
  actionSeq: number;
}

export function hydrateMatchState(snapshot: MatchSnapshot): RestoredMatchState {
  const actions = [...(snapshot.actions ?? [])];
  return {
    status: snapshot.status,
    turnSeat: snapshot.turnSeat,
    turnNumber: snapshot.turnNumber,
    log: [...snapshot.log],
    plays: [...snapshot.plays],
    actions,
    actionSeq: snapshot.actionSeq
      ?? Math.max(0, ...actions.map((action) => action.seq)),
  };
}

export interface HydrateSeatOptions {
  player: MatchPlayer;
  snapshot?: SeatSnapshot;
  restoringMatch: boolean;
  buildDeck: () => CardInstance[];
}

export function hydrateSeat({
  player,
  snapshot,
  restoringMatch,
  buildDeck,
}: HydrateSeatOptions): Seat {
  return {
    player,
    hp: snapshot?.hp ?? STARTING_HP,
    shield: snapshot?.shield ?? 0,
    energy: snapshot?.energy ?? 0,
    maxEnergy: snapshot?.maxEnergy ?? 0,
    deck: snapshot ? snapshot.deck.map((card) => ({ ...card })) : buildDeck(),
    hand: snapshot ? snapshot.hand.map((card) => ({ ...card })) : [],
    board: snapshot ? snapshot.board.map((card) => ({ ...card })) : [],
    artifacts: snapshot ? [...snapshot.artifacts] : [],
    attackBonus: snapshot?.attackBonus ?? 0,
    spellBonus: snapshot?.spellBonus ?? 0,
    regen: snapshot?.regen ?? 0,
    shieldRegen: snapshot?.shieldRegen ?? 0,
    fatigue: snapshot?.fatigue ?? 0,
    connected: !restoringMatch,
    out: snapshot?.out ?? false,
    mulliganDone: snapshot?.mulliganDone ?? false,
    stats: snapshot?.stats
      ? { ...snapshot.stats }
      : { creaturesSummoned: 0, spellsCast: 0, damageDealt: 0, shieldAbsorbed: 0 },
    creatureLog: new Map(snapshot?.creatureLog ?? []),
  };
}

export interface MatchSnapshotSource {
  id: string;
  startedAt: number;
  status: MatchSnapshot['status'];
  turnSeat: number;
  turnNumber: number;
  turnSeconds: number;
  turnTimeLeftMs: number;
  tutorialOpenPlayerIds: string[];
  useMulligan: boolean;
  botIds: string[];
  content: MatchContent;
  seats: Seat[];
  reconnectDeadlineFor: (seat: Seat) => number | null;
  log: MatchSnapshot['log'];
  plays: MatchSnapshot['plays'];
  actions: NonNullable<MatchSnapshot['actions']>;
  actionSeq: number;
}

export function createMatchSnapshot(source: MatchSnapshotSource): MatchSnapshot {
  return {
    id: source.id,
    startedAt: source.startedAt,
    status: source.status,
    turnSeat: source.turnSeat,
    turnNumber: source.turnNumber,
    turnSeconds: source.turnSeconds,
    turnTimeLeftMs: source.turnTimeLeftMs,
    tutorialOpenPlayerIds: [...source.tutorialOpenPlayerIds],
    useMulligan: source.useMulligan,
    botIds: [...source.botIds],
    content: {
      factions: source.content.factions ? { ...source.content.factions } : undefined,
      comeback: source.content.comeback,
    },
    seats: source.seats.map((seat) => serializeSeat(
      seat,
      source.reconnectDeadlineFor(seat),
    )),
    log: source.log.slice(-LOG_LIMIT),
    plays: source.plays.slice(-PLAY_LIMIT),
    actions: source.actions.slice(-ACTION_LIMIT),
    actionSeq: source.actionSeq,
  };
}

function serializeSeat(seat: Seat, reconnectDeadline: number | null): SeatSnapshot {
  return {
    player: { ...seat.player },
    hp: seat.hp,
    shield: seat.shield,
    energy: seat.energy,
    maxEnergy: seat.maxEnergy,
    deck: seat.deck.map((card) => ({ ...card })),
    hand: seat.hand.map((card) => ({ ...card })),
    board: seat.board.map((card) => ({ ...card })),
    artifacts: [...seat.artifacts],
    attackBonus: seat.attackBonus,
    spellBonus: seat.spellBonus,
    regen: seat.regen,
    shieldRegen: seat.shieldRegen,
    fatigue: seat.fatigue,
    out: seat.out,
    mulliganDone: seat.mulliganDone,
    reconnectDeadline,
    stats: { ...seat.stats },
    creatureLog: [...seat.creatureLog.entries()],
  };
}
