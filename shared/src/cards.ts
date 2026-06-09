/**
 * Catálogo de cartas e deck padrão do MVP.
 *
 * Por decisão de produto (slide "O que fica fora do MVP"), não há deck builder:
 * todos os jogadores usam o mesmo deck padrão balanceado, isolando a variável
 * "a mecânica é divertida?" durante a validação.
 */

export type CardType = 'creature' | 'spell' | 'artifact' | 'tactic';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  text: string;
  /** Arte da carta (emoji) — placeholder até a direção de arte do beta */
  art: string;
  /** Apenas criaturas */
  attack?: number;
  health?: number;
  /** Se a carta exige alvo ao ser jogada */
  target?: 'enemy-creature' | 'friendly-creature' | 'enemy-any' | 'none';
}

export const CARDS: Record<string, CardDef> = {
  // ─── Criaturas ────────────────────────────────────────────────
  c_recruta: {
    id: 'c_recruta', art: '🪖', name: 'Recruta da Vanguarda', type: 'creature', cost: 1,
    attack: 1, health: 2, target: 'none',
    text: 'Um soldado leal, sempre o primeiro na linha de frente.',
  },
  c_lobo: {
    id: 'c_lobo', art: '🐺', name: 'Lobo das Sombras', type: 'creature', cost: 2,
    attack: 3, health: 2, target: 'none',
    text: 'Rápido e letal, mas frágil sob luz direta.',
  },
  c_arqueira: {
    id: 'c_arqueira', art: '🏹', name: 'Arqueira Élfica', type: 'creature', cost: 2,
    attack: 2, health: 3, target: 'none',
    text: 'Nunca erra duas vezes o mesmo alvo.',
  },
  c_cavaleiro: {
    id: 'c_cavaleiro', art: '⚔️', name: 'Cavaleiro de Ferro', type: 'creature', cost: 3,
    attack: 3, health: 4, target: 'none',
    text: 'Sua armadura já atravessou três guerras.',
  },
  c_golem: {
    id: 'c_golem', art: '🗿', name: 'Golem de Pedra', type: 'creature', cost: 4,
    attack: 3, health: 6, target: 'none',
    text: 'Lento, paciente e praticamente indestrutível.',
  },
  c_campea: {
    id: 'c_campea', art: '🌟', name: 'Campeã da Aurora', type: 'creature', cost: 5,
    attack: 5, health: 5, target: 'none',
    text: 'Onde ela avança, a linha inimiga recua.',
  },
  c_dragao: {
    id: 'c_dragao', art: '🐉', name: 'Dragão Cinzento', type: 'creature', cost: 7,
    attack: 7, health: 7, target: 'none',
    text: 'A última carta que muitos comandantes viram.',
  },

  // ─── Magias ───────────────────────────────────────────────────
  s_faisca: {
    id: 's_faisca', art: '⚡', name: 'Faísca', type: 'spell', cost: 1,
    target: 'enemy-any',
    text: 'Causa 2 de dano a uma criatura inimiga ou ao comandante inimigo.',
  },
  s_bola_de_fogo: {
    id: 's_bola_de_fogo', art: '🔥', name: 'Bola de Fogo', type: 'spell', cost: 4,
    target: 'enemy-any',
    text: 'Causa 5 de dano a uma criatura inimiga ou ao comandante inimigo.',
  },
  s_bencao: {
    id: 's_bencao', art: '💖', name: 'Bênção Vital', type: 'spell', cost: 2,
    target: 'none',
    text: 'Restaura 4 de vida ao seu comandante (máx. 30).',
  },
  s_fortalecer: {
    id: 's_fortalecer', art: '💪', name: 'Fortalecer', type: 'spell', cost: 2,
    target: 'friendly-creature',
    text: 'Uma criatura aliada ganha +2/+2.',
  },

  // ─── Artefatos ────────────────────────────────────────────────
  a_escudo: {
    id: 'a_escudo', art: '🛡️', name: 'Escudo de Aço', type: 'artifact', cost: 2,
    target: 'none',
    text: 'Seu comandante ganha 4 de escudo (absorve dano antes da vida).',
  },
  a_estandarte: {
    id: 'a_estandarte', art: '🚩', name: 'Estandarte de Guerra', type: 'artifact', cost: 3,
    target: 'none',
    text: 'Permanente: suas criaturas atacam com +1 de ataque.',
  },

  // ─── Táticas ──────────────────────────────────────────────────
  t_reforcos: {
    id: 't_reforcos', art: '📜', name: 'Reforços', type: 'tactic', cost: 2,
    target: 'none',
    text: 'Compre 2 cartas.',
  },
  t_surto: {
    id: 't_surto', art: '🔋', name: 'Surto de Energia', type: 'tactic', cost: 1,
    target: 'none',
    text: 'Ganhe 2 de energia neste turno.',
  },
  t_recuo: {
    id: 't_recuo', art: '🌀', name: 'Recuo Tático', type: 'tactic', cost: 3,
    target: 'enemy-creature',
    text: 'Devolve uma criatura inimiga à mão do dono.',
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
  ['s_bencao', 2],
  ['s_fortalecer', 2],
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
