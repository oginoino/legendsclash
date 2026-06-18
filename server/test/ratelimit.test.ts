import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/ratelimit.js';

describe('RateLimiter (token bucket)', () => {
  it('permite o burst até a capacidade e nega depois', () => {
    const rl = new RateLimiter(3, 1); // cap 3, 1 token/s
    expect(rl.take('u', 0)).toBe(true);
    expect(rl.take('u', 0)).toBe(true);
    expect(rl.take('u', 0)).toBe(true);
    expect(rl.take('u', 0)).toBe(false); // estourou o burst
  });

  it('recarrega tokens com o tempo', () => {
    const rl = new RateLimiter(2, 1); // 1 token/s
    expect(rl.take('u', 0)).toBe(true);
    expect(rl.take('u', 0)).toBe(true);
    expect(rl.take('u', 0)).toBe(false);
    expect(rl.take('u', 1000)).toBe(true); // +1 token após 1 s
    expect(rl.take('u', 1000)).toBe(false);
  });

  it('isola chaves diferentes', () => {
    const rl = new RateLimiter(1, 1);
    expect(rl.take('a', 0)).toBe(true);
    expect(rl.take('a', 0)).toBe(false);
    expect(rl.take('b', 0)).toBe(true); // 'b' tem o próprio balde
  });

  it('forget reseta o balde da chave', () => {
    const rl = new RateLimiter(1, 0.1);
    expect(rl.take('u', 0)).toBe(true);
    expect(rl.take('u', 0)).toBe(false);
    rl.forget('u');
    expect(rl.take('u', 0)).toBe(true); // balde recriado cheio
  });

  it('não passa da capacidade por mais que se espere', () => {
    const rl = new RateLimiter(2, 100);
    expect(rl.take('u', 0)).toBe(true);
    // muito tempo depois: o balde enche só até a capacidade (2), não acumula infinito
    expect(rl.take('u', 10_000)).toBe(true);
    expect(rl.take('u', 10_000)).toBe(true);
    expect(rl.take('u', 10_000)).toBe(false);
  });
});
