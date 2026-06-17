import { randomBytes, randomInt } from 'node:crypto';
import {
  CARDS, DEFAULT_DECK, MAX_BOARD, MAX_ENERGY, MAX_HAND,
  RECONNECT_GRACE_MS, STARTING_HAND, STARTING_HP, TURN_SECONDS,
} from '@legendsclash/shared';
import type {
  CardInHand, CreatureOnBoard, GameLogEntry, GameView,
  MatchEndReason, SeatView, Target,
} from '@legendsclash/shared';

/**
 * Motor de regras autoritativo (slide "Briefing": WebSockets com servidor
 * autoritativo — estado único, anti-lag e anti-cheat). Toda jogada é validada
 * aqui; o cliente apenas envia intenções e renderiza o estado.
 *
 * Decisão de produto (slide "por que 1v1 primeiro"): salas modeladas por
 * assentos e turnos em fila circular — 1v1 é o caso particular N=2. O motor
 * não assume dois jogadores em nenhuma regra estrutural.
 */

export interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  mmr: number;
}

interface CardInstance {
  iid: string;
  defId: string;
}

interface Creature extends CardInstance {
  attack: number;
  health: number;
  baseHealth: number;
  canAttack: boolean;
  attacked: boolean;
}

interface Seat {
  player: MatchPlayer;
  hp: number;
  shield: number;
  energy: number;
  maxEnergy: number;
  deck: CardInstance[];
  hand: CardInstance[];
  board: Creature[];
  artifacts: string[];
  attackBonus: number;
  fatigue: number;
  connected: boolean;
  out: boolean;
  reconnectTimer: NodeJS.Timeout | null;
}

export interface EngineResult {
  winnerSeat: number;
  reason: MatchEndReason;
  turns: number;
  durationMs: number;
}

export class GameError extends Error {}

let nextIid = 1;
function newIid(): string {
  return 'i' + nextIid++;
}

function buildDeck(): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const [defId, copies] of DEFAULT_DECK) {
    for (let i = 0; i < copies; i++) deck.push({ iid: newIid(), defId });
  }
  // Fisher–Yates com aleatoriedade do servidor — embaralhamento não auditável
  // pelo cliente é parte do anti-cheat.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export class Match {
  readonly id = 'm' + randomBytes(6).toString('hex');
  readonly seats: Seat[];
  private turnSeat = 0;
  private turnNumber = 0;
  private turnEndsAt = 0;
  private turnTimer: NodeJS.Timeout | null = null;
  private status: 'active' | 'finished' = 'active';
  private result: EngineResult | null = null;
  private readonly startedAt = Date.now();
  private log: GameLogEntry[] = [];
  private plays: Array<{ seat: number; cardId: string; at: number }> = [];

  /** onUpdate: reenvia visões; onFinish: Elo/histórico/notificação. */
  constructor(
    players: MatchPlayer[],
    private onUpdate: () => void,
    private onFinish: (result: EngineResult) => void,
    private turnSeconds = TURN_SECONDS,
  ) {
    if (players.length < 2) throw new Error('partida exige ao menos 2 jogadores');
    this.seats = players.map((player) => ({
      player,
      hp: STARTING_HP,
      shield: 0,
      energy: 0,
      maxEnergy: 0,
      deck: buildDeck(),
      hand: [],
      board: [],
      artifacts: [],
      attackBonus: 0,
      fatigue: 0,
      connected: true,
      out: false,
      reconnectTimer: null,
    }));
  }

  start(): void {
    // Mão inicial; quem joga depois compensa a desvantagem com 1 carta extra.
    this.seats.forEach((seat, i) => {
      const extra = i === 0 ? 0 : 1;
      for (let k = 0; k < STARTING_HAND + extra; k++) this.draw(seat, true);
    });
    this.addLog(`Partida iniciada: ${this.seats.map((s) => s.player.name).join(' vs ')}`);
    this.beginTurn(0);
    this.onUpdate();
  }

  // ─── Ciclo de turno (fases: Compra → Energia → Ação/Combate → Encerra) ──

  private beginTurn(seatIdx: number): void {
    this.turnSeat = seatIdx;
    this.turnNumber++;
    const seat = this.seats[seatIdx];

    // Fase de Energia: +1 ponto, máx. 10 (energia incremental por design)
    seat.maxEnergy = Math.min(MAX_ENERGY, seat.maxEnergy + 1);
    seat.energy = seat.maxEnergy;

    // Fase de Compra
    this.draw(seat);

    for (const c of seat.board) {
      c.canAttack = true;
      c.attacked = false;
    }

    this.addLog(`Turno ${this.turnNumber}: vez de ${seat.player.name}`);
    this.armTurnTimer();
    this.checkEnd();
  }

  private armTurnTimer(): void {
    this.clearTurnTimer();
    this.turnEndsAt = Date.now() + this.turnSeconds * 1000;
    this.turnTimer = setTimeout(() => {
      if (this.status !== 'active') return;
      this.addLog(`${this.seats[this.turnSeat].player.name} ficou sem tempo — turno encerrado`);
      this.advanceTurn();
      this.onUpdate();
    }, this.turnSeconds * 1000);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  /** Fila circular: o próximo assento ativo, qualquer que seja N. */
  private advanceTurn(): void {
    if (this.status !== 'active') return;
    let next = this.turnSeat;
    do {
      next = (next + 1) % this.seats.length;
    } while (this.seats[next].out && next !== this.turnSeat);
    this.beginTurn(next);
  }

  private draw(seat: Seat, silent = false): void {
    const card = seat.deck.pop();
    if (!card) {
      // Fadiga: evita partidas infinitas quando o deck acaba
      seat.fatigue++;
      seat.hp -= seat.fatigue;
      if (!silent) this.addLog(`${seat.player.name} está em fadiga e sofre ${seat.fatigue} de dano`);
      this.checkEnd();
      return;
    }
    if (seat.hand.length >= MAX_HAND) {
      if (!silent) this.addLog(`Mão cheia: ${seat.player.name} queimou uma carta`);
      return;
    }
    seat.hand.push(card);
  }

  // ─── Ações do jogador ───────────────────────────────────────────

  private requireTurn(playerId: string): { seat: Seat; idx: number } {
    if (this.status !== 'active') throw new GameError('A partida já terminou.');
    const idx = this.seatOf(playerId);
    if (idx < 0) throw new GameError('Você não está nesta partida.');
    if (idx !== this.turnSeat) throw new GameError('Não é o seu turno.');
    return { seat: this.seats[idx], idx };
  }

  seatOf(playerId: string): number {
    return this.seats.findIndex((s) => s.player.id === playerId);
  }

  /**
   * Rótulo de uma criatura para o log de eventos. Quando há cópias idênticas
   * da mesma carta na mesa do dono, anexa a posição (1-based, da esquerda para
   * a direita, na mesma ordem em que o cliente as desenha) — assim duas cartas
   * iguais nunca se confundem no relato de quem sofreu o efeito/dano.
   */
  private creatureLabel(seat: Seat, creature: Creature): string {
    const name = CARDS[creature.defId].name;
    const copies = seat.board.filter((c) => c.defId === creature.defId).length;
    if (copies < 2) return name;
    const pos = seat.board.indexOf(creature) + 1;
    return `${name} (posição ${pos})`;
  }

  playCard(playerId: string, iid: string, target?: Target): void {
    const { seat, idx } = this.requireTurn(playerId);
    const handIdx = seat.hand.findIndex((c) => c.iid === iid);
    if (handIdx < 0) throw new GameError('Carta não está na sua mão.');
    const card = seat.hand[handIdx];
    const def = CARDS[card.defId];
    if (seat.energy < def.cost) throw new GameError('Energia insuficiente.');

    switch (def.type) {
      case 'creature': {
        if (seat.board.length >= MAX_BOARD) throw new GameError('Mesa cheia (máx. 6 criaturas).');
        seat.board.push({
          iid: card.iid,
          defId: card.defId,
          attack: def.attack!,
          health: def.health!,
          baseHealth: def.health!,
          canAttack: false, // enjoo de invocação: ataca a partir do próximo turno
          attacked: false,
        });
        this.addLog(`${seat.player.name} invocou ${def.name}`);
        break;
      }
      case 'spell':
      case 'tactic':
        this.resolveEffect(idx, def.id, target);
        break;
      case 'artifact': {
        if (def.id === 'a_escudo') {
          seat.shield += 4;
        } else if (def.id === 'a_estandarte') {
          seat.attackBonus += 1;
          seat.artifacts.push(def.id);
        }
        this.addLog(`${seat.player.name} equipou ${def.name}`);
        break;
      }
    }

    seat.energy -= def.cost;
    seat.hand.splice(handIdx, 1);
    // jogada concluída é informação pública — alimenta a revelação no cliente
    this.plays.push({ seat: idx, cardId: def.id, at: Date.now() });
    this.checkEnd();
    this.onUpdate();
  }

  private resolveEffect(casterIdx: number, defId: string, target?: Target): void {
    const caster = this.seats[casterIdx];
    const def = CARDS[defId];

    const enemyCreature = (): { seat: Seat; creature: Creature } => {
      if (!target || target.iid === undefined) throw new GameError('Escolha uma criatura inimiga.');
      if (target.seat === casterIdx) throw new GameError('O alvo deve ser inimigo.');
      const seat = this.seats[target.seat];
      const creature = seat?.board.find((c) => c.iid === target.iid);
      if (!creature) throw new GameError('Alvo inválido.');
      return { seat, creature };
    };

    switch (defId) {
      case 's_faisca':
      case 's_bola_de_fogo': {
        const dmg = defId === 's_faisca' ? 2 : 5;
        if (!target || target.seat === casterIdx) throw new GameError('Escolha um alvo inimigo.');
        const enemy = this.seats[target.seat];
        if (!enemy || enemy.out) throw new GameError('Alvo inválido.');
        // A proteção das criaturas vale também para magias; apenas efeitos
        // especiais marcados como dano direto (pierce) a atravessam.
        if (!target.iid && enemy.board.length > 0 && !def.pierce) {
          throw new GameError('As criaturas inimigas protegem o comandante.');
        }
        if (target.iid) {
          const creature = enemy.board.find((c) => c.iid === target.iid);
          if (!creature) throw new GameError('Alvo inválido.');
          creature.health -= dmg;
          this.addLog(`${def.name} causou ${dmg} de dano em ${this.creatureLabel(enemy, creature)}`);
          this.cleanupBoard(enemy);
        } else {
          this.damagePlayer(enemy, dmg);
          this.addLog(`${def.name} causou ${dmg} de dano em ${enemy.player.name}`);
        }
        break;
      }
      case 's_bencao':
        caster.hp = Math.min(STARTING_HP, caster.hp + 4);
        this.addLog(`${caster.player.name} restaurou 4 de vida`);
        break;
      case 's_fortalecer': {
        if (!target || target.seat !== casterIdx || !target.iid) {
          throw new GameError('Escolha uma criatura aliada.');
        }
        const creature = caster.board.find((c) => c.iid === target.iid);
        if (!creature) throw new GameError('Alvo inválido.');
        creature.attack += 2;
        creature.health += 2;
        creature.baseHealth += 2;
        this.addLog(`${this.creatureLabel(caster, creature)} recebeu +2/+2`);
        break;
      }
      case 't_reforcos':
        this.draw(caster);
        this.draw(caster);
        this.addLog(`${caster.player.name} comprou 2 cartas`);
        break;
      case 't_surto':
        caster.energy = Math.min(MAX_ENERGY + 2, caster.energy + 2);
        this.addLog(`${caster.player.name} ganhou 2 de energia`);
        break;
      case 't_recuo': {
        const { seat, creature } = enemyCreature();
        // rótulo calculado antes de remover: ainda inclui as cópias idênticas
        const label = this.creatureLabel(seat, creature);
        seat.board = seat.board.filter((c) => c.iid !== creature.iid);
        if (seat.hand.length < MAX_HAND) {
          seat.hand.push({ iid: creature.iid, defId: creature.defId });
        }
        this.addLog(`${label} foi devolvida à mão de ${seat.player.name}`);
        break;
      }
      default:
        throw new GameError('Efeito desconhecido.');
    }
  }

  attack(playerId: string, attackerIid: string, target: Target): void {
    const { seat, idx } = this.requireTurn(playerId);
    const attacker = seat.board.find((c) => c.iid === attackerIid);
    if (!attacker) throw new GameError('Criatura não encontrada.');
    if (!attacker.canAttack) throw new GameError('Essa criatura ainda não pode atacar.');
    if (attacker.attacked) throw new GameError('Essa criatura já atacou neste turno.');
    if (target.seat === idx) throw new GameError('Não é possível atacar a si mesmo.');
    const enemy = this.seats[target.seat];
    if (!enemy || enemy.out) throw new GameError('Alvo inválido.');

    // Dinâmica Yu-Gi-Oh: criaturas em campo protegem os pontos de vida —
    // o comandante só pode ser atacado com a mesa inimiga vazia.
    if (!target.iid && enemy.board.length > 0) {
      throw new GameError('As criaturas inimigas protegem o comandante — derrote-as primeiro.');
    }

    // Provocar: define a prioridade entre criaturas — a que tem a
    // palavra-chave precisa ser atacada antes das demais.
    const taunts = enemy.board.filter((c) => CARDS[c.defId].keywords?.includes('taunt'));
    if (target.iid && taunts.length > 0 && !taunts.some((c) => c.iid === target.iid)) {
      throw new GameError('Provocar: ataque primeiro a criatura com Provocar.');
    }

    const power = attacker.attack + seat.attackBonus;
    const attackerName = this.creatureLabel(seat, attacker);

    if (target.iid) {
      const defender = enemy.board.find((c) => c.iid === target.iid);
      if (!defender) throw new GameError('Alvo inválido.');
      // rótulos fixados antes da limpeza, quando as posições ainda valem
      const defenderName = this.creatureLabel(enemy, defender);
      const wasLast = enemy.board.length === 1;
      const excess = power - defender.health;
      // Combate simultâneo: cada criatura causa seu ataque na outra.
      const retaliation = defender.attack + enemy.attackBonus;
      defender.health -= power;
      attacker.health -= retaliation;
      this.addLog(`${attackerName} atacou ${defenderName}`);
      if (retaliation > 0) {
        this.addLog(`${defenderName} revidou: ${attackerName} sofreu ${retaliation} de dano`);
      }
      this.cleanupBoard(seat);
      this.cleanupBoard(enemy);
      // Dano excedente: ao destruir a última criatura em campo, o saldo do
      // golpe (não a retaliação) desconta dos pontos de vida do comandante.
      if (wasLast && defender.health <= 0 && excess > 0) {
        this.damagePlayer(enemy, excess);
        this.addLog(`O dano excedente atingiu ${enemy.player.name} (−${excess})`);
      }
    } else {
      this.damagePlayer(enemy, power);
      this.addLog(`${attackerName} causou ${power} de dano em ${enemy.player.name}`);
    }

    attacker.attacked = true;
    this.checkEnd();
    this.onUpdate();
  }

  endTurn(playerId: string): void {
    this.requireTurn(playerId);
    this.advanceTurn();
    this.onUpdate();
  }

  surrender(playerId: string): void {
    if (this.status !== 'active') return;
    const idx = this.seatOf(playerId);
    if (idx < 0) return;
    this.seats[idx].out = true;
    this.addLog(`${this.seats[idx].player.name} desistiu da partida`);
    this.checkEnd('surrender');
    this.onUpdate();
  }

  // ─── Anti-abandono (slide "Fairness por design") ────────────────
  // 2 minutos para reconectar; vitória automática do oponente só após a
  // janela expirar. (A "IA assume temporariamente" do slide fica coberta
  // pelo temporizador de turno, que passa a vez automaticamente.)

  handleDisconnect(playerId: string): void {
    const idx = this.seatOf(playerId);
    if (idx < 0 || this.status !== 'active') return;
    const seat = this.seats[idx];
    seat.connected = false;
    this.addLog(`${seat.player.name} desconectou — ${RECONNECT_GRACE_MS / 60000} min para reconectar`);
    seat.reconnectTimer = setTimeout(() => {
      if (this.status !== 'active' || seat.connected) return;
      seat.out = true;
      this.addLog(`${seat.player.name} não voltou a tempo`);
      this.checkEnd('timeout');
      this.onUpdate();
    }, RECONNECT_GRACE_MS);
    this.onUpdate();
  }

  handleReconnect(playerId: string): void {
    const idx = this.seatOf(playerId);
    if (idx < 0) return;
    const seat = this.seats[idx];
    if (seat.reconnectTimer) clearTimeout(seat.reconnectTimer);
    seat.reconnectTimer = null;
    if (!seat.connected) {
      seat.connected = true;
      this.addLog(`${seat.player.name} reconectou`);
      this.onUpdate();
    }
  }

  // ─── Fim de jogo ────────────────────────────────────────────────

  private damagePlayer(seat: Seat, amount: number): void {
    const absorbed = Math.min(seat.shield, amount);
    seat.shield -= absorbed;
    seat.hp -= amount - absorbed;
  }

  private cleanupBoard(seat: Seat): void {
    const dead = seat.board.filter((c) => c.health <= 0);
    // rótulo calculado com o tabuleiro ainda intacto, para citar a posição certa
    for (const c of dead) this.addLog(`${this.creatureLabel(seat, c)} foi destruída`);
    seat.board = seat.board.filter((c) => c.health > 0);
  }

  private checkEnd(reasonHint?: MatchEndReason): void {
    if (this.status !== 'active') return;
    for (const seat of this.seats) {
      if (!seat.out && seat.hp <= 0) {
        seat.out = true;
        this.addLog(`${seat.player.name} ficou sem vida`);
      }
    }
    const alive = this.seats.map((s, i) => ({ s, i })).filter(({ s }) => !s.out);
    if (alive.length > 1) return;

    this.status = 'finished';
    this.clearTurnTimer();
    for (const seat of this.seats) {
      if (seat.reconnectTimer) clearTimeout(seat.reconnectTimer);
    }
    const winnerSeat = alive.length === 1 ? alive[0].i : 0;
    this.result = {
      winnerSeat,
      reason: reasonHint ?? 'hp',
      turns: this.turnNumber,
      durationMs: Date.now() - this.startedAt,
    };
    this.addLog(`Vitória de ${this.seats[winnerSeat].player.name}!`);
    this.onFinish(this.result);
  }

  // ─── Visões redigidas por jogador (anti-cheat) ─────────────────
  // Cada cliente recebe apenas o que pode ver: a própria mão completa e,
  // dos oponentes, apenas contagens.

  viewFor(playerId: string): GameView {
    const yourSeat = this.seatOf(playerId);
    const seats: SeatView[] = this.seats.map((s) => ({
      playerId: s.player.id,
      name: s.player.name,
      avatar: s.player.avatar,
      mmr: s.player.mmr,
      hp: Math.max(0, s.hp),
      shield: s.shield,
      energy: s.energy,
      maxEnergy: s.maxEnergy,
      deckCount: s.deck.length,
      handCount: s.hand.length,
      board: s.board.map((c): CreatureOnBoard => ({
        iid: c.iid,
        defId: c.defId,
        attack: c.attack,
        health: c.health,
        baseHealth: c.baseHealth,
        canAttack: c.canAttack && !c.attacked,
      })),
      artifacts: s.artifacts,
      attackBonus: s.attackBonus,
      fatigue: s.fatigue,
      connected: s.connected,
      out: s.out,
    }));
    const hand: CardInHand[] =
      yourSeat >= 0 ? this.seats[yourSeat].hand.map((c) => ({ iid: c.iid, defId: c.defId })) : [];
    return {
      matchId: this.id,
      yourSeat,
      turnSeat: this.turnSeat,
      turnNumber: this.turnNumber,
      turnEndsAt: this.turnEndsAt,
      seats,
      hand,
      status: this.status,
      log: this.log.slice(-30),
      plays: this.plays.slice(-12),
    };
  }

  get finished(): boolean {
    return this.status === 'finished';
  }

  get finalResult(): EngineResult | null {
    return this.result;
  }

  playerIds(): string[] {
    return this.seats.map((s) => s.player.id);
  }

  private addLog(text: string): void {
    this.log.push({ at: Date.now(), text });
  }

  /** Encerramento administrativo (ex.: desligamento do servidor). */
  dispose(): void {
    this.clearTurnTimer();
    for (const seat of this.seats) {
      if (seat.reconnectTimer) clearTimeout(seat.reconnectTimer);
    }
  }
}
