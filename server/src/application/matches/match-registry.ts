import { Match, type MatchSnapshot } from '../../game/engine.js';

export type MatchMode = 'ranked' | 'practice';

/**
 * Índice das partidas ativas por jogador. Centraliza deduplicação e ciclo de
 * vida sem assumir como uma partida é criada, restaurada ou finalizada.
 */
export class MatchRegistry {
  private readonly byPlayer = new Map<string, Match>();
  private readonly practiceIds = new Set<string>();

  get(playerId: string): Match | undefined {
    return this.byPlayer.get(playerId);
  }

  has(playerId: string): boolean {
    return this.byPlayer.has(playerId);
  }

  register(
    match: Match,
    playerIds: Iterable<string>,
    mode: MatchMode = 'ranked',
  ): void {
    for (const playerId of playerIds) this.byPlayer.set(playerId, match);
    if (mode === 'practice') this.practiceIds.add(match.id);
  }

  unregister(match: Match): void {
    for (const [playerId, registered] of this.byPlayer) {
      if (registered === match) this.byPlayer.delete(playerId);
    }
    this.practiceIds.delete(match.id);
  }

  /** Partidas ranqueadas ativas, deduplicadas e prontas para persistência. */
  exportSnapshots(): MatchSnapshot[] {
    const snapshots: MatchSnapshot[] = [];
    for (const match of this.uniqueMatches()) {
      if (match.finished || this.practiceIds.has(match.id)) continue;
      snapshots.push(match.toSnapshot());
    }
    return snapshots;
  }

  /** Libera os timers de cada partida uma única vez no encerramento do App. */
  dispose(): void {
    for (const match of this.uniqueMatches()) match.dispose();
  }

  private uniqueMatches(): Match[] {
    return [...new Set(this.byPlayer.values())];
  }
}
