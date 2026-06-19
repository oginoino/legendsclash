/**
 * Catálogo de cartas e deck padrão do MVP.
 *
 * Por decisão de produto (slide "O que fica fora do MVP"), não há deck builder:
 * todos os jogadores usam o mesmo deck padrão balanceado, isolando a variável
 * "a mecânica é divertida?" durante a validação.
 */

export type CardType = 'creature' | 'spell' | 'artifact' | 'tactic';

/** Raridade — só apresentação (gema/moldura da carta); sem efeito de regra. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  rarity: Rarity;
  text: string;
  /** Arte da carta (emoji) — placeholder até a direção de arte do beta */
  art: string;
  /** Apenas criaturas */
  attack?: number;
  health?: number;
  /** Se a carta exige alvo ao ser jogada */
  target?: 'enemy-creature' | 'friendly-creature' | 'enemy-any' | 'none';
  /**
   * Palavras-chave de regra:
   * - `taunt` (Provocar): inimigos devem atacá-la primeiro.
   * - `charge` (Investida): pode atacar no turno em que entra.
   * - `battlecry` (Grito de Batalha): dispara um efeito ao ser invocada.
   * - `deathrattle` (Estertor): dispara um efeito ao ser destruída.
   * - `comeback` (Resistência): ganha +2/+2 e Investida enquanto o dono tem ≤10 de vida.
   */
  keywords?: Array<'taunt' | 'charge' | 'battlecry' | 'deathrattle' | 'comeback'>;
  /**
   * Efeito especial de dano direto: ignora a proteção das criaturas e pode
   * mirar o comandante mesmo com a mesa inimiga ocupada. Nenhuma carta do
   * deck padrão usa o flag — é espaço de design para expansões.
   */
  pierce?: boolean;
  /**
   * Token concedido por uma mecânica (ex.: a "moeda" de quem joga depois): não
   * faz parte do baralho nem do catálogo colecionável — fica fora do Arquivo/Codex.
   */
  token?: boolean;
}

/**
 * Glossário de palavras-chave: rótulo curto (chip) + explicação em uma frase
 * (tooltip). Fonte única para CardView, CodexView e os tooltips em jogo —
 * antes os rótulos viviam duplicados em dois componentes do cliente.
 */
export const KEYWORD_GLOSSARY: Record<string, { label: string; desc: string }> = {
  taunt: { label: '🛡 Provocar', desc: 'Inimigos precisam atacar esta criatura antes das outras.' },
  charge: { label: '⚡ Investida', desc: 'Pode atacar já no turno em que entra em jogo.' },
  battlecry: { label: '📣 Grito de Batalha', desc: 'Dispara um efeito ao ser jogada da mão.' },
  deathrattle: { label: '💀 Estertor', desc: 'Dispara um efeito quando é destruída.' },
  comeback: { label: '🔥 Resistência', desc: 'Ganha +2 de ataque e Investida enquanto seu comandante tem 10 de vida ou menos.' },
};

export function keywordLabel(k: string): string {
  return KEYWORD_GLOSSARY[k]?.label ?? k;
}
export function keywordDesc(k: string): string {
  return KEYWORD_GLOSSARY[k]?.desc ?? '';
}

export const CARDS: Record<string, CardDef> = {
  // ─── Criaturas ────────────────────────────────────────────────
  c_recruta: {
    id: 'c_recruta', art: '🪖', name: 'Recruta da Vanguarda', type: 'creature', cost: 1, rarity: 'common',
    attack: 1, health: 2, target: 'none',
    text: 'Um soldado leal, sempre o primeiro na linha de frente.',
  },
  c_lobo: {
    id: 'c_lobo', art: '🐺', name: 'Lobo das Sombras', type: 'creature', cost: 2, rarity: 'common',
    attack: 3, health: 2, target: 'none',
    text: 'Rápido e letal, mas frágil sob luz direta.',
  },
  c_arqueira: {
    id: 'c_arqueira', art: '🏹', name: 'Arqueira Élfica', type: 'creature', cost: 2, rarity: 'common',
    attack: 2, health: 3, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: dispara 1 de dano numa criatura inimiga. Nunca erra duas vezes o mesmo alvo.',
  },
  c_cavaleiro: {
    id: 'c_cavaleiro', art: '⚔️', name: 'Cavaleiro de Ferro', type: 'creature', cost: 3, rarity: 'rare',
    attack: 3, health: 4, target: 'none', keywords: ['deathrattle'],
    text: 'Estertor: um Recruta da Vanguarda toma seu lugar na linha. Sua armadura já atravessou três guerras.',
  },
  c_golem: {
    id: 'c_golem', art: '🗿', name: 'Golem de Pedra', type: 'creature', cost: 4, rarity: 'rare',
    attack: 3, health: 6, target: 'none', keywords: ['taunt'],
    text: 'Provocar: enquanto estiver na mesa, inimigos precisam atacá-lo primeiro.',
  },
  c_campea: {
    id: 'c_campea', art: '🌟', name: 'Campeã da Aurora', type: 'creature', cost: 5, rarity: 'epic',
    attack: 5, health: 5, target: 'none',
    text: 'Onde ela avança, a linha inimiga recua.',
  },
  c_dragao: {
    id: 'c_dragao', art: '🐉', name: 'Dragão Cinzento', type: 'creature', cost: 7, rarity: 'legendary',
    attack: 7, health: 7, target: 'none', keywords: ['charge'],
    text: 'Investida: pode atacar no turno em que entra. A última carta que muitos comandantes viram.',
  },
  c_renegado: {
    id: 'c_renegado', art: '🗡️', name: 'Renegado Ferido', type: 'creature', cost: 2, rarity: 'rare',
    attack: 2, health: 3, target: 'none', keywords: ['comeback'],
    text: 'Resistência: com o comandante em 10 de vida ou menos, ganha +2 de ataque e Investida. A dor o aguça.',
  },

  // ─── Magias ───────────────────────────────────────────────────
  s_faisca: {
    id: 's_faisca', art: '⚡', name: 'Faísca', type: 'spell', cost: 1, rarity: 'common',
    target: 'enemy-any',
    text: 'Causa 2 de dano a uma criatura inimiga ou ao comandante inimigo.',
  },
  s_bola_de_fogo: {
    id: 's_bola_de_fogo', art: '🔥', name: 'Bola de Fogo', type: 'spell', cost: 4, rarity: 'rare',
    target: 'enemy-any', pierce: true,
    text: 'Causa 5 de dano a uma criatura inimiga — ou direto ao comandante, atravessando as defesas.',
  },
  s_bencao: {
    id: 's_bencao', art: '💖', name: 'Bênção Vital', type: 'spell', cost: 2, rarity: 'common',
    target: 'none',
    text: 'Restaura 4 de vida ao seu comandante (máx. 30).',
  },
  s_fortalecer: {
    id: 's_fortalecer', art: '💪', name: 'Fortalecer', type: 'spell', cost: 2, rarity: 'common',
    target: 'friendly-creature',
    text: 'Uma criatura aliada ganha +2/+2.',
  },
  s_tempestade: {
    id: 's_tempestade', art: '⛈️', name: 'Tempestade', type: 'spell', cost: 4, rarity: 'epic',
    target: 'none',
    text: 'Causa 2 de dano a todas as criaturas inimigas. Pune tabuleiros lotados.',
  },

  // ─── Artefatos ────────────────────────────────────────────────
  a_escudo: {
    id: 'a_escudo', art: '🛡️', name: 'Escudo de Aço', type: 'artifact', cost: 2, rarity: 'rare',
    target: 'none',
    text: 'Seu comandante ganha 4 de escudo (absorve dano antes da vida).',
  },
  a_estandarte: {
    id: 'a_estandarte', art: '🚩', name: 'Estandarte de Guerra', type: 'artifact', cost: 3, rarity: 'epic',
    target: 'none',
    text: 'Permanente: suas criaturas atacam com +1 de ataque.',
  },

  // ─── Táticas ──────────────────────────────────────────────────
  t_reforcos: {
    id: 't_reforcos', art: '📜', name: 'Reforços', type: 'tactic', cost: 2, rarity: 'common',
    target: 'none',
    text: 'Compre 2 cartas.',
  },
  t_surto: {
    id: 't_surto', art: '🔋', name: 'Surto de Energia', type: 'tactic', cost: 1, rarity: 'rare',
    target: 'none',
    text: 'Ganhe 2 de energia neste turno.',
  },
  t_recuo: {
    id: 't_recuo', art: '🌀', name: 'Recuo Tático', type: 'tactic', cost: 3, rarity: 'epic',
    target: 'enemy-creature',
    text: 'Devolve uma criatura inimiga à mão do dono.',
  },

  // ─── Token (concedido por mecânica, fora do baralho) ───────────
  t_moeda: {
    id: 't_moeda', art: '🪙', name: 'Moeda do Tempo', type: 'tactic', cost: 0, rarity: 'common',
    target: 'none', token: true,
    text: 'Ganhe 1 de energia neste turno. Compensa a iniciativa de quem joga primeiro.',
  },
};

/** Composição do deck padrão: 30 cartas (slide "Conceito e condições de vitória"). */
export const DEFAULT_DECK: Array<[cardId: string, copies: number]> = [
  ['c_recruta', 3],
  ['c_lobo', 3],
  ['c_arqueira', 3],
  ['c_cavaleiro', 3],
  ['c_golem', 2],
  ['c_campea', 2],
  ['c_dragao', 1],
  ['s_faisca', 2],
  ['s_bola_de_fogo', 2],
  ['s_bencao', 1],
  ['s_fortalecer', 2],
  ['s_tempestade', 1],
  ['a_escudo', 1],
  ['a_estandarte', 1],
  ['t_reforcos', 1],
  ['t_surto', 1],
  ['t_recuo', 1],
];

export const DECK_SIZE = 30;
export const STARTING_HP = 30;
export const MAX_ENERGY = 10;
export const MAX_HAND = 10;
export const MAX_BOARD = 6;
export const STARTING_HAND = 4;
export const TURN_SECONDS = 60;
export const RECONNECT_GRACE_MS = 2 * 60 * 1000; // janela anti-abandono de 2 min

// ─── Fase 6: variedade de conteúdo (atrás de flags + playtest) ──
// Tudo simétrico (ambos têm acesso), sem poder novo: troca CÓPIAS de cartas
// existentes. Ativado só por env flag — o balance fino é gate de playtest.

export interface DeckSwap { remove: string; add: string; }

/** Inclinações de facção: ~2 trocas que mudam o "sabor" sem mexer no tamanho. */
export const FACTION_TILTS: Record<string, DeckSwap[]> = {
  vanguarda: [{ remove: 's_faisca', add: 'c_recruta' }, { remove: 't_recuo', add: 'c_cavaleiro' }],
  silvanos: [{ remove: 's_bencao', add: 'c_lobo' }, { remove: 'a_escudo', add: 'c_arqueira' }],
  eter: [{ remove: 'c_recruta', add: 's_faisca' }, { remove: 'a_estandarte', add: 's_tempestade' }],
  profundezas: [{ remove: 'c_lobo', add: 'c_golem' }, { remove: 'c_recruta', add: 'a_escudo' }],
};

function applySwaps(base: Array<[string, number]>, swaps: DeckSwap[]): Array<[string, number]> {
  const counts = new Map<string, number>(base.map(([id, n]) => [id, n]));
  for (const { remove, add } of swaps) {
    const have = counts.get(remove) ?? 0;
    if (have <= 0) continue; // nada a remover → ignora (preserva o tamanho do deck)
    counts.set(remove, have - 1);
    counts.set(add, (counts.get(add) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 0);
}

/** Composição do deck para uma facção (+ carta de Resistência opcional). Sempre 30. */
export function deckComposition(factionId?: string, includeComeback = false): Array<[string, number]> {
  const swaps: DeckSwap[] = [];
  if (factionId && FACTION_TILTS[factionId]) swaps.push(...FACTION_TILTS[factionId]);
  if (includeComeback) swaps.push({ remove: 'c_recruta', add: 'c_renegado' });
  return swaps.length ? applySwaps(DEFAULT_DECK, swaps) : DEFAULT_DECK;
}

/** Carta em destaque do dia (cosmético, determinístico) — gancho de retorno. */
export const CARD_OF_DAY_POOL = [
  'c_recruta', 'c_lobo', 'c_arqueira', 'c_cavaleiro', 'c_golem', 'c_campea', 'c_dragao',
  's_faisca', 's_bola_de_fogo', 's_fortalecer', 's_tempestade', 'a_escudo',
];
export function cardOfDay(nowMs: number): string {
  const day = Math.floor(nowMs / 86_400_000);
  const n = CARD_OF_DAY_POOL.length;
  return CARD_OF_DAY_POOL[((day % n) + n) % n];
}
