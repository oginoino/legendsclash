import type { IncomingMessage } from 'node:http';
import type { ClientMsg, Profile, ServerMsg } from '@legendsclash/shared';
import type { WebSocket } from 'ws';
import { ApplicationError } from '../../application/application-error.js';
import type { Match } from '../../game/engine.js';
import { GameError } from '../../game/errors.js';
import { RateLimiter } from '../../ratelimit.js';
import type { UserRecord } from '../../store.js';
import type { AuthenticatedClientMessage } from './client-message-router.js';

type HelloContent = NonNullable<Extract<ServerMsg, { t: 'hello:ok' }>['content']>;

export interface ConnectionLifecycleDependencies {
  resolveSession(token: string): UserRecord | undefined;
  resolveUser(userId: string): UserRecord | undefined;
  profileFor(user: UserRecord): Profile;
  content: HelloContent;
  recordSessionStart(user: UserRecord): void;
  matchFor(userId: string): Match | undefined;
  queueSize(): number;
  syncRoom(userId: string): void;
  disconnectQueue(userId: string): void;
  disconnectRoom(userId: string): void;
  forgetChat(userId: string): void;
  forgetSocial(userId: string): void;
  routeMessage(user: UserRecord, message: AuthenticatedClientMessage): void;
  logUnexpectedError?: (error: unknown) => void;
}

/** Resolve o IP real usado pelas proteções anti alt-farm. */
export function clientIp(request?: IncomingMessage): string {
  if (!request) return '';
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim();
  if (first) return first;
  const remoteAddress = request.socket.remoteAddress ?? '';
  return /^(::1$|::ffff:127\.|127\.)/.test(remoteAddress) ? '' : remoteAddress;
}

/**
 * Mantém o ciclo de vida do WebSocket separado da orquestração da aplicação:
 * parsing, autenticação, substituição de aba, reconexão e limpeza no fechamento.
 */
export class ConnectionLifecycle {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly socketUser = new WeakMap<WebSocket, string>();
  private readonly socketIp = new WeakMap<WebSocket, string>();
  private readonly userIp = new Map<string, string>();
  private readonly messageLimiter = new RateLimiter(50, 30);

  constructor(private readonly dependencies: ConnectionLifecycleDependencies) {}

  handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    const ip = clientIp(request);
    if (ip) this.socketIp.set(socket, ip);

    socket.on('message', (raw) => this.handleRawMessage(socket, raw));
    socket.on('close', () => this.handleClose(socket));
  }

  isOnline(userId: string): boolean {
    return this.sockets.has(userId);
  }

  originFor(userId: string): string | undefined {
    return this.userIp.get(userId);
  }

  send(socket: WebSocket, message: ServerMsg): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  sendTo(userId: string, message: ServerMsg): void {
    const socket = this.sockets.get(userId);
    if (socket) this.send(socket, message);
  }

  private handleRawMessage(socket: WebSocket, raw: unknown): void {
    let message: ClientMsg;
    try {
      message = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      this.send(socket, { t: 'error', message: 'Mensagem inválida.' });
      return;
    }

    try {
      this.handleMessage(socket, message);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Erro interno.';
      this.send(socket, { t: 'error', message: messageText });
      if (!(error instanceof GameError) && !(error instanceof ApplicationError)) {
        (this.dependencies.logUnexpectedError ?? console.error)(error);
      }
    }
  }

  private handleMessage(socket: WebSocket, message: ClientMsg): void {
    // Keepalive e handshake passam antes da exigência de autenticação.
    if (message.t === 'ping') {
      this.send(socket, { t: 'pong' });
      return;
    }
    if (message.t === 'hello') {
      this.handleHello(socket, message.token);
      return;
    }

    const userId = this.socketUser.get(socket);
    if (!userId) throw new ApplicationError('Sessão não autenticada.');
    const user = this.dependencies.resolveUser(userId);
    if (!user) throw new ApplicationError('Usuário não encontrado.');

    // Teto global anti-flood. Limites específicos continuam nos coordenadores.
    if (!this.messageLimiter.take(userId)) return;
    this.dependencies.routeMessage(user, message);
  }

  private handleHello(socket: WebSocket, token: string): void {
    const user = this.dependencies.resolveSession(token);
    if (!user) {
      this.send(socket, { t: 'error', message: 'Sessão expirada. Entre novamente.' });
      return;
    }

    // A nova conexão substitui a anterior sem iniciar disputa de reconexão.
    const oldSocket = this.sockets.get(user.id);
    if (oldSocket && oldSocket !== socket) {
      oldSocket.close(4001, 'Conexão substituída por outra aba/dispositivo.');
    }
    this.sockets.set(user.id, socket);
    this.socketUser.set(socket, user.id);
    const ip = this.socketIp.get(socket);
    if (ip) this.userIp.set(user.id, ip);

    this.send(socket, {
      t: 'hello:ok',
      profile: this.dependencies.profileFor(user),
      content: this.dependencies.content,
    });
    this.dependencies.recordSessionStart(user);

    const match = this.dependencies.matchFor(user.id);
    if (match && !match.finished) {
      match.handleReconnect(user.id);
      this.send(socket, { t: 'game:state', view: match.viewFor(user.id) });
      return;
    }

    // Verdade completa após reconexão evita batalha, sala ou fila fantasma.
    this.send(socket, { t: 'game:state', view: null });
    this.send(socket, { t: 'queue:status', inQueue: false, size: this.dependencies.queueSize() });
    this.dependencies.syncRoom(user.id);
  }

  private handleClose(socket: WebSocket): void {
    const userId = this.socketUser.get(socket);
    if (!userId || this.sockets.get(userId) !== socket) return;

    this.sockets.delete(userId);
    this.dependencies.disconnectQueue(userId);
    this.messageLimiter.forget(userId);
    this.dependencies.forgetChat(userId);
    this.dependencies.forgetSocial(userId);
    this.userIp.delete(userId);

    const match = this.dependencies.matchFor(userId);
    if (match && !match.finished) {
      match.handleDisconnect(userId);
      return;
    }
    this.dependencies.disconnectRoom(userId);
  }
}
