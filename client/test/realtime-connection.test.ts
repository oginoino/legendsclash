import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@legendsclash/shared';
import {
  createRealtimeConnection,
} from '../src/network/realtime-connection';
import type {
  RealtimeEnvironment,
  RealtimeSession,
  RealtimeSocket,
} from '../src/network/realtime-connection';

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  readonly sent: string[] = [];
  closeCalls = 0;
  private readonly openHandlers: Array<() => void> = [];
  private readonly messageHandlers: Array<(payload: string) => void> = [];
  private readonly closeHandlers: Array<(code: number) => void> = [];

  constructor(readonly url: string) {}

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onMessage(handler: (payload: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: (code: number) => void): void {
    this.closeHandlers.push(handler);
  }

  open(): void {
    this.readyState = 1;
    for (const handler of this.openHandlers) handler();
  }

  receive(message: ServerMsg): void {
    for (const handler of this.messageHandlers) handler(JSON.stringify(message));
  }

  serverClose(code = 1006): void {
    this.readyState = 3;
    for (const handler of this.closeHandlers) handler(code);
  }
}

class FakeEnvironment implements RealtimeEnvironment {
  nowMs = 0;
  visible = true;
  readonly sockets: FakeSocket[] = [];
  readonly timeouts: Array<{ callback: () => void; delayMs: number }> = [];
  readonly intervals: Array<{ callback: () => void; delayMs: number }> = [];
  private onlineHandler: () => void = () => {};
  private focusHandler: () => void = () => {};
  private visibilityHandler: () => void = () => {};

  createSocket(url: string): RealtimeSocket {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    return socket;
  }

  socketUrl(): string {
    return 'wss://arena.test/ws';
  }

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): void {
    this.timeouts.push({ callback, delayMs });
  }

  setInterval(callback: () => void, delayMs: number): void {
    this.intervals.push({ callback, delayMs });
  }

  onOnline(callback: () => void): void {
    this.onlineHandler = callback;
  }

  onFocus(callback: () => void): void {
    this.focusHandler = callback;
  }

  onVisibilityChange(callback: () => void): void {
    this.visibilityHandler = callback;
  }

  isVisible(): boolean {
    return this.visible;
  }

  runNextTimeout(): void {
    const timeout = this.timeouts.shift();
    if (!timeout) throw new Error('Nenhuma reconexão agendada.');
    timeout.callback();
  }

  runIntervals(): void {
    for (const interval of this.intervals) interval.callback();
  }

  goOnline(): void {
    this.onlineHandler();
  }

  focus(): void {
    this.focusHandler();
  }

  changeVisibility(): void {
    this.visibilityHandler();
  }
}

function setup(initialSession: Partial<RealtimeSession> = {}) {
  const environment = new FakeEnvironment();
  const session: RealtimeSession = {
    token: 'session-token',
    resetToken: null,
    replaced: false,
    ...initialSession,
  };
  const messages: ServerMsg[] = [];
  const events = { opened: 0, closed: 0, replaced: 0 };
  let connection: ReturnType<typeof createRealtimeConnection>;

  connection = createRealtimeConnection({
    getSession: () => session,
    onOpen: () => {
      events.opened += 1;
      if (session.token) connection.send({ t: 'hello', token: session.token });
    },
    onMessage: (message) => messages.push(message),
    onClosed: () => { events.closed += 1; },
    onReplaced: () => { events.replaced += 1; },
  }, environment);

  return { connection, environment, events, messages, session };
}

describe('RealtimeConnection', () => {
  it('abre uma única conexão, autentica e encaminha mensagens do servidor', () => {
    const { connection, environment, events, messages } = setup();

    connection.connect();
    connection.connect();

    expect(environment.sockets).toHaveLength(1);
    const socket = environment.sockets[0];
    expect(socket.url).toBe('wss://arena.test/ws');

    socket.open();
    socket.receive({ t: 'pong' });

    expect(events.opened).toBe(1);
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([
      { t: 'hello', token: 'session-token' },
    ]);
    expect(messages).toEqual([{ t: 'pong' }]);
  });

  it('não conecta sem sessão, durante reset ou após substituição da aba', () => {
    const { connection, environment, session } = setup({ token: null });

    connection.connect();
    session.token = 'session-token';
    session.resetToken = 'recovery-token';
    environment.goOnline();
    session.resetToken = null;
    session.replaced = true;
    environment.focus();

    expect(environment.sockets).toHaveLength(0);

    session.replaced = false;
    environment.focus();
    expect(environment.sockets).toHaveLength(1);
  });

  it('usa backoff progressivo e o reinicia após uma conexão bem-sucedida', () => {
    const { connection, environment, events } = setup();

    connection.connect();
    environment.sockets[0].serverClose();

    expect(events.closed).toBe(1);
    expect(environment.timeouts.map(({ delayMs }) => delayMs)).toEqual([1_000]);

    environment.runNextTimeout();
    environment.sockets[1].serverClose();
    expect(environment.timeouts.map(({ delayMs }) => delayMs)).toEqual([2_000]);

    environment.runNextTimeout();
    environment.sockets[2].open();
    environment.sockets[2].serverClose();
    expect(environment.timeouts.map(({ delayMs }) => delayMs)).toEqual([1_000]);
  });

  it('interrompe a reconexão quando outra aba assume a sessão', () => {
    const { connection, environment, events } = setup();

    connection.connect();
    environment.sockets[0].serverClose(4001);

    expect(events).toEqual({ opened: 0, closed: 1, replaced: 1 });
    expect(environment.timeouts).toHaveLength(0);
  });

  it('envia ping após ociosidade e fecha conexões silenciosas', () => {
    const { connection, environment } = setup();

    connection.connect();
    const socket = environment.sockets[0];
    socket.open();

    environment.nowMs = 25_001;
    environment.runIntervals();
    expect(socket.sent.map((payload) => JSON.parse(payload))).toContainEqual({ t: 'ping' });

    environment.nowMs = 30_000;
    socket.receive({ t: 'pong' });
    environment.nowMs = 95_000;
    environment.runIntervals();
    expect(socket.closeCalls).toBe(0);

    environment.nowMs = 95_001;
    environment.runIntervals();
    expect(socket.closeCalls).toBe(1);
  });

  it('descarta eventos tardios ao trocar ou encerrar a sessão', () => {
    const { connection, environment, events } = setup();

    connection.connect();
    const socket = environment.sockets[0];
    socket.open();
    connection.disconnect();
    socket.serverClose();

    expect(socket.closeCalls).toBe(1);
    expect(events.closed).toBe(0);
    expect(environment.timeouts).toHaveLength(0);
  });

  it('só retoma por visibilidade quando a aba está visível', () => {
    const { environment } = setup();

    environment.visible = false;
    environment.changeVisibility();
    expect(environment.sockets).toHaveLength(0);

    environment.visible = true;
    environment.changeVisibility();
    expect(environment.sockets).toHaveLength(1);
  });
});
