import { CARDS, cardOfDay } from '@legendsclash/shared';
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
};

const linked = new Set<string>();
const decoded = new Set<string>();
const pending = new Set<string>();

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
  link.href = url;
  link.fetchPriority = priority;
  document.head.appendChild(link);
}

function decodeImage(url: string, priority: ImageFetchPriority): void {
  if (!canUseDom() || decoded.has(url) || pending.has(url)) return;
  pending.add(url);
  const img = new Image() as HTMLImageElement & { fetchPriority?: ImageFetchPriority };
  img.decoding = 'async';
  img.loading = 'eager';
  img.fetchPriority = priority;
  img.onload = () => {
    decoded.add(url);
    pending.delete(url);
  };
  img.onerror = () => pending.delete(url);
  img.src = url;
  if (img.decode) {
    void img.decode()
      .then(() => decoded.add(url))
      .catch(() => undefined)
      .finally(() => pending.delete(url));
  }
}

export function preloadCardImages(defIds: readonly string[], options: PreloadOptions = {}): void {
  const priority = options.priority ?? 'auto';
  for (const url of uniqueUrls(defIds)) {
    preloadLink(url, priority);
    if (options.decode ?? true) decodeImage(url, priority);
  }
}

export function warmCardImages(defIds: readonly string[], options: WarmupOptions = {}): void {
  if (!canUseDom()) return;
  const priority = options.priority ?? 'low';
  const batchSize = options.batchSize ?? 4;
  const queue = uniqueUrls(defIds).filter((url) => !decoded.has(url));
  const pump = () => {
    scheduleIdle((deadline) => {
      let used = 0;
      while (queue.length && used < batchSize && (deadline.timeRemaining() > 6 || deadline.didTimeout)) {
        const url = queue.shift();
        if (url) decodeImage(url, priority);
        used++;
      }
      if (queue.length) pump();
    }, 1800);
  };
  pump();
}

function preloadFontFaces(): void {
  if (!canUseDom() || !('fonts' in document)) return;
  const fonts = document.fonts;
  void fonts.load('900 1rem "Cinzel Decorative"');
  void fonts.load('800 1rem "Cinzel"');
  void fonts.load('600 1rem "Mozilla Text"');
  void fonts.ready.catch(() => undefined);
}

export function primeVisualAssets(): void {
  if (!canUseDom()) return;
  preloadFontFaces();

  const critical = [
    cardOfDay(Date.now()),
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
  preloadCardImages(critical, { priority: 'high', decode: true });

  const rest = Object.keys(CARD_IMAGE_MAP).filter((id) => !critical.includes(id));
  warmCardImages(rest, { batchSize: 3, priority: 'low' });
}

export function allCardImageIds(): string[] {
  return Object.keys(CARDS).filter((id) => !!cardImageUrl(id));
}
