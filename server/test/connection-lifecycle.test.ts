import type { IncomingMessage } from 'node:http';
import { EventEmitter } from 'node:events';
import type { Profile, ServerMsg } from '@legendsclash/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../src/application/application-error.js';
import type { Match } from '../src/game/engine.js';
import type { UserRecord } from '../src/store.js';
import {
  ConnectionLifecycle,
  clientIp,
  type ConnectionLifecycleDependencies,
} from '../src/transport/websocket/connection-lifecycle.js';

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: ServerMsg[] = [];
  closedWith: number | undefined;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMsg);
  }

  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code;
    this.emit('close');
  }

  message(value: unknown): void {
    this.emit('message', typeof value === 'string' ? value : JSON.stringify(value));
  }
}

function setup(activeMatch?: Match) {
  const user = { id: 'player-1', guest: true } as UserRecord;
  const profile = { id: user.id, name: 'Aurora' } as Profile;
  const routeMessage = vi.fn();
  const logUnexpectedError = vi.fn();
  const dependencies: ConnectionLifecycleDependencies = {
    resolveSession: vi.fn((token) => token === 'valid' ? user : undefined),
    resolveUser: vi.fn((userId) => userId === user.id ? user : undefined),
    profileFor: vi.fn(() => profile),
    content: { factions: true, cosmetics: true },
    recordSessionStart: vi.fn(),
    matchFor: vi.fn(() => activeMatch),
    queueSize: vi.fn(() => 3),
    syncRoom: vi.fn(),
    disconnectQueue: vi.fn(),
    disconnectRoom: vi.fn(),
    forgetChat: vi.fn(),
    forgetSocial: vi.fn(),
    routeMessage,
    logUnexpectedError,
  };
  const lifecycle = new ConnectionLifecycle(dependencies);
  const connect = (request?: IncomingMessage) => {
    const socket = new FakeSocket();
    lifecycle.handleConnection(socket as never, request);
    return socket;
  };
  return { user, profile, dependencies, routeMessage, logUnexpectedError, lifecycle, connect };
}

describe('ConnectionLifecycle', () => {
  it('resolve IP encaminhado e ignora loopback local', () => {
    expect(clientIp({
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage)).toBe('203.0.113.7');
    expect(clientIp({
      headers: {},
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    } as unknown as IncomingMessage)).toBe('');
  });

  it('trata keepalive, payload inválido e autenticação obrigatória', () => {
    const { connect, logUnexpectedError } = setup();
    const socket = connect();

    socket.message({ t: 'ping' });
    socket.message('{');
    socket.message({ t: 'queue:join' });

    expect(socket.sent).toContainEqual({ t: 'pong' });
    expect(socket.sent).toContainEqual({ t: 'error', message: 'Mensagem inválida.' });
    expect(socket.sent).toContainEqual({ t: 'error', message: 'Sessão não autenticada.' });
    expect(logUnexpectedError).not.toHaveBeenCalled();
  });

  it('autentica, publica o estado completo e roteia mensagens do usuário', () => {
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.8' },
      socket: { remoteAddress: '10.0.0.2' },
    } as unknown as IncomingMessage;
    const {
      user, profile, dependencies, routeMessage, lifecycle, connect,
    } = setup();
    const socket = connect(request);

    socket.message({ t: 'hello', token: 'valid' });
    socket.message({ t: 'queue:join' });

    expect(socket.sent[0]).toEqual({
      t: 'hello:ok', profile, content: { factions: true, cosmetics: true },
    });
    expect(socket.sent).toContainEqual({ t: 'game:state', view: null });
    expect(socket.sent).toContainEqual({ t: 'queue:status', inQueue: false, size: 3 });
    expect(dependencies.syncRoom).toHaveBeenCalledWith(user.id);
    expect(dependencies.recordSessionStart).toHaveBeenCalledWith(user);
    expect(routeMessage).toHaveBeenCalledWith(user, { t: 'queue:join' });
    expect(lifecycle.isOnline(user.id)).toBe(true);
    expect(lifecycle.originFor(user.id)).toBe('203.0.113.8');
  });

  it('substitui a conexão antiga e mantém somente a nova como ativa', () => {
    const { user, lifecycle, connect } = setup();
    const first = connect();
    first.message({ t: 'hello', token: 'valid' });
    const second = connect();

    second.message({ t: 'hello', token: 'valid' });
    lifecycle.sendTo(user.id, { t: 'pong' });

    expect(first.closedWith).toBe(4001);
    expect(second.sent.at(-1)).toEqual({ t: 'pong' });
    expect(lifecycle.isOnline(user.id)).toBe(true);
  });

  it('reconecta e desconecta uma partida ativa sem remover a sala', () => {
    const match = {
      finished: false,
      handleReconnect: vi.fn(),
      viewFor: vi.fn(() => ({ matchId: 'match-1' })),
      handleDisconnect: vi.fn(),
    } as unknown as Match;
    const { user, dependencies, connect } = setup(match);
    const socket = connect();

    socket.message({ t: 'hello', token: 'valid' });
    socket.close();

    expect(match.handleReconnect).toHaveBeenCalledWith(user.id);
    expect(socket.sent).toContainEqual({ t: 'game:state', view: { matchId: 'match-1' } });
    expect(dependencies.disconnectQueue).toHaveBeenCalledWith(user.id);
    expect(dependencies.forgetChat).toHaveBeenCalledWith(user.id);
    expect(dependencies.forgetSocial).toHaveBeenCalledWith(user.id);
    expect(match.handleDisconnect).toHaveBeenCalledWith(user.id);
    expect(dependencies.disconnectRoom).not.toHaveBeenCalled();
  });

  it('envia falhas ao cliente e só registra erros inesperados', () => {
    const { routeMessage, logUnexpectedError, connect } = setup();
    const socket = connect();
    socket.message({ t: 'hello', token: 'valid' });
    routeMessage.mockImplementationOnce(() => { throw new ApplicationError('Fluxo recusado.'); });
    routeMessage.mockImplementationOnce(() => { throw new Error('Falha inesperada.'); });

    socket.message({ t: 'queue:join' });
    socket.message({ t: 'queue:leave' });

    expect(socket.sent).toContainEqual({ t: 'error', message: 'Fluxo recusado.' });
    expect(socket.sent).toContainEqual({ t: 'error', message: 'Falha inesperada.' });
    expect(logUnexpectedError).toHaveBeenCalledTimes(1);
  });
});
