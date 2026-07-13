/**
 * O universo de Legends Clash e as histórias do Arquivo de Aurélia.
 *
 * Este arquivo reúne apenas conteúdo narrativo para a camada de apresentação.
 * O servidor não depende dessas informações. A estrutura segue o padrão de
 * `CardArt.tsx`: um mapa de `defId` para dados que amplia o catálogo de
 * `@legendsclash/shared` sem acoplar regras de jogo.
 *
 * Cada carta ocupa um lugar no mesmo mundo. A narrativa também traduz, dentro
 * da ficção, elementos que o jogador encontra na mesa, como a proteção do
 * Comandante, o retorno da energia e a fadiga.
 */

export interface Faction {
  id: string;
  name: string;
  sigil: string; // id do ícone do brasão, resolvido via SIGIL_ICONS no cliente
  color: string; // cor de acento alinhada à paleta da arte
  /** Lema curto exibido sob o nome. */
  motto: string;
  /** Descrição do lugar da tradição no mundo. */
  blurb: string;
}

export interface CardLore {
  /** Epíteto ou título honorífico da carta. */
  epithet: string;
  factionId: string;
  /** Narrativa de uma ou mais frases ambientadas no universo. */
  story: string;
}

/** O mundo e a moldura que ligam todas as cartas. */
export const WORLD = {
  realm: 'Aurélia',
  tagline: 'Um reino partido, sustentado pelas lembranças de um céu que caiu.',
  intro: [
    'Aurélia já foi uma só terra, banhada pela Aurora e governada por estradas que ligavam o litoral às montanhas do norte. Na noite da Fratura, o firmamento rachou. Milhares de fragmentos luminosos atravessaram as nuvens e se enterraram em muralhas, florestas, torres, desertos e fossas oceânicas. Eram os Cristais de Éter. Ao redor deles, a realidade aprendeu novas regras.',
    'Os Cristais guardam lembranças. Vozes, batalhas, criaturas e juramentos permanecem gravados em sua luz, formando uma memória comum chamada Arquivo de Aurélia. Poucos conseguem ouvi-la sem perder a própria identidade. Esses poucos se tornam Comandantes, capazes de abrir o Arquivo e chamar ao presente ecos de lendas que o mundo se recusa a esquecer.',
    'Quando dois Cristais despertos se aproximam, suas memórias entram em conflito e começa um Embate. Cada chamado consome Éter. A luz retorna em ciclos, como uma aurora comprimida dentro do próprio Cristal, e o Comandante precisa acompanhar esse pulso. Quando todas as lembranças disponíveis já foram invocadas, insistir no chamado cobra outra coisa: primeiro o fôlego, depois a vida.',
    'A Fratura não criou uma única resposta. A Vanguarda tenta reunir o reino sob a antiga luz. O Pacto Silvano protege as terras que cresceram livres das coroas. O Conclave estuda o Éter como quem decifra uma língua perigosa. Nas profundezas, seres anteriores à história voltaram a se mover. Sob o oceano, Cristais Afogados abriram rotas que pertencem à Maré Sem Rei, onde nenhuma bandeira permanece hasteada por muito tempo.',
  ],
  storyBeats: [
    {
      icon: 'arcane',
      kicker: 'Origem',
      title: 'O céu deixou cicatrizes',
      text: 'A Fratura espalhou Cristais de Éter por Aurélia e alterou tudo o que encontrou, da pedra ao fundo do mar.',
    },
    {
      icon: 'shield',
      kicker: 'Presente',
      title: 'O Arquivo preserva as lendas',
      text: 'Comandantes acessam a memória dos Cristais e trazem antigos juramentos, criaturas e feitiços para novos Embates.',
    },
    {
      icon: 'death',
      kicker: 'Preço',
      title: 'Toda invocação deixa uma marca',
      text: 'O Éter retorna em ciclos, mas o Arquivo tem limites. Depois da última lembrança, o Cristal passa a cobrar vida.',
    },
  ],
  /** Notas que ligam as regras à história, exibidas no rodapé do Arquivo. */
  codexNotes: [
    {
      icon: 'shield',
      title: 'Por que as criaturas protegem o Comandante',
      text: 'O chamado prende cada lenda à luz do Cristal que a trouxe. Enquanto uma delas permanecer no campo, seu juramento forma uma barreira ao redor do Comandante. Para alcançá-lo, o inimigo precisa romper primeiro essa muralha de carne, metal, raiz ou magia.',
    },
    {
      icon: 'light',
      title: 'Como a energia retorna',
      text: 'Durante um Embate, o Cristal pulsa como um pequeno amanhecer. A cada novo ciclo, recompõe parte do Éter gasto e amplia sua capacidade até atingir o limite que consegue sustentar. A força de um Comandante depende tanto do poder que invoca quanto do momento em que decide usá-lo.',
    },
    {
      icon: 'death',
      title: 'O que acontece quando o Arquivo se esgota',
      text: 'Depois que a última lembrança disponível foi chamada, resta apenas o silêncio do Cristal. Quem tenta arrancar dele uma nova resposta oferece a própria vitalidade em troca. O preço cresce a cada tentativa, pois nenhuma memória pode ser forçada para sempre.',
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
      'A Vanguarda nasceu entre as ruínas da antiga capital e jurou reunir Aurélia. Seus soldados marcham em formações cerradas, guardam os Comandantes como portadores de uma chama sagrada e acreditam que disciplina é o primeiro passo para reconstruir o reino. Nem todos concordam com a ordem que pretendem restaurar.',
  },
  silvanos: {
    id: 'silvanos',
    name: 'O Pacto Silvano',
    sigil: 'wolf',
    color: '#3fb950',
    motto: 'A mata vê tudo. A mata espera.',
    blurb:
      'Elfos, feras e espíritos formaram o Pacto nas florestas que cresceram sobre as bordas da Fratura. Eles defendem rios, clareiras e trilhas antigas contra qualquer poder que tente possuí-los. Observam por muito tempo, escolhem o terreno e atacam quando o invasor já não sabe encontrar a saída.',
  },
  eter: {
    id: 'eter',
    name: 'O Conclave do Éter',
    sigil: 'arcane',
    color: '#7fb1ff',
    motto: 'Todo Cristal é uma pergunta.',
    blurb:
      'O Conclave reúne estudiosos que enxergam escrita na luz dos Cristais. Seus laboratórios transformam padrões de Éter em runas, relâmpagos e formas de vida instáveis. Cada descoberta amplia o domínio sobre a Fratura e também a chance de repetir o desastre que a originou.',
  },
  profundezas: {
    id: 'profundezas',
    name: 'Os Antigos das Profundezas',
    sigil: 'dragon',
    color: '#ff8c6e',
    motto: 'O que dormia, acordou.',
    blurb:
      'Sob as montanhas e cidades soterradas, a Fratura despertou seres que já eram velhos antes do primeiro reino. Golems, dragões, espectros e devotos do Vazio avançam sem formar um exército verdadeiro. O que os une é a mesma origem escura e a certeza de que a superfície ocupou terras que nunca lhe pertenceram.',
  },
  mares: {
    id: 'mares',
    name: 'A Maré Sem Rei',
    sigil: 'tide',
    color: '#38d1c2',
    motto: 'O mar não jura lealdade.',
    blurb:
      'Corsários, sereias, monstros abissais e ladrões de vento percorrem as rotas abertas pelos Cristais Afogados. Cada tripulação segue seu próprio código até surgir uma oportunidade melhor. A Maré chega depressa, luta em movimento e desaparece antes que a costa consiga contar o que perdeu.',
  },
};

export const CARD_LORE: Record<string, CardLore> = {
  // Vanguarda da Aurora
  c_recruta: {
    epithet: 'O Primeiro na Linha',
    factionId: 'vanguarda',
    story:
      'Elian Varo cresceu no bairro dos oleiros de Lúmen, reconstruído tantas vezes que ninguém sabia mais onde terminavam as casas antigas. Entrou para a Vanguarda para ajudar a mãe a recuperar a oficina tomada pela guerra e porque acreditava que um uniforme impediria seu nome de desaparecer entre as ruínas. Garran Valeferro lhe ensinou a firmar os pés; Mara Seral lhe ensinou que coragem sem atenção mata quem está ao lado. Elian ainda avança cedo demais quando o clarim soa. O que parece bravura nasce do medo de chegar tarde, como chegou na noite em que seu pai não voltou para casa. Iria Solen já o trouxe de volta da beira da morte duas vezes. Ele evita perguntar quantas chances a Aurora concede a um mesmo homem.',
  },
  c_cavaleiro: {
    epithet: 'Veterano de Três Guerras',
    factionId: 'vanguarda',
    story:
      'Garran Valeferro serviu a três brasões e viu os três desaparecerem sob cinza, disputa e fome. Desde então, mede uma causa pelo destino que reserva aos soldados depois da vitória. Tornou-se mestre de Mara Seral e, contra o próprio juízo, tomou Elian Varo como segundo aprendiz. Ensina os dois a sobreviver, embora nunca tenha aprendido a abandonar uma posição perdida. Durante a Guerra das Pontes, poupou Kael Dorn quando recebeu ordem de executá-lo. Anos depois, encontrou o antigo prisioneiro lutando por outra bandeira e passou a carregar aquela escolha como dúvida, não como arrependimento. Garran deseja viver o bastante para ver seus aprendizes sem armadura. Seu maior medo é descobrir que a Vanguarda só sabe preparar jovens para a próxima ruína.',
  },
  c_campea: {
    epithet: 'Estandarte Vivo da Aurora',
    factionId: 'vanguarda',
    story:
      'Lysandra Alvor era filha de uma magistrada da antiga capital e aprendeu cedo que a ordem pode proteger uma praça e esmagar quem vive fora de seus portões. Na queda da Porta Oriental, manteve a formação até o amanhecer e saiu do cerco como símbolo de uma Vanguarda que já não sabia em quem confiar. Ela quer reunir Aurélia, mas se recusa a reconstruir o mesmo reino que ajudou a parti-la. Essa posição lhe rendeu a lealdade de Garran e a vigilância dos juízes da Aurora. No Bosque de Ilyr, Lysandra baixou a espada diante de Aruan, o Cervo-Rei, e aceitou interromper uma estrada militar que cortaria as raízes sagradas. O acordo evitou uma guerra e quase lhe custou o comando. Desde então, teme menos a derrota do que o dia em que obedecerá por cansaço.',
  },
  s_bencao: {
    epithet: 'A Luz que Restaura',
    factionId: 'vanguarda',
    story:
      'A Bênção nasceu nas tendas de campanha, pronunciada em voz baixa por curadores que já não tinham faixas nem remédios. Sua luz aquece a carne, fecha o que ainda pode ser salvo e devolve ao Comandante o fôlego necessário para permanecer no Embate.',
  },
  a_escudo: {
    epithet: 'A Muralha Pessoal',
    factionId: 'vanguarda',
    story:
      'Ferreiros da Aurora moldam esses escudos com metal retirado das antigas muralhas. Cada marca na superfície registra um golpe que não chegou ao portador. Ele não encerra batalhas. Oferece o instante exato em que uma derrota ainda pode mudar de rumo.',
  },
  a_estandarte: {
    epithet: 'O Brado que Inspira',
    factionId: 'vanguarda',
    story:
      'O tecido conserva fuligem de cercos e nomes costurados por mãos diferentes. Garran Valeferro carregou-o na Guerra das Pontes; Lysandra Alvor o perdeu entre as chamas da Porta Oriental; Mara Seral recuperou um fragmento sob os escombros. Quando volta a tremular, cada combatente reconhece que a formação é feita de pessoas que recusaram desaparecer. A lembrança passa de lâmina em lâmina e fortalece toda a linha.',
  },
  t_reforcos: {
    epithet: 'O Clarim Distante',
    factionId: 'vanguarda',
    story:
      'Três notas atravessam a fumaça e alcançam os postos mais afastados. Quem as escuta abandona a fogueira, aperta as correias e corre na direção do combate. A Vanguarda conhece muitas canções de vitória, mas nenhuma soa tão bem quanto passos aliados chegando a tempo.',
  },
  c_escudeira: {
    epithet: 'A Que Segura a Porta',
    factionId: 'vanguarda',
    story:
      'Mara Seral foi entregue ainda criança ao quartel de Lúmen como pagamento de uma dívida que não era sua. Garran Valeferro a colocou atrás de um escudo, ensinou-lhe as letras gravadas nas bordas e nunca voltou a chamá-la de serva. No último dia do cerco, ele ordenou que Mara conduzisse os feridos para fora da fortaleza enquanto permanecia na passagem. Ela obedeceu e voltou tarde demais. O Arquivo preserva Garran em muitos momentos, mas Mara só se lembra do corpo sob as pedras. Desde então, protege todos como se pudesse corrigir aquela ausência. Elian Varo é o alvo mais frequente de sua vigilância e de sua impaciência. Mara deseja tornar-se cavaleira sem herdar a disposição de Garran para morrer por uma ordem. Sua fraqueza é não perceber quando proteção começa a se parecer com prisão.',
  },
  c_cleriga: {
    epithet: 'Voz do Amanhecer',
    factionId: 'vanguarda',
    story:
      'Iria Solen nasceu durante um eclipse e passou a infância ouvindo que a Aurora lhe cobraria aquela falta de luz. Tornou-se clériga para provar que a graça não escolhe o momento do nascimento. Nos campos de Lúmen, aprendeu a reconhecer soldados pela respiração antes de ver seus rostos. Salvou Elian Varo duas vezes e chegou tarde demais para Garran Valeferro, uma falha que ainda interrompe seu canto nas noites silenciosas. Iria mantém amizade cautelosa com Nara Veyr, do Conclave, e troca com ela métodos de cura que os superiores de ambas as tradições preferem ignorar. Seu desejo é fundar um hospital onde ninguém precise jurar lealdade antes de receber cuidado. Seu medo mais íntimo não é perder a fé, mas descobrir que a luz responde apenas porque o Cristal exige algo em troca.',
  },
  c_templario: {
    epithet: 'O Muro que Marcha',
    factionId: 'vanguarda',
    story:
      'Odran Cael fez seu primeiro voto diante dos reis antigos e seu segundo diante das ruínas deixadas por eles. Como jovem templário, ajudou a sufocar a revolta de Vale Seco porque acreditava que toda desobediência anunciava outra Fratura. Anos depois, encontrou nos registros do Arquivo os nomes das famílias mortas e reconheceu entre elas pessoas que só pediam água. Desde então, serve como guarda de Lysandra Alvor, cuja coragem de contrariar o próprio conselho lhe oferece uma forma tardia de redenção. Odran suporta qualquer golpe dirigido a ela, mas hesita diante de ordens que lembram o passado. Deseja transformar o voto em abrigo, não em licença para punir. Sua maior fraqueza é achar que o sofrimento presente pode pagar uma dívida antiga. Alguns inimigos já aprenderam a conduzi-lo pela culpa.',
  },
  s_julgamento: {
    epithet: 'A Sentença Luminosa',
    factionId: 'vanguarda',
    story:
      'Os juízes da Aurora gravam o nome do acusado em uma lâmina de vidro e a erguem diante do Cristal. A luz atravessa a inscrição, fere o alvo e retorna ao Comandante como calor restaurador. Em um único clarão, a ordem pune a ameaça e ampara quem pronunciou a sentença.',
  },
  a_relicario: {
    epithet: 'A Chama que Não Apaga',
    factionId: 'vanguarda',
    story:
      'Dentro do relicário arde uma centelha recolhida na manhã seguinte à Fratura. Ela é pequena, constante e resistente ao tempo. A cada novo ciclo do Embate, uma parte desse brilho se transfere ao portador e mantém sua vida acesa por mais um instante.',
  },

  // Pacto Silvano
  c_lobo: {
    epithet: 'Caçador do Crepúsculo',
    factionId: 'silvanos',
    story:
      'Bruma era o único filhote vivo quando Maelis Virdan encontrou uma alcateia abatida perto das clareiras queimadas de Ilyr. A arqueira o carregou dentro do manto até o coração da floresta, e desde então os dois reconhecem o perigo pelo mesmo silêncio. Bruma caça para proteger as crias que agora dormem onde sua antiga toca virou carvão. O cheiro de óleo, ferro quente e sinos de marcha o devolve à noite do incêndio. Nessas horas, abandona qualquer cautela e avança antes do sinal de Maelis. Aruan tolera sua ferocidade porque sabe de onde ela vem; Tavren teme o dia em que o lobo seguirá uma lembrança até uma armadilha. Bruma não deseja território além do que pode percorrer ao anoitecer. Só quer que nenhuma fogueira humana alcance outra toca.',
  },
  c_arqueira: {
    epithet: 'A Que Nunca Erra Duas Vezes',
    factionId: 'silvanos',
    story:
      'Maelis Virdan cresceu ao lado do irmão Tavren nas copas de Ilyr, onde crianças aprendem a ler o vento antes das palavras. Tornou-se arqueira depois que uma coluna da Vanguarda incendiou a mata para abrir uma estrada e deixou para trás o filhote que ela chamou de Bruma. Maelis deseja manter o Pacto livre de muralhas, mapas e tratados escritos por gente de fora. Por isso recebeu com desconfiança a trégua entre Lysandra Alvor e Aruan, embora tenha sido sua flecha que impediu um fanático de romper o encontro. Ela ama o irmão, mas teme as visões que o afastam cada vez mais do presente. Sua precisão esconde uma fraqueza menos admirável: Maelis prefere acertar um inimigo a admitir que julgou alguém cedo demais. Syrra Folha-Lâmina não perde uma oportunidade de lembrá-la disso.',
  },
  t_recuo: {
    epithet: 'Some na Mata',
    factionId: 'silvanos',
    story:
      'Os guardiões batem os cajados no solo e a floresta fecha suas trilhas. Raízes se erguem, a névoa cobre o campo e o invasor reaparece longe do combate, de volta ao ponto de onde partiu. Quem atravessa o domínio silvano precisa aceitar que o caminho também escolhe quem pode passar.',
  },
  c_sentinela: {
    epithet: 'Olhos da Copa',
    factionId: 'silvanos',
    story:
      'Tavren Virdan passa tantos dias acima da névoa que os jovens do Pacto dizem que seus pés criaram raízes nos galhos. Ele observa estradas, fumaça e o comportamento das aves, mas também enxerga pulsos de Éter que ninguém mais percebe. Foi o primeiro a notar que as tempestades de Severin Veyr acordavam algo sob as montanhas. Desde então, envia avisos ao Conclave por intermédio de Iria Solen, sem revelar a Maelis toda a extensão do perigo. Tavren deseja impedir uma segunda Fratura, ainda que precise negociar com povos que a irmã despreza. O problema é que já não distingue com segurança uma visão do futuro de uma lembrança deixada pelo Cristal. Seu maior medo é conduzir o Pacto a uma guerra para evitar um desastre que talvez já tenha acontecido apenas dentro de sua cabeça.',
  },
  c_duelista: {
    epithet: 'Lâmina do Crepúsculo',
    factionId: 'silvanos',
    story:
      'Syrra nasceu na antiga capital e foi treinada para duelar em nome de nobres que preferiam preservar as próprias mãos. Abandonou a corte quando recebeu a ordem de executar três guardiões silvanos capturados fora do campo de batalha. O Pacto lhe ofereceu abrigo, mas não confiança. Maelis ainda a chama de lâmina emprestada; Orien Sete-Cordas insiste que nenhuma raiz escolhe o solo onde começa. Syrra quer provar que uma pessoa pode romper a função para a qual foi moldada. Entra em combate rápido demais porque o primeiro movimento é o único momento em que sente controlar o próprio destino. Sua habilidade a tornou orgulhosa, e elogios bem colocados ainda conseguem guiá-la para duelos que deveria recusar. Ela teme menos morrer do que perceber que continua lutando para ser aprovada por alguma corte.',
  },
  c_bardo: {
    epithet: 'O Que Afina Exércitos',
    factionId: 'silvanos',
    story:
      'Orien recebeu o sobrenome depois de unir sete povos do Pacto em uma única canção durante o Cerco das Raízes. Cada corda de seu instrumento pertence a uma comunidade diferente, e nenhuma melodia funciona quando uma delas é silenciada. Ele compôs o canto da trégua entre Lysandra Alvor e Aruan, o que lhe rendeu aplausos dos jovens e acusações de traição dos anciãos. Orien deseja preservar as vozes do Pacto sem transformá-las numa marcha uniforme. Esse cuidado também é sua fraqueza. Costuma ouvir todos os lados até que o tempo de escolher quase tenha passado. Syrra confia nele porque foi o primeiro silvano a perguntar por que ela fugira; Maelis o respeita e se irrita com sua esperança. Orien teme que, um dia, suas canções sirvam para tornar bonita uma guerra que deveria ter impedido.',
  },
  c_cervo: {
    epithet: 'O Rei Sem Coroa',
    factionId: 'silvanos',
    story:
      'Aruan já atravessava Ilyr quando as primeiras pedras da capital ainda eram retiradas das montanhas. Não governa por decreto. A floresta reconhece em seus passos o ritmo que mantém rios, raízes e criaturas no mesmo ciclo. Depois da Fratura, guiou sobreviventes de povos rivais até a clareira onde nasceu o Pacto. Séculos depois, aceitou encontrar Lysandra Alvor e interrompeu com os próprios chifres a lâmina de quem tentou matá-la durante a negociação. Aruan deseja conservar a liberdade da mata, mas sabe que isolamento não deterá o que desperta nas profundezas. Seu medo é ver o Pacto tornar-se outro reino, com fronteiras defendidas em nome de um equilíbrio que já deixou de existir. Sua fraqueza é antiga como ele: demora a mudar de caminho, mesmo quando a floresta ao redor já mudou primeiro.',
  },
  s_canto: {
    epithet: 'O Refrão do Pacto',
    factionId: 'silvanos',
    story:
      'Orien Sete-Cordas compôs o refrão durante o Cerco das Raízes, deixando um trecho incompleto para cada povo do Pacto preencher com a própria memória. No campo, as vozes se encontram e percorrem raízes, peles e cordas de arco. A floresta responde ao conjunto, não ao cantor, e fortalece todos os que mantêm a canção viva.',
  },
  t_matilha: {
    epithet: 'Uivos na Névoa',
    factionId: 'silvanos',
    story:
      'Um uivo parte da encosta e outro responde do vale. Quando a névoa se abre, dois jovens lobos já cruzaram a distância entre o chamado e a presa. O invasor aprende tarde que, no território do Pacto, nenhum caçador está realmente sozinho.',
  },

  // Conclave do Éter
  s_faisca: {
    epithet: 'O Primeiro Truque',
    factionId: 'eter',
    story:
      'Todo aprendiz começa tentando separar um único fio de Éter do brilho do Cristal. A maioria queima os dedos. Os melhores aprendem a soltá-lo no instante certo, e essa pequena descarga já foi suficiente para encerrar mais Embates do que muitos mestres admitem.',
  },
  s_bola_de_fogo: {
    epithet: 'Fúria Concentrada',
    factionId: 'eter',
    story:
      'A Bola de Fogo exige cálculo, respiração firme e espaço para errar longe dos aliados. O Éter se comprime até ganhar peso, atravessa o campo e rompe sua forma no impacto. Depois da explosão, até os estudiosos mais vaidosos costumam respeitar alguns segundos de silêncio.',
  },
  s_fortalecer: {
    epithet: 'Runa de Vigor',
    factionId: 'eter',
    story:
      'A runa é desenhada no ar e fechada sobre o corpo de um aliado. Linhas azuis percorrem músculos, couro e metal, reforçando tudo o que encontram. O Conclave prefere chamar o processo de amplificação estrutural. Quem recebe o encanto costuma chamá-lo apenas de força.',
  },
  s_tempestade: {
    epithet: 'A Ira do Céu Partido',
    factionId: 'eter',
    story:
      'Severin Veyr desenhou a primeira Tempestade a partir das cicatrizes da Fratura. Nara retirou do feitiço três linhas que mantinham a abertura ativa por tempo demais, mas ele nunca reconheceu a correção. Ao completar o traçado, o conjurador abre no alto uma fenda breve e violenta. Relâmpagos descem sobre as fileiras inimigas, e o cheiro de pedra queimada permanece depois que o céu volta a fechar.',
  },
  t_surto: {
    epithet: 'Veia de Éter',
    factionId: 'eter',
    story:
      'Alguns Cristais escondem correntes de energia abaixo de sua luz visível. O Surto rompe uma dessas veias e libera de uma vez o Éter reservado para ciclos futuros. O poder chega rápido. As rachaduras que ficam no Cristal explicam por que nenhum mestre recomenda repetir a prática.',
  },
  c_fada: {
    epithet: 'Centelha Travessa',
    factionId: 'eter',
    story:
      'Lume nasceu de um recipiente que Nara Veyr esqueceu aberto durante uma noite de tempestade. Ao amanhecer, a pequena criatura já havia roubado três chaves, invertido as placas do laboratório e aprendido a repetir a risada de Severin Veyr. Todos a tratam como acidente; Nara foi a primeira a lhe dar um nome. Lume coleciona segredos porque consegue ouvir resíduos de memória presos ao Éter. Foi assim que descobriu o verdadeiro motivo de Severin para reabrir o céu. Desde então, esconde páginas, troca fechaduras e conduz Nara para longe das câmaras proibidas. Seu desejo é permanecer livre e manter a amiga viva. Seu medo é voltar a ser energia sem vontade dentro de um frasco. A curiosidade, porém, sempre a leva exatamente aos lugares dos quais tenta proteger os outros.',
  },
  c_elemental: {
    epithet: 'Éter que Anda',
    factionId: 'eter',
    story:
      'Írix se formou dentro de uma fissura do Orbe Amplificador durante o primeiro experimento de Nara Veyr. Severin queria desmontá-lo para estudar a anomalia, mas Nara percebeu que a criatura recuava ao ouvir instrumentos e se aproximava quando alguém pronunciava padrões simples. Ela lhe deu um nome e, com ele, uma identidade que o Arquivo conseguiu preservar. Írix acompanha Nara porque a reconhece como o ponto estável de sua existência. Deseja compreender por que os seres de carne temem o fim, embora passe os dias reforçando a película de luz que o impede de se desfazer. Sua fraqueza é interpretar toda promessa de forma literal. Lume já o convenceu a guardar uma porta por três dias porque ninguém especificou quando a ordem terminava.',
  },
  c_maga: {
    epithet: 'Aprendiz de Tempestades',
    factionId: 'eter',
    story:
      'Nara Veyr foi encontrada ainda criança no centro de uma cratera de Éter, ilesa e sem qualquer lembrança anterior. Severin a acolheu, deu-lhe seu sobrenome e passou a tratá-la como prova de que a Fratura podia devolver aquilo que havia tomado. Nara cresceu entre cálculos, expectativas e portas que nunca deveria abrir. Quer usar o Éter para curar regiões alteradas pelo desastre, projeto que desenvolve em segredo com Iria Solen. Ao mesmo tempo, teme carregar dentro de si a mesma anomalia que consumiu seu mestre. Lume e Írix são as primeiras vidas que escolheu proteger por vontade própria. Nara reúne poder com facilidade, mas sua pressa desvia a descarga quando a emoção vence o cálculo. Cada erro reforça a voz de Severin dizendo que só disciplina absoluta pode impedir outra catástrofe.',
  },
  c_arquimago: {
    epithet: 'O Que Reabriu o Céu',
    factionId: 'eter',
    story:
      'Severin Veyr perdeu a companheira, Adea, na noite da Fratura. Nenhum corpo foi encontrado, apenas uma sequência de luz que ele passou quarenta anos tentando reconstruir. Quando encontrou Nara no centro de uma cratera, convenceu-se de que o céu podia devolver os desaparecidos. A partir daí, toda descoberta se tornou degrau para o mesmo objetivo. Severin ama a aprendiz, mas a observa como filha e evidência ao mesmo tempo, distinção que Nara aprendeu a sentir mesmo quando ele tenta escondê-la. Seu grande experimento abriu uma ferida menor sobre Aurélia, devastou uma ala do Conclave e despertou Varkhaz sob as montanhas. Ainda assim, Severin acredita ter ouvido a voz de Adea do outro lado. Seu medo não é fracassar. É aceitar que passou a vida inteira conversando com a própria saudade.',
  },
  s_lanca_gelo: {
    epithet: 'Inverno Pontiagudo',
    factionId: 'eter',
    story:
      'A Lança de Gelo nasce quando o Éter é resfriado até perder o brilho e ganhar aresta. Ela atravessa pele, couraça e escama, mas se desfaz ao tocar a luz concentrada de um Comandante. O Conclave ainda discute se isso é uma limitação ou uma forma rara de prudência.',
  },
  a_orbe: {
    epithet: 'O Amplificador',
    factionId: 'eter',
    story:
      'Uma geração de lapidários trabalhou no Orbe até eliminar toda aresta capaz de dispersar energia. Feitiços atravessam seu núcleo e saem mais intensos, como se o Cristal repetisse a ordem com uma voz maior. Pequenas fissuras internas sugerem que o artefato também se lembra de cada passagem.',
  },

  // Antigos das Profundezas
  c_golem: {
    epithet: 'O Muro que Respira',
    factionId: 'profundezas',
    story:
      'Orun de Basalto foi moldado por um povo cujo nome desapareceu antes da primeira dinastia de Aurélia. A ordem gravada em seu peito é simples: ninguém atravessa o limiar enquanto o último herdeiro dormir. Ele cumpriu a sentença por milênios, mesmo depois que os corredores ruíram e os herdeiros deixaram de existir. Atrás de Orun repousava Varkhaz. Quando a tempestade de Severin abriu a montanha, o dragão passou pelo guardião porque carregava no sangue a marca que a pedra reconhecia. Desde então, Orun percorre a superfície procurando outro limiar para proteger. Deseja receber uma ordem que ainda tenha sentido. Teme descobrir que sua vigília nunca protegeu ninguém. Sua fraqueza permanece escrita na rocha: obedece às palavras exatas, mesmo quando compreende que o resultado será desastroso.',
  },
  c_dragao: {
    epithet: 'A Última Coisa que Viram',
    factionId: 'profundezas',
    story:
      'Varkhaz reinava sobre os céus antes que os humanos dessem nomes às montanhas. Os primeiros reis caçaram sua espécie, tomaram os ninhos elevados e transformaram ovos de dragão em relíquias da Aurora. Ele sobreviveu enterrando-se sob a pedra, cercado pelos ossos da própria linhagem. A ferida aberta por Severin Veyr rompeu seu sono e lhe trouxe o cheiro dos Cristais usados pela Vanguarda. Varkhaz deseja encontrar o último ovo que acredita ainda existir entre os relicários de Lúmen. O desejo o torna paciente quando a fúria pediria fogo. Seu medo é chegar tarde e descobrir que é, de fato, o último. Lysandra sabe o que ele procura e mantém a informação em segredo, pois teme que a verdade sobre as relíquias destrua a fé que ainda sustenta seu povo.',
  },
  c_morcego: {
    epithet: 'Asa do Abismo',
    factionId: 'profundezas',
    story:
      'Nix foi a primeira criatura a seguir Edras Venn quando o antigo arquivista desceu às câmaras do Vazio. O morcego aprendeu a reconhecer sua voz antes que ele abandonasse o próprio nome. Desde então, carrega fragmentos de sussurros entre fendas que nenhum mensageiro humano atravessaria. Nix busca qualquer fonte de luz porque o Éter vibra em seus ossos finos e lhe parece uma canção impossível de ignorar. Esse impulso o torna útil e fácil de atrair. Edras diz que o animal não sente lealdade, apenas fome. Mesmo assim, Nix sempre retorna ao mesmo ombro quando o culto silencia. O que ele teme é a ausência completa de som, pois nasceu nas profundezas onde até o próprio bater de asas pode desaparecer sem eco.',
  },
  c_cultista: {
    epithet: 'O Devoto do Nada',
    factionId: 'profundezas',
    story:
      'Edras Venn foi arquivista do Conclave e ajudou Severin Veyr a organizar os primeiros diagramas da Fratura. Enquanto o mestre procurava vozes dentro da luz, Edras passou a estudar os intervalos entre uma lembrança e outra. Ali encontrou o Vazio, uma presença que prometia libertar Aurélia do ciclo de repetir guerras antigas por meio do Arquivo. Para selar o pacto, entregou o nome, mas não conseguiu apagá-lo dos registros nem da memória de Nara, que ainda o chama como antes. Edras deseja destruir os Cristais para que os mortos deixem de ser convocados. Teme que, sem as vozes do Vazio, reste apenas um homem culpado pelo que fez. Sua morte é parte do ritual, embora Nix e a hesitação que surge ao encontrar Nara revelem que nem toda humanidade foi entregue.',
  },
  c_espectro: {
    epithet: 'Fome Antiga',
    factionId: 'profundezas',
    story:
      'Sael do Vau Verde foi um batedor silvano enviado para investigar a primeira cratera aberta nas bordas de Ilyr. Tavren ainda era criança quando o viu partir; Maelis conhece seu rosto apenas pelos entalhes mantidos na árvore da família. Sael caiu numa fenda onde o Éter não guardava lembranças, apenas fome. Voltou anos depois como espectro, incapaz de atravessar a luz plena e obrigado a roubar calor para conservar forma. Em raros momentos, segue o cheiro das folhas até a fronteira do Pacto e observa de longe aqueles que deveriam reconhecê-lo. Seu desejo é lembrar o caminho de casa. Seu medo é chegar à clareira e sentir apenas fome diante dos próprios parentes. Tavren sabe quem ele é, mas ainda não encontrou coragem para contar à irmã.',
  },
  c_horror: {
    epithet: 'O Que Rasteja por Baixo',
    factionId: 'profundezas',
    story:
      'Uroth não nasceu como as criaturas da superfície. Cresceu ao redor de um Cristal soterrado, alimentando-se do calor que a pedra perdia a cada século. Orun de Basalto manteve a passagem selada enquanto pôde, mas o despertar de Varkhaz abriu fendas largas o bastante para o monstro seguir os pulsos do Éter. Uroth não distingue um Comandante de uma fogueira. Ambos são fontes de vida em um mundo que sempre conheceu frio. Ele avança sob o solo e devolve ao Cristal que o chamou parte do calor devorado, como uma cria alimentando algo que considera maior que si. Teme o céu aberto e recua diante de chamas sem Éter. Essa aversão é a única fraqueza conhecida, embora poucos sobrevivam perto o bastante para usá-la.',
  },
  s_pacto: {
    epithet: 'Três Segredos por Três Gotas',
    factionId: 'profundezas',
    story:
      'Edras Venn encontrou o ritual escrito nos espaços vazios de um códice do Conclave. Três gotas de sangue sobre um fragmento escuro abrem lembranças que o Arquivo se recusava a mostrar. O conhecimento chega inteiro, junto da fraqueza deixada pela cobrança. Cada praticante promete recorrer ao Pacto uma única vez, repetindo as mesmas palavras que Edras pronunciou antes de perder o nome.',
  },
  c_renegado: {
    epithet: 'O Que a Dor Aguça',
    factionId: 'profundezas',
    story:
      'Kael Dorn vestiu primeiro o dourado da Vanguarda, depois o verde de uma companhia silvana e, por fim, o azul roubado de um navio da Maré. Em cada lugar encontrou alguém disposto a pedir sua vida em nome de uma causa. Garran Valeferro o poupou durante a Guerra das Pontes e lhe ofereceu uma segunda chance que Kael interpretou como humilhação. Cira Salobra mais tarde o contratou para atravessar as ruínas submersas de Salmarra, onde ele ouviu o Vazio chamá-lo pelo nome. Hoje, luta por pagamento e abandona o campo antes que surjam juramentos. Deseja provar que toda lealdade é apenas uma forma elegante de dívida. Seu medo é morrer sob outra bandeira. Sua fraqueza é continuar voltando para salvar pessoas das quais afirma não precisar, sobretudo quando o Cristal do Comandante começa a falhar.',
  },

  // A Maré Sem Rei
  c_grumete: {
    epithet: 'Primeiro no Convés',
    factionId: 'mares',
    story:
      'Timo ganhou o nome Três-Nós porque foi o que conseguiu fazer antes de Cira Salobra perceber que ele havia embarcado escondido. Veio de uma vila de pescadores destruída pela onda que seguiu a queda de Salmarra e acredita que o irmão mais velho foi levado, não morto. Tornar-se capitão é, para ele, a única maneira de comandar uma busca que ninguém mais considera sensata. Timo salta primeiro nas abordagens para provar que merece permanecer no navio. Só Lúmia, a Água-viva, conhece o segredo que ele guarda da tripulação: Timo nunca aprendeu a nadar. Cira vê nele a mesma pressa que quase matou sua antiga tripulação e tenta ensiná-lo sem revelar o próprio afeto. O medo de ser deixado em terra firme o empurra para riscos que nenhum marinheiro experiente aceitaria.',
  },
  c_corsaria: {
    epithet: 'Mão Leve de Salobra',
    factionId: 'mares',
    story:
      'Cira Salobra era filha de cartógrafos e sobreviveu à noite em que o Kraken arrastou sua cidade para o fundo. Naelira a encontrou entre destroços, manteve-a viva com uma canção e cobrou em troca uma promessa: libertar as sereias presas às minas de Cristais Afogados. Cira tornou-se corsária para reunir tripulação, mapas e poder suficientes para cumprir a dívida, embora conte a todos que busca apenas o coração do monstro. Timo Três-Nós desperta nela um instinto de proteção que considera perigoso; Kael Dorn, um respeito que jamais admite. Cira rouba Éter porque nenhum reino vende liberdade a preço justo. Seu maior medo é tornar-se como os capitães que sacrificam a tripulação por um objetivo pessoal. Sua fraqueza é não abandonar uma promessa, mesmo quando cumpri-la ameaça todos que ainda confiam nela.',
  },
  c_aguaviva: {
    epithet: 'Lanterna Afogada',
    factionId: 'mares',
    story:
      'Lúmia cresceu presa a um recife de Cristais Afogados explorado por mercadores de Lúmen. Timo a encontrou dentro de uma rede de vidro durante seu primeiro saque e, em vez de vendê-la, cortou as amarras. Desde então, a Água-viva acompanha o navio atraída pelo assobio desafinado do grumete e pela carga de Éter escondida no porão. Seu desejo simples é retornar ao recife quando as correntes estiverem livres de caçadores. Redes fechadas e sinos de mergulho a fazem emitir um brilho de pânico que pode ser visto a léguas. Lúmia é delicada, curiosa e incapaz de controlar a energia acumulada quando ferida. Cira teme usá-la como arma; Timo insiste que ela escolhe ficar. Nenhum dos dois sabe se criaturas feitas de Éter compreendem a diferença entre amizade e abrigo.',
  },
  c_sereia: {
    epithet: 'A Voz que Desfaz Juras',
    factionId: 'mares',
    story:
      'Naelira pertencia ao coro que guardava as rotas profundas antes que navios humanos aprendessem a seguir os Cristais Afogados. Quando mineradores capturaram suas irmãs e prenderam suas vozes em figuras de proa, ela passou a negociar com corsários, monstros e qualquer um capaz de romper as correntes. Salvou Cira Salobra após a queda de Salmarra e tomou dela uma promessa que ainda une as duas. Naelira deseja libertar o coro, mas teme que cada irmã resgatada tenha perdido a própria vontade para a madeira e o Éter. Sua canção desfaz juramentos porque conhece a nota exata em que toda promessa começa a doer. A mesma habilidade também a condena: ela já não sabe quando alguém permanece ao seu lado por escolha. Por isso nunca canta para Cira, mesmo nos momentos em que seria mais fácil fazê-la obedecer.',
  },
  c_tubarao: {
    epithet: 'Casco Vermelho',
    factionId: 'mares',
    story:
      'Rubro começou a seguir o navio de Cira Salobra depois que Timo lançou ao mar metade da carne destinada à tripulação. Cresceu sob o casco, aprendeu o som das correntes de abordagem e passou a atacar tudo o que ameaçasse aquela sombra familiar. Uma cicatriz branca atravessa seu dorso desde o encontro com um tentáculo do Kraken nas ruínas de Salmarra. O cheiro de sangue desperta nele uma fúria que não distingue presa de aliado, razão pela qual Cira proíbe feridos de permanecer perto da amurada. Timo o chama como se chama um cão; Naelira afirma que o animal responde apenas ao tambor do próprio estômago. Rubro deseja pouco além de movimento, alimento e a segurança do casco. Seu medo aparece quando as águas ficam imóveis demais e o pulso do Kraken volta a vibrar no fundo.',
  },
  c_serpente: {
    epithet: 'A Primeira Dobra do Mar',
    factionId: 'mares',
    story:
      'Talássia contornava os abismos antes que o oceano tivesse rotas. Foi ela quem conduziu os primeiros Cristais Afogados para fossas onde sua luz não alcançaria a superfície. O Kraken era então uma criatura menor, guardada por seu corpo entre cânions submersos. Quando os sinos de Salmarra começaram a extrair Éter das profundezas, o chamado enlouqueceu o monstro e transformou os antigos aliados em rivais. Talássia deseja fechar para sempre as rotas abertas pelos humanos, mesmo que isso condene cidades costeiras que agora dependem delas. Naelira tenta convencê-la de que o mar já mudou demais para voltar ao silêncio. A serpente teme o que dorme abaixo dos Cristais mais antigos. Sua armadura de Éter detém o primeiro golpe, mas precisa ser renovada na superfície, onde seu corpo imenso se torna visível e vulnerável.',
  },
  c_kraken: {
    epithet: 'O Porto Que Afunda Portos',
    factionId: 'mares',
    story:
      'Mharok viveu séculos sob a proteção de Talássia, alimentando-se das correntes mornas ao redor dos Cristais Afogados. Os engenheiros de Salmarra instalaram sinos de extração no fundo da baía, e cada toque atravessou o corpo do Kraken como uma ordem que ele não conseguia recusar. Na noite da queda, Mharok tentou destruir a fonte do chamado e levou a cidade junto. Cira Salobra sobreviveu; ele permaneceu preso às ruínas, ainda ouvindo ecos dos sinos entre as pedras. Mharok deseja silêncio, mas já não distingue o som que o tortura das vozes de quem se aproxima. Teme Talássia porque nela reconhece a criatura que um dia o conteve. Quando é abatido, seus tentáculos continuam lutando, cada um carregando uma lembrança incompleta e uma vontade própria. Matar o corpo apenas dispersa o pesadelo.',
  },
  s_maremoto: {
    epithet: 'A Conta da Maré',
    factionId: 'mares',
    story:
      'A água recua primeiro, expondo pedras, âncoras e restos de navios que ninguém lembrava ter perdido. Então o Maremoto retorna com a força acumulada de toda a baía e atravessa as fileiras inimigas. Quando o mar baixa, o silêncio costuma durar mais que a onda.',
  },
  t_abordagem: {
    epithet: 'Prancha ao Mar!',
    factionId: 'mares',
    story:
      'O grito corre pelo convés antes que os cascos terminem de colidir. Uma prancha cai, a tripulação abre passagem e o primeiro aliado atravessa com a fúria de quem já escolheu sua presa. Na Maré, uma ordem vale pelo tempo que leva para chegar ao outro navio.',
  },
  t_saque: {
    epithet: 'X Marca o Lugar',
    factionId: 'mares',
    story:
      'Timo encontrou o mapa no camarote de um capitão afundado e quase o perdeu ao descobrir que o pergaminho tentava voltar sozinho para Salmarra. Cira reconheceu no traçado a caligrafia de sua mãe. Entre manchas de sal, o X revela uma lembrança escondida no Arquivo e uma corrente de Éter favorável ao próximo movimento. Para Cira, o mapa vale menos pelo tesouro do que pelo caminho que ainda pode levar aos mortos.',
  },
  a_figura: {
    epithet: 'A Guardiã do Casco',
    factionId: 'mares',
    story:
      'A Figura de Proa carrega o rosto de uma das irmãs de Naelira, capturada nas minas dos Cristais Afogados. Cira comprou o navio para impedir que a peça fosse levada a outro continente, mas ainda não encontrou um modo de libertar a voz presa à madeira. A cada ciclo, o canto forma uma camada de proteção sobre o casco. Naelira evita olhar diretamente para ela, pois reconhece na melodia uma lembrança que talvez já não pertença à irmã.',
  },
};

/** Cartas de uma tradição, na ordem do catálogo. */
export function cardsOfFaction(factionId: string, cardIds: string[]): string[] {
  return cardIds.filter((id) => CARD_LORE[id]?.factionId === factionId);
}