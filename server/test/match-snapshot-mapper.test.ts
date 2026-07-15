import { describe, expect, it, vi } from 'vitest';
import type { MatchPlayer, MatchSnapshot, Seat, SeatSnapshot } from '../src/game/types.js';
import {
  createMatchSnapshot,
  hydrateMatchState,
  hydrateSeat,
} from '../src/game/snapshot/match-snapshot-mapper.js';

const player: MatchPlayer = {
  id: 'p0',
  name: 'Jogador',
  avatar: 'shield',
  commander: 'shield',
  accent: '#e3b341',
  photo: null,
  frame: 'none',
  accentStyle: 'solid',
  mmr: 1000,
};

function seatSnapshot(): SeatSnapshot {
  return {
    player,
    hp: 21,
    shield: 2,
    energy: 3,
    maxEnergy: 4,
    deck: [{ iid: 'deck-1', defId: 'c_lobo' }],
    hand: [{ iid: 'hand-1', defId: 's_faisca' }],
    board: [{
      iid: 'board-1', defId: 'c_lobo', attack: 3, health: 2,
      baseHealth: 2, canAttack: true, attacked: false,
    }],
    artifacts: ['a_estandarte'],
    attackBonus: 1,
    spellBonus: 2,
    regen: 1,
    shieldRegen: 1,
    fatigue: 2,
    out: false,
    mulliganDone: true,
    reconnectDeadline: 123,
    stats: { creaturesSummoned: 1, spellsCast: 2, damageDealt: 3, shieldAbsorbed: 4 },
    creatureLog: [['board-1', { defId: 'c_lobo', dmg: 3, kills: 1 }]],
  };
}

function liveSeat(): Seat {
  return hydrateSeat({
    player,
    snapshot: seatSnapshot(),
    restoringMatch: true,
    buildDeck: () => [],
  });
}

function baseSnapshot(): MatchSnapshot {
  return {
    id: 'm1',
    startedAt: 1,
    status: 'active',
    turnSeat: 1,
    turnNumber: 3,
    turnSeconds: 60,
    useMulligan: false,
    botIds: [],
    content: {},
    seats: [seatSnapshot()],
    log: [{ at: 1, text: 'inicio' }],
    plays: [{ seat: 0, cardId: 'c_lobo', at: 2 }],
  };
}

describe('match snapshot mapper', () => {
  it('hidrata snapshots legados sem historico estruturado', () => {
    const state = hydrateMatchState(baseSnapshot());
    expect(state).toMatchObject({
      status: 'active',
      turnSeat: 1,
      turnNumber: 3,
      actions: [],
      actionSeq: 0,
    });
  });

  it('recupera actionSeq pelo historico quando o campo legado esta ausente', () => {
    const snapshot = baseSnapshot();
    snapshot.actions = [
      { seq: 2, seat: 0, kind: 'card', sourceDefId: 'c_lobo', at: 2 },
      { seq: 7, seat: 1, kind: 'attack', sourceDefId: 'c_lobo', at: 3 },
    ];
    expect(hydrateMatchState(snapshot).actionSeq).toBe(7);
  });

  it('hidrata o assento por copia e mantem restaurados desconectados', () => {
    const snapshot = seatSnapshot();
    const buildDeck = vi.fn(() => [{ iid: 'novo', defId: 'c_lobo' }]);
    const seat = hydrateSeat({ player, snapshot, restoringMatch: true, buildDeck });

    expect(seat).toMatchObject({ hp: 21, connected: false, fatigue: 2 });
    expect(buildDeck).not.toHaveBeenCalled();
    expect(seat.hand).not.toBe(snapshot.hand);
    expect(seat.board).not.toBe(snapshot.board);
    expect(seat.stats).not.toBe(snapshot.stats);
  });

  it('serializa copias, deadlines e limites de historico', () => {
    const seat = liveSeat();
    const log = Array.from({ length: 105 }, (_, at) => ({ at, text: `log ${at}` }));
    const plays = Array.from({ length: 15 }, (_, at) => ({ seat: 0, cardId: 'c_lobo', at }));
    const actions = Array.from({ length: 30 }, (_, seq) => ({
      seq,
      seat: 0,
      kind: 'card' as const,
      sourceDefId: 'c_lobo',
      at: seq,
    }));
    const factions = { p0: 'aurora' };

    const snapshot = createMatchSnapshot({
      id: 'm1',
      startedAt: 1,
      status: 'active',
      turnSeat: 0,
      turnNumber: 2,
      turnSeconds: 60,
      turnTimeLeftMs: 42_000,
      tutorialOpenPlayerIds: ['p0'],
      useMulligan: false,
      botIds: [],
      content: { factions, comeback: true },
      seats: [seat],
      reconnectDeadlineFor: () => 999,
      log,
      plays,
      actions,
      actionSeq: 30,
    });

    expect(snapshot.log).toHaveLength(100);
    expect(snapshot.plays).toHaveLength(12);
    expect(snapshot.actions).toHaveLength(24);
    expect(snapshot.seats[0].reconnectDeadline).toBe(999);
    expect(snapshot.seats[0].hand).not.toBe(seat.hand);
    expect(snapshot.content.factions).toEqual(factions);
    expect(snapshot.content.factions).not.toBe(factions);
  });
});
