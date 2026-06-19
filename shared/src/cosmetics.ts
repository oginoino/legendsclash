/**
 * Cosméticos do jogador: avatares de perfil, comandantes (retrato exibido na
 * arena), cores/estilos de destaque, molduras e provocações. Fonte ÚNICA para
 * cliente e servidor — o servidor valida toda personalização contra estas
 * listas (anti-abuso: avatar/retrato vão para a tela do oponente, não podem ser
 * texto arbitrário).
 *
 * IMPORTANTE: este pacote é agnóstico de framework (o servidor o importa). Aqui
 * ficam só IDS e metadados; o mapa id→ícone (react-icons/gi) vive no cliente.
 * Avatares e comandantes são identificados por IDS ESTÁVEIS (ex.: 'shield'),
 * não mais por emoji — `LEGACY_ICON_MAP` converte valores antigos já gravados.
 */

export interface AvatarDef {
  /** Id estável do ícone (resolvido para um SVG no cliente). */
  id: string;
  /** Rótulo curto (acessibilidade / tooltip). */
  label: string;
  /** Conquista que o desbloqueia (ausente = sempre liberado). */
  unlockReq?: string;
}

/** Avatar do perfil (listas, ranking, chat). */
export const AVATARS: AvatarDef[] = [
  { id: 'shield', label: 'Escudo' },
  { id: 'crossed-swords', label: 'Espadas Cruzadas' },
  { id: 'wolf', label: 'Lobo' },
  { id: 'dragon', label: 'Dragão' },
  { id: 'bow', label: 'Arco' },
  { id: 'orb', label: 'Orbe' },
  { id: 'eagle', label: 'Águia' },
  { id: 'moon', label: 'Lua' },
  { id: 'dragon-spirit', label: 'Espírito Dragão' },
  { id: 'crown', label: 'Coroa' },
  { id: 'wizard', label: 'Mago' },
  { id: 'dagger', label: 'Adaga' },
];

export interface Commander {
  /** Id do ícone-retrato exibido no medalhão do comandante na arena. */
  id: string;
  /** Cognome temático mostrado sob o nome do jogador na partida. */
  title: string;
}

/** Comandantes selecionáveis: o retrato (id de ícone) e o título na arena. */
export const COMMANDERS: Commander[] = [
  { id: 'shield', title: 'o Guardião' },
  { id: 'crossed-swords', title: 'a Lâmina' },
  { id: 'dragon', title: 'Senhor dos Dragões' },
  { id: 'orb', title: 'o Arcano' },
  { id: 'bow', title: 'a Caçadora' },
  { id: 'crown', title: 'o Monarca' },
  { id: 'wizard', title: 'o Feiticeiro' },
  { id: 'eagle', title: 'Senhor do Corvo' },
  { id: 'dragon-spirit', title: 'o Domador' },
  { id: 'moon', title: 'o Andarilho' },
];

/**
 * Mapa de legado: valores antigos (emoji) já gravados no banco/snapshot são
 * convertidos para os ids estáveis na carga. Avatar e comandante compartilham o
 * mesmo espaço de ids de ícone, então um único mapa atende aos dois.
 */
export const LEGACY_ICON_MAP: Record<string, string> = {
  '🛡️': 'shield',
  '⚔️': 'crossed-swords',
  '🐺': 'wolf',
  '🐉': 'dragon',
  '🏹': 'bow',
  '🔮': 'orb',
  '🦅': 'eagle',
  '🌙': 'moon',
  '🐲': 'dragon-spirit',
  '👑': 'crown',
  '🧙': 'wizard',
  '🗡️': 'dagger',
  '🤖': 'robot',
};

/** Converte um valor de ícone legado (emoji) no id estável; ids passam direto. */
export function normalizeIconId(v: string | undefined | null): string {
  if (!v) return DEFAULT_AVATAR;
  return LEGACY_ICON_MAP[v] ?? v;
}

/** Paleta de cores de destaque do comandante (cor-base do realce na arena). */
export const ACCENTS = ['#e3b341', '#4d8dff', '#3fb950', '#b083f0', '#f85149', '#3fd3c6'] as const;

export const DEFAULT_AVATAR = 'shield';
export const DEFAULT_COMMANDER = 'shield';
export const DEFAULT_ACCENT = '#e3b341';

// ─── Molduras (armações decorativas sobre o avatar/retrato) ───────

export interface FrameDef {
  id: string;
  label: string;
  unlockReq?: string;
}

/** Armações: 'none' = sem moldura. As demais decoram o medalhão/retrato. */
export const FRAMES: FrameDef[] = [
  { id: 'none', label: 'Sem moldura' },
  { id: 'gilded', label: 'Dourada' },
  { id: 'laurel', label: 'Louros' },
  { id: 'runes', label: 'Runas' },
  { id: 'arcane', label: 'Arcana' },
  { id: 'dragon', label: 'Dracônica' },
];

export const DEFAULT_FRAME = 'none';

/** Moldura → conquista que a desbloqueia. */
export const FRAME_UNLOCKS: Record<string, string> = {
  runes: 'veteran_10',
  arcane: 'winner_10',
  dragon: 'veteran_50',
};

// ─── Estilos de cor (gradientes e brilhos) ────────────────────────

export interface AccentStyleDef {
  id: string;
  label: string;
  /** Par de cores do gradiente; null = cor sólida (usa o `accent` escolhido). */
  gradient: [string, string] | null;
  /** Intensidade do brilho (0–1) aplicada ao realce. */
  glow: number;
  unlockReq?: string;
}

/** Estilos de realce: sólido (compat) + gradientes/brilhos sofisticados. */
export const ACCENT_STYLES: AccentStyleDef[] = [
  { id: 'solid', label: 'Sólida', gradient: null, glow: 0.6 },
  { id: 'aurora', label: 'Aurora', gradient: ['#4d8dff', '#3fd3c6'], glow: 0.85 },
  { id: 'frost', label: 'Gélido', gradient: ['#3fd3c6', '#b083f0'], glow: 0.8 },
  { id: 'ember', label: 'Brasa', gradient: ['#f85149', '#e3b341'], glow: 0.9, unlockReq: 'veteran_10' },
  { id: 'void', label: 'Abissal', gradient: ['#b083f0', '#4d8dff'], glow: 1, unlockReq: 'veteran_50' },
];

export const DEFAULT_ACCENT_STYLE = 'solid';

/** Estilo de cor → conquista que o desbloqueia (derivado de ACCENT_STYLES). */
export const ACCENT_STYLE_UNLOCKS: Record<string, string> = Object.fromEntries(
  ACCENT_STYLES.filter((s) => s.unlockReq).map((s) => [s.id, s.unlockReq!]),
);

export function accentStyleDef(id: string | undefined): AccentStyleDef {
  return ACCENT_STYLES.find((s) => s.id === id) ?? ACCENT_STYLES[0];
}

export interface Taunt {
  id: string;
  /** Conceito de ícone (resolvido para um Game Icon no cliente). */
  icon: string;
  /** Texto enviado ao chat (sem emoji — o ícone fica no botão do picker). */
  text: string;
}

/** Provocações rápidas disparadas na arena (entram no chat da partida). */
export const TAUNTS: Taunt[] = [
  { id: 'gg', icon: 'handshake', text: 'Boa partida!' },
  { id: 'fire', icon: 'flame', text: 'Tô pegando fogo!' },
  { id: 'ouch', icon: 'ouch', text: 'Essa doeu!' },
  { id: 'plan', icon: 'target', text: 'Tudo calculado.' },
  { id: 'thatall', icon: 'cool', text: 'É só isso?' },
  { id: 'hurry', icon: 'hourglass', text: 'Acelera aí!' },
  { id: 'kneel', icon: 'crown', text: 'Ajoelha.' },
  { id: 'lol', icon: 'party', text: 'kkkk' },
];

// ─── Conquistas e desbloqueio por mérito ────────────────────────
// Progressão por hábito/habilidade, NUNCA por pagamento (pilar "sem pay-to-win").
// As conquistas derivam de estatísticas MONOTÔNICAS (vitórias e nº de partidas,
// que só crescem) — logo os desbloqueios são permanentes sem persistência extra.

export interface Achievement {
  id: string;
  label: string;
  /** Como conquistar (texto curto para a UI). */
  how: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', label: 'Primeira Vitória', how: 'Vença 1 partida' },
  { id: 'veteran_10', label: 'Veterano', how: 'Jogue 10 partidas' },
  { id: 'winner_10', label: 'Conquistador', how: 'Vença 10 partidas' },
  { id: 'veteran_50', label: 'Lenda da Arena', how: 'Jogue 50 partidas' },
];

/** Conquistas já obtidas, derivadas de vitórias e nº de partidas (monotônicas). */
export function achievementsOf(wins: number, games: number): string[] {
  const earned: string[] = [];
  if (wins >= 1) earned.push('first_win');
  if (games >= 10) earned.push('veteran_10');
  if (wins >= 10) earned.push('winner_10');
  if (games >= 50) earned.push('veteran_50');
  return earned;
}

export function achievementLabel(id: string): string {
  return ACHIEVEMENTS.find((a) => a.id === id)?.label ?? id;
}

/** Comandante → conquista que o desbloqueia (ausente da lista = sempre liberado). */
export const COMMANDER_UNLOCKS: Record<string, string> = {
  crown: 'winner_10', // o Monarca
  'dragon-spirit': 'veteran_50', // o Domador
};
/** Cor de destaque → conquista que a desbloqueia. */
export const ACCENT_UNLOCKS: Record<string, string> = {
  '#3fd3c6': 'veteran_10',
};

export function commanderUnlocked(id: string, earned: string[]): boolean {
  const req = COMMANDER_UNLOCKS[id];
  return !req || earned.includes(req);
}
export function accentUnlocked(accent: string, earned: string[]): boolean {
  const req = ACCENT_UNLOCKS[accent];
  return !req || earned.includes(req);
}
export function frameUnlocked(frame: string, earned: string[]): boolean {
  const req = FRAME_UNLOCKS[frame];
  return !req || earned.includes(req);
}
export function accentStyleUnlocked(style: string, earned: string[]): boolean {
  const req = ACCENT_STYLE_UNLOCKS[style];
  return !req || earned.includes(req);
}

/**
 * Progresso rumo a uma conquista (para barras "7/10 vitórias"). Retorna null
 * quando já obtida ou desconhecida. Mesma fonte de verdade do `achievementsOf`.
 */
export function achievementProgress(
  id: string,
  wins: number,
  games: number,
): { current: number; target: number } | null {
  switch (id) {
    case 'first_win': return wins >= 1 ? null : { current: wins, target: 1 };
    case 'winner_10': return wins >= 10 ? null : { current: wins, target: 10 };
    case 'veteran_10': return games >= 10 ? null : { current: games, target: 10 };
    case 'veteran_50': return games >= 50 ? null : { current: games, target: 50 };
    default: return null;
  }
}

export type CosmeticTier = 'common' | 'rare' | 'legendary';

/** Tier de prestígio de um cosmético, derivado da conquista que o desbloqueia. */
export function cosmeticTier(req: string | undefined): CosmeticTier {
  if (!req) return 'common';
  if (req === 'veteran_50') return 'legendary';
  return 'rare'; // winner_10, veteran_10 etc.
}

/** Título do comandante associado a um id de retrato (para exibição na arena). */
export function commanderTitle(id: string | undefined): string | null {
  return COMMANDERS.find((c) => c.id === normalizeIconId(id))?.title ?? null;
}

export function isValidAvatar(v: string): boolean {
  const id = normalizeIconId(v);
  return AVATARS.some((a) => a.id === id);
}
export function isValidCommander(v: string): boolean {
  const id = normalizeIconId(v);
  return COMMANDERS.some((c) => c.id === id);
}
export function isValidAccent(v: string): boolean {
  return (ACCENTS as readonly string[]).includes(v);
}
export function isValidFrame(v: string): boolean {
  return FRAMES.some((f) => f.id === v);
}
export function isValidAccentStyle(v: string): boolean {
  return ACCENT_STYLES.some((s) => s.id === v);
}
