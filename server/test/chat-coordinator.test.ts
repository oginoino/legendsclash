import { describe, expect, it, vi } from 'vitest';
import type { Profile, ServerMsg } from '@legendsclash/shared';
import {
  ChatCoordinator,
  ChatError,
  type ChatStore,
} from '../src/application/chat/chat-coordinator.js';
import type { ReportRecord, UserRecord } from '../src/store.js';

function makeUser(id: string, name = id): UserRecord {
  return {
    id,
    email: '',
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

function setup(initialUsers: UserRecord[]) {
  const users = new Map(initialUsers.map((user) => [user.id, user]));
  const recipients = new Map<string, string[]>();
  const reports: ReportRecord[] = [];
  const sent: Array<{ userId: string; message: ServerMsg }> = [];
  const warn = vi.fn<(message: string) => void>();
  const store: ChatStore = {
    userById: (id) => users.get(id),
    setMuted: (userId, targetId, muted) => {
      const user = users.get(userId);
      if (!user) return;
      if (muted && !user.muted.includes(targetId)) user.muted.push(targetId);
      if (!muted) user.muted = user.muted.filter((id) => id !== targetId);
    },
    addReport: (report) => reports.push(report),
    profileOf,
  };
  const chat = new ChatCoordinator({
    store,
    recipientsFor: (userId) => recipients.get(userId) ?? [],
    sendTo: (userId, message) => sent.push({ userId, message }),
    warn,
  });
  return { chat, recipients, reports, sent, warn };
}

describe('ChatCoordinator', () => {
  it('filtra a mensagem e respeita o mute de cada destinatário', () => {
    const sender = makeUser('sender', '');
    const visible = makeUser('visible');
    const muted = makeUser('muted');
    muted.muted.push(sender.id);
    const { chat, recipients, sent } = setup([sender, visible, muted]);
    recipients.set(sender.id, [sender.id, visible.id, muted.id]);

    chat.send(sender, '  seu idiota  ');

    const deliveries = sent.filter(({ message }) => message.t === 'chat:message');
    expect(deliveries.map(({ userId }) => userId)).toEqual([sender.id, visible.id]);
    expect(deliveries[0].message).toMatchObject({
      t: 'chat:message',
      message: {
        from: { id: sender.id, name: 'Jogador', avatar: sender.avatar, photo: null },
        text: 'seu ******',
      },
    });
  });

  it('rejeita envio fora de sala ou partida', () => {
    const sender = makeUser('sender');
    const { chat } = setup([sender]);

    expect(() => chat.send(sender, 'olá')).toThrowError(
      new ChatError('Você não está em uma sala ou partida.'),
    );
  });

  it('valida a provocação e aplica cooldown autoritativo', () => {
    const sender = makeUser('sender');
    const recipient = makeUser('recipient');
    const { chat, recipients, sent } = setup([sender, recipient]);
    recipients.set(sender.id, [recipient.id]);

    chat.sendTaunt(sender, 'gg');
    chat.sendTaunt(sender, 'gg');

    expect(sent).toHaveLength(1);
    expect(sent[0].message).toMatchObject({
      t: 'chat:message',
      message: { text: 'Boa partida!' },
    });
    expect(() => chat.sendTaunt(sender, 'inexistente')).toThrowError(
      new ChatError('Provocação inválida.'),
    );
  });

  it('sincroniza mute no perfil e bloqueia mensagens do alvo', () => {
    const owner = makeUser('owner');
    const target = makeUser('target');
    const { chat, recipients, sent } = setup([owner, target]);
    recipients.set(target.id, [owner.id, target.id]);

    chat.setMuted(owner, target.id, true);
    chat.send(target, 'mensagem oculta');

    expect(owner.muted).toContain(target.id);
    expect(sent.find(({ message }) => message.t === 'profile')).toMatchObject({
      userId: owner.id,
      message: { t: 'profile', profile: { muted: [target.id] } },
    });
    expect(sent.filter(({ message }) => message.t === 'chat:message').map(({ userId }) => userId))
      .toEqual([target.id]);
  });

  it('persiste denúncia com contexto e sinaliza somente denunciantes distintos', () => {
    const target = makeUser('target');
    const first = makeUser('first');
    const second = makeUser('second');
    const third = makeUser('third');
    const { chat, recipients, reports, sent, warn } = setup([target, first, second, third]);
    const room = [target.id, first.id, second.id, third.id];
    for (const userId of room) recipients.set(userId, room);
    chat.send(target, 'primeira');
    chat.send(target, 'segunda');

    expect(() => chat.report(target, target.id, 'x')).toThrowError(
      new ChatError('Você não pode se denunciar.'),
    );
    recipients.set(first.id, [first.id]);
    expect(() => chat.report(first, 'fora-da-sala', 'x')).toThrowError(
      new ChatError('Só dá para denunciar quem está na sua sala ou partida.'),
    );
    recipients.set(first.id, room);

    chat.report(first, target.id, 'x'.repeat(600));
    chat.report(first, target.id, 'duplicada');
    chat.report(second, target.id, 'spam');
    expect(warn).not.toHaveBeenCalled();
    chat.report(third, target.id, 'abuso');

    expect(first.muted).toContain(target.id);
    expect(reports[0]).toMatchObject({
      reporterId: first.id,
      reportedId: target.id,
      context: 'primeira | segunda',
    });
    expect(reports[0].reason).toHaveLength(500);
    expect(sent.filter(({ message }) => message.t === 'chat:report:ok')).toHaveLength(4);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3 denunciantes distintos'));
  });

  it('reinicia os limites efêmeros quando a conexão é esquecida', () => {
    const sender = makeUser('sender');
    const { chat, recipients, sent } = setup([sender]);
    recipients.set(sender.id, [sender.id]);
    for (let index = 0; index < 6; index++) chat.send(sender, `mensagem ${index}`);
    expect(sent).toHaveLength(5);

    chat.forget(sender.id);
    chat.send(sender, 'após reconectar');

    expect(sent).toHaveLength(6);
  });
});
