import { CARDS, cardOfDay, deckComposition } from '@legendsclash/shared';
import { CARD_IMAGE_MAP, cardImageUrl, type ImageFetchPriority } from './components/CardArt';

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type PreloadOptions = {
  priority?: ImageFetchPriority;
  decode?: boolean;
};

type WarmupOptions = {
  batchSize?: number;
  priority?: ImageFetchPriority;
  intervalMs?: number;
};

const linked = new Set<string>();
const decoded = new Set<string>();
const pending = new Map<string, Promise<void>>();

function canUseDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function scheduleIdle(cb: (deadline: IdleDeadlineLike) => void, timeout = 1200): void {
  if (!canUseDom()) return;
  const w = window as Window & {
    requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) {
    w.requestIdleCallback(cb, { timeout });
    return;
  }
  window.setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 16);
}

function isMobileLike(): boolean {
  if (!canUseDom()) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
  ]);
}

function uniqueUrls(defIds: readonly string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const id of defIds) {
    const url = cardImageUrl(id);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function preloadLink(url: string, priority: ImageFetchPriority): void {
  if (!canUseDom() || linked.has(url)) return;
  linked.add(url);
  const link = document.createElement('link') as HTMLLinkElement & { fetchPriority?: ImageFetchPriority };
  link.rel = 'preload';
  link.as = 'image';
  if (/\.webp(?:$|\?)/i.test(url)) link.type = 'image/webp';
  link.href = url;
  link.fetchPriority = priority;
  document.head.appendChild(link);
}

function decodeImage(url: string, priority: ImageFetchPriority): Promise<void> {
  if (!canUseDom() || decoded.has(url)) return Promise.resolve();
  const inflight = pending.get(url);
  if (inflight) return inflight;

  const promise = new Promise<void>((resolve) => {
    const img = new Image() as HTMLImageElement & { fetchPriority?: ImageFetchPriority };
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (ok) decoded.add(url);
      pending.delete(url);
      resolve();
    };
    img.decoding = 'async';
    img.loading = 'eager';
    img.fetchPriority = priority;
    img.onload = () => {
      if (!img.decode) return finish(true);
      void img.decode().then(() => finish(true)).catch(() => finish(true));
    };
    img.onerror = () => finish(false);
    img.src = url;
  });
  pending.set(url, promise);
  return promise;
}

export function preloadCardImages(defIds: readonly string[], options: PreloadOptions = {}): Promise<void> {
  const priority = options.priority ?? 'auto';
  const tasks: Promise<void>[] = [];
  for (const url of uniqueUrls(defIds)) {
    preloadLink(url, priority);
    if (options.decode ?? true) tasks.push(decodeImage(url, priority));
  }
  return Promise.all(tasks).then(() => undefined);
}

export function warmCardImages(defIds: readonly string[], options: WarmupOptions = {}): void {
  if (!canUseDom()) return;
  const priority = options.priority ?? 'low';
  const batchSize = options.batchSize ?? 4;
  const mobile = isMobileLike();
  const intervalMs = options.intervalMs ?? (mobile ? 90 : 0);
  const queue = uniqueUrls(defIds).filter((url) => !decoded.has(url) && !pending.has(url));
  if (!queue.length) return;

  const runBatch = (deadline?: IdleDeadlineLike) => {
    let used = 0;
    while (
      queue.length
      && used < batchSize
      && (!deadline || deadline.timeRemaining() > 6 || deadline.didTimeout)
    ) {
      const url = queue.shift();
      if (url) void decodeImage(url, priority);
      used++;
    }
    if (queue.length) pump();
  };

  const pump = () => {
    if (mobile || document.visibilityState === 'hidden') {
      window.setTimeout(() => runBatch(), intervalMs);
      return;
    }
    scheduleIdle(runBatch, 900);
  };
  pump();
}

function preloadFontFaces(): Promise<void> {
  if (!canUseDom() || !('fonts' in document)) return Promise.resolve();
  const fonts = document.fonts;
  return Promise.all([
    fonts.load('900 1rem "Cinzel Decorative"'),
    fonts.load('800 1rem "Cinzel"'),
    fonts.load('600 1rem "Mozilla Text"'),
  ])
    .then(() => fonts.ready)
    .then(() => undefined)
    .catch(() => undefined);
}

export function primeVisualAssets(): Promise<void> {
  if (!canUseDom()) return Promise.resolve();
  const mobile = isMobileLike();
  const fontLoad = preloadFontFaces();

  const critical = [
    cardOfDay(Date.now()),
    ...deckComposition().map(([id]) => id),
    'c_recruta',
    's_faisca',
    't_reforcos',
    'c_golem',
    's_bola_de_fogo',
    'c_lobo',
    'c_arqueira',
    'a_escudo',
    'a_estandarte',
  ];
  const firstWave = [...new Set(critical)];
  const criticalLoad = preloadCardImages(firstWave, { priority: 'high', decode: true });

  const rest = Object.keys(CARD_IMAGE_MAP).filter((id) => !firstWave.includes(id));
  warmCardImages(rest, {
    batchSize: mobile ? 6 : 3,
    priority: 'low',
    intervalMs: mobile ? 75 : 0,
  });

  return withTimeout(
    Promise.all([fontLoad, criticalLoad]).then(() => undefined),
    mobile ? 2400 : 1600,
  ).then(() => undefined);
}

export function allCardImageIds(): string[] {
  return Object.keys(CARDS).filter((id) => !!cardImageUrl(id));
}
