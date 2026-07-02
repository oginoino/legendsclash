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
  sigil: string; // id de ícone do brasão (resolvido via SIGIL_ICONS no cliente)
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
    'Nem todos os estilhaços caíram em terra. Milhares afundaram no oceano e lá seguem acesos — os Cristais Afogados. As marés que passam por eles voltam carregadas de Éter, e ao redor dessas rotas floresceu uma gente que não jura bandeira: corsários, sereias e coisas mais antigas que qualquer porto. Em Aurélia se diz que a Vanguarda guarda a terra — mas ninguém guarda o mar.',
  ],
  /** Notas que amarram regra ↔ história, mostradas no rodapé do Arquivo. */
  codexNotes: [
    {
      icon: 'shield',
      title: 'Por que as criaturas protegem o Comandante',
      text: 'Um Cristal aceso é um farol. Enquanto houver uma só lenda em campo, ela se interpõe entre o inimigo e o seu portador — nenhum golpe ou magia alcança o Comandante antes que a última defensora caia. Só então o excedente do golpe atravessa.',
    },
    {
      icon: 'light',
      title: 'A energia que renasce ao amanhecer',
      text: 'O Éter de um Cristal recompõe-se devagar. A cada turno você recebe mais um ponto de energia (até dez) — a paciência de Aurélia recompensa quem planeja, não quem desperdiça.',
    },
    {
      icon: 'death',
      title: 'A fadiga dos que lutam demais',
      text: 'Quando o baralho de um Comandante se esgota, não há mais lendas para chamar — e o esforço de forçar o Cristal vazio cobra seu preço em vida, crescente a cada tentativa. Nenhum Embate se arrasta para sempre.',
    },
  ],
} as const;

export const FACTIONS: Record<string, Faction> = {
  vanguarda: {
    id: 'vanguarda',
    name: 'A Vanguarda da Aurora',
    sigil: 'light',
    color: '#e3b341',
    motto: 'Primeiro a luz, depois a lâmina.',
    blurb:
      'A ordem jurada que guarda o que restou da Aurora. Disciplina, escudos e estandartes: vencem pela linha que não recua e pelo socorro que chega na hora certa.',
  },
  silvanos: {
    id: 'silvanos',
    name: 'O Pacto Silvano',
    sigil: 'wolf',
    color: '#3fb950',
    motto: 'A mata vê tudo; a mata espera.',
    blurb:
      'Elfos e feras das florestas que medraram nas bordas da Fratura. Caçam no crepúsculo, golpeiam onde dói e somem na folhagem antes do troco.',
  },
  eter: {
    id: 'eter',
    name: 'O Conclave do Éter',
    sigil: 'arcane',
    color: '#7fb1ff',
    motto: 'Todo Cristal é uma pergunta.',
    blurb:
      'Estudiosos que decifram os estilhaços do céu. Não erguem muralhas — dobram o próprio Éter em faíscas, chamas e runas que mudam o ritmo do Embate.',
  },
  profundezas: {
    id: 'profundezas',
    name: 'Os Antigos das Profundezas',
    sigil: 'dragon',
    color: '#ff8c6e',
    motto: 'O que dormia, acordou.',
    blurb:
      'Aquilo que a Fratura desenterrou: golems de pedra viva e dragões mais velhos que os reinos. Lentos para chamar, terríveis para enfrentar.',
  },
  mares: {
    id: 'mares',
    name: 'A Maré Sem Rei',
    sigil: 'tide',
    color: '#38d1c2',
    motto: 'O mar não jura lealdade.',
    blurb:
      'Corsários, sereias e o que nada abaixo deles. Quando a Fratura caiu no oceano, os Cristais afogados criaram marés de Éter — e quem vive delas não serve a reino algum. Rápidos no saque, traiçoeiros na espera, terríveis quando a maré sobe.',
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
  c_escudeira: {
    epithet: 'A Que Segura a Porta',
    factionId: 'vanguarda',
    story:
      'Serviu de escudeira ao Cavaleiro de Ferro e aprendeu dele a lição que nenhum manual ensina: plantar os pés e não sair do lugar. O escudo que carrega é maior que ela — e é exatamente essa a ideia. Enquanto estiver de pé, Provoca: quem quiser passar terá de derrubá-la primeiro, e derrubar quem segura a porta nunca é tão rápido quanto parece.',
  },
  c_cleriga: {
    epithet: 'Voz do Amanhecer',
    factionId: 'vanguarda',
    story:
      'Curandeira de campo da Aurora, reza costurando ferida — dizem os soldados que ela é a prece da Bênção Vital em pessoa. Chega onde o clarim a chama e, no instante em que pisa o campo, o Comandante sente o fôlego voltar: três medidas de vida, devolvidas antes mesmo de a poeira assentar.',
  },
  c_templario: {
    epithet: 'O Muro que Marcha',
    factionId: 'vanguarda',
    story:
      'Elite jurada da Aurora, treinado a vida inteira para uma única coisa: ser o lugar onde a batalha para. Custa caro chamá-lo — mas onde ele planta os pés, a linha inteira para junto. Provoca por ofício: nenhum inimigo alcança o que ele decidiu proteger sem antes atravessá-lo, e poucos atravessam.',
  },
  s_julgamento: {
    epithet: 'A Sentença Luminosa',
    factionId: 'vanguarda',
    story:
      'Os juízes da Aurora ensinam que a luz não escolhe lado: a mesma chama que pune o invasor fecha a ferida do justo. Conjurada sobre uma lenda inimiga, castiga com três medidas de dano — e o clarão que sobra volta ao Comandante como duas de vida. Punição e socorro, num só verbo.',
  },
  a_relicario: {
    epithet: 'A Chama que Não Apaga',
    factionId: 'vanguarda',
    story:
      'Dentro do relicário arde um fragmento da primeira Aurora, salvo da Fratura por mãos que ninguém soube nomear. Não faz nada de espetacular — apenas goteja luz sobre o portador a cada amanhecer, um ponto de vida por turno, sem falhar nunca. Nas guerras longas, é a diferença entre resistir e apagar.',
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
  c_sentinela: {
    epithet: 'Olhos da Copa',
    factionId: 'silvanos',
    story:
      'Batedora élfica que vive no alto das copas, onde a mata inteira vira mapa. Vê o inimigo um dia antes de ele chegar — é por isso que o Pacto nunca é surpreendido. Quando enfim desce ao campo, traz o que viu: uma carta a mais na mão do Comandante, o aviso transformado em vantagem.',
  },
  c_duelista: {
    epithet: 'Lâmina do Crepúsculo',
    factionId: 'silvanos',
    story:
      'Esgrimista élfica que trata cada duelo como dança — e faz questão de marcar o primeiro compasso. Investida: ataca no turno em que entra, antes que o inimigo entenda que a música começou. Quando entende, o duelo já acabou.',
  },
  c_bardo: {
    epithet: 'O Que Afina Exércitos',
    factionId: 'silvanos',
    story:
      'O Pacto não marcha ao som de tambores: marcha ao som dele. Diz que exército é instrumento — desafinado, quebra; afinado, canta. Quando chega ao campo, cada aliada que já lutava ganha um palmo a mais de altura e de coragem, +1/+1 na medida exata da canção certa.',
  },
  c_cervo: {
    epithet: 'O Rei Sem Coroa',
    factionId: 'silvanos',
    story:
      'Criatura mágica mais antiga que os próprios elfos, o cervo que nunca precisou de coroa para reinar sobre a clareira. Provoca: quem ameaça a mata enfrenta primeiro a mata inteira — e a mata inteira se interpõe com ele. Nenhum silvano dá ordem ao Cervo-Rei; apenas agradece quando ele aparece.',
  },
  s_canto: {
    epithet: 'O Refrão do Pacto',
    factionId: 'silvanos',
    story:
      'Todo silvano conhece o estribilho, aprendido antes de qualquer arma. Cantado sozinho, é saudade de casa; cantado em coro sobre o campo, vira armadura — cada criatura aliada cresce +1/+1 no compasso. É por isso que o Pacto canta antes de lutar. E, às vezes, durante.',
  },
  t_matilha: {
    epithet: 'Uivos na Névoa',
    factionId: 'silvanos',
    story:
      'O caçador ouve um uivo e se prepara para um lobo — é o primeiro erro, e costuma ser o último. Na mata do Pacto, um uivo sempre responde ao outro: quando o chamado sobe, dois filhotes atravessam a névoa de uma vez. Nunca vem um lobo só.',
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
  c_fada: {
    epithet: 'Centelha Travessa',
    factionId: 'eter',
    story:
      'Criatura mágica nascida do próprio Éter, brilha, provoca e dança fora do alcance — até que algo enfim a alcança. Ao apagar, sopra um último segredo ao ouvido do conjurador: uma carta comprada no Estertor. No Conclave se diz que nem a morte de uma fada é desperdício.',
  },
  c_elemental: {
    epithet: 'Éter que Anda',
    factionId: 'eter',
    story:
      'O Conclave aprendeu a condensar Éter até ele criar casca — uma criatura de vidro vivo que anda, luta e reflete. Escudo Arcano: o primeiro golpe que recebe quebra só o reflexo, não a criatura. O segundo é que encontra o que há por baixo.',
  },
  c_maga: {
    epithet: 'Aprendiz de Tempestades',
    factionId: 'eter',
    story:
      'Entre a Faísca do aprendiz e a Bola de Fogo do mestre há ela: já perigosa, ainda imprecisa. Ao pisar o campo, solta a pólvora arcana que vem ensaiando — dois de dano numa criatura inimiga qualquer, porque a mira ainda é do Éter, não dela. O Conclave garante que um dia ela escolherá o alvo.',
  },
  c_arquimago: {
    epithet: 'O Que Reabriu o Céu',
    factionId: 'eter',
    story:
      'Lenda viva do Conclave — o único que estudou a Fratura de perto o bastante para reproduzi-la. Quando chega ao campo, faz o céu sangrar em miniatura: dois de dano sobre todas as criaturas inimigas, um eco pequeno da catástrofe que partiu Aurélia. Chamá-lo custa caro; reabrir a ferida do céu nunca foi barato.',
  },
  s_lanca_gelo: {
    epithet: 'Inverno Pontiagudo',
    factionId: 'eter',
    story:
      'Éter resfriado até virar ponta, arremessado antes que derreta. Foi feita para caçar lendas, não comandantes: a lança busca o coração de uma criatura inimiga e ali entrega três medidas de inverno. Contra um Cristal ela simplesmente se desfaz — e o Conclave nunca se deu ao trabalho de corrigir isso.',
  },
  a_orbe: {
    epithet: 'O Amplificador',
    factionId: 'eter',
    story:
      'Um Cristal de Éter lapidado por uma geração inteira até virar esfera perfeita, sem aresta que disperse. Toda magia que passa por ele sai maior do que entrou: +1 de dano, sempre, sem cerimônia. O Conclave o considera menos um artefato e mais uma tese provada.',
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
  c_morcego: {
    epithet: 'Asa do Abismo',
    factionId: 'profundezas',
    story:
      'Foi a primeira coisa que a Fratura soltou das profundezas: pequeno, faminto e — descobriu-se tarde demais — incontável. Custa quase nada chamá-lo, e morde muito mais do que o tamanho sugere. Onde aparece um, o abismo ainda guarda milhares.',
  },
  c_cultista: {
    epithet: 'O Devoto do Nada',
    factionId: 'profundezas',
    story:
      'Entregou o nome, o rosto e o medo ao Vazio, e recebeu em troca uma única certeza: a de que a própria morte teria serventia. Quando cai, morre sorrindo — e o Estertor cobra duas medidas de dano direto do comandante inimigo. A morte dele é o recado; o remetente ainda vem.',
  },
  c_espectro: {
    epithet: 'Fome Antiga',
    factionId: 'profundezas',
    story:
      'Sombra que a Fratura arrancou de um lugar sem nome, faminta desde antes de existirem reinos. Drenar: o que ela fere, ela bebe — e o que bebe, entrega em vida ao portador. Lutar contra o Espectro é alimentá-lo; ignorá-lo é pior.',
  },
  c_horror: {
    epithet: 'O Que Rasteja por Baixo',
    factionId: 'profundezas',
    story:
      'Grande demais para caber num nome, velho demais para lembrar o próprio começo. Rasteja por baixo do campo e por baixo da razão, e cada bocado que arranca do inimigo alimenta o mestre que o chamou — Drenar, em escala de monstro. Os Antigos não o adestram: apenas apontam a direção.',
  },
  s_pacto: {
    epithet: 'Três Segredos por Três Gotas',
    factionId: 'profundezas',
    story:
      'O Vazio é o único credor de Aurélia que nunca recusa um empréstimo — e o único que cobra no ato. Três cartas surgem na mão do Comandante; três medidas de vida deixam seu corpo, na mesma respiração. Todo conjurador jura que fará o pacto uma única vez. Nenhum cumpriu.',
  },
  c_renegado: {
    epithet: 'O Que a Dor Aguça',
    factionId: 'profundezas',
    story:
      'Já lutou sob três bandeiras e enterrou as três; hoje só luta pela própria pele — e pela do Comandante que o paga. Resistência: quando o Cristal do portador fraqueja, ele lembra por que sobreviveu a tudo, e a lembrança o aguça — +2 de ataque e Investida enquanto durar o perigo. O desespero dos outros é o elemento dele.',
  },

  // ─── A Maré Sem Rei ───────────────────────────────────────────
  c_grumete: {
    epithet: 'Primeiro no Convés',
    factionId: 'mares',
    story:
      'O menor contrato da Maré: um garoto, uma faca e nenhuma paciência. Investida: pula no abalroamento antes de a prancha encostar, porque quem espera a prancha chega em segundo. Metade não volta; a metade que volta vira corsária.',
  },
  c_corsaria: {
    epithet: 'Mão Leve de Salobra',
    factionId: 'mares',
    story:
      'No porto franco de Salobra ela é lenda de taverna: a pirata que rouba tempo, não só carga. Chega ao campo já com um estilhaço de Éter afanado no bolso — um ponto de energia a mais neste turno, subtraído sabe-se lá de quem. Ninguém nunca viu a mão dela se mover.',
  },
  c_aguaviva: {
    epithet: 'Lanterna Afogada',
    factionId: 'mares',
    story:
      'Água-viva que medrou colada a um Cristal Afogado até virar lanterna viva de Éter. Em vida, apenas flutua e brilha; na morte, estoura num clarão que queima tudo por perto — um de dano em cada criatura inimiga, no Estertor. Os corsários as recolhem com redes de vidro. Com muito, muito cuidado.',
  },
  c_sereia: {
    epithet: 'A Voz que Desfaz Juras',
    factionId: 'mares',
    story:
      'Os marinheiros tapam os ouvidos com cera — não por medo de morrer, mas de obedecer. O canto dela desfaz juramentos: convence uma lenda inimiga, escolhida pela maré, a largar o campo e voltar para casa, direto à mão de quem a chamou. Nenhuma corrente segura quem foi convencido a partir.',
  },
  c_tubarao: {
    epithet: 'Casco Vermelho',
    factionId: 'mares',
    story:
      'Criado sob os cascos dos galeões da Maré, alimentado com o que as batalhas jogam ao mar. Investida: ataca no turno em que chega, porque ataca no cheiro — e sente sangue a um oceano de distância. Os corsários o chamam de Casco Vermelho. Ninguém pergunta o porquê duas vezes.',
  },
  c_serpente: {
    epithet: 'A Primeira Dobra do Mar',
    factionId: 'mares',
    story:
      'Dizem os velhos de Salobra que, quando o mar se dobrou pela primeira vez, ela já estava por baixo. As escamas, banhadas há eras no Éter de um Cristal Afogado, desviam o primeiro arpão — Escudo Arcano: o primeiro dano se anula e quebra só o encanto. O segundo arpão precisa ser atirado por alguém que ainda esteja no barco.',
  },
  c_kraken: {
    epithet: 'O Porto Que Afunda Portos',
    factionId: 'mares',
    story:
      'É o monstro que dá nome ao medo dos marinheiros — e Salmarra, o porto que afundou, é só a mais famosa das cidades de que ele se lembrou de ter raiva. Provoca: nada passa por ele, porque não existe por onde. E nem morto termina: no Estertor, dois braços continuam lutando onde o corpo caiu. Do Kraken se mata o meio; as pontas ficam.',
  },
  s_maremoto: {
    epithet: 'A Conta da Maré',
    factionId: 'mares',
    story:
      'A Maré não perdoa dívidas: apenas espera a lua certa. Quando a conta vence, o mar cobra de uma vez o que a costa devia há anos — três medidas de dano sobre todas as criaturas inimigas, numa única onda que não pergunta nomes. Depois recua, manso, como quem já recebeu.',
  },
  t_abordagem: {
    epithet: 'Prancha ao Mar!',
    factionId: 'mares',
    story:
      'Duas palavras, e a tripulação vira arma. Uma criatura aliada ganha +1 de ataque e ataca já, neste turno — porque abordagem que espera não é abordagem, é visita. Na Maré, o grito vale mais que qualquer ordem escrita: quando soa, ninguém pergunta para onde.',
  },
  t_saque: {
    epithet: 'X Marca o Lugar',
    factionId: 'mares',
    story:
      'Mapa roubado do camarote de um capitão que não precisa mais dele. O X marca o lugar: uma carta a mais na mão e um sopro de energia com o vento a favor. Na Maré, todo tesouro pertence a quem chega primeiro — e o mapa existe para garantir que seja você.',
  },
  a_figura: {
    epithet: 'A Guardiã do Casco',
    factionId: 'mares',
    story:
      'Entalhada à imagem de uma sereia de verdade — dizem que com a permissão dela, o que já seria milagre. Presa à proa, desvia um golpe do casco a cada maré: um ponto de escudo no início de cada turno, até o limite do que a madeira aguenta. Nenhum navio da Maré zarpa sem a sua. Os que zarparam não voltaram para contar.',
  },
};

/** Cartas de uma tradição, na ordem do catálogo. */
export function cardsOfFaction(factionId: string, cardIds: string[]): string[] {
  return cardIds.filter((id) => CARD_LORE[id]?.factionId === factionId);
}
