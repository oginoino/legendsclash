import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnClock } from '../src/game/timing/turn-clock.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TurnClock', () => {
  it('expira uma fase no deadline armado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    const onExpire = vi.fn();
    const clock = new TurnClock();

    clock.arm(10_000, onExpire);
    expect(clock.view()).toEqual({
      endsAt: Date.now() + 10_000,
      paused: false,
      timeLeftMs: 10_000,
    });

    vi.advanceTimersByTime(9_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(clock.view().timeLeftMs).toBe(0);
  });

  it('preserva o tempo ate que todos os bloqueadores liberem a pausa', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const clock = new TurnClock();
    clock.arm(10_000, onExpire);
    vi.advanceTimersByTime(2_000);

    expect(clock.setPausedBy('p0', true)).toBe(true);
    expect(clock.setPausedBy('p1', true)).toBe(true);
    expect(clock.view()).toMatchObject({ endsAt: 0, paused: true, timeLeftMs: 8_000 });
    vi.advanceTimersByTime(20_000);
    expect(onExpire).not.toHaveBeenCalled();

    clock.setPausedBy('p0', false);
    expect(clock.view()).toMatchObject({ paused: true, timeLeftMs: 8_000 });
    clock.setPausedBy('p1', false);
    expect(clock.view()).toMatchObject({ paused: false, timeLeftMs: 8_000 });
    vi.advanceTimersByTime(8_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('restaura bloqueadores sem iniciar a contagem antes da retomada', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const clock = new TurnClock(['p0']);

    clock.arm(53_000, onExpire);
    expect(clock.pausedBy).toEqual(['p0']);
    expect(clock.view()).toEqual({ endsAt: 0, paused: true, timeLeftMs: 53_000 });
    vi.advanceTimersByTime(90_000);
    expect(onExpire).not.toHaveBeenCalled();

    clock.setPausedBy('p0', false);
    vi.advanceTimersByTime(53_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('torna operacoes idempotentes e cancela a expiracao ao limpar', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const clock = new TurnClock();
    clock.arm(1_000, onExpire);

    expect(clock.setPausedBy('p0', true)).toBe(true);
    expect(clock.setPausedBy('p0', true)).toBe(false);
    expect(clock.setPausedBy('p1', false)).toBe(false);
    clock.setPausedBy('p0', false);
    clock.clear();
    vi.advanceTimersByTime(2_000);

    expect(onExpire).not.toHaveBeenCalled();
  });
});
