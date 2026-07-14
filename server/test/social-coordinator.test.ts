import { describe, expect, it } from 'vitest';
import type { Profile, PublicProfile, ServerMsg } from '@legendsclash/shared';
import {
  SocialCoordinator,
  SocialError,
  type SocialStore,
} from '../src/application/social/social-coordinator.js';
import type { UserRecord } from '../src/store.js';

function makeUser(id: string, name = id): UserRecord {
  return {
    id,
    email: `${id}@test.local`,
    name,
    avatar: 'shield',
    commander: 'shield',
    accent: '#4f8cff',
    photo: null,
    frame: 'none',
    accentStyle: 'solid',
    profileCover: 'default',
    faction: '',
    authUserId: null,
    guest: true,
    mmr: 1000,
    league: 'Bronze',
    wins: 0,
    losses: 0,
    muted: [],
    friends: [],
    history: [],
    createdAt: 0,
    streak: 0,
    lastPlayDay: 0,
  };
}

function profileOf(user: UserRecord): Profile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    commander: user.commander,
    accent: user.accent,
    photo: user.photo,
    frame: user.frame,
    accentStyle: user.accentStyle,
    profileCover: user.profileCover,
    faction: user.faction,
    guest: user.guest,
    mmr: user.mmr,
    league: user.league ?? 'Bronze',
    wins: user.wins,
    losses: user.losses,
    streak: user.streak,
    playedToday: false,
    achievements: [],
    muted: [...user.muted],
    friends: [...user.friends],
  };
}

function publicProfileOf(user: UserRecord): PublicProfile {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    commander: user.commander,
    accent: user.accent,
    photo: user.photo,
    frame: user.frame,
    accentStyle: user.accentStyle,
    profileCover: user.profileCover,
    faction: user.faction,
    league: user.league ?? 'Bronze',
    mmr: user.mmr,
    wins: user.wins,
    losses: user.losses,
    achievements: [],
    streak: user.streak,
  };
}

function setup(initialUsers: UserRecord[]) {
  const users = new Map(initialUsers.map((user) => [user.id, user]));
  const participants = new Map<string, string[]>();
  const online = new Set<string>();
  const inMatch = new Set<string>();
  const sent: Array<{ userId: string; message: ServerMsg }> = [];
  const started: UserRecord[][] = [];
  const store: SocialStore = {
    userById: (id) => users.get(id),
    setFriend: (userId, friendId, add) => {
      const user = users.get(userId);
      if (!user || userId === friendId) return;
      if (add && !user.friends.includes(friendId)) user.friends.push(friendId);
      if (!add) user.friends = user.friends.filter((id) => id !== friendId);
    },
    profileOf,
    publicProfileOf,
  };
  const social = new SocialCoordinator({
    store,
    participantsFor: (userId) => participants.get(userId) ?? [],
    isOnline: (userId) => online.has(userId),
    isInMatch: (userId) => inMatch.has(userId),
    startMatch: (usersToStart) => started.push(usersToStart),
    sendTo: (userId, message) => sent.push({ userId, message }),
  });
  return { social, participants, online, inMatch, sent, started };
}

describe('SocialCoordinator', () => {
  it('habilita amizade e perfil público somente após uma relação válida', () => {
    const owner = makeUser('owner');
    const opponent = makeUser('opponent');
    const stranger = makeUser('stranger');
    const { social, sent } = setup([owner, opponent, stranger]);
    social.recordOpponents([owner.id, opponent.id]);

    social.setFriend(owner, opponent.id, true);
    social.getProfile(owner, opponent.id);

    expect(owner.friends).toContain(opponent.id);
    expect(sent.find(({ message }) => message.t === 'profile')).toMatchObject({
      userId: owner.id,
      message: { t: 'profile', profile: { friends: [opponent.id] } },
    });
    const publicView = sent.find(({ message }) => message.t === 'profile:view')?.message;
    expect(publicView).toMatchObject({
      t: 'profile:view',
      profile: { id: opponent.id },
    });
    expect(publicView && 'profile' in publicView && 'email' in publicView.profile).toBe(false);
    expect(() => social.setFriend(owner, stranger.id, true)).toThrowError(
      new SocialError('Só dá para adicionar quem você enfrentou.'),
    );
  });

  it('considera participantes do contexto atual e permite sempre remover amizade', () => {
    const owner = makeUser('owner');
    const participant = makeUser('participant');
    const oldFriend = makeUser('old-friend');
    owner.friends.push(oldFriend.id);
    const { social, participants } = setup([owner, participant, oldFriend]);
    participants.set(owner.id, [owner.id, participant.id]);

    social.setFriend(owner, participant.id, true);
    social.setFriend(owner, oldFriend.id, false);

    expect(owner.friends).toEqual([participant.id]);
  });

  it('expõe perfis ranqueados sem relação e protege perfis não ranqueados', () => {
    const viewer = makeUser('viewer');
    const ranked = makeUser('ranked');
    ranked.guest = false;
    ranked.wins = 1;
    const hidden = makeUser('hidden');
    hidden.guest = false;
    const { social, sent } = setup([viewer, ranked, hidden]);

    social.getProfile(viewer, ranked.id);
    expect(sent.at(-1)).toMatchObject({
      userId: viewer.id,
      message: { t: 'profile:view', profile: { id: ranked.id } },
    });
    expect(() => social.getProfile(viewer, hidden.id)).toThrowError(
      new SocialError('Perfil ainda não está disponível publicamente.'),
    );
    expect(() => social.getProfile(viewer, 'missing')).toThrowError(
      new SocialError('Jogador não encontrado.'),
    );
  });

  it('troca pedidos recíprocos de revanche por uma nova partida', () => {
    const first = makeUser('first', '');
    const second = makeUser('second');
    const { social, online, sent, started } = setup([first, second]);
    online.add(first.id);
    online.add(second.id);
    social.recordOpponents([first.id, second.id]);

    social.requestRematch(first);

    expect(sent).toEqual(expect.arrayContaining([
      { userId: first.id, message: { t: 'rematch:state', status: 'sent' } },
      {
        userId: second.id,
        message: {
          t: 'rematch:state',
          status: 'incoming',
          from: { id: first.id, name: 'Jogador', avatar: first.avatar, photo: null },
        },
      },
    ]));

    social.requestRematch(second);

    expect(started).toEqual([[second, first]]);
  });

  it('prioriza o encontro mais recente e mantém somente dez oponentes', () => {
    const owner = makeUser('owner');
    const opponents = Array.from({ length: 11 }, (_, index) => makeUser(`opponent-${index}`));
    const { social, online, sent } = setup([owner, ...opponents]);
    for (const opponent of opponents) {
      online.add(opponent.id);
      social.recordOpponents([owner.id, opponent.id]);
    }

    social.requestRematch(owner);

    expect(sent.at(-1)).toMatchObject({
      userId: opponents.at(-1)!.id,
      message: { t: 'rematch:state', status: 'incoming' },
    });
    expect(() => social.setFriend(owner, opponents[0].id, true)).toThrowError(
      new SocialError('Só dá para adicionar quem você enfrentou.'),
    );
  });

  it('informa indisponibilidade e impede pedir revanche durante uma partida', () => {
    const first = makeUser('first');
    const second = makeUser('second');
    const { social, online, inMatch, sent } = setup([first, second]);

    social.requestRematch(first);
    social.recordOpponents([first.id, second.id]);
    social.requestRematch(first);
    online.add(second.id);
    inMatch.add(second.id);
    social.requestRematch(first);
    inMatch.delete(second.id);
    inMatch.add(first.id);

    expect(() => social.requestRematch(first)).toThrowError(
      new SocialError('Termine a partida atual primeiro.'),
    );
    expect(sent.filter(({ message }) => (
      message.t === 'rematch:state' && message.status === 'unavailable'
    ))).toHaveLength(3);
  });

  it('limpa ofertas ao recusar ou desconectar um dos envolvidos', () => {
    const first = makeUser('first');
    const second = makeUser('second');
    const { social, online, sent, started } = setup([first, second]);
    online.add(first.id);
    online.add(second.id);
    social.recordOpponents([first.id, second.id]);

    social.requestRematch(first);
    social.declineRematch(second);
    expect(sent.at(-1)).toEqual({
      userId: first.id,
      message: { t: 'rematch:state', status: 'declined' },
    });

    social.requestRematch(first);
    social.forget(second.id);
    social.requestRematch(second);

    expect(started).toHaveLength(0);
    expect(sent.at(-1)).toMatchObject({
      userId: first.id,
      message: { t: 'rematch:state', status: 'incoming', from: { id: second.id } },
    });
  });

  it('limita enumeração de perfis e reinicia o balde após desconexão', () => {
    const viewer = makeUser('viewer');
    const ranked = makeUser('ranked');
    ranked.guest = false;
    ranked.losses = 1;
    const { social, sent } = setup([viewer, ranked]);

    for (let index = 0; index < 5; index++) social.getProfile(viewer, ranked.id);
    expect(sent).toHaveLength(4);

    social.forget(viewer.id);
    social.getProfile(viewer, ranked.id);

    expect(sent).toHaveLength(5);
  });
});
