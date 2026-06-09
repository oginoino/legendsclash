/**
 * Efeitos sonoros sintetizados via WebAudio — zero assets, latência mínima.
 * Volume baixo por padrão e toggle persistido; som nunca pode atrapalhar a
 * partida (princípio de game feel: feedback, não ruído).
 */

let ctx: AudioContext | null = null;
let enabled = localStorage.getItem('lc_sound') !== 'off';

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  dur = 0.12,
  type: OscillatorType = 'triangle',
  vol = 0.05,
  delay = 0,
): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  click: () => tone(420, 0.05, 'triangle', 0.03),
  error: () => { tone(140, 0.12, 'square', 0.04); tone(110, 0.16, 'square', 0.035, 0.07); },
  tick: () => tone(880, 0.04, 'sine', 0.035),
  reveal: () => { tone(440, 0.08, 'triangle', 0.04); tone(587, 0.1, 'triangle', 0.035, 0.07); },
  draw: () => tone(660, 0.07, 'triangle', 0.03),
  play: () => { tone(520, 0.08); tone(780, 0.1, 'triangle', 0.04, 0.06); },
  summon: () => { tone(330, 0.1, 'triangle', 0.05); tone(495, 0.12, 'triangle', 0.04, 0.08); },
  attack: () => { tone(190, 0.1, 'sawtooth', 0.06); tone(120, 0.16, 'sawtooth', 0.05, 0.05); },
  damage: () => tone(140, 0.18, 'square', 0.045),
  heal: () => { tone(660, 0.1, 'triangle', 0.04); tone(880, 0.12, 'triangle', 0.035, 0.08); },
  myTurn: () => { tone(523, 0.1, 'triangle', 0.05); tone(659, 0.1, 'triangle', 0.05, 0.1); tone(784, 0.16, 'triangle', 0.05, 0.2); },
  victory: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.06, i * 0.14)),
  defeat: () => { tone(220, 0.3, 'sawtooth', 0.04); tone(165, 0.5, 'sawtooth', 0.04, 0.22); },
};

export function soundOn(): boolean {
  return enabled;
}

export function toggleSound(): boolean {
  enabled = !enabled;
  localStorage.setItem('lc_sound', enabled ? 'on' : 'off');
  if (enabled) sfx.click();
  return enabled;
}
