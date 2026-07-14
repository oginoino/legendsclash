import { describe, expect, it, vi } from 'vitest';
import { MatchRegistry } from '../src/application/matches/match-registry.js';
import { Match, type MatchPlayer } from '../src/game/engine.js';

function player(id: string): MatchPlayer {
  return {
    id,
    name: id,
    avatar: 'shield',
    commander: 'shield',
    accent: '#e3b341',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    mmr: 1000,
  };
}

function match(...playerIds: string[]): Match {
  return new Match(playerIds.map(player), () => {}, () => {});
}

describe('MatchRegistry', () => {
  it('indexa a mesma partida por todos os jogadores e remove o vínculo completo', () => {
    const registry = new MatchRegistry();
    const active = match('p1', 'p2');

    registry.register(active, active.playerIds());

    expect(registry.get('p1')).toBe(active);
    expect(registry.get('p2')).toBe(active);
    registry.unregister(active);
    expect(registry.has('p1')).toBe(false);
    expect(registry.has('p2')).toBe(false);
  });

  it('exporta cada ranqueada ativa uma vez e exclui treino e partidas encerradas', () => {
    const registry = new MatchRegistry();
    const ranked = match('p1', 'p2');
    const practice = match('p3', 'bot:1');
    const finished = match('p4', 'p5');
    finished.start();
    finished.surrender('p4');

    registry.register(ranked, ranked.playerIds());
    registry.register(practice, ['p3'], 'practice');
    registry.register(finished, finished.playerIds());

    expect(registry.exportSnapshots().map((snapshot) => snapshot.id)).toEqual([ranked.id]);
  });

  it('descarta cada partida registrada apenas uma vez', () => {
    const registry = new MatchRegistry();
    const ranked = match('p1', 'p2');
    const practice = match('p3', 'bot:1');
    const rankedDispose = vi.spyOn(ranked, 'dispose');
    const practiceDispose = vi.spyOn(practice, 'dispose');

    registry.register(ranked, ranked.playerIds());
    registry.register(practice, ['p3'], 'practice');
    registry.dispose();

    expect(rankedDispose).toHaveBeenCalledOnce();
    expect(practiceDispose).toHaveBeenCalledOnce();
  });
});
