/**
 * Efeitos sonoros sintetizados via WebAudio — zero assets, latência mínima.
 * Dois barramentos de volume independentes e persistidos — SFX e música — para
 * o jogador dosar cada um; som nunca pode atrapalhar a partida (princípio de
 * game feel: feedback, não ruído). A música respeita preferência salva; para
 * novos jogadores começa baixa, mas audível, após o primeiro gesto.
 */

export type Bus = 'sfx' | 'music';

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;

const DEFAULT_SFX_VOL = 0.85;
const DEFAULT_MUSIC_VOL = 0.22;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function loadVol(key: string, dflt: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return dflt;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : dflt;
  } catch {
    return dflt;
  }
}

// Migração do toggle legado: quem tinha `lc_sound === 'off'` começa mudo.
const legacyOff = (() => {
  try { return localStorage.getItem('lc_sound') === 'off'; } catch { return false; }
})();
let sfxVol = loadVol('lc_vol_sfx', legacyOff ? 0 : DEFAULT_SFX_VOL);
let musicVol = loadVol('lc_vol_music', legacyOff ? 0 : DEFAULT_MUSIC_VOL);

/** Garante o contexto + os dois barramentos (lazy: só no 1º som/gesto). */
function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 10;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.006;
      limiter.release.value = 0.22;
      sfxBus.gain.value = sfxVol;
      musicBus.gain.value = musicVol;
      sfxBus.connect(limiter);
      musicBus.connect(limiter);
      limiter.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Contexto para SFX — nulo quando o volume de efeitos está zerado. */
function ac(): AudioContext | null {
  if (sfxVol <= 0) return null;
  return ensure();
}

function tone(
  freq: number,
  dur = 0.12,
  type: OscillatorType = 'triangle',
  vol = 0.05,
  delay = 0,
): void {
  const c = ac();
  if (!c || !sfxBus) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(sfxBus); // passa pelo volume de SFX
  o.start(t);
  o.stop(t + dur);
}

function sweep(
  from: number,
  to: number,
  dur = 0.22,
  type: OscillatorType = 'sawtooth',
  vol = 0.04,
  delay = 0,
): void {
  const c = ac();
  if (!c || !sfxBus) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.035, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(sfxBus);
  o.start(t);
  o.stop(t + dur);
}

function noise(
  dur = 0.14,
  vol = 0.035,
  filter: BiquadFilterType = 'bandpass',
  freq = 900,
  delay = 0,
): void {
  const c = ac();
  if (!c || !sfxBus) return;
  const t = c.currentTime + delay;
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  src.buffer = buffer;
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = 0.8;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(sfxBus);
  src.start(t);
  src.stop(t + dur);
}

function chord(freqs: number[], dur = 0.2, type: OscillatorType = 'triangle', vol = 0.035, delay = 0): void {
  freqs.forEach((freq, i) => tone(freq, dur + i * 0.015, type, vol, delay + i * 0.025));
}

function bell(freq: number, delay = 0, vol = 0.035): void {
  tone(freq, 0.32, 'sine', vol, delay);
  tone(freq * 2.01, 0.22, 'triangle', vol * 0.42, delay + 0.012);
  tone(freq * 3.02, 0.16, 'sine', vol * 0.2, delay + 0.018);
}

function warDrum(delay = 0, vol = 0.055): void {
  sweep(118, 46, 0.22, 'sine', vol, delay);
  noise(0.09, vol * 0.38, 'lowpass', 220, delay);
}

export const sfx = {
  click: () => { tone(520, 0.045, 'triangle', 0.026); bell(1040, 0.012, 0.012); },
  error: () => { chord([138, 146], 0.18, 'square', 0.035); sweep(120, 72, 0.18, 'sawtooth', 0.032, 0.06); },
  tick: () => { tone(880, 0.04, 'sine', 0.032); tone(1320, 0.035, 'sine', 0.014); },
  reveal: () => { sweep(280, 760, 0.26, 'triangle', 0.035); bell(1046, 0.08, 0.026); noise(0.22, 0.018, 'highpass', 1600, 0.04); },
  draw: () => { noise(0.11, 0.026, 'highpass', 1200); tone(620, 0.06, 'triangle', 0.028, 0.02); tone(820, 0.08, 'triangle', 0.024, 0.07); },
  energyUp: () => { bell(523, 0, 0.028); bell(784, 0.08, 0.026); noise(0.16, 0.018, 'bandpass', 1800, 0.04); },
  play: () => { chord([392, 523, 659], 0.16, 'triangle', 0.034); sweep(220, 540, 0.24, 'sine', 0.024, 0.04); },
  summon: () => { warDrum(0, 0.062); sweep(180, 390, 0.34, 'sawtooth', 0.032, 0.04); chord([330, 495, 660], 0.22, 'triangle', 0.036, 0.1); },
  buff: () => { chord([392, 587, 784], 0.18, 'triangle', 0.034); sweep(520, 1180, 0.25, 'sine', 0.026, 0.08); noise(0.18, 0.016, 'highpass', 2200, 0.05); },
  attack: () => { warDrum(0, 0.07); sweep(260, 92, 0.18, 'sawtooth', 0.052, 0.035); noise(0.12, 0.042, 'bandpass', 1300, 0.035); },
  damage: () => { warDrum(0, 0.048); noise(0.18, 0.042, 'lowpass', 520, 0.02); sweep(160, 92, 0.22, 'square', 0.032, 0.04); },
  shield: () => { chord([1180, 1479, 1760], 0.08, 'sine', 0.036); sweep(900, 1500, 0.16, 'triangle', 0.026, 0.04); },
  death: () => { noise(0.26, 0.038, 'lowpass', 360); sweep(300, 82, 0.42, 'sawtooth', 0.046); tone(150, 0.34, 'sawtooth', 0.035, 0.1); },
  heal: () => { bell(660, 0, 0.03); bell(880, 0.09, 0.028); chord([523, 659, 784], 0.2, 'triangle', 0.02, 0.06); },
  tableWin: () => { warDrum(0, 0.052); [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.047, 0.08 + i * 0.08)); },
  mulligan: () => { noise(0.1, 0.022, 'highpass', 1300); chord([440, 587, 660], 0.12, 'triangle', 0.032, 0.04); },
  myTurn: () => { warDrum(0, 0.04); [523, 659, 784].forEach((f, i) => bell(f, 0.08 + i * 0.1, 0.034)); },
  victory: () => { warDrum(0, 0.06); [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.24, 'triangle', 0.054, i * 0.12)); noise(0.35, 0.018, 'highpass', 2400, 0.24); },
  defeat: () => { noise(0.34, 0.032, 'lowpass', 300); tone(220, 0.34, 'sawtooth', 0.036); tone(165, 0.58, 'sawtooth', 0.038, 0.22); sweep(180, 70, 0.56, 'sine', 0.03, 0.18); },
};

// ─── Trilha ambiente ────────────────────────────────────────────
// Cada nota é um oscilador "fire-and-forget" com stop próprio — não há
// oscilador persistente para vazar; parar = só limpar o intervalo.
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicStep = 0;
// progressão modal sombria: Am → F → Dm → E, com respiros de Éter no agudo.
const MUSIC_PROG: Array<[root: number, third: number, fifth: number, accent: number]> = [
  [110, 261.63, 329.63, 880],
  [87.31, 220, 261.63, 698.46],
  [73.42, 146.83, 220, 587.33],
  [82.41, 164.81, 246.94, 659.25],
];

function musicVoice(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  delay = 0,
): void {
  const c = ensure();
  if (!c || !musicBus) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.55, dur * 0.3));
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(musicBus);
  o.start(t);
  o.stop(t + dur + 0.04);
}

function musicPulse(delay = 0): void {
  const c = ensure();
  if (!c || !musicBus) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(92, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.24);
  g.gain.setValueAtTime(0.026, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(g);
  g.connect(musicBus);
  o.start(t);
  o.stop(t + 0.3);
}

function musicTick(): void {
  const c = ensure();
  if (!c || !musicBus || musicVol <= 0) return;
  const [root, third, fifth, accent] = MUSIC_PROG[musicStep % MUSIC_PROG.length];
  musicStep++;
  musicVoice(root, 2.4, 'sine', 0.035);
  musicVoice(third, 2.1, 'triangle', 0.021, 0.04);
  musicVoice(fifth, 2.0, 'sine', 0.018, 0.08);
  if (musicStep % 2 === 0) musicVoice(accent, 1.2, 'triangle', 0.012, 0.16);
  if (musicStep % 4 === 0) musicPulse(0.05);
}

function startMusic(): void {
  if (musicTimer != null) return;
  ensure();
  musicTick();
  musicTimer = setInterval(musicTick, 1900);
}

function stopMusic(): void {
  if (musicTimer != null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

// Retoma a trilha se o jogador já tinha música ligada de uma sessão anterior.
if (musicVol > 0) {
  // espera o 1º gesto do usuário (política de autoplay) para destravar o áudio
  try {
    const kick = () => { startMusic(); window.removeEventListener('pointerdown', kick); };
    window.addEventListener('pointerdown', kick, { once: true });
  } catch { /* SSR/teste: sem window */ }
}

// ─── API de volume (usada pelo controle de som) ─────────────────

export function getVolume(bus: Bus): number {
  return bus === 'sfx' ? sfxVol : musicVol;
}

export function setVolume(bus: Bus, v: number): void {
  const vol = clamp01(v);
  if (bus === 'sfx') {
    sfxVol = vol;
    try { localStorage.setItem('lc_vol_sfx', String(vol)); } catch { /* ignore */ }
    if (sfxBus) sfxBus.gain.value = vol;
    if (vol > 0) { ensure(); sfx.click(); } // destrava o áudio + confirma audível
  } else {
    musicVol = vol;
    try { localStorage.setItem('lc_vol_music', String(vol)); } catch { /* ignore */ }
    if (musicBus) musicBus.gain.value = vol;
    if (vol > 0) startMusic(); else stopMusic();
  }
}

// ─── Compatibilidade: API antiga de liga/desliga (mapeada no SFX) ──

export function soundOn(): boolean {
  return sfxVol > 0;
}

export function toggleSound(): boolean {
  const on = sfxVol > 0;
  setVolume('sfx', on ? 0 : DEFAULT_SFX_VOL);
  return !on;
}
