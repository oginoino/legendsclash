/**
 * O universo de Legends Clash — lore e storytelling do "Arquivo de Aurélia".
 *
 * Conteúdo puramente narrativo (camada de apresentação): o servidor não
 * conhece nada disto. Mantém o mesmo padrão de `CardArt.tsx` — um mapa
 * `defId → dados` que enriquece o catálogo de `@legendsclash/shared` sem
 * acoplar regra de jogo. A intenção é dar a cada carta um lugar no mesmo
 * mundo e explicar, por meio de história, as mecânicas que o jogador já vê
 * na mesa (proteção do comandante, energia que renasce ao amanhecer, fadiga).
 */

export interface Faction {
  id: string;
  name: string;
  sigil: string; // emoji-brasão
  color: string; // cor de acento (combina com a paleta da arte)
  /** Lema curto, exibido sob o nome. */
  motto: string;
  /** Descrição do que a tradição representa no mundo. */
  blurb: string;
}

export interface CardLore {
  /** Epíteto/título honorífico da carta. */
  epithet: string;
  factionId: string;
  /** Narrativa — uma ou mais frases dentro do universo. */
  story: string;
}

/** O mundo e a moldura que liga todas as cartas. */
export const WORLD = {
  realm: 'Aurélia',
  tagline: 'O reino partido onde as lendas atendem ao chamado dos Cristais.',
  intro: [
    'Houve um tempo em que Aurélia era uma só terra, banhada pela luz constante da Aurora. Então veio a Fratura: o céu se partiu como vidro e despencou sobre o mundo em milhares de estilhaços luminosos — os Cristais de Éter. Onde caíram, ergueram-se reinos; onde escassearam, restou o silêncio.',
    'Quem aprende a ouvir um Cristal torna-se um Comandante. Não luta com as próprias mãos: convoca lendas adormecidas, conjura magias e ergue artefatos, tudo alimentado pela centelha do Éter. A cada amanhecer o Cristal renova um pouco da sua força — por isso nenhum Comandante gasta de uma vez o que não pode repor.',
    'O que você joga não é uma partida: é um Embate. Dois Cristais se reconhecem à distância e se chamam, e seus portadores conduzem seus exércitos até que só reste uma luz acesa. As cartas deste Arquivo são as lendas que respondem a esse chamado — cada uma com seu nome, sua casa e sua história.',
  ],
  /** Notas que amarram regra ↔ história, mostradas no rodapé do Arquivo. */
  codexNotes: [
    {
      icon: '🛡️',
      title: 'Por que as criaturas protegem o Comandante',
      text: 'Um Cristal aceso é um farol. Enquanto houver uma só lenda em campo, ela se interpõe entre o inimigo e o seu portador — nenhum golpe ou magia alcança o Comandante antes que a última defensora caia. Só então o excedente do golpe atravessa.',
    },
    {
      icon: '☀️',
      title: 'A energia que renasce ao amanhecer',
      text: 'O Éter de um Cristal recompõe-se devagar. A cada turno você recebe mais um ponto de energia (até dez) — a paciência de Aurélia recompensa quem planeja, não quem desperdiça.',
    },
    {
      icon: '💀',
      title: 'A fadiga dos que lutam demais',
      text: 'Quando o baralho de um Comandante se esgota, não há mais lendas para chamar — e o esforço de forçar o Cristal vazio cobra seu preço em vida, crescente a cada tentativa. Nenhum Embate se arrasta para sempre.',
    },
  ],
} as const;

export const FACTIONS: Record<string, Faction> = {
  vanguarda: {
    id: 'vanguarda',
    name: 'A Vanguarda da Aurora',
    sigil: '🌟',
    color: '#e3b341',
    motto: 'Primeiro a luz, depois a lâmina.',
    blurb:
      'A ordem jurada que guarda o que restou da Aurora. Disciplina, escudos e estandartes: vencem pela linha que não recua e pelo socorro que chega na hora certa.',
  },
  silvanos: {
    id: 'silvanos',
    name: 'O Pacto Silvano',
    sigil: '🐺',
    color: '#3fb950',
    motto: 'A mata vê tudo; a mata espera.',
    blurb:
      'Elfos e feras das florestas que medraram nas bordas da Fratura. Caçam no crepúsculo, golpeiam onde dói e somem na folhagem antes do troco.',
  },
  eter: {
    id: 'eter',
    name: 'O Conclave do Éter',
    sigil: '🔮',
    color: '#7fb1ff',
    motto: 'Todo Cristal é uma pergunta.',
    blurb:
      'Estudiosos que decifram os estilhaços do céu. Não erguem muralhas — dobram o próprio Éter em faíscas, chamas e runas que mudam o ritmo do Embate.',
  },
  profundezas: {
    id: 'profundezas',
    name: 'Os Antigos das Profundezas',
    sigil: '🐉',
    color: '#ff8c6e',
    motto: 'O que dormia, acordou.',
    blurb:
      'Aquilo que a Fratura desenterrou: golems de pedra viva e dragões mais velhos que os reinos. Lentos para chamar, terríveis para enfrentar.',
  },
};

export const CARD_LORE: Record<string, CardLore> = {
  // ─── Vanguarda da Aurora ──────────────────────────────────────
  c_recruta: {
    epithet: 'O Primeiro na Linha',
    factionId: 'vanguarda',
    story:
      'Mal aprendeu a segurar a lança e já fez o Juramento da Aurora, diante do muro de luz onde gerações antes dele juraram o mesmo. Custa pouco para ser chamado e tomba cedo nas grandes batalhas — mas é sempre o primeiro a se erguer quando o clarim soa de novo.',
  },
  c_cavaleiro: {
    epithet: 'Veterano de Três Guerras',
    factionId: 'vanguarda',
    story:
      'A armadura tem mais remendos que brasão, e cada um conta uma guerra que ele sobreviveu. Não é o mais rápido nem o mais brilhante; é o que ainda está de pé quando a poeira assenta. Os recrutas aprendem a lutar imitando o jeito como ele planta os pés.',
  },
  c_campea: {
    epithet: 'Estandarte Vivo da Aurora',
    factionId: 'vanguarda',
    story:
      'Dizem que quando ela ergue a espada, a própria Aurora se inclina para olhar. Onde avança, a linha inimiga recua sem que ninguém dê a ordem — porque enfrentá-la é encarar tudo o que a Vanguarda promete proteger.',
  },
  s_bencao: {
    epithet: 'A Luz que Restaura',
    factionId: 'vanguarda',
    story:
      'Não é magia de batalha, e sim a prece que as curandeiras da Aurora sussurram sobre os feridos. Um fio da luz original costura de volta o que o aço abriu — devolvendo ao Comandante o fôlego para mais um amanhecer.',
  },
  a_escudo: {
    epithet: 'A Muralha Pessoal',
    factionId: 'vanguarda',
    story:
      'Forjado com o aço temperado nas forjas sob o muro auroral, absorve o primeiro castigo para que a vida não pague por ele. Um Comandante prudente nunca entra num Embate sem sentir seu peso no braço.',
  },
  a_estandarte: {
    epithet: 'O Brado que Inspira',
    factionId: 'vanguarda',
    story:
      'O pano é simples; o que ele carrega não é. Hasteado em campo, cada lenda da Vanguarda golpeia com a força de quem sabe que não luta sozinha. Enquanto tremular, o exército inteiro bate mais forte.',
  },
  t_reforcos: {
    epithet: 'O Clarim Distante',
    factionId: 'vanguarda',
    story:
      'Três notas longas, e das retaguardas da Aurora partem os que estavam de prontidão. Reforços nunca chegam cedo demais nem em pequena conta: quando o clarim soa, vêm dois de uma vez.',
  },

  // ─── Pacto Silvano ────────────────────────────────────────────
  c_lobo: {
    epithet: 'Caçador do Crepúsculo',
    factionId: 'silvanos',
    story:
      'Caça na hora azul, entre o último raio e a primeira estrela, quando os olhos dos homens ainda se ajustam e os dele já enxergam tudo. Rápido e letal — mas a luz direta o cega e o expõe, e a fragilidade é o preço da velocidade.',
  },
  c_arqueira: {
    epithet: 'A Que Nunca Erra Duas Vezes',
    factionId: 'silvanos',
    story:
      'Sentinela das copas, parte do Pacto antes mesmo de saber andar. Diz o ditado silvano que ela nunca erra o mesmo alvo duas vezes — porque, depois do primeiro disparo, raramente sobra um segundo alvo para errar.',
  },
  t_recuo: {
    epithet: 'Some na Mata',
    factionId: 'silvanos',
    story:
      'A arte silvana mais temida não é um golpe: é o desaparecimento. Uma criatura inimiga é arrancada do campo e devolvida à mão de quem a chamou, como se a floresta a tivesse engolido e cuspido lá atrás. Recuar, para o Pacto, é só outra forma de atacar.',
  },

  // ─── Conclave do Éter ─────────────────────────────────────────
  s_faisca: {
    epithet: 'O Primeiro Truque',
    factionId: 'eter',
    story:
      'A primeira coisa que todo aprendiz do Conclave aprende: pinçar um fio de Éter e soltá-lo num estalo. Pequena, barata, quase um gesto de criança — mas já decidiu mais Embates do que qualquer conjurador admite.',
  },
  s_bola_de_fogo: {
    epithet: 'Fúria Concentrada',
    factionId: 'eter',
    story:
      'O que a Faísca é ao aprendiz, esta é ao mestre. Horas de estudo comprimidas numa esfera que parte o ar e estoura no alvo. Cara de conjurar e impossível de ignorar: poucas lendas resistem a vê-la chegar.',
  },
  s_fortalecer: {
    epithet: 'Runa de Vigor',
    factionId: 'eter',
    story:
      'Gravada no ar com um traço de Éter e fixada sobre uma aliada, a runa engrossa músculo e couraça em segundos. O Conclave não tem exércitos próprios — então aprendeu a tornar os exércitos alheios maiores do que nasceram.',
  },
  s_tempestade: {
    epithet: 'A Ira do Céu Partido',
    factionId: 'eter',
    story:
      'Há quem decifre os Cristais para acender uma faísca; e há quem os force a sangrar. Quando um mestre do Conclave reabre de vez a ferida que a Fratura deixou no céu, o Éter desaba em raios sobre todo o campo inimigo de uma só vez. Onde havia uma horda, fica só fumaça — e o silêncio depois do trovão.',
  },
  t_surto: {
    epithet: 'Veia de Éter',
    factionId: 'eter',
    story:
      'Um conjurador hábil às vezes encontra uma veia mais rica no Cristal e a abre de vez, num jorro de energia para este instante. É um truque arriscado — gastar o amanhã pela vantagem de agora — e exatamente por isso tão silvanamente do Conclave.',
  },

  // ─── Antigos das Profundezas ──────────────────────────────────
  c_golem: {
    epithet: 'O Muro que Respira',
    factionId: 'profundezas',
    story:
      'Quando a Fratura rachou o solo, algo na pedra acordou e se pôs de pé. Não persegue, não recua: planta-se onde está e Provoca — o inimigo precisa derrubá-lo antes de mirar qualquer outra coisa. Muitos exércitos quebraram-se contra esse muro vivo.',
  },
  c_dragao: {
    epithet: 'A Última Coisa que Viram',
    factionId: 'profundezas',
    story:
      'Mais velho que os reinos, dormia no fundo do mundo até a Fratura abrir-lhe a caverna. Custa caro chamá-lo e demora a vir — mas, quando enfim desdobra as asas cinzentas sobre o campo, costuma ser a última carta que o Comandante adversário chega a ver.',
  },
};

/** Cartas de uma tradição, na ordem do catálogo. */
export function cardsOfFaction(factionId: string, cardIds: string[]): string[] {
  return cardIds.filter((id) => CARD_LORE[id]?.factionId === factionId);
}
