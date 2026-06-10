import { useEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_ENERGY, TURN_SECONDS } from '@legendsclash/shared';
import type { CreatureOnBoard, GameView as GameViewState, SeatView } from '@legendsclash/shared';
import { dismissGameOver, send, useAppState } from '../store';
import { CardArt } from '../components/CardArt';
import { CardView } from '../components/CardView';
import { Chat } from '../components/Chat';
import { LeagueBadge } from '../components/LeagueBadge';
import { RulesModal } from '../components/RulesModal';
import { sfx, soundOn, toggleSound } from '../sounds';

type Selection =
  | { kind: 'hand'; iid: string }
  | { kind: 'attacker'; iid: string }
  | null;

type HoverTarget = { kind: 'face' } | { kind: 'creature'; iid: string } | null;

/** Efeito flutuante transitório (dano/cura), ancorado a um elemento da arena. */
interface FloatFx {
  id: number;
  kind: 'dmg' | 'heal';
  value: number;
  anchor: string; // `face-{seat}` ou `cr-{iid}`
  at: number;
}

/** Criatura recém-destruída, mantida em cena para a animação de morte. */
interface Ghost {
  id: number;
  seatIdx: number;
  creature: CreatureOnBoard;
  at: number;
}

/** Revelação de carta jogada pelo oponente. */
interface Reveal {
  id: number;
  cardId: string;
  at: number;
}

/** Prévia de combate/dano calculada no hover do alvo (decisão informada). */
interface CombatPreview {
  targetDmg: number;
  targetDies?: boolean;
  lethal?: boolean; // venceria a partida
  overflow?: number; // dano excedente que atravessa para o comandante
  selfDmg?: number; // retaliação no atacante
  selfDies?: boolean;
  attackerIid?: string;
}

let fxId = 1;
const FX_TTL = 1100;
const GHOST_TTL = 700;
const REVEAL_TTL = 1700;
const SPELL_DMG: Record<string, number> = { s_faisca: 2, s_bola_de_fogo: 5 };

export function GameView() {
  const s = useAppState();
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [hoverCost, setHoverCost] = useState(0);
  const [energyWarnAt, setEnergyWarnAt] = useState(0);
  const [cantAttackWarn, setCantAttackWarn] = useState<{ iid: string; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fx, setFx] = useState<FloatFx[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [reveals, setReveals] = useState<Reveal[]>([]);
  const [banner, setBanner] = useState<{ text: string; at: number } | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [sound, setSound] = useState(soundOn());
  const [showRules, setShowRules] = useState(false);
  const prevRef = useRef<GameViewState | null>(null);

  const game = s.game;

  useEffect(() => {
    const t = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      setFx((f) => (f.length && ts - f[0].at > FX_TTL ? f.filter((x) => ts - x.at < FX_TTL) : f));
      setGhosts((g) => (g.length && ts - g[0].at > GHOST_TTL ? g.filter((x) => ts - x.at < GHOST_TTL) : g));
      setReveals((r) => (r.length && ts - r[0].at > REVEAL_TTL ? r.filter((x) => ts - x.at < REVEAL_TTL) : r));
      setBanner((b) => (b && ts - b.at > 1500 ? null : b));
    }, 250);
    return () => clearInterval(t);
  }, []);

  // cancela a seleção com Esc ou clique com o botão direito
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelection(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Game feel: diff do estado autoritativo → efeitos visuais/sonoros ──
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = game;
    if (!prev || !game || prev.matchId !== game.matchId || game.yourSeat < 0) return;

    const ts = Date.now();
    const newFx: FloatFx[] = [];
    const newGhosts: Ghost[] = [];
    let hadDamage = false;
    let hadHeal = false;

    game.seats.forEach((seat, i) => {
      const before = prev.seats[i];
      if (!before) return;
      if (seat.hp < before.hp) {
        newFx.push({ id: fxId++, kind: 'dmg', value: before.hp - seat.hp, anchor: `face-${i}`, at: ts });
        hadDamage = true;
      } else if (seat.hp > before.hp) {
        newFx.push({ id: fxId++, kind: 'heal', value: seat.hp - before.hp, anchor: `face-${i}`, at: ts });
        hadHeal = true;
      }
      const prevById = new Map(before.board.map((c) => [c.iid, c]));
      for (const c of seat.board) {
        const pc = prevById.get(c.iid);
        if (pc && c.health < pc.health) {
          newFx.push({ id: fxId++, kind: 'dmg', value: pc.health - c.health, anchor: `cr-${c.iid}`, at: ts });
          hadDamage = true;
        } else if (pc && c.health > pc.health) {
          newFx.push({ id: fxId++, kind: 'heal', value: c.health - pc.health, anchor: `cr-${c.iid}`, at: ts });
          hadHeal = true;
        }
      }
      for (const pc of before.board) {
        if (!seat.board.some((c) => c.iid === pc.iid)) {
          newGhosts.push({ id: fxId++, seatIdx: i, creature: pc, at: ts });
        }
      }
    });

    // revelação: cartas jogadas pelo oponente desde o último estado
    const newPlays = game.plays.slice(prev.plays.length);
    const enemyPlays = newPlays.filter((p) => p.seat !== game.yourSeat);
    if (enemyPlays.length) {
      setReveals((r) => [...r, ...enemyPlays.map((p) => ({ id: fxId++, cardId: p.cardId, at: ts }))]);
      sfx.reveal();
    }

    if (newFx.length) setFx((f) => [...f, ...newFx]);
    if (newGhosts.length) setGhosts((g) => [...g, ...newGhosts]);
    if (hadDamage) sfx.damage();
    else if (hadHeal) sfx.heal();

    if (prev.turnSeat !== game.turnSeat && game.status === 'active') {
      const mine = game.turnSeat === game.yourSeat;
      setBanner({ text: mine ? '⚔️ Seu turno!' : `Turno de ${game.seats[game.turnSeat].name}`, at: ts });
      if (mine) sfx.myTurn();
      setSelection(null);
      setHover(null);
    }
  }, [game]);

  // fanfarra de fim de partida
  const overSig = s.gameOver?.matchId;
  useEffect(() => {
    if (!overSig || !s.profile) return;
    if (s.gameOver!.winnerId === s.profile.id) sfx.victory();
    else sfx.defeat();
  }, [overSig]);

  const me = useMemo(
    () => (game && game.yourSeat >= 0 ? game.seats[game.yourSeat] : null),
    [game],
  );

  const myTurn = !!game && !!me && game.turnSeat === game.yourSeat && game.status === 'active';
  const secondsLeft = game ? Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000)) : 0;

  // tique-taque de urgência nos últimos 5 segundos do seu turno
  useEffect(() => {
    if (myTurn && secondsLeft > 0 && secondsLeft <= 5) sfx.tick();
  }, [secondsLeft, myTurn]);

  if (!game || !me) return null;

  const enemySeatIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
  const enemy = game.seats[enemySeatIdx];
  const timerPct = Math.min(100, (secondsLeft / TURN_SECONDS) * 100);

  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((c) => c.iid === selection.iid)?.defId ?? '']
    : null;
  const selectedAttacker = selection?.kind === 'attacker'
    ? me.board.find((c) => c.iid === selection.iid) ?? null
    : null;

  const noMovesLeft =
    myTurn &&
    !game.hand.some((c) => CARDS[c.defId].cost <= me.energy) &&
    !me.board.some((c) => c.canAttack);

  // Dinâmica Yu-Gi-Oh: criaturas em campo protegem o comandante de ataques
  // e magias (apenas efeitos especiais "pierce" atravessam).
  const faceShielded = enemy.board.length > 0;
  // Provocar: prioridade entre criaturas — a com a palavra-chave vai primeiro
  const enemyTaunts = enemy.board.filter((c) => CARDS[c.defId].keywords?.includes('taunt'));
  const mustHitTaunt = selection?.kind === 'attacker' && enemyTaunts.length > 0;

  // ── Prévia de combate (hover no alvo) ──────────────────────────
  function previewFor(target: HoverTarget): CombatPreview | null {
    if (!target || !myTurn) return null;
    if (selectedAttacker) {
      const power = selectedAttacker.attack + me!.attackBonus;
      if (target.kind === 'face') {
        if (faceShielded) return null;
        return { targetDmg: power, lethal: power >= enemy.hp + enemy.shield, attackerIid: selectedAttacker.iid };
      }
      const defender = enemy.board.find((c) => c.iid === target.iid);
      if (!defender) return null;
      if (mustHitTaunt && !CARDS[defender.defId].keywords?.includes('taunt')) return null;
      const retaliation = defender.attack + enemy.attackBonus;
      const dies = defender.health <= power;
      // dano excedente: só quando a defensora morta era a última criatura
      const overflow = dies && enemy.board.length === 1 ? Math.max(0, power - defender.health) : 0;
      return {
        targetDmg: power,
        targetDies: dies,
        overflow: overflow > 0 ? overflow : undefined,
        lethal: overflow > 0 && overflow >= enemy.hp + enemy.shield,
        selfDmg: retaliation,
        selfDies: selectedAttacker.health <= retaliation,
        attackerIid: selectedAttacker.iid,
      };
    }
    if (selectedHandDef && SPELL_DMG[selectedHandDef.id] !== undefined) {
      const dmg = SPELL_DMG[selectedHandDef.id];
      if (target.kind === 'face') {
        if (faceShielded && !selectedHandDef.pierce) return null;
        return { targetDmg: dmg, lethal: dmg >= enemy.hp + enemy.shield };
      }
      const victim = enemy.board.find((c) => c.iid === target.iid);
      if (!victim) return null;
      return { targetDmg: dmg, targetDies: victim.health <= dmg };
    }
    return null;
  }
  const preview = previewFor(hover);

  // ── Ações ───────────────────────────────────────────────────────

  function clickHandCard(iid: string, defId: string) {
    if (!myTurn) return;
    const def = CARDS[defId];
    if (def.cost > me!.energy) {
      // feedback de "por que não posso?": cristais tremem + som de erro
      setEnergyWarnAt(Date.now());
      sfx.error();
      return;
    }
    if (def.target === 'none' || !def.target) {
      send({ t: 'game:play', iid });
      if (def.type === 'creature') sfx.summon(); else sfx.play();
      setSelection(null);
    } else {
      sfx.click();
      setSelection(selection?.kind === 'hand' && selection.iid === iid ? null : { kind: 'hand', iid });
    }
  }

  function clickMyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selectedHandDef?.target === 'friendly-creature' && selection?.kind === 'hand') {
      send({ t: 'game:play', iid: selection.iid, target: { seat: game!.yourSeat, iid: c.iid } });
      sfx.play();
      setSelection(null);
      return;
    }
    if (c.canAttack) {
      sfx.click();
      setSelection(
        selection?.kind === 'attacker' && selection.iid === c.iid ? null : { kind: 'attacker', iid: c.iid },
      );
    } else {
      // criatura que não pode atacar: limpa a seleção e avisa — nunca deixar
      // uma seleção antiga ativa em silêncio (o ataque sairia do monstro errado)
      setSelection(null);
      setCantAttackWarn({ iid: c.iid, at: Date.now() });
      sfx.error();
    }
  }

  function clickEnemyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef &&
        (selectedHandDef.target === 'enemy-creature' || selectedHandDef.target === 'enemy-any')) {
      send({ t: 'game:play', iid: selection.iid, target: { seat: enemySeatIdx, iid: c.iid } });
      sfx.play();
      setSelection(null);
      setHover(null);
      return;
    }
    if (selection?.kind === 'attacker') {
      if (mustHitTaunt && !CARDS[c.defId].keywords?.includes('taunt')) {
        sfx.error();
        return; // alvo bloqueado por Provocar — o visual já explica
      }
      send({ t: 'game:attack', attackerIid: selection.iid, target: { seat: enemySeatIdx, iid: c.iid } });
      sfx.attack();
      setSelection(null);
      setHover(null);
    }
  }

  function clickEnemyFace() {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef?.target === 'enemy-any') {
      if (faceShielded && !selectedHandDef.pierce) {
        sfx.error();
        return; // criaturas protegem o comandante até de magias
      }
      send({ t: 'game:play', iid: selection.iid, target: { seat: enemySeatIdx } });
      sfx.play();
      setSelection(null);
      setHover(null);
      return;
    }
    if (selection?.kind === 'attacker') {
      if (faceShielded) {
        sfx.error();
        return;
      }
      send({ t: 'game:attack', attackerIid: selection.iid, target: { seat: enemySeatIdx } });
      sfx.attack();
      setSelection(null);
      setHover(null);
    }
  }

  const targetingEnemy =
    selection?.kind === 'attacker' ||
    (selection?.kind === 'hand' && selectedHandDef?.target !== 'friendly-creature');
  const targetingFriendly = selection?.kind === 'hand' && selectedHandDef?.target === 'friendly-creature';

  const fxFor = (anchor: string) => fx.filter((f) => f.anchor === anchor);
  const ghostsFor = (seatIdx: number) => ghosts.filter((g) => g.seatIdx === seatIdx);

  // ── Seta de mira ────────────────────────────────────────────────
  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (selection && mouse) {
    const key = selection.kind === 'attacker' ? `cr-${selection.iid}` : `hand-${selection.iid}`;
    const el = document.querySelector(`[data-anchor="${key}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      arrow = { x1: r.left + r.width / 2, y1: r.top + r.height / 2, x2: mouse.x, y2: mouse.y };
    }
  }

  const energyWarn = now - energyWarnAt < 600;
  const faceLethal = !!preview?.lethal && hover?.kind === 'face';
  const lethalAim = !!preview?.lethal; // colore a seta também no overflow letal

  return (
    <div
      className="game-screen"
      onMouseMove={selection ? (e) => setMouse({ x: e.clientX, y: e.clientY }) : undefined}
      onContextMenu={selection ? (e) => { e.preventDefault(); setSelection(null); } : undefined}
    >
      <div className="game-board">
        <HeroPlate
          seat={enemy}
          seatIdx={enemySeatIdx}
          isEnemy
          onFaceClick={clickEnemyFace}
          targetable={!!targetingEnemy && (!faceShielded || !!selectedHandDef?.pierce)}
          blocked={!!targetingEnemy && faceShielded && !selectedHandDef?.pierce}
          lethal={faceLethal}
          preview={hover?.kind === 'face' ? preview : null}
          onHover={(h) => setHover(h ? { kind: 'face' } : null)}
          fx={fxFor(`face-${enemySeatIdx}`)}
        />

        <div className={`board-row enemy-row ${targetingEnemy ? 'targetable' : ''}`}>
          {enemy.board.map((c) => {
            const isTaunt = CARDS[c.defId].keywords?.includes('taunt');
            const blocked = !!mustHitTaunt && !isTaunt;
            return (
              <Creature
                key={c.iid}
                c={c}
                bonus={enemy.attackBonus}
                blocked={blocked}
                preview={hover?.kind === 'creature' && hover.iid === c.iid ? preview : null}
                onHover={(on) => setHover(on ? { kind: 'creature', iid: c.iid } : null)}
                fx={fxFor(`cr-${c.iid}`)}
                onClick={() => clickEnemyCreature(c)}
              />
            );
          })}
          {ghostsFor(enemySeatIdx).map((g) => <GhostCreature key={g.id} g={g} />)}
          {enemy.board.length === 0 && ghostsFor(enemySeatIdx).length === 0 && (
            <div className="board-empty">mesa vazia</div>
          )}
        </div>

        <div className="board-divider">
          <div className={myTurn ? 'turn-pill mine' : 'turn-pill'}>
            <span className={myTurn && secondsLeft <= 10 ? 'time-urgent' : ''}>
              {game.status !== 'active'
                ? 'Partida encerrada'
                : myTurn
                  ? `Seu turno · ${secondsLeft}s`
                  : `Turno de ${game.seats[game.turnSeat].name} · ${secondsLeft}s`}
            </span>
            <span className="timer-track">
              <span
                className={`timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`}
                style={{ width: `${timerPct}%` }}
              />
            </span>
          </div>
          {myTurn && (
            <button
              className={`btn end-turn ${noMovesLeft ? 'pulse' : ''}`}
              onClick={() => { sfx.click(); send({ t: 'game:endTurn' }); }}
            >
              Encerrar turno ▸
            </button>
          )}
        </div>

        <div className={`board-row my-row ${targetingFriendly ? 'friendly-targetable' : ''}`}>
          {me.board.map((c) => (
            <Creature
              key={c.iid}
              c={c}
              bonus={me.attackBonus}
              mine
              selected={selection?.kind === 'attacker' && selection.iid === c.iid}
              buffTarget={targetingFriendly}
              warn={cantAttackWarn?.iid === c.iid && now - cantAttackWarn.at < 600}
              retaliation={preview?.attackerIid === c.iid ? preview : null}
              fx={fxFor(`cr-${c.iid}`)}
              onClick={() => clickMyCreature(c)}
            />
          ))}
          {ghostsFor(game.yourSeat).map((g) => <GhostCreature key={g.id} g={g} />)}
          {me.board.length === 0 && ghostsFor(game.yourSeat).length === 0 && (
            <div className="board-empty">invoque criaturas aqui</div>
          )}
        </div>

        <HeroPlate
          seat={me}
          seatIdx={game.yourSeat}
          pendingCost={hoverCost}
          energyWarn={energyWarn}
          fx={fxFor(`face-${game.yourSeat}`)}
        />

        <div className="hand">
          {game.hand.map((c, i) => {
            const off = i - (game.hand.length - 1) / 2;
            const isSelected = selection?.kind === 'hand' && selection.iid === c.iid;
            const affordable = CARDS[c.defId].cost <= me.energy;
            return (
              <CardView
                key={c.iid}
                defId={c.defId}
                anchorId={`hand-${c.iid}`}
                playable={myTurn && affordable}
                selected={isSelected}
                onClick={() => clickHandCard(c.iid, c.defId)}
                onMouseEnter={() => myTurn && affordable && setHoverCost(CARDS[c.defId].cost)}
                onMouseLeave={() => setHoverCost(0)}
                style={isSelected ? undefined : {
                  transform: `rotate(${off * 2.5}deg) translateY(${Math.abs(off) * 5}px)`,
                }}
              />
            );
          })}
        </div>
      </div>

      <aside className="game-side">
        <div className="side-top">
          <span>
            <button className="btn small ghost" onClick={() => setSound(toggleSound())} title="Som">
              {sound ? '🔊' : '🔇'}
            </button>
            <button className="btn small ghost" onClick={() => setShowRules(true)} title="Como jogar">
              📖
            </button>
          </span>
          <button
            className="btn small ghost danger"
            onClick={() => { if (confirm('Desistir da partida?')) send({ t: 'game:surrender' }); }}
          >
            🏳️ Desistir
          </button>
        </div>
        <div className="panel log-panel">
          <h3>📜 Eventos</h3>
          <ul className="game-log">
            {game.log.slice(-14).reverse().map((l, i) => <li key={game.log.length - i}>{l.text}</li>)}
          </ul>
        </div>
        <div className="panel side-chat">
          <h3>💬 Chat</h3>
          <Chat />
        </div>
      </aside>

      {selection && (
        <div className="target-hint">
          {selection.kind === 'attacker'
            ? `⚔️ Atacando com ${selectedAttacker ? CARDS[selectedAttacker.defId].name : 'sua criatura'}: ${
                mustHitTaunt
                  ? 'Provocar — ataque o Golem antes das outras criaturas'
                  : faceShielded
                    ? 'as criaturas inimigas protegem o comandante — derrote-as primeiro'
                    : 'mesa livre — ataque o comandante ou veja a prévia no alvo'
              }`
            : selectedHandDef?.target === 'friendly-creature'
              ? 'Escolha uma criatura aliada'
              : faceShielded && !selectedHandDef?.pierce
                ? 'Escolha uma criatura inimiga — elas protegem o comandante'
                : 'Escolha um alvo inimigo — passe o mouse para ver a prévia'}
          <span className="dim"> · Esc cancela</span>
        </div>
      )}

      {arrow && (
        <svg className="aim-arrow" width="100%" height="100%">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill={lethalAim ? '#f85149' : selection?.kind === 'attacker' ? '#e3b341' : '#b083f0'} />
            </marker>
          </defs>
          <path
            d={`M ${arrow.x1} ${arrow.y1} Q ${(arrow.x1 + arrow.x2) / 2} ${Math.min(arrow.y1, arrow.y2) - 60} ${arrow.x2} ${arrow.y2}`}
            stroke={lethalAim ? '#f85149' : selection?.kind === 'attacker' ? '#e3b341' : '#b083f0'}
            strokeWidth="3"
            strokeDasharray="8 6"
            fill="none"
            markerEnd="url(#arrowhead)"
          />
        </svg>
      )}

      <div className="reveal-stack">
        {reveals.map((r) => (
          <div key={r.id} className="card-reveal">
            <span className="reveal-label">Oponente jogou</span>
            <CardView defId={r.cardId} />
          </div>
        ))}
      </div>

      {banner && <div className="turn-banner" key={banner.at}>{banner.text}</div>}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {s.gameOver && <GameOverOverlay />}
    </div>
  );
}

function FxLayer({ fx }: { fx: FloatFx[] }) {
  return (
    <>
      {fx.map((f) => (
        <span key={f.id} className={`float-fx ${f.kind}`}>
          {f.kind === 'dmg' ? `-${f.value}` : `+${f.value}`}
        </span>
      ))}
    </>
  );
}

function PreviewChip({ p, self }: { p: CombatPreview; self?: boolean }) {
  if (self) {
    if (p.selfDmg === undefined) return null;
    return (
      <span className={`preview-chip ${p.selfDies ? 'dies' : ''}`}>
        −{p.selfDmg}{p.selfDies ? ' 💀' : ''}
      </span>
    );
  }
  return (
    <span className={`preview-chip ${p.lethal ? 'lethal' : p.targetDies ? 'dies' : ''}`}>
      −{p.targetDmg}
      {p.targetDies ? ' 💀' : ''}
      {p.overflow ? ` ↯${p.overflow}` : ''}
      {p.lethal ? ' ☠ LETAL' : ''}
    </span>
  );
}

function HeroPlate({ seat, seatIdx, isEnemy, onFaceClick, targetable, blocked, lethal, preview, onHover, pendingCost = 0, energyWarn, fx }: {
  seat: SeatView;
  seatIdx: number;
  isEnemy?: boolean;
  onFaceClick?: () => void;
  targetable?: boolean;
  blocked?: boolean;
  lethal?: boolean;
  preview?: CombatPreview | null;
  onHover?: (on: boolean) => void;
  pendingCost?: number;
  energyWarn?: boolean;
  fx: FloatFx[];
}) {
  const hit = fx.some((f) => f.kind === 'dmg');
  return (
    <div className={`hero-plate ${isEnemy ? 'enemy' : ''}`}>
      <button
        className={[
          'portrait',
          targetable ? 'targetable' : '',
          blocked ? 'blocked' : '',
          lethal ? 'lethal' : '',
          hit ? 'hit' : '',
        ].join(' ')}
        data-anchor={`face-${seatIdx}`}
        onClick={onFaceClick}
        disabled={!onFaceClick}
        onMouseEnter={onHover && targetable ? () => onHover(true) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}
        title={blocked ? 'Protegido por Provocar' : undefined}
      >
        <span className="portrait-avatar">{seat.avatar}</span>
        <span className="hp-orb">{seat.hp}</span>
        {seat.shield > 0 && <span className="shield-orb">🛡️{seat.shield}</span>}
        {preview && <PreviewChip p={preview} />}
        <FxLayer fx={fx} />
      </button>
      <div className="hero-info">
        <span className="hero-name">
          {seat.name}
          {!seat.connected && <em className="dc-tag"> · reconectando…</em>}
        </span>
        <span
          className={`energy-crystals ${energyWarn ? 'warn' : ''}`}
          title={`Energia ${seat.energy}/${seat.maxEnergy}`}
        >
          {Array.from({ length: Math.min(MAX_ENERGY, Math.max(seat.maxEnergy, seat.energy)) }, (_, i) => {
            const willSpend = pendingCost > 0 && i >= seat.energy - pendingCost && i < seat.energy;
            return <i key={i} className={`crystal ${i < seat.energy ? 'full' : ''} ${willSpend ? 'spend' : ''}`} />;
          })}
          <b>{seat.energy}/{seat.maxEnergy}</b>
        </span>
      </div>
      <div className="hero-meta">
        <span className="meta-chip" title="Cartas no deck">🂠 {seat.deckCount}</span>
        {isEnemy && <span className="meta-chip" title="Cartas na mão">✋ {seat.handCount}</span>}
        {seat.attackBonus > 0 && (
          <span className="meta-chip buff" title="Estandarte de Guerra">🚩 +{seat.attackBonus}</span>
        )}
        {seat.fatigue > 0 && <span className="meta-chip warn" title="Fadiga">💀 {seat.fatigue}</span>}
      </div>
    </div>
  );
}

function Creature({ c, bonus, mine, selected, buffTarget, blocked, warn, preview, retaliation, onHover, fx, onClick }: {
  c: CreatureOnBoard;
  bonus: number;
  mine?: boolean;
  selected?: boolean;
  buffTarget?: boolean;
  blocked?: boolean;
  warn?: boolean;
  preview?: CombatPreview | null;
  retaliation?: CombatPreview | null;
  onHover?: (on: boolean) => void;
  fx: FloatFx[];
  onClick: () => void;
}) {
  const def = CARDS[c.defId];
  const hit = fx.some((f) => f.kind === 'dmg');
  const isTaunt = def.keywords?.includes('taunt');
  const classes = [
    'creature',
    mine ? 'mine' : '',
    selected ? 'selected' : '',
    mine && c.canAttack ? 'ready' : '',
    buffTarget && mine ? 'buff-target' : '',
    blocked ? 'blocked' : '',
    warn ? 'cant-attack' : '',
    isTaunt ? 'taunt' : '',
    c.health < c.baseHealth ? 'wounded' : '',
    hit ? 'hit' : '',
  ].join(' ');
  return (
    <button
      className={classes}
      data-anchor={`cr-${c.iid}`}
      onClick={onClick}
      title={
        blocked
          ? 'Protegido por Provocar — ataque o Golem primeiro'
          : mine && !c.canAttack
            ? 'Essa criatura não pode atacar agora (acabou de entrar ou já atacou neste turno)'
            : def.text
      }
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {isTaunt && <span className="taunt-badge" title="Provocar">🛡</span>}
      <CardArt defId={c.defId} className="creature-art" />
      <span className="creature-name">{def.name}</span>
      <span className="creature-stats">
        <b className="atk">{c.attack + bonus}</b>
        <b className="hp">{c.health}</b>
      </span>
      {mine && c.canAttack && <span className="ready-dot" />}
      {preview && <PreviewChip p={preview} />}
      {retaliation && <PreviewChip p={retaliation} self />}
      <FxLayer fx={fx} />
    </button>
  );
}

function GhostCreature({ g }: { g: Ghost }) {
  const def = CARDS[g.creature.defId];
  return (
    <span className="creature ghost">
      <CardArt defId={g.creature.defId} className="creature-art" />
      <span className="creature-name">{def.name}</span>
      <span className="ghost-skull">💀</span>
    </span>
  );
}

function GameOverOverlay() {
  const s = useAppState();
  const result = s.gameOver;
  const myId = s.profile?.id;
  if (!result || !myId) return null;

  const won = result.winnerId === myId;
  const my = result.mmr[myId];
  const reasonText: Record<string, string> = {
    hp: won ? 'Você zerou a vida do oponente!' : 'Sua vida chegou a zero.',
    surrender: won ? 'O oponente desistiu da partida.' : 'Você desistiu da partida.',
    timeout: won ? 'O oponente não voltou a tempo.' : 'Você ficou desconectado por muito tempo.',
  };

  return (
    <div className="overlay">
      {won && (
        <div className="confetti">
          {Array.from({ length: 18 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 53) % 100}%`,
                animationDelay: `${(i % 6) * 0.25}s`,
                background: ['#e3b341', '#4d8dff', '#3fb950', '#b083f0', '#f85149'][i % 5],
              }}
            />
          ))}
        </div>
      )}
      <div className={`panel game-over ${won ? 'won' : 'lost'}`}>
        <div className="go-emblem">{won ? '🏆' : '💀'}</div>
        <h2>{won ? 'Vitória!' : 'Derrota'}</h2>
        <p>{reasonText[result.reason]}</p>
        <p className="dim">{result.turns} turnos · {Math.max(1, Math.round(result.durationMs / 60000))} min</p>
        {my && (
          <p className="mmr-change">
            MMR: {my.before} → <strong>{my.after}</strong>{' '}
            <span className={my.delta >= 0 ? 'delta up' : 'delta down'}>
              ({my.delta >= 0 ? '+' : ''}{my.delta})
            </span>
            <br />
            <LeagueBadge league={my.league} />
          </p>
        )}
        <button className="btn primary big" onClick={() => { sfx.click(); dismissGameOver(); }}>
          ⚔️ Jogar de novo
        </button>
      </div>
    </div>
  );
}
