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
  tagline: 'O reino partido onde toda lenda responde ao brilho de um Cristal.',
  intro: [
    'Antes da Fratura, Aurélia era uma terra inteira, mantida sob a luz mansa da Aurora. Então o céu se abriu como vidro ferido e caiu em milhares de estilhaços vivos: os Cristais de Éter. Onde tocaram o chão, nasceram fortalezas, bosques encantados, torres de estudo e abismos inquietos. Onde não tocaram nada, o mundo simplesmente escureceu.',
    'Um Comandante é alguém que aprendeu a escutar um Cristal sem enlouquecer. Não vence pela força do braço, mas pelo chamado: desperta lendas antigas, molda magias, ergue artefatos e sustenta tudo com a centelha de Éter que o Cristal devolve a cada amanhecer. Em Aurélia, poder sem ritmo vira ruína; por isso até os mais ousados aprendem a gastar hoje sem matar o amanhã.',
    'Cada partida é um Embate: dois Cristais se reconhecem à distância e puxam seus portadores para o conflito. As criaturas não são peças sem passado; são juramentos, pactos, monstros, canções e dívidas que atravessam o mundo para atender a um chamado. Quando a última luz de um Comandante se apaga, o Embate termina — e a lenda volta ao Arquivo, esperando outra mão, outra mesa, outro destino.',
    'Nem todo estilhaço caiu em terra firme. Muitos afundaram no oceano e continuaram acesos sob a água, criando rotas de maré carregadas de Éter. Foi ali que nasceu a Maré Sem Rei: corsários, sereias, feras de casco e coisas tão antigas que nenhum mapa ousa desenhar. A Vanguarda diz que guarda Aurélia. O Pacto diz que a mata lembra. O Conclave diz que todo Cristal pode ser decifrado. Os Antigos dizem pouco. Mas o mar, quando responde, responde alto.',
  ],
  /** Notas que amarram regra ↔ história, mostradas no rodapé do Arquivo. */
  codexNotes: [
    {
      icon: 'shield',
      title: 'Por que as criaturas protegem o Comandante',
      text: 'Um Cristal aceso denuncia seu portador como um farol no escuro. Toda lenda chamada ao campo sente esse brilho e se coloca entre ele e o inimigo. Golpes e magias só alcançam o Comandante depois que a última defensora cai; até lá, o exército é a muralha viva do Cristal.',
    },
    {
      icon: 'light',
      title: 'A energia que renasce ao amanhecer',
      text: 'O Éter não obedece à pressa. A cada turno, o Cristal recompõe parte da própria luz e oferece mais um ponto de energia, até o limite de dez. Quem entende esse ciclo transforma paciência em vantagem; quem força demais o brilho descobre que até a luz pode quebrar.',
    },
    {
      icon: 'death',
      title: 'A fadiga dos que lutam demais',
      text: 'Quando o baralho se esgota, o Comandante já chamou tudo o que podia. Insistir num Cristal vazio é arrancar lenda de onde só resta silêncio, e o custo vem direto na vida, cada vez mais alto. Nenhum Embate foi feito para durar para sempre.',
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
      'A ordem que ainda acredita que Aurélia pode ser reunida sob uma mesma luz. Marcham em linhas firmes, protegem seus Comandantes como relicários vivos e vencem quando a disciplina resiste mais que o medo.',
  },
  silvanos: {
    id: 'silvanos',
    name: 'O Pacto Silvano',
    sigil: 'wolf',
    color: '#3fb950',
    motto: 'A mata vê tudo; a mata espera.',
    blurb:
      'Elfos, feras e espíritos das florestas que cresceram nas bordas da Fratura. Não defendem tronos, defendem equilíbrio: observam primeiro, cercam em silêncio e atacam quando o inimigo já entrou fundo demais.',
  },
  eter: {
    id: 'eter',
    name: 'O Conclave do Éter',
    sigil: 'arcane',
    color: '#7fb1ff',
    motto: 'Todo Cristal é uma pergunta.',
    blurb:
      'Eruditos, aprendizes e arcanistas que tratam os estilhaços do céu como linguagem. Onde outros veem milagre ou maldição, o Conclave vê padrão — e transforma esse padrão em faísca, runa, tempestade e risco calculado.',
  },
  profundezas: {
    id: 'profundezas',
    name: 'Os Antigos das Profundezas',
    sigil: 'dragon',
    color: '#ff8c6e',
    motto: 'O que dormia, acordou.',
    blurb:
      'Tudo que a Fratura despertou sob pedra, cinza e esquecimento. Golems, dragões, cultistas e horrores sem nome avançam devagar, como se tivessem todo o tempo do mundo — talvez porque tenham mesmo.',
  },
  mares: {
    id: 'mares',
    name: 'A Maré Sem Rei',
    sigil: 'tide',
    color: '#38d1c2',
    motto: 'O mar não jura lealdade.',
    blurb:
      'Corsários, sereias, feras abissais e ladrões de vento que vivem das rotas criadas pelos Cristais Afogados. Não seguem coroa, não respeitam fronteira e não esperam permissão: chegam rápido, levam o que querem e somem antes que a costa entenda a perda.',
  },
};

export const CARD_LORE: Record<string, CardLore> = {
  // ─── Vanguarda da Aurora ──────────────────────────────────────
  c_recruta: {
    epithet: 'O Primeiro na Linha',
    factionId: 'vanguarda',
    story:
      'Ele ainda errava o peso da lança quando fez o Juramento da Aurora diante do muro de luz. Por isso é chamado cedo e cai cedo: a Vanguarda sempre começa por quem aceita ficar na frente. Quando o clarim soa outra vez, é quase sempre um recruta que responde primeiro.',
  },
  c_cavaleiro: {
    epithet: 'Veterano de Três Guerras',
    factionId: 'vanguarda',
    story:
      'A armadura tem mais remendos que brasão, e cada remendo segura uma história que ele não conta inteira. Não é o mais veloz, nem o mais nobre, nem o mais bonito em campo. É pior: é o que continua de pé. Os recrutas aprendem a coragem copiando o modo como ele finca os pés antes do impacto.',
  },
  c_campea: {
    epithet: 'Estandarte Vivo da Aurora',
    factionId: 'vanguarda',
    story:
      'A Campeã não carrega o estandarte; ela é o estandarte quando a linha começa a tremer. Dizem que a Aurora se curva para vê-la erguer a espada, e que até inimigos baixam a voz quando ela avança. Enfrentá-la é enfrentar a promessa mais antiga da Vanguarda: enquanto houver luz, alguém ficará de pé por você.',
  },
  s_bencao: {
    epithet: 'A Luz que Restaura',
    factionId: 'vanguarda',
    story:
      'A Bênção não fecha feridas com espetáculo. Ela chega como uma prece baixa, dita por mãos firmes no meio da poeira, e costura de volta o que aço, dente ou fogo tentaram levar. O Comandante respira mais uma vez porque a Aurora, teimosa como sempre, ainda não autorizou o fim.',
  },
  a_escudo: {
    epithet: 'A Muralha Pessoal',
    factionId: 'vanguarda',
    story:
      'Forjado no calor das muralhas aurorais, o escudo não promete vitória; promete tempo. Ele recebe o primeiro castigo no lugar da carne, compra um turno, uma decisão, uma chance de virar o Embate. Um Comandante prudente nunca despreza nada que saiba dizer não ao golpe.',
  },
  a_estandarte: {
    epithet: 'O Brado que Inspira',
    factionId: 'vanguarda',
    story:
      'O tecido já foi rasgado, queimado e lavado em chuva de cinzas, mas nunca caiu sem alguém se ajoelhar para erguê-lo de novo. Quando tremula no campo, cada aliada da Vanguarda lembra que sua lâmina faz parte de uma linha maior. É só pano, claro. Pano com memória costuma bater mais forte.',
  },
  t_reforcos: {
    epithet: 'O Clarim Distante',
    factionId: 'vanguarda',
    story:
      'Três notas longas atravessam o campo e chegam às tendas que ainda não queimaram. Então dois soldados correm, não porque a ordem é bonita, mas porque alguém na frente segurou a porta tempo suficiente. Reforços da Aurora raramente chegam cedo. Chegam juntos.',
  },
  c_escudeira: {
    epithet: 'A Que Segura a Porta',
    factionId: 'vanguarda',
    story:
      'Ela serviu ao Cavaleiro de Ferro e aprendeu a lição que nenhum manual ensina: às vezes vencer é simplesmente não sair do lugar. O escudo é grande demais para seu corpo, e esse é exatamente o ponto. Enquanto ela respira, Provoca; quem quiser passar precisa derrubá-la primeiro, e portas teimosas costumam humilhar monstros apressados.',
  },
  c_cleriga: {
    epithet: 'Voz do Amanhecer',
    factionId: 'vanguarda',
    story:
      'A Clériga chega depois do choque, quando o chão já escolheu seus mortos e os vivos começam a duvidar. Ela canta baixo, toca o Cristal do Comandante e devolve três medidas de vida antes que o medo vire rendição. Para muitos soldados, ela não conjura a Bênção: ela é a Bênção usando botas de campo.',
  },
  c_templario: {
    epithet: 'O Muro que Marcha',
    factionId: 'vanguarda',
    story:
      'Um Templário da Aurora é treinado para ser o lugar onde a batalha perde velocidade. Chamá-lo custa caro porque toda muralha verdadeira custa tempo, voto e cicatriz. Quando planta os pés, Provoca por dever: nenhum inimigo toca o que ele protege sem antes descobrir quanto pesa uma fé armada.',
  },
  s_julgamento: {
    epithet: 'A Sentença Luminosa',
    factionId: 'vanguarda',
    story:
      'Os juízes da Aurora dizem que a luz não bajula ninguém: ela revela, pune e cura na mesma chama. O Julgamento atinge uma lenda inimiga com três medidas de dano, e o clarão que sobra retorna ao Comandante como duas de vida. Punição e socorro, costurados no mesmo veredito.',
  },
  a_relicario: {
    epithet: 'A Chama que Não Apaga',
    factionId: 'vanguarda',
    story:
      'Dentro do relicário arde um fragmento salvo da primeira Aurora, pequeno demais para iluminar uma cidade e insistente demais para morrer. A cada amanhecer, ele pinga uma gota de vida sobre o portador, sem alarde, sem falha. Nas guerras longas, o milagre raramente é grandioso; às vezes é só continuar aceso.',
  },

  // ─── Pacto Silvano ────────────────────────────────────────────
  c_lobo: {
    epithet: 'Caçador do Crepúsculo',
    factionId: 'silvanos',
    story:
      'O lobo caça na hora azul, quando os olhos humanos ainda pedem luz e a mata já enxerga por eles. Chega rápido, fere fundo e não foi feito para aguentar cerco. Sua fragilidade é o preço do bote perfeito; no Pacto, velocidade nunca vem sem dívida.',
  },
  c_arqueira: {
    epithet: 'A Que Nunca Erra Duas Vezes',
    factionId: 'silvanos',
    story:
      'Ela cresceu nas copas antes de crescer no chão, ouvindo o vento ensinar distância. Dizem que nunca erra o mesmo alvo duas vezes, não por vaidade, mas por economia: depois do primeiro disparo, raramente existe um segundo erro para corrigir. A floresta não desperdiça flechas.',
  },
  t_recuo: {
    epithet: 'Some na Mata',
    factionId: 'silvanos',
    story:
      'A tática mais temida do Pacto não deixa sangue, deixa ausência. Uma criatura inimiga é arrancada do campo e devolvida à mão de quem a chamou, como se a própria mata tivesse engolido o invasor e cuspido de volta na fronteira. Para os silvanos, recuar alguém é só atacar a certeza dele.',
  },
  c_sentinela: {
    epithet: 'Olhos da Copa',
    factionId: 'silvanos',
    story:
      'Do alto das árvores, a Sentinela vê trilhas, mentiras e exércitos antes que eles tenham coragem de se chamar invasão. Quando desce ao campo, traz uma carta a mais para o Comandante: não é sorte, é aviso. O Pacto vence muitos Embates antes que o primeiro golpe seja dado.',
  },
  c_duelista: {
    epithet: 'Lâmina do Crepúsculo',
    factionId: 'silvanos',
    story:
      'A Duelista trata combate como dança e faz questão de escolher o primeiro passo. Investida: entra e ataca no mesmo fôlego, antes que o inimigo descubra o ritmo. Quando ele entende que começou um duelo, a lâmina dela já escreveu o final.',
  },
  c_bardo: {
    epithet: 'O Que Afina Exércitos',
    factionId: 'silvanos',
    story:
      'O Pacto não marcha ao som de tambores; marcha quando o Bardo encontra a nota certa. Para ele, cada aliada é uma corda: frouxa, arrebenta; afinada, canta. Ao chegar, transforma presença em coragem e dá +1/+1 às criaturas que já lutavam, como se a floresta inteira respirasse junto.',
  },
  c_cervo: {
    epithet: 'O Rei Sem Coroa',
    factionId: 'silvanos',
    story:
      'O Cervo-Rei é mais antigo que os juramentos élficos e nunca precisou de coroa para ser obedecido. Quando pisa na clareira, a mata inteira parece dar um passo à frente. Provoca porque não defende apenas o Comandante; defende a ordem silenciosa das coisas que existiam antes dos reinos.',
  },
  s_canto: {
    epithet: 'O Refrão do Pacto',
    factionId: 'silvanos',
    story:
      'Todo silvano aprende esse canto antes de aprender o nome da própria arma. Cantado sozinho, ele lembra casa; cantado em campo, vira pele mais dura, mão mais firme e coração menos solitário. Cada criatura aliada cresce +1/+1 no compasso, porque o Pacto nunca luta como indivíduos quando pode lutar como floresta.',
  },
  t_matilha: {
    epithet: 'Uivos na Névoa',
    factionId: 'silvanos',
    story:
      'O invasor escuta um uivo e imagina um lobo. Esse é o primeiro erro. Na névoa do Pacto, um chamado sempre encontra resposta, e dois filhotes atravessam a mata antes que a coragem do inimigo termine de se explicar. Nunca vem um lobo só; vem uma notícia ruim com dentes.',
  },

  // ─── Conclave do Éter ─────────────────────────────────────────
  s_faisca: {
    epithet: 'O Primeiro Truque',
    factionId: 'eter',
    story:
      'A primeira lição do Conclave é pinçar um fio de Éter e soltá-lo no ponto certo. Parece pequeno, quase infantil, até decidir um Embate por um único sopro de dano. Todo arquimago começou com uma Faísca; os mais honestos ainda a respeitam.',
  },
  s_bola_de_fogo: {
    epithet: 'Fúria Concentrada',
    factionId: 'eter',
    story:
      'Onde a Faísca estala, a Bola de Fogo declara. Horas de cálculo, respiração e arrogância são comprimidas numa esfera que parte o ar e explode no alvo. É cara de conjurar, difícil de esconder e impossível de ignorar — exatamente como o Conclave gosta quando quer ser levado a sério.',
  },
  s_fortalecer: {
    epithet: 'Runa de Vigor',
    factionId: 'eter',
    story:
      'O Conclave raramente tem exércitos próprios, então aprendeu a melhorar os dos outros. A Runa de Vigor é gravada no ar e fechada sobre uma aliada, engrossando músculo, couraça e vontade em poucos segundos. Para um arcanista, reforçar alguém é uma forma elegante de vencer sem sujar a manga.',
  },
  s_tempestade: {
    epithet: 'A Ira do Céu Partido',
    factionId: 'eter',
    story:
      'Alguns estudam os Cristais para entender a Fratura; outros, menos sensatos e mais brilhantes, aprendem a imitá-la. A Tempestade reabre por um instante a cicatriz do céu e despeja raios sobre todo o campo inimigo. Onde havia horda, sobra fumaça. Onde havia confiança, sobra respeito.',
  },
  t_surto: {
    epithet: 'Veia de Éter',
    factionId: 'eter',
    story:
      'Às vezes, um conjurador encontra no Cristal uma veia mais viva e a rasga sem pedir licença ao amanhã. O Surto entrega energia extra para este turno, puro agora, pura pressa. É uma ideia perigosa, brilhante e tipicamente do Conclave: gastar futuro para comprar precisão no presente.',
  },
  c_fada: {
    epithet: 'Centelha Travessa',
    factionId: 'eter',
    story:
      'A Fada nasceu de um vazamento de Éter e nunca entendeu muito bem o conceito de consequência. Brilha, ri, distrai e dança fora do alcance até que o campo finalmente a alcança. Ao morrer, ainda sopra um segredo ao Comandante e compra uma carta no Estertor; no Conclave, até acidente aprende a ser recurso.',
  },
  c_elemental: {
    epithet: 'Éter que Anda',
    factionId: 'eter',
    story:
      'O Elemental é Éter condensado até criar vontade, casca e mau humor. Seu corpo parece vidro vivo, mas o primeiro golpe encontra apenas o reflexo: Escudo Arcano. O encanto quebra, a criatura permanece, e o inimigo precisa explicar ao próprio braço por que aquilo ainda está andando.',
  },
  c_maga: {
    epithet: 'Aprendiz de Tempestades',
    factionId: 'eter',
    story:
      'Entre a Faísca obediente e a Bola de Fogo respeitável existe a Maga: talentosa, perigosa e ainda discutindo com a mira. Quando entra em campo, solta a carga que vinha ensaiando e causa dois de dano a uma criatura inimiga aleatória. O Conclave chama isso de fase de aprendizado. Os alvos chamam de problema.',
  },
  c_arquimago: {
    epithet: 'O Que Reabriu o Céu',
    factionId: 'eter',
    story:
      'O Arquimago estudou a Fratura de perto o bastante para reproduzir uma versão menor dela — o que diz muito sobre seu gênio e muito pouco sobre seu juízo. Quando pisa no campo, o céu sangra em miniatura e causa dois de dano a todas as criaturas inimigas. Chamá-lo custa caro, porque ninguém reabre uma ferida cósmica pagando pouco.',
  },
  s_lanca_gelo: {
    epithet: 'Inverno Pontiagudo',
    factionId: 'eter',
    story:
      'A Lança de Gelo é Éter resfriado até virar intenção. Foi desenhada para caçar criaturas, não para ferir Cristais: atravessa couraça, escama e carne com três medidas de inverno, mas se desfaz diante de um Comandante. O Conclave anotou a limitação, debateu por três anos e decidiu que estava ótima assim.',
  },
  a_orbe: {
    epithet: 'O Amplificador',
    factionId: 'eter',
    story:
      'O Orbe é um Cristal lapidado por uma geração inteira até não restar aresta que disperse energia. Toda magia que passa por ele sai maior do que entrou, com +1 de dano e zero modéstia. Para o Conclave, não é um artefato; é uma tese redonda demais para ser refutada.',
  },

  // ─── Antigos das Profundezas ──────────────────────────────────
  c_golem: {
    epithet: 'O Muro que Respira',
    factionId: 'profundezas',
    story:
      'Quando a Fratura rachou o solo, uma parte da montanha decidiu levantar. O Golem não corre, não persegue e não negocia: apenas se planta no caminho e Provoca. Muitos exércitos descobriram tarde demais que derrubar uma parede viva exige mais do que coragem decorativa.',
  },
  c_dragao: {
    epithet: 'A Última Coisa que Viram',
    factionId: 'profundezas',
    story:
      'O Dragão dormia abaixo dos reinos quando os reinos ainda eram ideias mal desenhadas. A Fratura abriu sua caverna, e desde então todo Comandante sabe que chamá-lo é caro, lento e absolutamente indecente para quem está do outro lado. Quando suas asas cinzentas cobrem o campo, muitas estratégias se tornam autobiografias curtas.',
  },
  c_morcego: {
    epithet: 'Asa do Abismo',
    factionId: 'profundezas',
    story:
      'O Morcego foi uma das primeiras coisas a escapar pelas rachaduras: pequeno, faminto e multiplicado demais para conforto geral. Custa quase nada chamá-lo, morde mais do que seu tamanho promete e sempre sugere que há outros vindo atrás. O abismo não manda aviso; manda amostra grátis.',
  },
  c_cultista: {
    epithet: 'O Devoto do Nada',
    factionId: 'profundezas',
    story:
      'Ele entregou nome, rosto e medo ao Vazio, e recebeu uma certeza em troca: até sua morte teria serventia. Quando cai, sorri como quem acaba de concluir um contrato. No Estertor, duas medidas de dano alcançam o Comandante inimigo; o corpo era só a carta de apresentação.',
  },
  c_espectro: {
    epithet: 'Fome Antiga',
    factionId: 'profundezas',
    story:
      'O Espectro veio de um lugar que a Fratura não deveria ter aberto. Ele não fere para matar, fere para beber: Drenar transforma cada dano causado em vida devolvida ao Comandante que o chamou. Lutar contra ele é alimentá-lo. Ignorá-lo é deixar a mesa posta.',
  },
  c_horror: {
    epithet: 'O Que Rasteja por Baixo',
    factionId: 'profundezas',
    story:
      'Grande demais para caber num nome e antigo demais para se importar com nomes, o Horror rasteja por baixo do campo e da razão. Cada bocado que arranca do inimigo volta como vida para seu Comandante, Drenar em escala de pesadelo. Os Antigos não o comandam de verdade; apontam uma direção e torcem para ele aceitar.',
  },
  s_pacto: {
    epithet: 'Três Segredos por Três Gotas',
    factionId: 'profundezas',
    story:
      'O Vazio é o único credor de Aurélia que nunca nega empréstimo e nunca parcela cobrança. Três cartas surgem na mão do Comandante; três medidas de vida deixam seu corpo na mesma respiração. Todo conjurador jura que fará o pacto uma única vez. A estatística, fofíssima, discorda.',
  },
  c_renegado: {
    epithet: 'O Que a Dor Aguça',
    factionId: 'profundezas',
    story:
      'O Renegado já lutou por três bandeiras e enterrou as três com a mesma pá. Hoje luta pela própria pele e pela do Comandante que ainda pode pagar. Quando o Cristal do portador fraqueja, sua Resistência desperta: ganha +2 de ataque e Investida, porque o perigo transforma sobrevivente em lâmina.',
  },

  // ─── A Maré Sem Rei ───────────────────────────────────────────
  c_grumete: {
    epithet: 'Primeiro no Convés',
    factionId: 'mares',
    story:
      'O Grumete é o menor contrato da Maré: uma faca, um sorriso torto e uma pressa criminosa de virar história. Investida: pula no abalroamento antes de a prancha encostar, porque quem espera permissão chega tarde no saque. Metade não volta. A metade que volta aprende a dar ordens.',
  },
  c_corsaria: {
    epithet: 'Mão Leve de Salobra',
    factionId: 'mares',
    story:
      'No porto franco de Salobra, ela é lenda de taverna e pesadelo de capitão. A Corsária não rouba só carga; rouba oportunidade. Quando entra em campo, traz um estilhaço de Éter que ninguém viu sair de lugar nenhum e concede um ponto de energia neste turno. A mão dela nunca se move. O bolso dos outros, sim.',
  },
  c_aguaviva: {
    epithet: 'Lanterna Afogada',
    factionId: 'mares',
    story:
      'A Água-viva cresceu presa a um Cristal Afogado até seu corpo virar lâmpada viva de Éter. Flutua bonita demais para ser confiável, o que no mar costuma ser uma tese sólida. No Estertor, explode em clarão e causa um de dano a cada criatura inimiga. Corsários a recolhem com redes de vidro e uma humildade raríssima.',
  },
  c_sereia: {
    epithet: 'A Voz que Desfaz Juras',
    factionId: 'mares',
    story:
      'Marinheiros tapam os ouvidos com cera não porque temem morrer, mas porque temem concordar. A Sereia canta e desfaz juramentos, puxando uma criatura inimiga de volta à mão de quem a chamou, como se a própria vontade tivesse mudado de maré. Nenhuma corrente segura quem decide partir sorrindo.',
  },
  c_tubarao: {
    epithet: 'Casco Vermelho',
    factionId: 'mares',
    story:
      'Criado sob os galeões da Maré, o Tubarão aprendeu a seguir batalha pelo gosto de ferro na água. Investida: ataca no turno em que chega, porque não precisa ver o inimigo para saber que ele sangra. Chamam-no de Casco Vermelho. Quem pergunta o motivo geralmente vira resposta.',
  },
  c_serpente: {
    epithet: 'A Primeira Dobra do Mar',
    factionId: 'mares',
    story:
      'Antes dos mapas, antes dos portos e talvez antes da coragem, a Serpente já dobrava o mar por baixo. Suas escamas, banhadas por eras no Éter de um Cristal Afogado, anulam o primeiro dano com Escudo Arcano. O segundo golpe precisa vir de alguém que ainda esteja no barco, e isso reduz bastante a fila.',
  },
  c_kraken: {
    epithet: 'O Porto Que Afunda Portos',
    factionId: 'mares',
    story:
      'O Kraken não é apenas um monstro; é uma lembrança ruim que o oceano se recusa a esquecer. Salmarra, o porto afundado, foi só a cidade mais famosa a descobrir isso. Provoca porque nada passa por ele: não há rota, praia ou coragem suficiente. E, no Estertor, dois tentáculos continuam lutando onde o corpo caiu. Do Kraken se mata o meio; as pontas ficam ofendidas.',
  },
  s_maremoto: {
    epithet: 'A Conta da Maré',
    factionId: 'mares',
    story:
      'A Maré Sem Rei não perdoa dívida; ela apenas espera a lua certa para cobrar com juros. O Maremoto sobe sem perguntar nome e causa três medidas de dano a todas as criaturas inimigas, lavando o campo como quem limpa convés depois de motim. Depois recua manso, porque crueldade com elegância ainda é crueldade.',
  },
  t_abordagem: {
    epithet: 'Prancha ao Mar!',
    factionId: 'mares',
    story:
      'Duas palavras bastam para transformar tripulação em lâmina. Uma criatura aliada ganha +1 de ataque e ataca imediatamente neste turno, porque abordagem que espera deixa de ser ameaça e vira visita. Na Maré, ordem escrita vale pouco; o grito certo, no segundo certo, vale um navio inteiro.',
  },
  t_saque: {
    epithet: 'X Marca o Lugar',
    factionId: 'mares',
    story:
      'O mapa foi roubado do camarote de um capitão que não precisava mais dele, principalmente por estar morto. O X marca o lugar, compra uma carta e traz um sopro de energia para este turno, como vento favorável entrando na vela. Na Maré, tesouro pertence a quem chega primeiro — e moral costuma chegar nadando atrás.',
  },
  a_figura: {
    epithet: 'A Guardiã do Casco',
    factionId: 'mares',
    story:
      'Entalhada à imagem de uma sereia real, talvez com permissão, talvez com uma aposta muito mal explicada, a Figura de Proa protege o navio como se ainda cantasse. A cada turno, concede um ponto de escudo, aparando o primeiro castigo antes que a madeira reclame. Nenhum capitão da Maré zarpa sem uma. Os que tentaram viraram boato náutico.',
  },
};

/** Cartas de uma tradição, na ordem do catálogo. */
export function cardsOfFaction(factionId: string, cardIds: string[]): string[] {
  return cardIds.filter((id) => CARD_LORE[id]?.factionId === factionId);
}
