import { randomBytes } from 'node:crypto';
import {
  CARDS, MAX_BOARD, MAX_ENERGY, MAX_HAND,
  RECONNECT_GRACE_MS, STARTING_HAND, STARTING_HP, TURN_SECONDS,
} from '@legendsclash/shared';
import type {
  CombatAction, GameLogEntry, GameView, MatchEndReason, MatchMvp, Target,
} from '@legendsclash/shared';
import { BotTurnController } from './bot/bot-turn-controller.js';
import { cardInstances } from './cards/card-instance-factory.js';
import { CombatResolver } from './combat/combat-resolver.js';
import { ReconnectController } from './connection/reconnect-controller.js';
import { CardEffects } from './effects/card-effects.js';
import { GameError } from './errors.js';
import {
  createMatchSnapshot,
  hydrateMatchState,
  hydrateSeat,
} from './snapshot/match-snapshot-mapper.js';
import { TurnClock } from './timing/turn-clock.js';
import { createGameView } from './view/game-view-mapper.js';
import type {
  Creature,
  EngineResult,
  MatchContent,
  MatchPlayer,
  MatchSnapshot,
  Seat,
} from './types.js';

export { GameError } from './errors.js';
export { BOT_CADENCE_MS } from './bot/bot-turn-controller.js';
export type {
  CardInstance,
  Creature,
  EngineResult,
  MatchContent,
  MatchPlayer,
  MatchSnapshot,
  SeatSnapshot,
} from './types.js';

/**
 * Motor de regras autoritativo (slide "Briefing": WebSockets com servidor
 * autoritativo — estado único, anti-lag e anti-cheat). Toda jogada é validada
 * aqui; o cliente apenas envia intenções e renderiza o estado.
 *
 * Decisão de produto (slide "por que 1v1 primeiro"): salas modeladas por
 * assentos e turnos em fila circular — 1v1 é o caso particular N=2. O motor
 * não assume dois jogadores em nenhuma regra estrutural.
 */

// Tipos e erros continuam reexportados por esta fachada para preservar os imports existentes.

/** Segundos da fase de mulligan (troca de mão inicial) antes do turno 1. */
const MULLIGAN_SECONDS = 30;
/**
 * Teto de turnos (somados entre os assentos): backstop contra impasses que se
 * arrastam (board-lock simétrico). Atingido o teto, a partida é decidida por
 * morte súbita por vantagem — garante encerramento previsível.
 */
const MAX_TURNS = 40;
/** Teto do escudo acumulável por artefato (Figura de Proa) — evita tartaruga infinita. */
const MAX_ARTIFACT_SHIELD = 10;
/** Folga mínima quando o prazo de reconexão vence durante o restart/deploy. */
const RESTORE_MIN_GRACE_MS = 15_000;

export class Match {
  readonly id: string;
  readonly seats: Seat[];
  private turnSeat = 0;
  private turnNumber = 0;
  private status: 'mulligan' | 'active' | 'finished' = 'active';
  private result: EngineResult | null = null;
  private readonly clock: TurnClock;
  private readonly reconnect: ReconnectController<Seat>;
  private readonly cardEffects: CardEffects;
  private readonly combat: CombatResolver;
  private readonly bot: BotTurnController;
  private readonly startedAt: number;
  private log: GameLogEntry[] = [];
  private plays: Array<{ seat: number; cardId: string; at: number }> = [];
  private actions: CombatAction[] = [];
  private actionSeq = 0;

  /**
   * onUpdate: reenvia visões; onFinish: Elo/histórico/notificação.
   * `restored` hidrata uma partida salva em snapshot, sem comprar novas mãos.
   */
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
    restored?: MatchSnapshot,
  ) {
    if (players.length < 2) throw new Error('partida exige ao menos 2 jogadores');
    this.id = restored?.id ?? 'm' + randomBytes(6).toString('hex');
    this.startedAt = restored?.startedAt ?? Date.now();
    if (restored) {
      const state = hydrateMatchState(restored);
      this.status = state.status;
      this.turnSeat = state.turnSeat;
      this.turnNumber = state.turnNumber;
      this.log = state.log;
      this.plays = state.plays;
      this.actions = state.actions;
      this.actionSeq = state.actionSeq;
      cardInstances.observeSnapshot(restored);
    }
    this.seats = players.map((player, i) => hydrateSeat({
      player,
      snapshot: restored?.seats[i],
      restoringMatch: restored !== undefined,
      buildDeck: () => cardInstances.buildDeck(
        content.factions?.[player.id],
        content.comeback ?? false,
      ),
    }));
    this.clock = new TurnClock(restored?.tutorialOpenPlayerIds);
    this.reconnect = new ReconnectController((seat) => {
      if (this.status === 'finished' || seat.connected) return;
      seat.out = true;
      this.addLog(`${seat.player.name} não voltou a tempo`);
      this.checkEnd('timeout');
      this.onUpdate();
    });
    this.cardEffects = new CardEffects({
      seats: this.seats,
      draw: (seat) => this.draw(seat),
      damagePlayer: (seat, amount) => this.damagePlayer(seat, amount),
      addLog: (text) => this.addLog(text),
      creatureLabel: (seat, creature) => this.creatureLabel(seat, creature),
      newInstanceId: () => cardInstances.nextId(),
    });
    this.combat = new CombatResolver({
      seats: this.seats,
      cardEffects: this.cardEffects,
      damagePlayer: (seat, amount) => this.damagePlayer(seat, amount),
      addLog: (text) => this.addLog(text),
      creatureLabel: (seat, creature) => this.creatureLabel(seat, creature),
      recordAction: (action) => this.recordAction(action),
    });
    this.bot = new BotTurnController({
      seats: this.seats,
      seatOf: (playerId) => this.seatOf(playerId),
      isTurnActive: (playerId) => {
        const seatIdx = this.seatOf(playerId);
        return seatIdx >= 0 && this.status === 'active' && this.turnSeat === seatIdx;
      },
      playCard: (playerId, iid, target) => this.playCard(playerId, iid, target),
      attack: (playerId, attackerIid, target) => this.attack(playerId, attackerIid, target),
      endTurn: (playerId) => this.endTurn(playerId),
    });
  }

  start(): void {
    // Mão inicial. Quem joga depois recebe a "moeda": tempo (1 de energia) no
    // lugar de uma carta extra — devolve a iniciativa que o seat 0 ganha por agir
    // primeiro, e o jogador decide quando gastá-la (pode segurar), ao contrário de
    // um bônus fixo. Antes a compensação era +1 carta (recurso, não tempo).
    this.seats.forEach((seat, i) => {
      for (let k = 0; k < STARTING_HAND; k++) this.draw(seat, true);
      if (i !== 0) seat.hand.push(cardInstances.create('t_moeda'));
    });
    this.addLog(`Partida iniciada: ${this.seats.map((s) => s.player.name).join(' vs ')}`);
    if (this.useMulligan) {
      // Fase de troca: cada jogador ajusta a mão inicial antes do turno 1.
      this.status = 'mulligan';
      this.armMulliganTimer();
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

  private armMulliganTimer(ms = MULLIGAN_SECONDS * 1000): void {
    this.clock.arm(ms, () => this.forceFinishMulligan());
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
      cardInstances.shuffle(seat.deck);
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
    this.clock.clear();
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

    // Artefatos com efeito por turno (expansão Maré Sem Rei)
    if (seat.regen > 0 && seat.hp > 0 && seat.hp < STARTING_HP) {
      const healed = Math.min(STARTING_HP - seat.hp, seat.regen);
      seat.hp += healed;
      this.addLog(`${CARDS['a_relicario'].name} restaurou ${healed} de vida a ${seat.player.name}`);
    }
    if (seat.shieldRegen > 0 && seat.shield < MAX_ARTIFACT_SHIELD) {
      const gained = Math.min(MAX_ARTIFACT_SHIELD - seat.shield, seat.shieldRegen);
      seat.shield += gained;
      this.addLog(`${CARDS['a_figura'].name} concedeu ${gained} de escudo a ${seat.player.name}`);
    }

    // Fase de Compra
    this.draw(seat);
    if (this.status !== 'active') return;

    for (const c of seat.board) {
      c.canAttack = true;
      c.attacked = false;
    }

    this.addLog(`Turno ${this.turnNumber}: vez de ${seat.player.name}`);
    this.armTurnTimer();
    this.checkEnd();
    // modo treino: se a vez é da IA, agenda a jogada dela (após uma pausa legível)
    if (this.status === 'active' && this.botIds.includes(seat.player.id)) {
      this.bot.scheduleTurn(seat.player.id);
    }
  }

  private armTurnTimer(ms = this.turnSeconds * 1000): void {
    this.clock.arm(ms, () => {
      if (this.status !== 'active') return;
      this.addLog(`${this.seats[this.turnSeat].player.name} ficou sem tempo — turno encerrado`);
      this.advanceTurn();
      this.onUpdate();
    });
  }

  /**
   * Congela o primeiro turno enquanto um jogador elegivel ainda le o tutorial.
   * O Set torna heartbeats/reconexoes idempotentes e a pausa so existe no
   * onboarding real, evitando que clientes usem a mensagem em partidas futuras.
   */
  setTutorialOpen(playerId: string, open: boolean): void {
    const idx = this.seatOf(playerId);
    if (idx < 0 || this.status !== 'active') return;
    const player = this.seats[idx].player;
    if (open && (this.turnNumber !== 1 || player.tutorialEligible !== true)) return;

    const changed = this.clock.setPausedBy(playerId, open);
    if (!changed) return;
    this.onUpdate();
  }

  /** Fila circular: o próximo assento ativo, qualquer que seja N. */
  private advanceTurn(): void {
    if (this.status !== 'active') return;
    this.bot.clear();
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
      if (!silent) {
        this.addLog(
          `${seat.player.name} tentou comprar, mas o baralho acabou: fadiga ${seat.fatigue} causou ${seat.fatigue} de dano`,
        );
      }
      this.checkEnd('fatigue');
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
    if (this.clock.paused) throw new GameError('A partida está pausada durante o tutorial inicial.');
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
    patch: { name?: string; avatar?: string; commander?: string; accent?: string; photo?: string | null; frame?: string; accentStyle?: string },
  ): boolean {
    const seat = this.seats.find((s) => s.player.id === playerId);
    if (!seat) return false;
    if (patch.name) seat.player.name = patch.name;
    if (patch.avatar) seat.player.avatar = patch.avatar;
    if (patch.commander) seat.player.commander = patch.commander;
    if (patch.accent) seat.player.accent = patch.accent;
    if (patch.photo !== undefined) seat.player.photo = patch.photo;
    if (patch.frame) seat.player.frame = patch.frame;
    if (patch.accentStyle) seat.player.accentStyle = patch.accentStyle;
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
          ward: keywords.includes('ward') || undefined,
        });
        this.addLog(`${seat.player.name} invocou ${def.name}`);
        if (keywords.includes('battlecry')) this.cardEffects.triggerBattlecry(idx, def.id, card.iid);
        break;
      }
      case 'spell':
      case 'tactic':
        this.cardEffects.resolve(idx, def.id, target);
        break;
      case 'artifact': {
        if (def.id === 'a_escudo') {
          seat.shield += 4;
        } else if (def.id === 'a_estandarte') {
          seat.attackBonus += 1;
          seat.artifacts.push(def.id);
        } else if (def.id === 'a_relicario') {
          seat.regen += 1;
          seat.artifacts.push(def.id);
        } else if (def.id === 'a_orbe') {
          seat.spellBonus += 1;
          seat.artifacts.push(def.id);
        } else if (def.id === 'a_figura') {
          seat.shieldRegen += 1;
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
    this.recordAction({
      seat: idx,
      kind: 'card',
      sourceDefId: def.id,
      sourceIid: card.iid,
      target: target ? { ...target } : undefined,
    });
    this.checkEnd();
    this.onUpdate();
  }

  attack(playerId: string, attackerIid: string, target: Target): void {
    const { idx } = this.requireTurn(playerId);
    this.combat.resolveAttack(idx, attackerIid, target);
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
    if (idx < 0 || this.status === 'finished') return;
    const seat = this.seats[idx];
    // Uma aba fechada nunca pode manter o onboarding dos demais congelado.
    this.clock.setPausedBy(playerId, false);
    this.addLog(`${seat.player.name} desconectou — ${RECONNECT_GRACE_MS / 60000} min para reconectar`);
    this.reconnect.disconnect(seat, RECONNECT_GRACE_MS);
    this.onUpdate();
  }

  handleReconnect(playerId: string): void {
    const idx = this.seatOf(playerId);
    if (idx < 0) return;
    const seat = this.seats[idx];
    if (this.reconnect.reconnect(seat)) {
      this.addLog(`${seat.player.name} reconectou`);
      this.onUpdate();
    }
  }

  // ─── Snapshot (partidas sobrevivem a deploys/restarts) ─────────

  /** Estado persistível — sem timers nem sockets; ver snapshot.ts. */
  toSnapshot(): MatchSnapshot {
    if (this.status === 'finished') throw new Error('Partida encerrada não deve ser serializada.');
    return createMatchSnapshot({
      id: this.id,
      startedAt: this.startedAt,
      status: this.status,
      turnSeat: this.turnSeat,
      turnNumber: this.turnNumber,
      turnSeconds: this.turnSeconds,
      turnTimeLeftMs: this.clock.view().timeLeftMs,
      tutorialOpenPlayerIds: this.clock.pausedBy,
      useMulligan: this.useMulligan,
      botIds: this.botIds,
      content: this.content,
      seats: this.seats,
      reconnectDeadlineFor: (seat) => this.reconnect.deadlineFor(seat),
      log: this.log,
      plays: this.plays,
      actions: this.actions,
      actionSeq: this.actionSeq,
    });
  }

  /**
   * Recria a partida no processo novo. Todos os assentos nascem desconectados:
   * quem estava conectado ganha a janela cheia; quem já estava desconectado
   * mantém o prazo restante, com folga mínima para cobrir o downtime do deploy.
   */
  static restore(
    snap: MatchSnapshot,
    onUpdate: () => void,
    onFinish: (result: EngineResult) => void,
  ): Match {
    const players = snap.seats.map((s) => s.player);
    const m = new Match(
      players,
      onUpdate,
      onFinish,
      snap.turnSeconds,
      snap.useMulligan,
      snap.botIds,
      snap.content,
      snap,
    );
    m.addLog('Servidor atualizado — partida restaurada');
    for (const [i, seat] of m.seats.entries()) {
      if (seat.out) continue;
      const deadline = snap.seats[i].reconnectDeadline;
      m.reconnect.disconnect(seat, deadline === null
        ? RECONNECT_GRACE_MS
        : Math.max(RESTORE_MIN_GRACE_MS, deadline - Date.now()));
    }
    if (m.status === 'mulligan') {
      m.armMulliganTimer();
    } else if (m.status === 'active') {
      m.armTurnTimer(snap.turnTimeLeftMs ?? snap.turnSeconds * 1000);
      const current = m.seats[m.turnSeat];
      if (current && m.botIds.includes(current.player.id)) m.bot.scheduleTurn(current.player.id);
    }
    return m;
  }

  // ─── Fim de jogo ────────────────────────────────────────────────

  private damagePlayer(seat: Seat, amount: number): void {
    const absorbed = Math.min(seat.shield, amount);
    seat.shield -= absorbed;
    seat.hp -= amount - absorbed;
    seat.stats.shieldAbsorbed += absorbed;
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
    if (this.status === 'finished') return;
    if (this.status === 'active') this.refreshComeback(); // reavalia a Resistência a cada mudança de estado
    for (const seat of this.seats) {
      if (!seat.out && seat.hp <= 0) {
        seat.out = true;
        this.addLog(`${seat.player.name} ficou sem vida`);
      }
    }
    const alive = this.seats.map((s, i) => ({ s, i })).filter(({ s }) => !s.out);
    if (alive.length > 1) return;

    this.status = 'finished';
    this.clock.clear();
    this.bot.clear();
    this.reconnect.clear();
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
  /** Resolve imediatamente para simulacoes e testes do motor. */
  runBotTurn(playerId: string): void {
    this.bot.runImmediate(playerId);
  }

  // ─── Visões redigidas por jogador (anti-cheat) ─────────────────
  // Cada cliente recebe apenas o que pode ver: a própria mão completa e,
  // dos oponentes, apenas contagens.

  viewFor(playerId: string): GameView {
    return createGameView({
      matchId: this.id,
      playerId,
      turnSeat: this.turnSeat,
      turnNumber: this.turnNumber,
      clock: this.clock.view(),
      seats: this.seats,
      status: this.status,
      log: this.log,
      plays: this.plays,
      actions: this.actions,
    });
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

  private recordAction(action: Omit<CombatAction, 'seq' | 'at'>): void {
    this.actions.push({ ...action, seq: ++this.actionSeq, at: Date.now() });
    if (this.actions.length > 48) this.actions.splice(0, this.actions.length - 48);
  }

  /** Encerramento administrativo (ex.: desligamento do servidor). */
  dispose(): void {
    this.clock.clear();
    this.bot.clear();
    this.reconnect.clear();
  }
}
