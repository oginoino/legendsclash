import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconnectController } from '../src/game/connection/reconnect-controller.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('ReconnectController', () => {
  it('marca o assento desconectado e expira no deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    const seat = { connected: true };
    const onTimeout = vi.fn();
    const reconnect = new ReconnectController(onTimeout);

    reconnect.disconnect(seat, 10_000);
    expect(seat.connected).toBe(false);
    expect(reconnect.deadlineFor(seat)).toBe(Date.now() + 10_000);
    vi.advanceTimersByTime(9_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledWith(seat);
  });

  it('reconectar cancela a derrota e e idempotente', () => {
    vi.useFakeTimers();
    const seat = { connected: true };
    const onTimeout = vi.fn();
    const reconnect = new ReconnectController(onTimeout);
    reconnect.disconnect(seat, 1_000);

    expect(reconnect.reconnect(seat)).toBe(true);
    expect(reconnect.reconnect(seat)).toBe(false);
    expect(reconnect.deadlineFor(seat)).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('uma nova desconexao substitui o timer anterior', () => {
    vi.useFakeTimers();
    const seat = { connected: true };
    const onTimeout = vi.fn();
    const reconnect = new ReconnectController(onTimeout);
    reconnect.disconnect(seat, 1_000);
    vi.advanceTimersByTime(500);

    reconnect.disconnect(seat, 1_000);
    vi.advanceTimersByTime(501);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('limpar cancela todas as janelas pendentes', () => {
    vi.useFakeTimers();
    const seats = [{ connected: true }, { connected: true }];
    const onTimeout = vi.fn();
    const reconnect = new ReconnectController(onTimeout);
    for (const seat of seats) reconnect.disconnect(seat, 1_000);

    reconnect.clear();
    vi.advanceTimersByTime(2_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
