import { afterEach, describe, expect, it, vi } from 'vitest';
import { Match, type EngineResult, type MatchPlayer } from '../src/game/engine.js';
import { CARDS, STARTING_HP, RECONNECT_GRACE_MS } from '@legendsclash/shared';

function players(n: number): MatchPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `Jogador ${i}`, avatar: '🛡️', commander: '🛡️', accent: '#e3b341', mmr: 1000,
  }));
}

function makeMatch(n = 2, turnSeconds = 60, mulligan = false) {
  let result: EngineResult | null = null;
  const m = new Match(players(n), () => {}, (r) => { result = r; }, turnSeconds, mulligan);
  return { m, result: () => result };
}

const open: Match[] = [];
function track(m: Match): Match {
  open.push(m);
  return m;
}

afterEach(() => {
  for (const m of open.splice(0)) m.dispose();
  vi.useRealTimers();
});

describe('início de partida', () => {
  it('distribui mãos iniciais com compensação para quem joga depois', () => {
    const { m } = makeMatch();
    track(m).start();
    const view0 = m.viewFor('p0');
    // jogador 0 já comprou a carta do turno 1: 4 inicial + 1
    expect(view0.hand.length).toBe(5);
    expect(view0.seats[1].handCount).toBe(5); // 4 cartas + a Moeda do Tempo
    expect(view0.seats[0].hp).toBe(STARTING_HP);
    expect(view0.seats[0].deckCount).toBe(25); // 30 - 4 - 1
  });

  it('quem joga depois recebe a Moeda do Tempo (tempo, não carta extra)', () => {
    const { m } = makeMatch();
    track(m).start();
    // a moeda é um token na mão do seat 1; o seat 0 não a recebe; não sai do deck
    expect(m.seats[1].hand.filter((c) => c.defId === 't_moeda')).toHaveLength(1);
    expect(m.seats[0].hand.some((c) => c.defId === 't_moeda')).toBe(false);
    expect(m.seats[1].deck.length).toBe(26); // 30 - 4 (sem carta extra; a moeda não vem do deck)
  });

  it('a Moeda do Tempo dá +1 de energia no turno (custo 0)', () => {
    const { m } = makeMatch();
    track(m).start();
    const coin = m.seats[1].hand.find((c) => c.defId === 't_moeda')!;
    m.endTurn('p0'); // passa a vez para o seat 1 (1º turno dele: maxEnergy 1)
    expect(m.seats[1].energy).toBe(1);
    m.playCard('p1', coin.iid);
    expect(m.seats[1].energy).toBe(2); // +1 de energia, sem custo
    expect(m.seats[1].hand.some((c) => c.defId === 't_moeda')).toBe(false); // consumida
  });

  it('energia incremental: 1 no primeiro turno, +1 por turno, máx. 10', () => {
    const { m } = makeMatch();
    track(m).start();
    expect(m.viewFor('p0').seats[0].maxEnergy).toBe(1);
    m.endTurn('p0');
    expect(m.viewFor('p1').seats[1].maxEnergy).toBe(1);
    m.endTurn('p1');
    expect(m.viewFor('p0').seats[0].maxEnergy).toBe(2);
  });
});

describe('mulligan (troca da mão inicial)', () => {
  it('entra na fase de mulligan antes do turno 1 quando habilitado', () => {
    const { m } = makeMatch(2, 60, true);
    track(m).start();
    expect(m.viewFor('p0').status).toBe('mulligan');
    // jogar/atacar/passar é bloqueado durante a troca
    expect(() => m.endTurn('p0')).toThrow('Aguarde a troca de mãos.');
  });

  it('trocar cartas devolve ao baralho e recompra a mesma quantidade', () => {
    const { m } = makeMatch(2, 60, true);
    track(m).start();
    const hand0 = m.seats[0].hand.map((c) => c.iid);
    const deckBefore = m.seats[0].deck.length;
    m.mulligan('p0', hand0.slice(0, 2)); // troca 2
    expect(m.seats[0].hand).toHaveLength(hand0.length); // mesma contagem de cartas
    expect(m.seats[0].deck.length).toBe(deckBefore); // 2 saíram, 2 entraram → deck igual
    expect(m.viewFor('p0').status).toBe('mulligan'); // p1 ainda não confirmou
    expect(m.viewFor('p0').seats[0].mulliganDone).toBe(true);
  });

  it('a partida começa no turno 1 quando todos confirmam', () => {
    const { m } = makeMatch(2, 60, true);
    track(m).start();
    m.mulligan('p0', []);
    m.mulligan('p1', []);
    expect(m.viewFor('p0').status).toBe('active');
    expect(m.viewFor('p0').turnSeat).toBe(0);
  });

  it('a Moeda do Tempo não é trocável no mulligan', () => {
    const { m } = makeMatch(2, 60, true);
    track(m).start();
    const coin = m.seats[1].hand.find((c) => c.defId === 't_moeda')!;
    const handLen = m.seats[1].hand.length;
    m.mulligan('p1', m.seats[1].hand.map((c) => c.iid)); // tenta trocar tudo, inclusive a moeda
    expect(m.seats[1].hand.some((c) => c.iid === coin.iid)).toBe(true);
    expect(m.seats[1].hand).toHaveLength(handLen);
  });

  it('confirmar a mão duas vezes é rejeitado', () => {
    const { m } = makeMatch(2, 60, true);
    track(m).start();
    m.mulligan('p0', []);
    expect(() => m.mulligan('p0', [])).toThrow('Você já confirmou sua mão.');
  });

  it('o tempo de troca esgotado confirma as mãos e começa a partida', () => {
    vi.useFakeTimers();
    const { m } = makeMatch(2, 60, true);
    track(m).start();
    expect(m.viewFor('p0').status).toBe('mulligan');
    vi.advanceTimersByTime(31_000); // MULLIGAN_SECONDS = 30
    expect(m.viewFor('p0').status).toBe('active');
  });
});

describe('validação autoritativa', () => {
  it('rejeita ação fora do turno', () => {
    const { m } = makeMatch();
    track(m).start();
    expect(() => m.endTurn('p1')).toThrow('Não é o seu turno.');
  });

  it('rejeita carta sem energia suficiente', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_dragao' }]; // custo 7, energia 1
    expect(() => m.playCard('p0', 'x1')).toThrow('Energia insuficiente.');
  });

  it('rejeita carta que não está na mão', () => {
    const { m } = makeMatch();
    track(m).start();
    expect(() => m.playCard('p0', 'nao-existe')).toThrow('Carta não está na sua mão.');
  });
});

describe('criaturas e combate', () => {
  it('invoca criatura com enjoo de invocação e ataca no turno seguinte', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_lobo' }];
    m.seats[0].energy = 2;
    m.playCard('p0', 'x1');
    expect(m.seats[0].board).toHaveLength(1);
    expect(() => m.attack('p0', 'x1', { seat: 1 }))
      .toThrow('Essa criatura ainda não pode atacar.');

    m.endTurn('p0');
    m.endTurn('p1');
    m.attack('p0', 'x1', { seat: 1 }); // lobo 3 de ataque na cara
    expect(m.seats[1].hp).toBe(STARTING_HP - 3);
    expect(() => m.attack('p0', 'x1', { seat: 1 }))
      .toThrow('Essa criatura já atacou neste turno.');
  });

  it('combate entre criaturas é simultâneo e remove as mortas', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [{
      iid: 'a1', defId: 'c_lobo', attack: 3, health: 2, baseHealth: 2,
      canAttack: true, attacked: false,
    }];
    m.seats[1].board = [{
      iid: 'b1', defId: 'c_arqueira', attack: 2, health: 3, baseHealth: 3,
      canAttack: true, attacked: false,
    }];
    m.attack('p0', 'a1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].board).toHaveLength(0); // arqueira: 3 de vida - 3 de dano → morta
    expect(m.seats[0].board).toHaveLength(0); // lobo: 2 de vida - 2 de dano → morto também
  });

  it('escudo absorve dano antes da vida', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'a_escudo' }];
    m.seats[0].energy = 2;
    m.playCard('p0', 'x1');
    expect(m.seats[0].shield).toBe(4);

    m.seats[1].board = [{
      iid: 'b1', defId: 'c_campea', attack: 5, health: 5, baseHealth: 5,
      canAttack: true, attacked: false,
    }];
    m.endTurn('p0');
    m.attack('p1', 'b1', { seat: 0 });
    expect(m.seats[0].shield).toBe(0);
    expect(m.seats[0].hp).toBe(STARTING_HP - 1); // 5 de dano - 4 de escudo
  });
});

describe('magias e táticas', () => {
  it('bola de fogo no comandante pode encerrar a partida (vida zerada)', () => {
    const { m, result } = makeMatch();
    track(m).start();
    m.seats[1].hp = 5;
    m.seats[0].hand = [{ iid: 'x1', defId: 's_bola_de_fogo' }];
    m.seats[0].energy = 4;
    m.playCard('p0', 'x1', { seat: 1 });
    expect(m.finished).toBe(true);
    expect(result()!.winnerSeat).toBe(0);
    expect(result()!.reason).toBe('hp');
  });

  it('recuo tático devolve criatura inimiga à mão', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [{
      iid: 'b1', defId: 'c_golem', attack: 3, health: 6, baseHealth: 6,
      canAttack: true, attacked: false,
    }];
    const handBefore = m.seats[1].hand.length;
    m.seats[0].hand = [{ iid: 'x1', defId: 't_recuo' }];
    m.seats[0].energy = 3;
    m.playCard('p0', 'x1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].board).toHaveLength(0);
    expect(m.seats[1].hand.length).toBe(handBefore + 1);
  });

  it('fortalecer só aceita criatura aliada', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [{
      iid: 'b1', defId: 'c_golem', attack: 3, health: 6, baseHealth: 6,
      canAttack: true, attacked: false,
    }];
    m.seats[0].hand = [{ iid: 'x1', defId: 's_fortalecer' }];
    m.seats[0].energy = 2;
    expect(() => m.playCard('p0', 'x1', { seat: 1, iid: 'b1' }))
      .toThrow('Escolha uma criatura aliada.');
  });

  it('surto de energia respeita o teto MAX_ENERGY (não estoura 10)', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 't_surto' }];
    m.seats[0].maxEnergy = 10;
    m.seats[0].energy = 10; // turno com energia cheia
    m.playCard('p0', 'x1');
    // surto resolve antes do débito: min(10, 10+2)=10; depois -1 de custo = 9.
    // (antes o clamp era MAX_ENERGY+2, terminando em 11 — acima do teto.)
    expect(m.seats[0].energy).toBe(9);
  });

  it('recuo com a mão do dono cheia destrói a criatura e o log não mente', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [{
      iid: 'b1', defId: 'c_dragao', attack: 7, health: 7, baseHealth: 7,
      canAttack: true, attacked: false,
    }];
    // mão cheia (MAX_HAND = 10): a criatura recuada não cabe e é destruída
    m.seats[1].hand = Array.from({ length: 10 }, (_, i) => ({ iid: `h${i}`, defId: 'c_recruta' }));
    m.seats[0].hand = [{ iid: 'x1', defId: 't_recuo' }];
    m.seats[0].energy = 3;
    m.playCard('p0', 'x1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].board).toHaveLength(0);
    expect(m.seats[1].hand).toHaveLength(10); // não cresceu
    expect(m.seats[1].hand.some((c) => c.iid === 'b1')).toBe(false);
    const log = m.viewFor('p0').log.map((l) => l.text);
    expect(log.some((t) => t.includes('foi devolvida à mão'))).toBe(false);
    expect(log.some((t) => t.includes('destruída'))).toBe(true);
  });
});

describe('palavras-chave: Investida, Grito de Batalha, Estertor', () => {
  const creature = (iid: string, defId: string, attack: number, health: number) => ({
    iid, defId, attack, health, baseHealth: health, canAttack: true, attacked: false,
  });

  it('Investida (charge): o Dragão ataca no turno em que entra', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_dragao' }];
    m.seats[0].energy = 7;
    m.playCard('p0', 'x1');
    // sem enjoo de invocação: ataca já a mesa vazia do oponente
    m.attack('p0', 'x1', { seat: 1 });
    expect(m.seats[1].hp).toBe(STARTING_HP - 7);
  });

  it('Grito de Batalha (Arqueira): 1 de dano numa criatura inimiga ao entrar', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [creature('e1', 'c_lobo', 3, 2)]; // único alvo
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_arqueira' }];
    m.seats[0].energy = 2;
    m.playCard('p0', 'x1');
    // 2 de vida - 1 do grito = 1
    expect(m.seats[1].board.find((c) => c.iid === 'e1')!.health).toBe(1);
  });

  it('Grito de Batalha fizzla sem criaturas inimigas (apenas invoca)', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_arqueira' }];
    m.seats[0].energy = 2;
    expect(() => m.playCard('p0', 'x1')).not.toThrow();
    expect(m.seats[0].board.some((c) => c.defId === 'c_arqueira')).toBe(true);
  });

  it('Estertor (Cavaleiro): um Recruta toma seu lugar ao morrer', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_campea', 5, 5)];
    m.seats[1].board = [creature('e1', 'c_cavaleiro', 3, 4)]; // morre para 5 de ataque
    m.attack('p0', 'a1', { seat: 1, iid: 'e1' });
    expect(m.seats[1].board.some((c) => c.iid === 'e1')).toBe(false); // cavaleiro morreu
    const recruits = m.seats[1].board.filter((c) => c.defId === 'c_recruta');
    expect(recruits).toHaveLength(1); // estertor invocou o substituto
    expect(recruits[0].canAttack).toBe(false); // entra com enjoo de invocação
  });
});

describe('Fase 3: AoE (Tempestade) e reach (Bola de Fogo pierce)', () => {
  const creature = (iid: string, defId: string, attack: number, health: number) => ({
    iid, defId, attack, health, baseHealth: health, canAttack: true, attacked: false,
  });

  it('Tempestade causa 2 de dano a TODAS as criaturas inimigas', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [
      creature('e1', 'c_recruta', 1, 2), // 2 - 2 = 0 → morre
      creature('e2', 'c_golem', 3, 6), // 6 - 2 = 4 → sobrevive
    ];
    m.seats[0].hand = [{ iid: 'x1', defId: 's_tempestade' }];
    m.seats[0].energy = 4;
    m.playCard('p0', 'x1');
    expect(m.seats[1].board.some((c) => c.iid === 'e1')).toBe(false);
    expect(m.seats[1].board.find((c) => c.iid === 'e2')!.health).toBe(4);
  });

  it('Tempestade não atinge as próprias criaturas', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_lobo', 3, 2)];
    m.seats[0].hand = [{ iid: 'x1', defId: 's_tempestade' }];
    m.seats[0].energy = 4;
    m.playCard('p0', 'x1');
    expect(m.seats[0].board.find((c) => c.iid === 'a1')!.health).toBe(2); // intacta
  });

  it('Bola de Fogo (pierce) atinge o comandante mesmo com criatura em campo', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [creature('e1', 'c_recruta', 1, 2)]; // mesa ocupada
    m.seats[0].hand = [{ iid: 'x1', defId: 's_bola_de_fogo' }];
    m.seats[0].energy = 4;
    m.playCard('p0', 'x1', { seat: 1 }); // sem iid = comandante; pierce atravessa
    expect(m.seats[1].hp).toBe(STARTING_HP - 5);
    expect(m.seats[1].board).toHaveLength(1); // a criatura segue intacta
  });
});

describe('Provocar (palavra-chave)', () => {
  const taunt = () => ({
    iid: 'g1', defId: 'c_golem', attack: 3, health: 6, baseHealth: 6,
    canAttack: true, attacked: false,
  });
  const wolf = (iid: string) => ({
    iid, defId: 'c_lobo', attack: 3, health: 2, baseHealth: 2,
    canAttack: true, attacked: false,
  });

  it('ataque ao comandante com Provocar em campo cai na proteção geral', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [wolf('a1')];
    m.seats[1].board = [taunt()];
    expect(() => m.attack('p0', 'a1', { seat: 1 }))
      .toThrow('As criaturas inimigas protegem o comandante — derrote-as primeiro.');
  });

  it('bloqueia ataque a outra criatura que não tem Provocar', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [wolf('a1')];
    m.seats[1].board = [taunt(), wolf('b2')];
    expect(() => m.attack('p0', 'a1', { seat: 1, iid: 'b2' }))
      .toThrow('Provocar: ataque primeiro a criatura com Provocar.');
    m.attack('p0', 'a1', { seat: 1, iid: 'g1' }); // no Provocar pode
    expect(m.seats[1].board.find((c) => c.iid === 'g1')!.health).toBe(3);
  });

  it('magias ignoram Provocar', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [taunt(), wolf('b2')];
    m.seats[0].hand = [{ iid: 'x1', defId: 's_faisca' }];
    m.seats[0].energy = 1;
    m.playCard('p0', 'x1', { seat: 1, iid: 'b2' }); // não lança erro
    // o lobo (2 de vida) morre com os 2 de dano e sai da mesa
    expect(m.seats[1].board.some((c) => c.iid === 'b2')).toBe(false);
    expect(m.seats[1].board.some((c) => c.iid === 'g1')).toBe(true);
  });
});

describe('proteção do comandante (dinâmica Yu-Gi-Oh)', () => {
  const creature = (iid: string, defId: string, attack: number, health: number) => ({
    iid, defId, attack, health, baseHealth: health, canAttack: true, attacked: false,
  });

  it('bloqueia ataque ao comandante com qualquer criatura em campo', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_lobo', 3, 2)];
    m.seats[1].board = [creature('b1', 'c_recruta', 1, 2)]; // sem Provocar
    expect(() => m.attack('p0', 'a1', { seat: 1 }))
      .toThrow('As criaturas inimigas protegem o comandante — derrote-as primeiro.');
  });

  it('libera o ataque ao comandante quando a mesa inimiga está vazia', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_lobo', 3, 2)];
    m.attack('p0', 'a1', { seat: 1 });
    expect(m.seats[1].hp).toBe(STARTING_HP - 3);
  });

  it('magias sem pierce são bloqueadas pela proteção das criaturas', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [creature('b1', 'c_recruta', 1, 2)];
    // Faísca não tem pierce: a mesa inimiga protege o comandante (a Bola de Fogo,
    // que agora atravessa, é coberta no teste de reach da Fase 3).
    m.seats[0].hand = [{ iid: 'x1', defId: 's_faisca' }];
    m.seats[0].energy = 1;
    expect(() => m.playCard('p0', 'x1', { seat: 1 }))
      .toThrow('As criaturas inimigas protegem o comandante.');
    // em criatura continua válida
    m.playCard('p0', 'x1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].board).toHaveLength(0);
  });

  it('efeito especial pierce atravessa a proteção', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[1].board = [creature('b1', 'c_recruta', 1, 2)];
    m.seats[0].hand = [{ iid: 'x1', defId: 's_faisca' }];
    m.seats[0].energy = 1;
    CARDS.s_faisca.pierce = true;
    try {
      m.playCard('p0', 'x1', { seat: 1 }); // não lança erro
      expect(m.seats[1].hp).toBe(STARTING_HP - 2);
    } finally {
      delete CARDS.s_faisca.pierce;
    }
  });
});

describe('dano excedente na última criatura', () => {
  const creature = (iid: string, defId: string, attack: number, health: number) => ({
    iid, defId, attack, health, baseHealth: health, canAttack: true, attacked: false,
  });

  it('o saldo do golpe que destrói a última criatura desconta da vida', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_campea', 5, 5)];
    m.seats[1].board = [creature('b1', 'c_lobo', 3, 2)]; // última criatura
    m.attack('p0', 'a1', { seat: 1, iid: 'b1' });
    // 5 de dano - 2 de vida = 3 de excedente no comandante
    expect(m.seats[1].board).toHaveLength(0);
    expect(m.seats[1].hp).toBe(STARTING_HP - 3);
  });

  it('o escudo absorve o dano excedente primeiro', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_campea', 5, 5)];
    m.seats[1].board = [creature('b1', 'c_lobo', 3, 2)];
    m.seats[1].shield = 2;
    m.attack('p0', 'a1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].shield).toBe(0);
    expect(m.seats[1].hp).toBe(STARTING_HP - 1); // 3 de excedente - 2 de escudo
  });

  it('não há excedente quando resta outra criatura em campo', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_campea', 5, 5)];
    m.seats[1].board = [creature('b1', 'c_lobo', 3, 2), creature('b2', 'c_recruta', 1, 2)];
    m.attack('p0', 'a1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].board).toHaveLength(1);
    expect(m.seats[1].hp).toBe(STARTING_HP); // excedente se perde
  });

  it('não há excedente quando a defensora sobrevive', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_lobo', 3, 2)];
    m.seats[1].board = [creature('b1', 'c_golem', 3, 6)]; // sobrevive com 3
    m.attack('p0', 'a1', { seat: 1, iid: 'b1' });
    expect(m.seats[1].board[0].health).toBe(3);
    expect(m.seats[1].hp).toBe(STARTING_HP);
  });

  it('excedente letal encerra a partida por vida zerada', () => {
    const { m, result } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_dragao', 7, 7)];
    m.seats[1].board = [creature('b1', 'c_recruta', 1, 2)];
    m.seats[1].hp = 5; // 7 - 2 = 5 de excedente
    m.attack('p0', 'a1', { seat: 1, iid: 'b1' });
    expect(m.finished).toBe(true);
    expect(result()!.winnerSeat).toBe(0);
    expect(result()!.reason).toBe('hp');
  });
});

describe('invariante: criaturas espectadoras nunca sofrem dano', () => {
  const creature = (iid: string, defId: string, attack: number, health: number) => ({
    iid, defId, attack, health, baseHealth: health, canAttack: true, attacked: false,
  });

  it('com dois monstros meus em campo, só o atacante recebe a retaliação', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('m1', 'c_lobo', 3, 2), creature('m2', 'c_golem', 3, 6)];
    m.seats[1].board = [creature('e1', 'c_cavaleiro', 3, 4)];
    m.attack('p0', 'm1', { seat: 1, iid: 'e1' });
    // m1 (2 de vida) morre para a retaliação de 3 do cavaleiro — esperado
    expect(m.seats[0].board.some((c) => c.iid === 'm1')).toBe(false);
    // m2 não participou do combate: intocada
    const m2c = m.seats[0].board.find((c) => c.iid === 'm2');
    expect(m2c).toBeDefined();
    expect(m2c!.health).toBe(6);
  });

  it('espectadores ficam intocados mesmo com bônus de ataque inimigo e overflow', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('a1', 'c_campea', 5, 5), creature('a2', 'c_recruta', 1, 2)];
    m.seats[1].board = [creature('d1', 'c_lobo', 3, 2)];
    m.seats[1].attackBonus = 1; // estandarte inimigo: retaliação 3+1
    m.attack('p0', 'a1', { seat: 1, iid: 'd1' });
    expect(m.seats[0].board.find((c) => c.iid === 'a1')!.health).toBe(1); // 5 - 4
    const spectator = m.seats[0].board.find((c) => c.iid === 'a2');
    expect(spectator!.health).toBe(2); // intocada
    expect(m.seats[1].hp).toBe(STARTING_HP - 3); // overflow 5-2 no comandante
  });

  it('a retaliação fica explícita no log de eventos', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [creature('m1', 'c_golem', 3, 6)];
    m.seats[1].board = [creature('e1', 'c_arqueira', 2, 3)];
    m.attack('p0', 'm1', { seat: 1, iid: 'e1' });
    const log = m.viewFor('p0').log.map((l) => l.text);
    expect(log).toContain('Arqueira Élfica revidou: Golem de Pedra sofreu 2 de dano');
  });
});

describe('cartas iguais na mesa: o log cita a posição exata', () => {
  const creature = (iid: string, defId: string, attack: number, health: number) => ({
    iid, defId, attack, health, baseHealth: health, canAttack: true, attacked: false,
  });

  it('magia em uma de duas cópias idênticas nomeia a posição atingida', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'sp', defId: 's_faisca' }];
    m.seats[0].energy = 5;
    m.seats[1].board = [
      creature('b1', 'c_lobo', 3, 4),
      creature('b2', 'c_lobo', 3, 4), // segunda cópia — alvo
    ];
    m.playCard('p0', 'sp', { seat: 1, iid: 'b2' });
    const log = m.viewFor('p0').log.map((l) => l.text);
    expect(log).toContain('Faísca causou 2 de dano em Lobo das Sombras (posição 2)');
    // a outra cópia segue intacta e sem dano
    expect(m.seats[1].board.find((c) => c.iid === 'b1')!.health).toBe(4);
    expect(m.seats[1].board.find((c) => c.iid === 'b2')!.health).toBe(2);
  });

  it('cópia única não recebe sufixo de posição (relato continua limpo)', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'sp', defId: 's_faisca' }];
    m.seats[0].energy = 5;
    m.seats[1].board = [creature('b1', 'c_lobo', 3, 4)];
    m.playCard('p0', 'sp', { seat: 1, iid: 'b1' });
    const log = m.viewFor('p0').log.map((l) => l.text);
    expect(log).toContain('Faísca causou 2 de dano em Lobo das Sombras');
    expect(log.some((t) => t.includes('posição'))).toBe(false);
  });

  it('ataque e destruição entre cópias idênticas citam as posições certas', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].board = [
      creature('a1', 'c_lobo', 3, 2),
      creature('a2', 'c_lobo', 3, 2), // atacante: 2ª cópia
    ];
    m.seats[1].board = [
      creature('e1', 'c_recruta', 1, 2),
      creature('e2', 'c_recruta', 1, 2), // defensora: 2ª cópia, morre para 3 de ataque
    ];
    m.attack('p0', 'a2', { seat: 1, iid: 'e2' });
    const log = m.viewFor('p0').log.map((l) => l.text);
    expect(log).toContain('Lobo das Sombras (posição 2) atacou Recruta da Vanguarda (posição 2)');
    expect(log).toContain('Recruta da Vanguarda (posição 2) foi destruída');
    // a primeira recruta não foi tocada
    expect(m.seats[1].board.find((c) => c.iid === 'e1')!.health).toBe(2);
  });
});

describe('registro público de jogadas (revelação no cliente)', () => {
  it('expõe as cartas jogadas na visão dos dois lados', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].hand = [{ iid: 'x1', defId: 'c_lobo' }];
    m.seats[0].energy = 2;
    m.playCard('p0', 'x1');
    const viewOpponent = m.viewFor('p1');
    expect(viewOpponent.plays).toHaveLength(1);
    expect(viewOpponent.plays[0]).toMatchObject({ seat: 0, cardId: 'c_lobo' });
  });
});

describe('condições de vitória (slide "Conceito e condições de vitória")', () => {
  it('abandono: desistência dá vitória ao oponente', () => {
    const { m, result } = makeMatch();
    track(m).start();
    m.surrender('p0');
    expect(m.finished).toBe(true);
    expect(result()!.winnerSeat).toBe(1);
    expect(result()!.reason).toBe('surrender');
  });

  it('timeout: vitória automática só após a janela anti-abandono de 2 min', () => {
    vi.useFakeTimers();
    const { m, result } = makeMatch();
    track(m).start();
    m.handleDisconnect('p1');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000);
    expect(m.finished).toBe(false); // ainda dentro da janela
    vi.advanceTimersByTime(2000);
    expect(m.finished).toBe(true);
    expect(result()!.winnerSeat).toBe(0);
    expect(result()!.reason).toBe('timeout');
  });

  it('reconexão dentro da janela cancela a derrota', () => {
    vi.useFakeTimers();
    const { m } = makeMatch();
    track(m).start();
    m.handleDisconnect('p1');
    vi.advanceTimersByTime(60_000);
    m.handleReconnect('p1');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
    expect(m.finished).toBe(false);
  });

  it('temporizador de turno passa a vez automaticamente', () => {
    vi.useFakeTimers();
    const { m } = makeMatch(2, 10);
    track(m).start();
    expect(m.viewFor('p0').turnSeat).toBe(0);
    vi.advanceTimersByTime(11_000);
    expect(m.viewFor('p0').turnSeat).toBe(1);
  });

  it('teto de turnos encerra por morte súbita; a maior vida vence', () => {
    const { m, result } = makeMatch();
    track(m).start();
    // decks grandes para isolar o teste do teto da fadiga (sem deck-out)
    const big = (n: number) => Array.from({ length: n }, (_, i) => ({ iid: `d${i}`, defId: 'c_recruta' }));
    m.seats[0].deck = big(100);
    m.seats[1].deck = big(100);
    m.seats[0].hp = 20;
    m.seats[1].hp = 10;
    // alterna passar a vez até o teto de turnos disparar a morte súbita
    for (let k = 0; k < 80 && !m.finished; k++) {
      m.endTurn(k % 2 === 0 ? 'p0' : 'p1');
    }
    expect(m.finished).toBe(true);
    expect(result()!.winnerSeat).toBe(0); // seat 0 tinha mais vida
  });

  it('fadiga: deck vazio causa dano crescente e encerra partidas longas', () => {
    const { m } = makeMatch();
    track(m).start();
    m.seats[0].deck = [];
    m.seats[0].hp = 3;
    m.endTurn('p0');
    m.endTurn('p1'); // p0 compra sem deck: fadiga 1 → hp 2
    m.endTurn('p0');
    m.endTurn('p1'); // fadiga 2 → hp 0
    expect(m.finished).toBe(true);
  });
});

describe('arquitetura N-player (slide "por que 1v1 primeiro")', () => {
  it('turnos em fila circular funcionam com 3 jogadores', () => {
    const { m } = makeMatch(3);
    track(m).start();
    expect(m.viewFor('p0').turnSeat).toBe(0);
    m.endTurn('p0');
    expect(m.viewFor('p0').turnSeat).toBe(1);
    m.endTurn('p1');
    expect(m.viewFor('p0').turnSeat).toBe(2);
    m.endTurn('p2');
    expect(m.viewFor('p0').turnSeat).toBe(0); // fila circular completa
  });

  it('assentos eliminados são pulados na fila', () => {
    const { m } = makeMatch(3);
    track(m).start();
    m.surrender('p1');
    expect(m.finished).toBe(false); // ainda restam 2 jogadores
    m.endTurn('p0');
    expect(m.viewFor('p0').turnSeat).toBe(2); // pulou o assento 1
  });
});

describe('anti-cheat: visão redigida', () => {
  it('não expõe as cartas da mão do oponente', () => {
    const { m } = makeMatch();
    track(m).start();
    const view = m.viewFor('p1') as unknown as Record<string, unknown>;
    const serialized = JSON.stringify(view);
    // a visão de p1 contém a própria mão, mas da mão de p0 só a contagem
    expect((view.seats as Array<{ handCount: number }>)[0].handCount).toBeGreaterThan(0);
    const p0HandIids = m.seats[0].hand.map((c) => c.iid);
    for (const iid of p0HandIids) {
      expect(serialized.includes(`"${iid}"`)).toBe(false);
    }
  });
});
