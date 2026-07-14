import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchFactory } from '../src/application/matches/match-factory.js';
import type { Match } from '../src/game/engine.js';
import type { UserRecord } from '../src/store.js';

const activeMatches: Match[] = [];

afterEach(() => {
  for (const match of activeMatches.splice(0)) match.dispose();
});

function user(id: string, patch: Partial<UserRecord> = {}): UserRecord {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatar: 'shield',
    commander: 'shield',
    accent: '#e3b341',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    profileCover: 'citadel',
    faction: '',
    authUserId: id,
    guest: false,
    mmr: 1000,
    wins: 0,
    losses: 0,
    muted: [],
    friends: [],
    history: [],
    createdAt: 1,
    streak: 0,
    lastPlayDay: 0,
    ...patch,
  };
}

function setup(
  flags = { factions: false, comeback: false },
  randomIndex: (maxExclusive: number) => number = (maxExclusive) => maxExclusive - 1,
) {
  const onUpdate = vi.fn();
  const onRankedFinish = vi.fn();
  const onPracticeFinish = vi.fn();
  const factory = new MatchFactory({
    flags,
    randomIndex,
    onUpdate,
    onRankedFinish,
    onPracticeFinish,
  });
  return { factory, onUpdate, onRankedFinish, onPracticeFinish };
}

function track(match: Match): Match {
  activeMatches.push(match);
  return match;
}

describe('MatchFactory', () => {
  it('mapeia identidade, sorteia assentos e monta o conteúdo ranqueado', () => {
    const randomIndex = vi.fn(() => 0);
    const { factory } = setup({ factions: true, comeback: true }, randomIndex);
    const first = user('p1', {
      name: '',
      avatar: 'wolf',
      commander: 'mage',
      accent: '#123456',
      photo: 'https://example.com/p1.webp',
      frame: 'gold',
      accentStyle: 'aurora',
      mmr: 1120,
      faction: 'eter',
    });
    const second = user('p2', { wins: 1 });

    const creation = factory.createRanked([first, second]);
    track(creation.match);

    expect(randomIndex).toHaveBeenCalledWith(2);
    expect(creation.players.map((player) => player.id)).toEqual(['p2', 'p1']);
    expect(creation.players.find((player) => player.id === 'p1')).toMatchObject({
      name: 'Jogador',
      avatar: 'wolf',
      commander: 'mage',
      accent: '#123456',
      photo: 'https://example.com/p1.webp',
      frame: 'gold',
      accentStyle: 'aurora',
      mmr: 1120,
      tutorialEligible: true,
    });
    expect(creation.players.find((player) => player.id === 'p2')?.tutorialEligible).toBe(false);
    expect(creation.content).toEqual({ factions: { p1: 'eter' }, comeback: true });
  });

  it('liga atualizações e encerramento ranqueado à instância criada', () => {
    const { factory, onUpdate, onRankedFinish, onPracticeFinish } = setup();
    const match = track(factory.createRanked([user('p1'), user('p2')]).match);

    match.start();
    for (const playerId of match.playerIds()) match.mulligan(playerId, []);
    match.surrender(match.playerIds()[0]);

    expect(onUpdate).toHaveBeenCalledWith(match);
    expect(onRankedFinish).toHaveBeenCalledWith(
      match,
      expect.objectContaining({ reason: 'surrender' }),
    );
    expect(onPracticeFinish).not.toHaveBeenCalled();
  });

  it('mantém o humano no primeiro assento e auto-confirma o bot no treino', () => {
    const { factory, onPracticeFinish } = setup(
      { factions: true, comeback: false },
      () => 42,
    );
    const match = track(factory.createPractice(user('p1', { faction: 'eter', mmr: 1080 })));

    expect(match.playerIds()).toEqual(['p1', 'bot:42']);
    expect(match.seats[1].player).toMatchObject({
      name: 'Treinador IA',
      avatar: 'robot',
      commander: 'robot',
      accentStyle: 'aurora',
      mmr: 1080,
    });
    expect(match.toSnapshot().content).toEqual({ factions: { p1: 'eter' } });

    match.start();
    expect(match.seats[1].mulliganDone).toBe(true);
    match.mulligan('p1', []);
    match.surrender('bot:42');
    expect(onPracticeFinish).toHaveBeenCalledWith(
      match,
      expect.objectContaining({ reason: 'surrender' }),
    );
  });

  it('restaura snapshot com callbacks ligados à nova instância', () => {
    const { factory, onUpdate, onRankedFinish } = setup();
    const original = track(factory.createRanked([user('p1'), user('p2')]).match);
    original.start();
    for (const playerId of original.playerIds()) original.mulligan(playerId, []);
    const snapshot = original.toSnapshot();
    original.dispose();
    onUpdate.mockClear();
    onRankedFinish.mockClear();

    const restored = track(factory.restoreRanked(snapshot));
    expect(restored.id).toBe(original.id);
    for (const playerId of restored.playerIds()) restored.handleReconnect(playerId);
    expect(onUpdate).toHaveBeenCalledWith(restored);

    restored.surrender(restored.playerIds()[0]);
    expect(onRankedFinish).toHaveBeenCalledWith(
      restored,
      expect.objectContaining({ reason: 'surrender' }),
    );
  });
});
