/**
 * Rate-limit por chave (token bucket). O servidor é autoritativo: cooldowns no
 * cliente (chat, provocação) são só UX — um socket modificado os ignora, então a
 * defesa contra flood/DoS e spam de chat tem que morar aqui.
 *
 * Token bucket: cada chave (ex.: userId) tem uma "balde" que enche a
 * `refillPerSec` tokens/segundo até `capacity` (o burst permitido). Cada ação
 * consome 1 token; sem token, é negada.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  /** Consome 1 token se houver. Retorna true se permitido, false se no limite. */
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: now };
    const elapsed = Math.max(0, now - b.last) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  /** Esquece a chave (ex.: ao desconectar) — evita o Map crescer indefinidamente. */
  forget(key: string): void {
    this.buckets.delete(key);
  }
}
