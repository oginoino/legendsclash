import { CARDS } from '@legendsclash/shared';
import type {
  CombatAction,
  CreatureOnBoard,
  GameView as GameViewState,
} from '@legendsclash/shared';

export const FX_TTL = 1100;
export const GHOST_TTL = 700;
export const REVEAL_TTL = 1700;
export const DAMAGE_NOTICE_TTL = 3600;
export const DAMAGE_SOURCE_TTL = 1500;
export const ENEMY_ATTACK_FX_TTL = 800;
export const BUBBLE_TTL = 4500;

export interface FloatFx {
  id: number;
  kind: 'dmg' | 'heal' | 'shield' | 'buff';
  value: number;
  anchor: string;
  at: number;
}

export interface Ghost {
  id: number;
  seatIdx: number;
  creature: CreatureOnBoard;
  slot: number;
  at: number;
}

export interface Reveal {
  id: number;
  cardId: string;
  at: number;
}

export interface Bubble {
  id: number;
  seatIdx: number;
  text: string;
  at: number;
}

export interface DamageNoticeHit {
  target: string;
  iid?: string;
  defId?: string;
  amount?: number;
  kind: 'hp' | 'shield' | 'creature' | 'defeat';
}

export interface DamageNotice {
  id: number;
  owner: string;
  source: string;
  sourceDefId?: string;
  sourceIid?: string;
  actionLabel: string;
  summary: string;
  incoming: number;
  hpDamage: number;
  shieldDamage: number;
  hpAfter: number;
  hits: DamageNoticeHit[];
  severity: 'normal' | 'heavy' | 'lethal';
  at: number;
}

export type FeedbackSoundCue =
  | 'damage'
  | 'death'
  | 'draw'
  | 'energyUp'
  | 'heal'
  | 'myTurn'
  | 'reveal'
  | 'shield'
  | 'buff'
  | 'tableWin';

export interface SnapshotFeedback {
  effects: FloatFx[];
  ghosts: Ghost[];
  reveals: Reveal[];
  sounds: FeedbackSoundCue[];
  attackFx?: { iid: string; at: number };
  banner?: { text: string; at: number };
  damageNotice?: DamageNotice;
  resetAim: boolean;
}

function emptyFeedback(): SnapshotFeedback {
  return {
    effects: [],
    ghosts: [],
    reveals: [],
    sounds: [],
    resetAim: false,
  };
}

function isDamageLogLine(text: string): boolean {
  return /\b(causou|sofreu|atingiu|atacou|revidou|excedente|sangrou|dano)\b/i.test(text);
}

function damageSourceFromLog(text: string | undefined): string {
  if (!text) return 'Ação inimiga';
  if (text.startsWith('Grito de Batalha')) return 'Grito de Batalha';
  if (text.startsWith('Estertor')) return 'Estertor';
  const [source] = text.split(/\s+(?:causou|atingiu|atacou|revidou|sofreu)\b/i);
  return source?.replace(/^O\s+/, '').trim() || 'Ação inimiga';
}

function sourceDefIdFromLogs(lines: string[]): string | undefined {
  const joined = lines.join(' · ').toLocaleLowerCase('pt-BR');
  return Object.values(CARDS)
    .sort((a, b) => b.name.length - a.name.length)
    .find((card) => joined.includes(card.name.toLocaleLowerCase('pt-BR')))?.id;
}

function actionLabelFor(
  action: CombatAction | undefined,
  sourceDefId: string | undefined,
  logs: string[],
): string {
  const hasDeathrattle = logs.some((line) => /^Estertor:/i.test(line));
  if (action?.kind === 'attack') return hasDeathrattle ? 'Ataque + Estertor' : 'Ataque';
  if (hasDeathrattle) return 'Estertor';
  const definition = sourceDefId ? CARDS[sourceDefId] : undefined;
  if (definition?.keywords?.includes('battlecry')) return 'Grito de batalha';
  if (definition?.type === 'spell') return 'Magia';
  if (definition?.type === 'tactic') return 'Tática';
  if (definition?.type === 'artifact') return 'Artefato';
  return 'Efeito inimigo';
}

function consolidateDamageHits(hits: DamageNoticeHit[]): DamageNoticeHit[] {
  const direct = hits.filter((hit) => hit.kind === 'hp' || hit.kind === 'shield');
  const creatures = new Map<string, DamageNoticeHit>();
  for (const hit of hits) {
    if (hit.kind !== 'creature' && hit.kind !== 'defeat') continue;
    const key = hit.iid ?? `${hit.defId ?? ''}:${hit.target}`;
    const current = creatures.get(key);
    creatures.set(key, {
      ...current,
      ...hit,
      amount: hit.amount ?? current?.amount,
      kind: hit.kind === 'defeat' || current?.kind === 'defeat' ? 'defeat' : 'creature',
    });
  }
  return [...direct, ...creatures.values()];
}

function impactSummary(
  hpDamage: number,
  shieldDamage: number,
  hits: DamageNoticeHit[],
): string {
  if (hpDamage > 0) return `${hpDamage} de vida perdida`;
  if (shieldDamage > 0) return `${shieldDamage} de dano bloqueado`;
  const defeated = hits.filter((hit) => hit.kind === 'defeat');
  if (defeated.length === 1) return `${defeated[0].target} foi abatido`;
  if (defeated.length > 1) return `${defeated.length} criaturas foram abatidas`;
  const boardDamage = hits
    .filter((hit) => hit.kind === 'creature')
    .reduce((sum, hit) => sum + (hit.amount ?? 0), 0);
  return boardDamage > 0 ? `${boardDamage} de dano na sua mesa` : 'Seu lado sofreu o impacto';
}

export function deriveSnapshotFeedback(
  previous: GameViewState | null,
  game: GameViewState | null,
  at: number,
  nextId: () => number,
): SnapshotFeedback {
  const feedback = emptyFeedback();
  if (!previous || !game || previous.matchId !== game.matchId || game.yourSeat < 0) return feedback;

  const receivedHits: DamageNoticeHit[] = [];
  const newLogs = game.log.slice(previous.log.length).map((entry) => entry.text);
  const damageLine = [...newLogs].reverse().find(isDamageLogLine);
  const newPlays = game.plays.slice(previous.plays.length);
  const enemyPlays = newPlays.filter((play) => play.seat !== game.yourSeat);
  const previousActionSeq = Math.max(0, ...(previous.actions ?? []).map((action) => action.seq));
  const newActions = (game.actions ?? []).filter((action) => action.seq > previousActionSeq);
  const enemyActions = newActions.filter((action) => action.seat !== game.yourSeat);
  const enemyAttack = [...enemyActions].reverse().find(
    (action) => action.kind === 'attack' && action.sourceIid,
  );
  if (enemyAttack?.sourceIid) feedback.attackFx = { iid: enemyAttack.sourceIid, at };

  const enemySeatIdxForNotice = game.seats.findIndex((_, seat) => seat !== game.yourSeat);
  const enemyNameForNotice = enemySeatIdxForNotice >= 0
    ? game.seats[enemySeatIdxForNotice].name
    : 'Adversário';
  let hadDamage = false;
  let hadHeal = false;
  let hadShield = false;
  let hadBuff = false;
  let hadDeath = false;

  game.seats.forEach((seat, seatIdx) => {
    const before = previous.seats[seatIdx];
    if (!before) return;

    if (seat.hp < before.hp) {
      const amount = before.hp - seat.hp;
      feedback.effects.push({ id: nextId(), kind: 'dmg', value: amount, anchor: `face-${seatIdx}`, at });
      if (seatIdx === game.yourSeat) {
        receivedHits.push({ target: 'seu comandante', amount, kind: 'hp' });
      }
      hadDamage = true;
    } else if (seat.hp > before.hp) {
      feedback.effects.push({ id: nextId(), kind: 'heal', value: seat.hp - before.hp, anchor: `face-${seatIdx}`, at });
      hadHeal = true;
    }

    if (seat.shield < before.shield) {
      const amount = before.shield - seat.shield;
      feedback.effects.push({ id: nextId(), kind: 'shield', value: amount, anchor: `face-${seatIdx}`, at });
      if (seatIdx === game.yourSeat) {
        receivedHits.push({ target: 'seu escudo', amount, kind: 'shield' });
      }
      hadShield = true;
    }

    const previousById = new Map(before.board.map((creature) => [creature.iid, creature]));
    for (const creature of seat.board) {
      const previousCreature = previousById.get(creature.iid);
      if (!previousCreature) continue;

      if (creature.health < previousCreature.health) {
        const amount = previousCreature.health - creature.health;
        feedback.effects.push({ id: nextId(), kind: 'dmg', value: amount, anchor: `cr-${creature.iid}`, at });
        if (seatIdx === game.yourSeat) {
          receivedHits.push({
            target: CARDS[creature.defId].name,
            iid: creature.iid,
            defId: creature.defId,
            amount,
            kind: 'creature',
          });
        }
        hadDamage = true;
      } else if (creature.health > previousCreature.health) {
        feedback.effects.push({
          id: nextId(),
          kind: 'heal',
          value: creature.health - previousCreature.health,
          anchor: `cr-${creature.iid}`,
          at,
        });
        hadHeal = true;
      }

      if (
        creature.attack > previousCreature.attack
        || creature.baseHealth > previousCreature.baseHealth
      ) {
        feedback.effects.push({ id: nextId(), kind: 'buff', value: 0, anchor: `cr-${creature.iid}`, at });
        hadBuff = true;
      }
    }

    before.board.forEach((creature, slot) => {
      if (seat.board.some((current) => current.iid === creature.iid)) return;
      feedback.ghosts.push({ id: nextId(), seatIdx, creature, slot, at });
      if (seatIdx === game.yourSeat) {
        receivedHits.push({
          target: CARDS[creature.defId].name,
          iid: creature.iid,
          defId: creature.defId,
          kind: 'defeat',
        });
      }
      hadDeath = true;
    });
  });

  if (game.hand.length > previous.hand.length) feedback.sounds.push('draw');
  const sameTurn = previous.turnSeat === game.turnSeat;
  const playerNow = game.seats[game.yourSeat];
  const playerBefore = previous.seats[game.yourSeat];
  if (sameTurn && playerNow && playerBefore && playerNow.energy > playerBefore.energy) {
    feedback.sounds.push('energyUp');
  }

  if (enemyPlays.length) {
    feedback.reveals.push(...enemyPlays.map((play) => ({
      id: nextId(),
      cardId: play.cardId,
      at,
    })));
    feedback.sounds.push('reveal');
  }

  const deathrattleLogs = newLogs.filter((line) => /^Estertor:/i.test(line));
  const deathrattleSourceDefId = sourceDefIdFromLogs(deathrattleLogs);
  const hostileDeathrattle = !!deathrattleSourceDefId && enemySeatIdxForNotice >= 0
    && previous.seats[enemySeatIdxForNotice]?.board.some(
      (card) => card.defId === deathrattleSourceDefId,
    );
  const causeAction = enemyActions.at(-1);
  const fatigueDamage = /\b(fadiga|baralho acabou|sem carta)\b/i.test(damageLine ?? '');
  const receivedFromOpponent = receivedHits.length > 0
    && !fatigueDamage
    && (!!causeAction || hostileDeathrattle);

  if (receivedFromOpponent) {
    const sourceDefId = causeAction?.sourceDefId
      ?? (hostileDeathrattle ? deathrattleSourceDefId : undefined)
      ?? sourceDefIdFromLogs(newLogs);
    const source = sourceDefId
      ? CARDS[sourceDefId]?.name ?? 'Ação inimiga'
      : damageSourceFromLog(damageLine);
    const hpDamage = receivedHits
      .filter((hit) => hit.kind === 'hp')
      .reduce((sum, hit) => sum + (hit.amount ?? 0), 0);
    const shieldDamage = receivedHits
      .filter((hit) => hit.kind === 'shield')
      .reduce((sum, hit) => sum + (hit.amount ?? 0), 0);
    const defeats = receivedHits.filter((hit) => hit.kind === 'defeat').length;
    const playerAfter = game.seats[game.yourSeat];
    const severity: DamageNotice['severity'] = playerAfter.hp <= 0
      ? 'lethal'
      : hpDamage + shieldDamage >= 5 || defeats > 0 || playerAfter.hp <= 10
        ? 'heavy'
        : 'normal';
    const consolidatedHits = consolidateDamageHits(receivedHits);

    feedback.damageNotice = {
      id: nextId(),
      owner: enemyNameForNotice,
      source,
      sourceDefId,
      sourceIid: causeAction && causeAction.sourceDefId === sourceDefId
        ? causeAction.sourceIid
        : undefined,
      actionLabel: actionLabelFor(
        causeAction,
        sourceDefId,
        hostileDeathrattle ? deathrattleLogs : [],
      ),
      summary: impactSummary(hpDamage, shieldDamage, consolidatedHits),
      incoming: hpDamage + shieldDamage,
      hpDamage,
      shieldDamage,
      hpAfter: playerAfter.hp,
      hits: consolidatedHits.slice(0, 5),
      severity,
      at,
    };
  }

  if (hadDeath) feedback.sounds.push('death');
  if (hadDamage) feedback.sounds.push('damage');
  else if (hadHeal) feedback.sounds.push('heal');
  if (hadShield) feedback.sounds.push('shield');
  if (hadBuff) feedback.sounds.push('buff');

  const enemyIdx = game.seats.findIndex((_, seat) => seat !== game.yourSeat);
  if (
    enemyIdx >= 0
    && game.status === 'active'
    && previous.seats[enemyIdx]
    && previous.seats[enemyIdx].board.length > 0
    && game.seats[enemyIdx].board.length === 0
  ) {
    feedback.banner = { text: 'Venceu a mesa!', at };
    feedback.sounds.push('tableWin');
  }

  if (previous.turnSeat !== game.turnSeat && game.status === 'active') {
    const mine = game.turnSeat === game.yourSeat;
    feedback.banner = {
      text: mine ? 'Seu turno!' : `Turno de ${game.seats[game.turnSeat].name}`,
      at,
    };
    if (mine) feedback.sounds.push('myTurn');
    feedback.resetAim = true;
  }

  return feedback;
}
