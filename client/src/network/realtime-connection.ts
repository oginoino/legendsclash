import type { ClientMsg, ServerMsg } from '@legendsclash/shared';

const SOCKET_OPEN = 1;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const PING_IDLE_MS = 25_000;
const DEAD_AFTER_MS = 65_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface RealtimeSession {
  token: string | null;
  resetToken: string | null;
  replaced: boolean;
}

export interface RealtimeSocket {
  readonly readyState: number;
  send(payload: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (payload: string) => void): void;
  onClose(handler: (code: number) => void): void;
}

export interface RealtimeEnvironment {
  createSocket(url: string): RealtimeSocket;
  socketUrl(): string;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): void;
  setInterval(callback: () => void, delayMs: number): void;
  onOnline(callback: () => void): void;
  onFocus(callback: () => void): void;
  onVisibilityChange(callback: () => void): void;
  isVisible(): boolean;
}

export interface RealtimeConnectionOptions {
  getSession(): RealtimeSession;
  onOpen(): void;
  onMessage(message: ServerMsg): void;
  onClosed(): void;
  onReplaced(): void;
}

export class RealtimeConnection {
  private socket: RealtimeSocket | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private lastServerMessageAt = 0;

  constructor(
    private readonly options: RealtimeConnectionOptions,
    private readonly environment: RealtimeEnvironment,
  ) {
    environment.setInterval(() => this.checkLiveness(), HEARTBEAT_INTERVAL_MS);
    environment.onOnline(() => this.reconnectNow());
    environment.onFocus(() => this.reconnectNow());
    environment.onVisibilityChange(() => {
      if (environment.isVisible()) this.reconnectNow();
    });
  }

  send(message: ClientMsg): void {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  connect(): void {
    const { token, resetToken } = this.options.getSession();
    if (
      !token
      || resetToken
      || (this.socket && this.socket.readyState <= SOCKET_OPEN)
    ) return;

    const socket = this.environment.createSocket(this.environment.socketUrl());
    this.socket = socket;

    socket.onOpen(() => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.lastServerMessageAt = this.environment.now();
      this.options.onOpen();
    });

    socket.onMessage((payload) => {
      this.lastServerMessageAt = this.environment.now();
      this.options.onMessage(JSON.parse(payload) as ServerMsg);
    });

    socket.onClose((code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.options.onClosed();
      if (code === 4001) {
        this.options.onReplaced();
        return;
      }
      if (this.options.getSession().token) {
        this.environment.setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(
          MAX_RECONNECT_DELAY_MS,
          this.reconnectDelay * 2,
        );
      }
    });
  }

  /** Reavalia a conexão imediatamente após retorno de rede, foco ou visibilidade. */
  reconnectNow(): void {
    const { token, replaced } = this.options.getSession();
    if (!token || replaced) return;
    if (this.socket?.readyState === SOCKET_OPEN) {
      if (this.environment.now() - this.lastServerMessageAt > DEAD_AFTER_MS) {
        this.socket.close();
      }
      return;
    }
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    this.connect();
  }

  /** Encerra a conexão atual sem permitir que seu evento close altere a sessão. */
  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private checkLiveness(): void {
    if (this.socket?.readyState !== SOCKET_OPEN) return;
    const quietFor = this.environment.now() - this.lastServerMessageAt;
    if (quietFor > DEAD_AFTER_MS) this.socket.close();
    else if (quietFor > PING_IDLE_MS) this.send({ t: 'ping' });
  }
}

export function createBrowserRealtimeEnvironment(): RealtimeEnvironment {
  return {
    createSocket(url) {
      const socket = new WebSocket(url);
      return {
        get readyState() { return socket.readyState; },
        send: (payload) => socket.send(payload),
        close: () => socket.close(),
        onOpen: (handler) => socket.addEventListener('open', handler),
        onMessage: (handler) => socket.addEventListener('message', (event) => handler(event.data)),
        onClose: (handler) => socket.addEventListener('close', (event) => handler(event.code)),
      };
    },
    socketUrl: () => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${location.host}/ws`;
    },
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => { window.setTimeout(callback, delayMs); },
    setInterval: (callback, delayMs) => { window.setInterval(callback, delayMs); },
    onOnline: (callback) => window.addEventListener('online', callback),
    onFocus: (callback) => window.addEventListener('focus', callback),
    onVisibilityChange: (callback) => document.addEventListener('visibilitychange', callback),
    isVisible: () => document.visibilityState === 'visible',
  };
}

export function createRealtimeConnection(
  options: RealtimeConnectionOptions,
  environment = createBrowserRealtimeEnvironment(),
): RealtimeConnection {
  return new RealtimeConnection(options, environment);
}
