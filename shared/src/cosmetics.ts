/**
 * Cosméticos do jogador: avatares de perfil, comandantes (retrato exibido na
 * arena), cores de destaque e provocações. Fonte ÚNICA para cliente e servidor
 * — o servidor valida toda personalização contra estas listas (anti-abuso:
 * avatar/retrato vão para a tela do oponente, não podem ser texto arbitrário).
 */

/** Avatar do perfil (listas, ranking, chat). */
export const AVATARS = ['🛡️', '⚔️', '🐺', '🐉', '🏹', '🔮', '🦅', '🌙', '🐲', '👑', '🧙', '🗡️'] as const;

export interface Commander {
  /** Emoji-retrato exibido no medalhão do comandante na arena. */
  portrait: string;
  /** Cognome temático mostrado sob o nome do jogador na partida. */
  title: string;
}

/** Comandantes selecionáveis: o retrato e o título que aparecem na arena. */
export const COMMANDERS: Commander[] = [
  { portrait: '🛡️', title: 'o Guardião' },
  { portrait: '⚔️', title: 'a Lâmina' },
  { portrait: '🐉', title: 'Senhor dos Dragões' },
  { portrait: '🔮', title: 'o Arcano' },
  { portrait: '🏹', title: 'a Caçadora' },
  { portrait: '👑', title: 'o Monarca' },
  { portrait: '🧙', title: 'o Feiticeiro' },
  { portrait: '🦅', title: 'Senhor do Corvo' },
  { portrait: '🐲', title: 'o Domador' },
  { portrait: '🌙', title: 'o Andarilho' },
];

/** Paleta de cores de destaque do comandante (moldura/realce na arena). */
export const ACCENTS = ['#e3b341', '#4d8dff', '#3fb950', '#b083f0', '#f85149', '#3fd3c6'] as const;

export const DEFAULT_COMMANDER = '🛡️';
export const DEFAULT_ACCENT = '#e3b341';

export interface Taunt {
  id: string;
  text: string;
}

/** Provocações rápidas disparadas na arena (entram no chat da partida). */
export const TAUNTS: Taunt[] = [
  { id: 'gg', text: '🤝 Boa partida!' },
  { id: 'fire', text: '🔥 Tô pegando fogo!' },
  { id: 'ouch', text: '😱 Essa doeu!' },
  { id: 'plan', text: '🎯 Tudo calculado.' },
  { id: 'thatall', text: '😎 É só isso?' },
  { id: 'hurry', text: '⏳ Acelera aí!' },
  { id: 'kneel', text: '👑 Ajoelha.' },
  { id: 'lol', text: '😂 kkkk' },
];

/** Título do comandante associado a um retrato (para exibição na arena). */
export function commanderTitle(portrait: string | undefined): string | null {
  return COMMANDERS.find((c) => c.portrait === portrait)?.title ?? null;
}

export function isValidAvatar(v: string): boolean {
  return (AVATARS as readonly string[]).includes(v);
}
export function isValidCommander(v: string): boolean {
  return COMMANDERS.some((c) => c.portrait === v);
}
export function isValidAccent(v: string): boolean {
  return (ACCENTS as readonly string[]).includes(v);
}
