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
   * - `lifesteal` (Drenar): o dano de combate que causa restaura a vida do dono.
   * - `ward` (Escudo Arcano): anula o primeiro dano que sofreria; depois quebra.
   */
  keywords?: Array<'taunt' | 'charge' | 'battlecry' | 'deathrattle' | 'comeback' | 'lifesteal' | 'ward'>;
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
  lifesteal: { label: '🩸 Drenar', desc: 'O dano de combate que esta criatura causa restaura a vida do seu comandante (máx. 30).' },
  ward: { label: '🔮 Escudo Arcano', desc: 'Anula o primeiro dano que esta criatura sofreria; depois o escudo se quebra.' },
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

  // ─── Criaturas — expansão "Maré Sem Rei" ──────────────────────
  // Vanguarda da Aurora (guerreiros e clérigos)
  c_escudeira: {
    id: 'c_escudeira', art: '🛡️', name: 'Escudeira de Ferro', type: 'creature', cost: 2, rarity: 'common',
    attack: 1, health: 3, target: 'none', keywords: ['taunt'],
    text: 'Provocar. O escudo é maior que ela — e ela sabe usá-lo.',
  },
  c_cleriga: {
    id: 'c_cleriga', art: '🕊️', name: 'Clériga da Aurora', type: 'creature', cost: 3, rarity: 'rare',
    attack: 2, health: 4, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: restaura 3 de vida ao seu comandante (máx. 30).',
  },
  c_templario: {
    id: 'c_templario', art: '⚒️', name: 'Templário do Amanhecer', type: 'creature', cost: 6, rarity: 'epic',
    attack: 5, health: 6, target: 'none', keywords: ['taunt'],
    text: 'Provocar. A linha que não recua, em pessoa.',
  },
  // Pacto Silvano (elfos, bardos e feras)
  c_sentinela: {
    id: 'c_sentinela', art: '🌿', name: 'Sentinela das Copas', type: 'creature', cost: 2, rarity: 'common',
    attack: 1, health: 2, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: compre 1 carta. Vê o inimigo um dia antes de ele chegar.',
  },
  c_duelista: {
    id: 'c_duelista', art: '🤺', name: 'Duelista Élfica', type: 'creature', cost: 3, rarity: 'rare',
    attack: 3, health: 2, target: 'none', keywords: ['charge'],
    text: 'Investida: pode atacar no turno em que entra. A dança termina antes de o inimigo entender que começou.',
  },
  c_bardo: {
    id: 'c_bardo', art: '🎻', name: 'Bardo da Clareira', type: 'creature', cost: 3, rarity: 'rare',
    attack: 2, health: 3, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: suas outras criaturas ganham +1/+1. A canção certa deixa qualquer exército um palmo mais alto.',
  },
  c_cervo: {
    id: 'c_cervo', art: '🦌', name: 'Cervo-Rei da Clareira', type: 'creature', cost: 5, rarity: 'epic',
    attack: 4, health: 6, target: 'none', keywords: ['taunt'],
    text: 'Provocar. Quem ameaça a clareira enfrenta primeiro a mata inteira.',
  },
  // Conclave do Éter (magos e criaturas mágicas)
  c_fada: {
    id: 'c_fada', art: '🧚', name: 'Fada Cintilante', type: 'creature', cost: 2, rarity: 'common',
    attack: 2, health: 2, target: 'none', keywords: ['deathrattle'],
    text: 'Estertor: compre 1 carta. Ao apagar, sopra um último segredo.',
  },
  c_elemental: {
    id: 'c_elemental', art: '💠', name: 'Elemental de Éter', type: 'creature', cost: 3, rarity: 'rare',
    attack: 2, health: 4, target: 'none', keywords: ['ward'],
    text: 'Escudo Arcano: anula o primeiro dano que sofreria. O primeiro golpe só quebra o reflexo.',
  },
  c_maga: {
    id: 'c_maga', art: '🪄', name: 'Maga do Conclave', type: 'creature', cost: 4, rarity: 'rare',
    attack: 3, health: 3, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: causa 2 de dano numa criatura inimiga aleatória.',
  },
  c_arquimago: {
    id: 'c_arquimago', art: '🧙', name: 'Arquimago da Fenda', type: 'creature', cost: 6, rarity: 'legendary',
    attack: 4, health: 5, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: causa 2 de dano a todas as criaturas inimigas. Faz a Fratura sangrar em miniatura.',
  },
  // Antigos das Profundezas (monstros sombrios)
  c_morcego: {
    id: 'c_morcego', art: '🦇', name: 'Morcego Abissal', type: 'creature', cost: 1, rarity: 'common',
    attack: 2, health: 1, target: 'none',
    text: 'Pequeno, faminto, incontável.',
  },
  c_cultista: {
    id: 'c_cultista', art: '🕯️', name: 'Cultista do Vazio', type: 'creature', cost: 2, rarity: 'rare',
    attack: 2, health: 2, target: 'none', keywords: ['deathrattle'],
    text: 'Estertor: causa 2 de dano aos comandantes inimigos. Morre sorrindo — a morte dele é o recado.',
  },
  c_espectro: {
    id: 'c_espectro', art: '👻', name: 'Espectro da Fenda', type: 'creature', cost: 3, rarity: 'rare',
    attack: 3, health: 3, target: 'none', keywords: ['lifesteal'],
    text: 'Drenar: o dano de combate que causa restaura a vida do seu comandante.',
  },
  c_horror: {
    id: 'c_horror', art: '🕷️', name: 'Horror Rastejante', type: 'creature', cost: 6, rarity: 'epic',
    attack: 6, health: 6, target: 'none', keywords: ['lifesteal'],
    text: 'Drenar. O que ele toma, o mestre recebe.',
  },
  // A Maré Sem Rei (piratas, sereias e monstros marinhos)
  c_grumete: {
    id: 'c_grumete', art: '⚓', name: 'Grumete Intrépido', type: 'creature', cost: 1, rarity: 'common',
    attack: 1, health: 1, target: 'none', keywords: ['charge'],
    text: 'Investida: pode atacar no turno em que entra. Pula no abalroamento antes de a prancha encostar.',
  },
  c_corsaria: {
    id: 'c_corsaria', art: '🏴‍☠️', name: 'Corsária de Salobra', type: 'creature', cost: 2, rarity: 'rare',
    attack: 2, health: 1, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: ganhe 1 de energia neste turno. Chega com um estilhaço afanado no bolso.',
  },
  c_aguaviva: {
    id: 'c_aguaviva', art: '🪼', name: 'Água-Viva Espectral', type: 'creature', cost: 2, rarity: 'rare',
    attack: 1, health: 3, target: 'none', keywords: ['deathrattle'],
    text: 'Estertor: causa 1 de dano a todas as criaturas inimigas. Estoura num clarão que queima tudo por perto.',
  },
  c_sereia: {
    id: 'c_sereia', art: '🧜‍♀️', name: 'Sereia do Recife', type: 'creature', cost: 4, rarity: 'epic',
    attack: 3, health: 4, target: 'none', keywords: ['battlecry'],
    text: 'Grito de Batalha: devolve uma criatura inimiga aleatória à mão do dono. O canto convence qualquer lenda a voltar para casa.',
  },
  c_tubarao: {
    id: 'c_tubarao', art: '🦈', name: 'Terror-de-Casco', type: 'creature', cost: 4, rarity: 'rare',
    attack: 4, health: 3, target: 'none', keywords: ['charge'],
    text: 'Investida. Sente sangue a um oceano de distância.',
  },
  c_serpente: {
    id: 'c_serpente', art: '🐍', name: 'Serpente do Abismo', type: 'creature', cost: 5, rarity: 'epic',
    attack: 5, health: 4, target: 'none', keywords: ['ward'],
    text: 'Escudo Arcano: anula o primeiro dano que sofreria. As escamas de Éter desviam o primeiro arpão.',
  },
  c_kraken: {
    id: 'c_kraken', art: '🦑', name: 'O Kraken de Salmarra', type: 'creature', cost: 7, rarity: 'legendary',
    attack: 6, health: 8, target: 'none', keywords: ['taunt', 'deathrattle'],
    text: 'Provocar. Estertor: invoca dois Tentáculos do Kraken 2/2 com Provocar. Mesmo morto, os braços continuam.',
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
  // Expansão "Maré Sem Rei"
  s_julgamento: {
    id: 's_julgamento', art: '☀️', name: 'Luz de Julgamento', type: 'spell', cost: 3, rarity: 'rare',
    target: 'enemy-creature',
    text: 'Causa 3 de dano a uma criatura inimiga e restaura 2 de vida ao seu comandante.',
  },
  s_canto: {
    id: 's_canto', art: '🎶', name: 'Canto Revigorante', type: 'spell', cost: 3, rarity: 'rare',
    target: 'none',
    text: 'Todas as suas criaturas ganham +1/+1. Cantado em coro, o refrão vira armadura.',
  },
  s_lanca_gelo: {
    id: 's_lanca_gelo', art: '🧊', name: 'Lança de Gelo', type: 'spell', cost: 2, rarity: 'common',
    target: 'enemy-creature',
    text: 'Causa 3 de dano a uma criatura inimiga. Feita para caçar lendas, não comandantes.',
  },
  s_pacto: {
    id: 's_pacto', art: '🩸', name: 'Pacto Sombrio', type: 'spell', cost: 3, rarity: 'epic',
    target: 'none',
    text: 'Compre 3 cartas e seu comandante perde 3 de vida (o escudo não protege). O Vazio empresta — e cobra na hora.',
  },
  s_maremoto: {
    id: 's_maremoto', art: '🌊', name: 'Maremoto', type: 'spell', cost: 6, rarity: 'epic',
    target: 'none',
    text: 'Causa 3 de dano a todas as criaturas inimigas. O mar cobra de uma vez o que a costa devia.',
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
  // Expansão "Maré Sem Rei"
  a_relicario: {
    id: 'a_relicario', art: '🏺', name: 'Relicário da Aurora', type: 'artifact', cost: 3, rarity: 'epic',
    target: 'none',
    text: 'Permanente: restaura 1 de vida ao seu comandante no início do seu turno (máx. 30).',
  },
  a_orbe: {
    id: 'a_orbe', art: '🔮', name: 'Orbe de Éter', type: 'artifact', cost: 3, rarity: 'epic',
    target: 'none',
    text: 'Permanente: suas magias de dano causam +1 de dano.',
  },
  a_figura: {
    id: 'a_figura', art: '⛵', name: 'Figura de Proa: Sereia', type: 'artifact', cost: 3, rarity: 'epic',
    target: 'none',
    text: 'Permanente: seu comandante ganha 1 de escudo no início do seu turno (máx. 10 de escudo).',
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
  // Expansão "Maré Sem Rei"
  t_matilha: {
    id: 't_matilha', art: '🐾', name: 'Chamado da Matilha', type: 'tactic', cost: 2, rarity: 'rare',
    target: 'none',
    text: 'Invoca dois Filhotes de Lobo 1/1. Nunca vem um lobo só.',
  },
  t_abordagem: {
    id: 't_abordagem', art: '🪝', name: 'Abordagem!', type: 'tactic', cost: 2, rarity: 'rare',
    target: 'friendly-creature',
    text: 'Uma criatura aliada ganha +1 de ataque e pode atacar neste turno.',
  },
  t_saque: {
    id: 't_saque', art: '🗺️', name: 'Mapa do Saque', type: 'tactic', cost: 1, rarity: 'rare',
    target: 'none',
    text: 'Compre 1 carta e ganhe 1 de energia neste turno.',
  },

  // ─── Tokens (concedidos por mecânica, fora do baralho) ─────────
  t_moeda: {
    id: 't_moeda', art: '🪙', name: 'Moeda do Tempo', type: 'tactic', cost: 0, rarity: 'common',
    target: 'none', token: true,
    text: 'Ganhe 1 de energia neste turno. Compensa a iniciativa de quem joga primeiro.',
  },
  c_filhote: {
    id: 'c_filhote', art: '🐺', name: 'Filhote de Lobo', type: 'creature', cost: 1, rarity: 'common',
    attack: 1, health: 1, target: 'none', token: true,
    text: 'Um uivo respondeu ao outro.',
  },
  c_tentaculo: {
    id: 'c_tentaculo', art: '🦑', name: 'Tentáculo do Kraken', type: 'creature', cost: 2, rarity: 'common',
    attack: 2, health: 2, target: 'none', keywords: ['taunt'], token: true,
    text: 'Provocar. Um braço do Kraken — e o Kraken tem muitos.',
  },
};

/**
 * Composição do deck padrão: 30 cartas (slide "Conceito e condições de vitória").
 * Rebalanceado na expansão "Maré Sem Rei": 7 cartas novas entram no jogo neutro
 * (incluindo as duas keywords novas — Espectro/Drenar e Serpente/Escudo Arcano);
 * Campeã e Recuo Tático saem do neutro mas seguem no catálogo e nos tilts.
 */
export const DEFAULT_DECK: Array<[cardId: string, copies: number]> = [
  ['c_recruta', 2],
  ['c_escudeira', 2],
  ['c_lobo', 2],
  ['c_sentinela', 2],
  ['c_arqueira', 2],
  ['c_cavaleiro', 2],
  ['c_espectro', 1],
  ['c_golem', 1],
  ['c_maga', 1],
  ['c_serpente', 1],
  ['c_dragao', 1],
  ['s_faisca', 2],
  ['s_lanca_gelo', 1],
  ['s_bencao', 1],
  ['s_fortalecer', 1],
  ['s_bola_de_fogo', 2],
  ['s_tempestade', 1],
  ['a_escudo', 1],
  ['a_estandarte', 1],
  ['t_reforcos', 1],
  ['t_surto', 1],
  ['t_saque', 1],
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

/**
 * Inclinações de facção: trocas que mudam o "sabor" sem mexer no tamanho (30).
 * Aprofundadas na expansão "Maré Sem Rei" (5–9 swaps; eram 2): cada tradição
 * ganha suas cartas de identidade — e a Maré, a 5ª tradição, estreia aqui.
 * Cada `remove` foi validado contra o estoque do DEFAULT_DECK; `c_recruta`
 * nunca é removido mais de 1× por facção (sobra a cópia do swap de Resistência).
 */
export const FACTION_TILTS: Record<string, DeckSwap[]> = {
  vanguarda: [
    { remove: 's_faisca', add: 'c_cleriga' },
    { remove: 'c_lobo', add: 'c_templario' },
    { remove: 'c_espectro', add: 's_julgamento' },
    { remove: 's_lanca_gelo', add: 'a_relicario' },
    { remove: 'c_sentinela', add: 'c_campea' },
  ],
  silvanos: [
    { remove: 'c_recruta', add: 'c_duelista' },
    { remove: 'c_escudeira', add: 'c_bardo' },
    { remove: 's_bencao', add: 's_canto' },
    { remove: 't_surto', add: 't_matilha' },
    { remove: 'c_golem', add: 'c_cervo' },
    { remove: 's_bola_de_fogo', add: 'c_lobo' },
  ],
  eter: [
    { remove: 'c_recruta', add: 'c_fada' },
    { remove: 'c_escudeira', add: 'c_elemental' },
    { remove: 'c_cavaleiro', add: 'c_arquimago' },
    { remove: 'a_estandarte', add: 'a_orbe' },
    { remove: 'c_lobo', add: 's_faisca' },
  ],
  profundezas: [
    { remove: 'c_recruta', add: 'c_morcego' },
    { remove: 'c_arqueira', add: 'c_cultista' },
    { remove: 'c_sentinela', add: 'c_espectro' },
    { remove: 's_bencao', add: 's_pacto' },
    { remove: 'c_maga', add: 'c_horror' },
  ],
  mares: [
    { remove: 'c_recruta', add: 'c_grumete' },
    { remove: 'c_lobo', add: 'c_corsaria' },
    { remove: 'c_escudeira', add: 'c_aguaviva' },
    { remove: 'c_arqueira', add: 'c_sereia' },
    { remove: 'c_cavaleiro', add: 'c_tubarao' },
    { remove: 'c_dragao', add: 'c_kraken' },
    { remove: 's_tempestade', add: 's_maremoto' },
    { remove: 't_surto', add: 't_abordagem' },
    { remove: 'a_estandarte', add: 'a_figura' },
  ],
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
  // Expansão "Maré Sem Rei"
  'c_escudeira', 'c_cleriga', 'c_templario', 'c_sentinela', 'c_duelista', 'c_bardo',
  'c_cervo', 'c_fada', 'c_elemental', 'c_maga', 'c_arquimago', 'c_morcego', 'c_cultista',
  'c_espectro', 'c_horror', 'c_grumete', 'c_corsaria', 'c_aguaviva', 'c_sereia',
  'c_tubarao', 'c_serpente', 'c_kraken', 's_julgamento', 's_canto', 's_lanca_gelo',
  's_pacto', 's_maremoto', 'a_relicario', 'a_orbe', 'a_figura', 't_matilha',
  't_abordagem', 't_saque',
];
export function cardOfDay(nowMs: number): string {
  const day = Math.floor(nowMs / 86_400_000);
  const n = CARD_OF_DAY_POOL.length;
  return CARD_OF_DAY_POOL[((day % n) + n) % n];
}
