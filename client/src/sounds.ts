/**
 * Efeitos sonoros sintetizados via WebAudio — zero assets, latência mínima.
 * Dois barramentos de volume independentes e persistidos — SFX e música — para
 * o jogador dosar cada um; som nunca pode atrapalhar a partida (princípio de
 * game feel: feedback, não ruído). A música é opt-in (volume 0 por padrão).
 */

export type Bus = 'sfx' | 'music';

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;

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
let sfxVol = loadVol('lc_vol_sfx', legacyOff ? 0 : 0.8);
let musicVol = loadVol('lc_vol_music', 0);

/** Garante o contexto + os dois barramentos (lazy: só no 1º som/gesto). */
function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      musicBus.gain.value = musicVol;
      sfxBus.connect(ctx.destination);
      musicBus.connect(ctx.destination);
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

export const sfx = {
  click: () => tone(420, 0.05, 'triangle', 0.03),
  error: () => { tone(140, 0.12, 'square', 0.04); tone(110, 0.16, 'square', 0.035, 0.07); },
  tick: () => tone(880, 0.04, 'sine', 0.035),
  reveal: () => { tone(440, 0.08, 'triangle', 0.04); tone(587, 0.1, 'triangle', 0.035, 0.07); },
  draw: () => { tone(620, 0.06, 'triangle', 0.03); tone(820, 0.07, 'triangle', 0.025, 0.05); },
  energyUp: () => { tone(523, 0.07, 'triangle', 0.035); tone(784, 0.1, 'triangle', 0.03, 0.06); },
  play: () => { tone(520, 0.08); tone(780, 0.1, 'triangle', 0.04, 0.06); },
  summon: () => { tone(330, 0.1, 'triangle', 0.05); tone(495, 0.12, 'triangle', 0.04, 0.08); },
  buff: () => { tone(392, 0.09, 'triangle', 0.04); tone(587, 0.11, 'triangle', 0.035, 0.06); tone(784, 0.12, 'triangle', 0.03, 0.12); },
  attack: () => { tone(190, 0.1, 'sawtooth', 0.06); tone(120, 0.16, 'sawtooth', 0.05, 0.05); },
  damage: () => tone(140, 0.18, 'square', 0.045),
  shield: () => { tone(1180, 0.06, 'sine', 0.05); tone(1760, 0.05, 'sine', 0.035, 0.04); },
  death: () => { tone(300, 0.16, 'sawtooth', 0.05); tone(150, 0.3, 'sawtooth', 0.045, 0.06); },
  heal: () => { tone(660, 0.1, 'triangle', 0.04); tone(880, 0.12, 'triangle', 0.035, 0.08); },
  tableWin: () => [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.08)),
  mulligan: () => { tone(440, 0.08, 'triangle', 0.04); tone(660, 0.1, 'triangle', 0.035, 0.07); },
  myTurn: () => { tone(523, 0.1, 'triangle', 0.05); tone(659, 0.1, 'triangle', 0.05, 0.1); tone(784, 0.16, 'triangle', 0.05, 0.2); },
  victory: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.06, i * 0.14)),
  defeat: () => { tone(220, 0.3, 'sawtooth', 0.04); tone(165, 0.5, 'sawtooth', 0.04, 0.22); },
};

// ─── Trilha ambiente (opt-in, volume 0 por padrão) ──────────────
// Cada nota é um oscilador "fire-and-forget" com stop próprio — não há
// oscilador persistente para vazar; parar = só limpar o intervalo.
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicStep = 0;
// pad suave em lá menor — notas longas que se sobrepõem
const MUSIC_PROG = [220, 261.63, 329.63, 261.63, 196, 246.94, 293.66, 246.94];

function musicTick(): void {
  const c = ensure();
  if (!c || !musicBus || musicVol <= 0) return;
  const base = MUSIC_PROG[musicStep % MUSIC_PROG.length];
  musicStep++;
  const layers: Array<[mult: number, vol: number]> = [[1, 0.03], [2, 0.018], [1.5, 0.012]];
  for (const [mult, vol] of layers) {
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = base * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.7);
    o.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + 1.8);
  }
}

function startMusic(): void {
  if (musicTimer != null) return;
  ensure();
  musicTick();
  musicTimer = setInterval(musicTick, 1500);
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
  setVolume('sfx', on ? 0 : 0.8);
  return !on;
}
