import { randomBytes, randomInt } from 'node:crypto';
import {
  CARDS, deckComposition, MAX_BOARD, MAX_ENERGY, MAX_HAND,
  RECONNECT_GRACE_MS, STARTING_HAND, STARTING_HP, TURN_SECONDS,
} from '@legendsclash/shared';
import type {
  CardDef, CardInHand, CreatureOnBoard, GameLogEntry, GameView,
  MatchEndReason, MatchMvp, MatchStats, SeatView, Target,
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
  commander: string;
  accent: string;
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
  /** Resistência (comeback): bônus de ataque ativo enquanto o dono está em ≤10 de vida. */
  comebackOn?: boolean;
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
  mulliganDone: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  /** Estatísticas acumuladas para o recap pós-partida. */
  stats: MatchStats;
  /** Dano/abates por criatura (iid), persiste após a morte → eleger o MVP. */
  creatureLog: Map<string, { defId: string; dmg: number; kills: number }>;
}

export interface EngineResult {
  winnerSeat: number;
  reason: MatchEndReason;
  turns: number;
  durationMs: number;
  /** Estatísticas por assento (index = seat). */
  stats: MatchStats[];
  /** Criatura MVP por assento (null se o assento não atacou). */
  mvp: (MatchMvp | null)[];
}

export class GameError extends Error {}

/** Segundos da fase de mulligan (troca de mão inicial) antes do turno 1. */
const MULLIGAN_SECONDS = 30;
/**
 * Teto de turnos (somados entre os assentos): backstop contra impasses que se
 * arrastam (board-lock simétrico). Atingido o teto, a partida é decidida por
 * morte súbita por vantagem — garante encerramento previsível.
 */
const MAX_TURNS = 40;
/** Pausa antes do bot de treino agir, para a jogada dele ser legível. */
const BOT_TURN_DELAY_MS = 750;

let nextIid = 1;
function newIid(): string {
  return 'i' + nextIid++;
}

/** Fisher–Yates com aleatoriedade do servidor (anti-cheat: não auditável pelo cliente). */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function buildDeck(factionId?: string, includeComeback = false): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const [defId, copies] of deckComposition(factionId, includeComeback)) {
    for (let i = 0; i < copies; i++) deck.push({ iid: newIid(), defId });
  }
  shuffle(deck);
  return deck;
}

/** Conteúdo variável da partida (Fase 6): facção por jogador + carta de Resistência. */
export interface MatchContent {
  factions?: Record<string, string>; // playerId → factionId
  comeback?: boolean; // inclui o Renegado (keyword Resistência) no deck dos dois
}

export class Match {
  readonly id = 'm' + randomBytes(6).toString('hex');
  readonly seats: Seat[];
  private turnSeat = 0;
  private turnNumber = 0;
  private turnEndsAt = 0;
  private turnTimer: NodeJS.Timeout | null = null;
  private mulliganTimer: NodeJS.Timeout | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private status: 'mulligan' | 'active' | 'finished' = 'active';
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
    /** Habilita a fase de mulligan antes do turno 1 (default off p/ testes do motor). */
    private useMulligan = false,
    /** Ids dos assentos controlados pela IA (modo treino). Vazio = só humanos. */
    private botIds: string[] = [],
    /** Conteúdo variável (Fase 6): facções por jogador + carta de Resistência. */
    private content: MatchContent = {},
  ) {
    if (players.length < 2) throw new Error('partida exige ao menos 2 jogadores');
    this.seats = players.map((player) => ({
      player,
      hp: STARTING_HP,
      shield: 0,
      energy: 0,
      maxEnergy: 0,
      deck: buildDeck(content.factions?.[player.id], content.comeback ?? false),
      hand: [],
      board: [],
      artifacts: [],
      attackBonus: 0,
      fatigue: 0,
      connected: true,
      out: false,
      mulliganDone: false,
      reconnectTimer: null,
      stats: { creaturesSummoned: 0, spellsCast: 0, damageDealt: 0, shieldAbsorbed: 0 },
      creatureLog: new Map(),
    }));
  }

  /** Acumula dano/abates de uma atacante para eleger o MVP (sobrevive à morte). */
  private bumpCreature(seat: Seat, creature: Creature, dmg: number, kills: number): void {
    const e = seat.creatureLog.get(creature.iid) ?? { defId: creature.defId, dmg: 0, kills: 0 };
    e.dmg += dmg;
    e.kills += kills;
    seat.creatureLog.set(creature.iid, e);
  }

  start(): void {
    // Mão inicial. Quem joga depois recebe a "moeda": tempo (1 de energia) no
    // lugar de uma carta extra — devolve a iniciativa que o seat 0 ganha por agir
    // primeiro, e o jogador decide quando gastá-la (pode segurar), ao contrário de
    // um bônus fixo. Antes a compensação era +1 carta (recurso, não tempo).
    this.seats.forEach((seat, i) => {
      for (let k = 0; k < STARTING_HAND; k++) this.draw(seat, true);
      if (i !== 0) seat.hand.push({ iid: newIid(), defId: 't_moeda' });
    });
    this.addLog(`Partida iniciada: ${this.seats.map((s) => s.player.name).join(' vs ')}`);
    if (this.useMulligan) {
      // Fase de troca: cada jogador ajusta a mão inicial antes do turno 1.
      this.status = 'mulligan';
      this.turnEndsAt = Date.now() + MULLIGAN_SECONDS * 1000;
      this.mulliganTimer = setTimeout(() => this.forceFinishMulligan(), MULLIGAN_SECONDS * 1000);
      this.addLog('Fase de troca: ajuste a mão inicial');
      // o bot de treino não troca cartas — confirma a mão na hora
      for (const id of this.botIds) {
        try { this.mulligan(id, []); } catch { /* ignore */ }
      }
      this.onUpdate();
      return;
    }
    this.beginTurn(0);
    this.onUpdate();
  }

  // ─── Mulligan (troca da mão inicial, antes do turno 1) ──────────

  mulligan(playerId: string, iids: string[]): void {
    if (this.status !== 'mulligan') throw new GameError('Não é a fase de troca de mão.');
    const idx = this.seatOf(playerId);
    if (idx < 0) throw new GameError('Você não está nesta partida.');
    const seat = this.seats[idx];
    if (seat.mulliganDone) throw new GameError('Você já confirmou sua mão.');

    const swapIds = new Set(iids);
    // a Moeda do Tempo (token) nunca é trocada
    const swapping = seat.hand.filter((c) => swapIds.has(c.iid) && !CARDS[c.defId].token);
    if (swapping.length) {
      const swappingIds = new Set(swapping.map((c) => c.iid));
      seat.hand = seat.hand.filter((c) => !swappingIds.has(c.iid));
      // compra as substitutas ANTES de devolver as trocadas (não recompra a mesma)
      for (let k = 0; k < swapping.length; k++) this.draw(seat, true);
      for (const c of swapping) seat.deck.push(c);
      shuffle(seat.deck);
    }
    seat.mulliganDone = true;
    this.addLog(
      `${seat.player.name} confirmou a mão${swapping.length ? ` (trocou ${swapping.length})` : ''}`,
    );
    if (this.seats.every((s) => s.out || s.mulliganDone)) this.finishMulligan();
    else this.onUpdate();
  }

  /** Tempo de troca esgotado: confirma as mãos como estão e começa a partida. */
  private forceFinishMulligan(): void {
    if (this.status !== 'mulligan') return;
    for (const s of this.seats) s.mulliganDone = true;
    this.addLog('Tempo de troca esgotado — mãos confirmadas');
    this.finishMulligan();
  }

  private finishMulligan(): void {
    if (this.mulliganTimer) clearTimeout(this.mulliganTimer);
    this.mulliganTimer = null;
    this.status = 'active';
    this.beginTurn(0);
    this.onUpdate();
  }

  // ─── Ciclo de turno (fases: Compra → Energia → Ação/Combate → Encerra) ──

  private beginTurn(seatIdx: number): void {
    this.turnSeat = seatIdx;
    this.turnNumber++;
    // Backstop de duração: passado o teto, decide por morte súbita (vantagem).
    if (this.turnNumber > MAX_TURNS) {
      this.resolveByTiebreak();
      if (this.status !== 'active') return;
    }
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
    // modo treino: se a vez é da IA, agenda a jogada dela (após uma pausa legível)
    if (this.status === 'active' && this.botIds.includes(seat.player.id)) {
      this.scheduleBotTurn(seat.player.id);
    }
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
    if (this.status === 'mulligan') throw new GameError('Aguarde a troca de mãos.');
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
   * Atualiza só os cosméticos do jogador (nome/avatar/comandante/cor). Não toca
   * nas regras — reflete a personalização na partida em andamento.
   */
  updateCosmetics(
    playerId: string,
    patch: { name?: string; avatar?: string; commander?: string; accent?: string },
  ): boolean {
    const seat = this.seats.find((s) => s.player.id === playerId);
    if (!seat) return false;
    if (patch.name) seat.player.name = patch.name;
    if (patch.avatar) seat.player.avatar = patch.avatar;
    if (patch.commander) seat.player.commander = patch.commander;
    if (patch.accent) seat.player.accent = patch.accent;
    return true;
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
        const keywords = def.keywords ?? [];
        seat.board.push({
          iid: card.iid,
          defId: card.defId,
          attack: def.attack!,
          health: def.health!,
          baseHealth: def.health!,
          // Investida (charge) ataca já; senão, enjoo de invocação até o próximo turno.
          canAttack: keywords.includes('charge'),
          attacked: false,
        });
        this.addLog(`${seat.player.name} invocou ${def.name}`);
        if (keywords.includes('battlecry')) this.triggerBattlecry(idx, def.id);
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

    if (def.type === 'creature') seat.stats.creaturesSummoned++;
    else if (def.type === 'spell') seat.stats.spellsCast++;

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
          caster.stats.damageDealt += dmg;
          this.addLog(`${def.name} causou ${dmg} de dano em ${enemy.player.name}`);
        }
        break;
      }
      case 's_bencao':
        caster.hp = Math.min(STARTING_HP, caster.hp + 4);
        this.addLog(`${caster.player.name} restaurou 4 de vida`);
        break;
      case 's_tempestade': {
        // AoE: 2 de dano a TODAS as criaturas inimigas (pune go-wide; ferramenta
        // de virada). Sem alvo — atinge todos os assentos inimigos.
        let hit = 0;
        this.seats.forEach((s, i) => {
          if (i === casterIdx || s.out) return;
          for (const c of s.board) {
            c.health -= 2;
            hit++;
          }
          this.cleanupBoard(s);
        });
        this.addLog(`${def.name} atingiu ${hit} criatura(s) inimiga(s)`);
        break;
      }
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
        // Adianta energia DENTRO do turno, mas respeita o teto MAX_ENERGY (10) —
        // o mesmo limite da fase de energia (beginTurn). Antes clampava em
        // MAX_ENERGY+2, deixando a energia estourar o teto que o resto do motor
        // assume.
        caster.energy = Math.min(MAX_ENERGY, caster.energy + 2);
        this.addLog(`${caster.player.name} ganhou 2 de energia`);
        break;
      case 't_moeda':
        // "Moeda" de quem joga depois: +1 de energia neste turno (teto MAX_ENERGY).
        caster.energy = Math.min(MAX_ENERGY, caster.energy + 1);
        this.addLog(`${caster.player.name} usou a Moeda do Tempo (+1 de energia)`);
        break;
      case 't_recuo': {
        const { seat, creature } = enemyCreature();
        // rótulo calculado antes de remover: ainda inclui as cópias idênticas
        const label = this.creatureLabel(seat, creature);
        seat.board = seat.board.filter((c) => c.iid !== creature.iid);
        if (seat.hand.length < MAX_HAND) {
          seat.hand.push({ iid: creature.iid, defId: creature.defId });
          this.addLog(`${label} foi devolvida à mão de ${seat.player.name}`);
        } else {
          // Mão cheia: a criatura não cabe e é destruída (mesma convenção honesta
          // da queima por compra em draw()). O log antes mentia "devolvida à mão".
          this.addLog(`${label} não coube na mão cheia de ${seat.player.name} e foi destruída`);
        }
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
      const defenderDied = defender.health <= 0;
      this.bumpCreature(seat, attacker, power, defenderDied ? 1 : 0);
      this.addLog(`${attackerName} atacou ${defenderName}`);
      if (retaliation > 0) {
        this.addLog(`${defenderName} revidou: ${attackerName} sofreu ${retaliation} de dano`);
      }
      this.cleanupBoard(seat);
      this.cleanupBoard(enemy);
      // Dano excedente: ao destruir a última criatura em campo, o saldo do
      // golpe (não a retaliação) desconta dos pontos de vida do comandante.
      if (wasLast && defenderDied && excess > 0) {
        this.damagePlayer(enemy, excess);
        seat.stats.damageDealt += excess;
        this.addLog(`O dano excedente atingiu ${enemy.player.name} (−${excess})`);
      }
    } else {
      this.damagePlayer(enemy, power);
      seat.stats.damageDealt += power;
      this.bumpCreature(seat, attacker, power, 0);
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
    seat.stats.shieldAbsorbed += absorbed;
  }

  private cleanupBoard(seat: Seat): void {
    const dead = seat.board.filter((c) => c.health <= 0);
    // rótulo calculado com o tabuleiro ainda intacto, para citar a posição certa
    for (const c of dead) this.addLog(`${this.creatureLabel(seat, c)} foi destruída`);
    seat.board = seat.board.filter((c) => c.health > 0);
    // Estertor (deathrattle) dispara após a remoção do corpo.
    for (const c of dead) {
      if (CARDS[c.defId].keywords?.includes('deathrattle')) this.triggerDeathrattle(seat, c);
    }
  }

  // ─── Gatilhos de palavras-chave (battlecry / deathrattle) ───────

  /** Grito de Batalha: efeito ao invocar (targetless, sem mudar a UI de alvo). */
  private triggerBattlecry(casterIdx: number, defId: string): void {
    if (defId === 'c_arqueira') {
      // dispara 1 de dano numa criatura inimiga aleatória (fizzla sem alvos)
      const targets: Array<{ seat: Seat; creature: Creature }> = [];
      this.seats.forEach((s, i) => {
        if (i === casterIdx || s.out) return;
        for (const c of s.board) targets.push({ seat: s, creature: c });
      });
      if (!targets.length) return;
      const pick = targets[randomInt(targets.length)];
      pick.creature.health -= 1;
      this.addLog(`Grito de Batalha: a flecha causou 1 de dano em ${this.creatureLabel(pick.seat, pick.creature)}`);
      this.cleanupBoard(pick.seat);
    }
  }

  /** Estertor: efeito ao morrer (targetless). */
  private triggerDeathrattle(seat: Seat, creature: Creature): void {
    if (creature.defId === 'c_cavaleiro') {
      if (seat.board.length >= MAX_BOARD) return;
      const def = CARDS['c_recruta'];
      seat.board.push({
        iid: newIid(),
        defId: 'c_recruta',
        attack: def.attack!,
        health: def.health!,
        baseHealth: def.health!,
        canAttack: false,
        attacked: false,
      });
      this.addLog(`Estertor: um ${def.name} toma o lugar de ${CARDS['c_cavaleiro'].name}`);
    }
  }

  /**
   * Morte súbita por tempo (teto de turnos): vence quem tem mais vida; empate
   * decide pela maior soma de ataque em campo; persistindo o empate, o assento de
   * menor índice. Usa o motivo 'hp' (sem novo enum nem migração de banco).
   */
  private resolveByTiebreak(): void {
    const alive = this.seats.map((s, i) => ({ s, i })).filter(({ s }) => !s.out);
    if (alive.length <= 1) return;
    const score = (s: Seat) => s.hp * 1000 + s.board.reduce((sum, c) => sum + c.attack, 0);
    alive.sort((a, b) => score(b.s) - score(a.s));
    for (let k = 1; k < alive.length; k++) alive[k].s.out = true; // só o líder sobrevive
    this.addLog(`Limite de ${MAX_TURNS} turnos atingido — vitória por vantagem (morte súbita)`);
    this.checkEnd();
  }

  /** Resistência (comeback): liga/desliga o +2 de ataque conforme a vida do dono
   *  cruza 10, de forma idempotente (não acumula). Concede Investida ao ligar. */
  private refreshComeback(): void {
    for (const seat of this.seats) {
      const active = seat.hp <= 10 && !seat.out;
      for (const c of seat.board) {
        if (!CARDS[c.defId].keywords?.includes('comeback')) continue;
        if (active && !c.comebackOn) {
          c.attack += 2;
          c.comebackOn = true;
          if (!c.attacked) c.canAttack = true; // Investida enquanto resiste
        } else if (!active && c.comebackOn) {
          c.attack -= 2;
          c.comebackOn = false;
        }
      }
    }
  }

  private checkEnd(reasonHint?: MatchEndReason): void {
    if (this.status !== 'active') return;
    this.refreshComeback(); // reavalia a Resistência a cada mudança de estado
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
      stats: this.seats.map((s) => ({ ...s.stats })),
      mvp: this.seats.map((s) => {
        let best: MatchMvp | null = null;
        for (const e of s.creatureLog.values()) {
          if (!best || e.dmg > best.damage || (e.dmg === best.damage && e.kills > best.kills)) {
            best = { defId: e.defId, damage: e.dmg, kills: e.kills };
          }
        }
        return best;
      }),
    };
    this.addLog(`Vitória de ${this.seats[winnerSeat].player.name}!`);
    this.onFinish(this.result);
  }

  // ─── Bot de treino (assento virtual, sem MMR) ──────────────────
  // Heurística gananciosa que usa SÓ os métodos públicos validados — o bot não
  // tem socket e não pode trapacear (taunt/escudo/energia são checados de toda forma).

  private scheduleBotTurn(playerId: string): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try { this.runBotTurn(playerId); } catch { /* o bot nunca derruba a partida */ }
    }, BOT_TURN_DELAY_MS);
  }

  /** Joga a vez do bot: gasta cartas acessíveis, ataca e encerra o turno. */
  runBotTurn(playerId: string): void {
    const idx = this.seatOf(playerId);
    if (idx < 0 || this.status !== 'active' || this.turnSeat !== idx) return;
    const seat = this.seats[idx];

    // 1) jogar cartas acessíveis (uma por passada; repete até travar)
    let played = true;
    let guard = 0;
    while (played && this.status === 'active' && this.turnSeat === idx && guard++ < 20) {
      played = false;
      for (const card of [...seat.hand]) {
        const def = CARDS[card.defId];
        if (def.cost > seat.energy) continue;
        const wants = def.target ?? 'none';
        const target = wants === 'none' ? undefined : this.botTargetFor(idx, def);
        if (wants !== 'none' && !target) continue; // sem alvo válido → tenta outra
        try { this.playCard(playerId, card.iid, target); played = true; break; }
        catch { /* carta inválida agora; tenta a próxima */ }
      }
    }

    // 2) atacar com todas as criaturas prontas
    for (const c of [...seat.board]) {
      if (this.status !== 'active' || this.turnSeat !== idx) break;
      const live = seat.board.find((x) => x.iid === c.iid);
      if (!live || !live.canAttack || live.attacked) continue;
      const target = this.botAttackTarget(idx);
      if (!target) break;
      try { this.attack(playerId, live.iid, target); } catch { /* alvo sumiu; segue */ }
    }

    // 3) encerra o turno
    if (this.status === 'active' && this.turnSeat === idx) {
      try { this.endTurn(playerId); } catch { /* ignore */ }
    }
  }

  /** Alvo para uma carta com alvo (magia/tática), do ponto de vista do bot. */
  private botTargetFor(casterIdx: number, def: CardDef): Target | undefined {
    const enemyIdx = this.seats.findIndex((_, i) => i !== casterIdx && !this.seats[i].out);
    const enemy = enemyIdx >= 0 ? this.seats[enemyIdx] : null;
    if (def.target === 'friendly-creature') {
      const mine = this.seats[casterIdx].board[0];
      return mine ? { seat: casterIdx, iid: mine.iid } : undefined;
    }
    if (def.target === 'enemy-creature') {
      if (!enemy || enemy.board.length === 0) return undefined;
      return { seat: enemyIdx, iid: enemy.board[0].iid };
    }
    if (def.target === 'enemy-any') {
      if (!enemy) return undefined;
      // mira o comandante se a mesa permite (vazia ou a carta atravessa); senão a 1ª criatura
      if (enemy.board.length === 0 || def.pierce) return { seat: enemyIdx };
      return { seat: enemyIdx, iid: enemy.board[0].iid };
    }
    return undefined;
  }

  /** Alvo de ataque do bot: respeita Provocar e a proteção do comandante. */
  private botAttackTarget(casterIdx: number): Target | undefined {
    const enemyIdx = this.seats.findIndex((_, i) => i !== casterIdx && !this.seats[i].out);
    if (enemyIdx < 0) return undefined;
    const enemy = this.seats[enemyIdx];
    if (enemy.board.length === 0) return { seat: enemyIdx }; // mesa livre → comandante
    const taunt = enemy.board.find((c) => CARDS[c.defId].keywords?.includes('taunt'));
    return { seat: enemyIdx, iid: (taunt ?? enemy.board[0]).iid };
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
      commander: s.player.commander,
      accent: s.player.accent,
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
      mulliganDone: s.mulliganDone,
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
    if (this.mulliganTimer) clearTimeout(this.mulliganTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    for (const seat of this.seats) {
      if (seat.reconnectTimer) clearTimeout(seat.reconnectTimer);
    }
  }
}
