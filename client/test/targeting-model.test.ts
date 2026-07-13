import { describe, expect, it } from 'vitest';
import { CARDS } from '@legendsclash/shared';
import type { CreatureOnBoard, SeatView } from '@legendsclash/shared';
import {
  combatPreviewFor,
  isValidDragTarget,
  targetFromAnchor,
} from '../src/features/game/targeting-model';

function creature(overrides: Partial<CreatureOnBoard> = {}): CreatureOnBoard {
  return {
    iid: 'creature-1',
    defId: 'c_lobo',
    attack: 3,
    health: 2,
    baseHealth: 2,
    canAttack: true,
    ...overrides,
  };
}

function seat(overrides: Partial<SeatView> = {}): SeatView {
  return {
    playerId: 'player',
    name: 'Jogador',
    avatar: 'shield',
    commander: 'shield',
    accent: '#4d8dff',
    photo: null,
    frame: '',
    accentStyle: '',
    mmr: 1000,
    hp: 30,
    shield: 0,
    energy: 3,
    maxEnergy: 3,
    deckCount: 20,
    handCount: 5,
    board: [],
    artifacts: [],
    attackBonus: 0,
    fatigue: 0,
    connected: true,
    out: false,
    mulliganDone: true,
    ...overrides,
  };
}

function preview({
  target,
  attacker = null,
  selectedCard = null,
  player = seat(),
  enemy = seat({ playerId: 'enemy' }),
}: {
  target: { kind: 'face' } | { kind: 'creature'; iid: string };
  attacker?: CreatureOnBoard | null;
  selectedCard?: (typeof CARDS)[string] | null;
  player?: SeatView;
  enemy?: SeatView;
}) {
  return combatPreviewFor({
    target,
    myTurn: true,
    attacker,
    selectedCard,
    player,
    enemy,
  });
}

describe('combatPreviewFor', () => {
  it('considera vida e escudo do comandante ao calcular letal', () => {
    const attacker = creature({ attack: 5 });
    const enemy = seat({ hp: 4, shield: 2 });

    expect(preview({ target: { kind: 'face' }, attacker, enemy })).toMatchObject({
      targetDmg: 5,
      lethal: false,
      attackerIid: attacker.iid,
    });

    attacker.attack = 6;
    expect(preview({ target: { kind: 'face' }, attacker, enemy })?.lethal).toBe(true);
  });

  it('impede a prévia contra uma criatura comum enquanto houver Provocar', () => {
    const attacker = creature({ iid: 'attacker', attack: 4 });
    const taunt = creature({ iid: 'taunt', defId: 'c_golem', health: 6, baseHealth: 6 });
    const common = creature({ iid: 'common' });
    const enemy = seat({ board: [taunt, common] });

    expect(preview({ target: { kind: 'creature', iid: common.iid }, attacker, enemy })).toBeNull();
    expect(preview({ target: { kind: 'creature', iid: taunt.iid }, attacker, enemy })).toMatchObject({
      targetDmg: 4,
      targetDies: false,
    });
  });

  it('espelha Escudo Arcano nos dois lados do combate', () => {
    const attacker = creature({ iid: 'attacker', attack: 5, health: 2, ward: true });
    const defender = creature({ iid: 'defender', attack: 6, health: 1, ward: true });
    const enemy = seat({ board: [defender] });

    expect(preview({ target: { kind: 'creature', iid: defender.iid }, attacker, enemy })).toMatchObject({
      targetDmg: 0,
      targetDies: false,
      selfDmg: 0,
      selfDies: false,
    });
  });

  it('só aplica dano excedente quando a última defensora é abatida', () => {
    const attacker = creature({ iid: 'attacker', attack: 7 });
    const defender = creature({ iid: 'defender', health: 3, baseHealth: 3 });
    const lastDefender = seat({ hp: 4, board: [defender] });

    expect(preview({ target: { kind: 'creature', iid: defender.iid }, attacker, enemy: lastDefender })).toMatchObject({
      targetDmg: 7,
      targetDies: true,
      overflow: 4,
      lethal: true,
    });

    const occupiedBoard = seat({ hp: 4, board: [defender, creature({ iid: 'other' })] });
    const result = preview({ target: { kind: 'creature', iid: defender.iid }, attacker, enemy: occupiedBoard });
    expect(result?.targetDies).toBe(true);
    expect(result?.overflow).toBeUndefined();
    expect(result?.lethal).toBe(false);
  });

  it('soma Orbes de Éter e respeita perfuração contra o comandante protegido', () => {
    const player = seat({ artifacts: ['a_orbe', 'a_orbe'] });
    const defender = creature({ iid: 'defender' });
    const enemy = seat({ hp: 4, board: [defender] });

    expect(preview({
      target: { kind: 'creature', iid: defender.iid },
      selectedCard: CARDS.s_faisca,
      player,
      enemy,
    })?.targetDmg).toBe(4);
    expect(preview({ target: { kind: 'face' }, selectedCard: CARDS.s_faisca, player, enemy })).toBeNull();
    expect(preview({ target: { kind: 'face' }, selectedCard: CARDS.s_bola_de_fogo, player, enemy })).toMatchObject({
      targetDmg: 7,
      lethal: true,
    });
  });

  it('não promete dano de magia contra uma criatura com Escudo Arcano', () => {
    const defender = creature({ iid: 'warded', health: 1, ward: true });
    const enemy = seat({ board: [defender] });

    expect(preview({
      target: { kind: 'creature', iid: defender.iid },
      selectedCard: CARDS.s_faisca,
      enemy,
    })).toMatchObject({ targetDmg: 0, targetDies: false });
  });
});

describe('drag targeting', () => {
  const ally = creature({ iid: 'ally' });
  const enemy = creature({ iid: 'enemy' });
  const taunt = creature({ iid: 'taunt', defId: 'c_golem' });

  it('mantém a matriz de alvos de cartas e ataques', () => {
    expect(isValidDragTarget(
      { kind: 'hand', defId: 's_fortalecer' },
      { kind: 'my-creature', c: ally },
      [enemy],
    )).toBe(true);
    expect(isValidDragTarget(
      { kind: 'hand', defId: 's_fortalecer' },
      { kind: 'enemy-creature', c: enemy },
      [enemy],
    )).toBe(false);
    expect(isValidDragTarget(
      { kind: 'hand', defId: 's_lanca_gelo' },
      { kind: 'face' },
      [],
    )).toBe(false);
    expect(isValidDragTarget(
      { kind: 'hand', defId: 's_bola_de_fogo' },
      { kind: 'face' },
      [enemy],
    )).toBe(true);
  });

  it('bloqueia face e criaturas comuns enquanto houver Provocar', () => {
    expect(isValidDragTarget(
      { kind: 'creature', defId: 'c_lobo' },
      { kind: 'face' },
      [taunt, enemy],
    )).toBe(false);
    expect(isValidDragTarget(
      { kind: 'creature', defId: 'c_lobo' },
      { kind: 'enemy-creature', c: enemy },
      [taunt, enemy],
    )).toBe(false);
    expect(isValidDragTarget(
      { kind: 'creature', defId: 'c_lobo' },
      { kind: 'enemy-creature', c: taunt },
      [taunt, enemy],
    )).toBe(true);
  });

  it('resolve anchors de comandante e das duas mesas', () => {
    expect(targetFromAnchor('face-1', 1, [enemy], [ally])).toEqual({ kind: 'face' });
    expect(targetFromAnchor('cr-enemy', 1, [enemy], [ally])).toEqual({ kind: 'enemy-creature', c: enemy });
    expect(targetFromAnchor('cr-ally', 1, [enemy], [ally])).toEqual({ kind: 'my-creature', c: ally });
    expect(targetFromAnchor('hand-unknown', 1, [enemy], [ally])).toBeNull();
  });
});
