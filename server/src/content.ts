/**
 * Flags de conteúdo variável (Fase 6) — DARK LAUNCH: tudo OFF por padrão.
 * Ligar só após playtest + checagem de winrate (~50%) sobre a tabela `events`.
 * Em prod, defina LC_FACTIONS=1 / LC_COMEBACK=1 para ativar.
 */
export const contentFlags = {
  /** Decks inclinados por facção (escolha do jogador, simétrica e às cegas). */
  factions: process.env.LC_FACTIONS === '1',
  /** Carta de Resistência (keyword comeback) entra no deck dos dois. */
  comeback: process.env.LC_COMEBACK === '1',
};
