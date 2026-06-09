import { afterEach, describe, expect, it, vi } from 'vitest';
import { Match, type EngineResult, type MatchPlayer } from '../src/game/engine.js';
import { STARTING_HP, RECONNECT_GRACE_MS } from '@legendsclash/shared';

function players(n: number): MatchPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `Jogador ${i}`, avatar: '🛡️', mmr: 1000,
  }));
}

function makeMatch(n = 2, turnSeconds = 60) {
  let result: EngineResult | null = null;
  const m = new Match(players(n), () => {}, (r) => { result = r; }, turnSeconds);
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
    expect(view0.seats[1].handCount).toBe(5); // 4 + 1 de compensação
    expect(view0.seats[0].hp).toBe(STARTING_HP);
    expect(view0.seats[0].deckCount).toBe(25); // 30 - 4 - 1
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
