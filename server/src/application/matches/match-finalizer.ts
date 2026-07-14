import {
  achievementsOf,
  type League,
  type MatchHistoryEntry,
  type MatchResult,
  type ServerMsg,
} from '@legendsclash/shared';
import { applyElo, leagueOf } from '../../elo.js';
import { Match, type EngineResult } from '../../game/engine.js';
import type { Store, UserRecord } from '../../store.js';

export type MatchFinalizerStore = Pick<
  Store,
  'profileOf' | 'recordEvent' | 'recordMatch' | 'userById'
>;

export interface MatchFinalizerDependencies {
  store: MatchFinalizerStore;
  broadcastMatch(match: Match): void;
  unregisterMatch(match: Match): void;
  recordOpponents(playerIds: string[]): void;
  sendTo(playerId: string, message: ServerMsg): void;
  onMatchesChanged(): void;
  now?: () => number;
}

/** Consolida resultado, progressão e notificações ao encerrar uma partida. */
export class MatchFinalizer {
  private readonly now: () => number;

  constructor(private readonly dependencies: MatchFinalizerDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  /** Entrega o recap de treino sem tocar Elo, histórico, streak ou eventos. */
  finishPractice(match: Match, result: EngineResult): void {
    const ids = match.playerIds();
    const winnerId = ids[result.winnerSeat];
    const humanId = ids.find((id) => this.dependencies.store.userById(id));
    const { stats, mvp } = this.recap(ids, result);

    this.dependencies.broadcastMatch(match);
    this.dependencies.unregisterMatch(match);
    if (humanId) {
      this.dependencies.sendTo(humanId, {
        t: 'game:over',
        result: {
          matchId: match.id,
          winnerId,
          reason: result.reason,
          turns: result.turns,
          durationMs: result.durationMs,
          mmr: {},
          stats,
          mvp,
        },
      });
    }
    match.dispose();
    this.dependencies.onMatchesChanged();
  }

  finishRanked(match: Match, result: EngineResult): void {
    const ids = match.playerIds();
    const winnerId = ids[result.winnerSeat];
    const winner = this.dependencies.store.userById(winnerId)!;
    const loserIds = ids.filter((id) => id !== winnerId);
    const winnerBefore = winner.mmr;

    const firstMatchPlayers = ids.filter((id) => {
      const user = this.dependencies.store.userById(id);
      return !!user && user.wins + user.losses === 0;
    });
    const achievementsBefore: Record<string, string[]> = {};
    for (const id of ids) {
      const user = this.dependencies.store.userById(id);
      achievementsBefore[id] = user ? achievementsOf(user.wins, user.wins + user.losses) : [];
    }

    const entryFor = (
      won: boolean,
      opponent: UserRecord,
      delta: number,
    ): MatchHistoryEntry => ({
      matchId: match.id,
      opponentName: opponent.name || 'Jogador',
      opponentId: opponent.id,
      won,
      reason: result.reason,
      mmrDelta: delta,
      turns: result.turns,
      durationMs: result.durationMs,
      endedAt: this.now(),
    });

    // Cada perdedor é pareado contra o rating original do vencedor. Assim, o
    // comportamento 1v1 permanece clássico e partidas N-player não omitem Elo.
    const mmr: Record<
      string,
      { before: number; after: number; delta: number; league: League }
    > = {};
    let winnerGain = 0;
    let toughestLoser = this.dependencies.store.userById(loserIds[0])!;
    for (const loserId of loserIds) {
      const loser = this.dependencies.store.userById(loserId);
      if (!loser) continue;
      const loserBefore = loser.mmr;
      const after = applyElo(winnerBefore, loserBefore);
      const loserDelta = after.loser - loserBefore;
      winnerGain += after.winner - winnerBefore;
      if (loserBefore >= toughestLoser.mmr) toughestLoser = loser;
      this.dependencies.store.recordMatch(
        loserId,
        entryFor(false, winner, loserDelta),
        after.loser,
        false,
      );
      mmr[loserId] = {
        before: loserBefore,
        after: after.loser,
        delta: loserDelta,
        league: leagueOf(after.loser),
      };
    }

    const winnerAfter = winnerBefore + winnerGain;
    this.dependencies.store.recordMatch(
      winnerId,
      entryFor(true, toughestLoser, winnerGain),
      winnerAfter,
      true,
    );
    mmr[winnerId] = {
      before: winnerBefore,
      after: winnerAfter,
      delta: winnerGain,
      league: leagueOf(winnerAfter),
    };

    this.dependencies.store.recordEvent('match_end', {
      matchId: match.id,
      props: {
        winnerId,
        winnerSeat: result.winnerSeat,
        reason: result.reason,
        turns: result.turns,
        durationMs: result.durationMs,
        deltas: Object.fromEntries(Object.entries(mmr).map(([id, value]) => [id, value.delta])),
      },
    });
    for (const id of firstMatchPlayers) {
      this.dependencies.store.recordEvent('first_match_completed', {
        userId: id,
        matchId: match.id,
        props: { won: id === winnerId },
      });
    }

    const unlocked: Record<string, string[]> = {};
    for (const id of ids) {
      const user = this.dependencies.store.userById(id);
      if (!user) continue;
      const fresh = achievementsOf(user.wins, user.wins + user.losses)
        .filter((achievement) => !achievementsBefore[id].includes(achievement));
      if (fresh.length) unlocked[id] = fresh;
    }

    const { stats, mvp } = this.recap(ids, result);
    this.dependencies.recordOpponents(ids);
    this.dependencies.broadcastMatch(match);
    this.dependencies.unregisterMatch(match);
    for (const playerId of ids) {
      this.dependencies.sendTo(playerId, {
        t: 'game:over',
        result: {
          matchId: match.id,
          winnerId,
          reason: result.reason,
          turns: result.turns,
          durationMs: result.durationMs,
          mmr,
          unlocked,
          stats,
          mvp,
        },
      });
      const user = this.dependencies.store.userById(playerId);
      if (user) {
        this.dependencies.sendTo(playerId, {
          t: 'profile',
          profile: this.dependencies.store.profileOf(user),
        });
      }
    }
    match.dispose();
    this.dependencies.onMatchesChanged();
  }

  private recap(
    ids: string[],
    result: EngineResult,
  ): Pick<Required<MatchResult>, 'mvp' | 'stats'> {
    const stats: NonNullable<MatchResult['stats']> = {};
    const mvp: NonNullable<MatchResult['mvp']> = {};
    ids.forEach((id, seat) => {
      if (result.stats[seat]) stats[id] = result.stats[seat];
      mvp[id] = result.mvp[seat] ?? null;
    });
    return { stats, mvp };
  }
}
