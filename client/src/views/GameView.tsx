import { useEffect, useMemo, useRef, useState } from 'react';
import { CARDS, MAX_ENERGY, TURN_SECONDS } from '@legendsclash/shared';
import type { CreatureOnBoard, GameView as GameViewState, SeatView } from '@legendsclash/shared';
import { dismissGameOver, send, useAppState } from '../store';
import { CardView } from '../components/CardView';
import { Chat } from '../components/Chat';
import { LeagueBadge } from '../components/LeagueBadge';
import { sfx, soundOn, toggleSound } from '../sounds';

type Selection =
  | { kind: 'hand'; iid: string }
  | { kind: 'attacker'; iid: string }
  | null;

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

let fxId = 1;
const FX_TTL = 1100;
const GHOST_TTL = 700;

export function GameView() {
  const s = useAppState();
  const [selection, setSelection] = useState<Selection>(null);
  const [now, setNow] = useState(Date.now());
  const [fx, setFx] = useState<FloatFx[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [banner, setBanner] = useState<{ text: string; at: number } | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [sound, setSound] = useState(soundOn());
  const prevRef = useRef<GameViewState | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);

  const game = s.game;

  useEffect(() => {
    const t = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      setFx((f) => (f.length && ts - f[0].at > FX_TTL ? f.filter((x) => ts - x.at < FX_TTL) : f));
      setGhosts((g) => (g.length && ts - g[0].at > GHOST_TTL ? g.filter((x) => ts - x.at < GHOST_TTL) : g));
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

    if (newFx.length) setFx((f) => [...f, ...newFx]);
    if (newGhosts.length) setGhosts((g) => [...g, ...newGhosts]);
    if (hadDamage) sfx.damage();
    else if (hadHeal) sfx.heal();

    if (prev.turnSeat !== game.turnSeat && game.status === 'active') {
      const mine = game.turnSeat === game.yourSeat;
      setBanner({ text: mine ? '⚔️ Seu turno!' : `Turno de ${game.seats[game.turnSeat].name}`, at: ts });
      if (mine) sfx.myTurn();
      setSelection(null);
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

  if (!game || !me) return null;

  const myTurn = game.turnSeat === game.yourSeat && game.status === 'active';
  const enemySeatIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
  const enemy = game.seats[enemySeatIdx];
  const secondsLeft = Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000));
  const timerPct = Math.min(100, (secondsLeft / TURN_SECONDS) * 100);

  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((c) => c.iid === selection.iid)?.defId ?? '']
    : null;

  const noMovesLeft =
    myTurn &&
    !game.hand.some((c) => CARDS[c.defId].cost <= me.energy) &&
    !me.board.some((c) => c.canAttack);

  // ── Ações ───────────────────────────────────────────────────────

  function clickHandCard(iid: string, defId: string) {
    if (!myTurn) return;
    const def = CARDS[defId];
    if (def.cost > me!.energy) return;
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
    }
  }

  function clickEnemyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef &&
        (selectedHandDef.target === 'enemy-creature' || selectedHandDef.target === 'enemy-any')) {
      send({ t: 'game:play', iid: selection.iid, target: { seat: enemySeatIdx, iid: c.iid } });
      sfx.play();
      setSelection(null);
      return;
    }
    if (selection?.kind === 'attacker') {
      send({ t: 'game:attack', attackerIid: selection.iid, target: { seat: enemySeatIdx, iid: c.iid } });
      sfx.attack();
      setSelection(null);
    }
  }

  function clickEnemyFace() {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef?.target === 'enemy-any') {
      send({ t: 'game:play', iid: selection.iid, target: { seat: enemySeatIdx } });
      sfx.play();
      setSelection(null);
      return;
    }
    if (selection?.kind === 'attacker') {
      send({ t: 'game:attack', attackerIid: selection.iid, target: { seat: enemySeatIdx } });
      sfx.attack();
      setSelection(null);
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

  return (
    <div
      className="game-screen"
      onMouseMove={selection ? (e) => setMouse({ x: e.clientX, y: e.clientY }) : undefined}
      onContextMenu={selection ? (e) => { e.preventDefault(); setSelection(null); } : undefined}
    >
      <div className="game-board" ref={arenaRef}>
        <HeroPlate
          seat={enemy}
          seatIdx={enemySeatIdx}
          isEnemy
          onFaceClick={clickEnemyFace}
          targetable={!!targetingEnemy}
          fx={fxFor(`face-${enemySeatIdx}`)}
        />

        <div className={`board-row enemy-row ${targetingEnemy ? 'targetable' : ''}`}>
          {enemy.board.map((c) => (
            <Creature
              key={c.iid}
              c={c}
              bonus={enemy.attackBonus}
              fx={fxFor(`cr-${c.iid}`)}
              onClick={() => clickEnemyCreature(c)}
            />
          ))}
          {ghostsFor(enemySeatIdx).map((g) => <GhostCreature key={g.id} g={g} />)}
          {enemy.board.length === 0 && ghostsFor(enemySeatIdx).length === 0 && (
            <div className="board-empty">mesa vazia</div>
          )}
        </div>

        <div className="board-divider">
          <div className={myTurn ? 'turn-pill mine' : 'turn-pill'}>
            <span>
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
              fx={fxFor(`cr-${c.iid}`)}
              onClick={() => clickMyCreature(c)}
            />
          ))}
          {ghostsFor(game.yourSeat).map((g) => <GhostCreature key={g.id} g={g} />)}
          {me.board.length === 0 && ghostsFor(game.yourSeat).length === 0 && (
            <div className="board-empty">invoque criaturas aqui</div>
          )}
        </div>

        <HeroPlate seat={me} seatIdx={game.yourSeat} fx={fxFor(`face-${game.yourSeat}`)} />

        <div className="hand">
          {game.hand.map((c, i) => {
            const off = i - (game.hand.length - 1) / 2;
            const isSelected = selection?.kind === 'hand' && selection.iid === c.iid;
            return (
              <CardView
                key={c.iid}
                defId={c.defId}
                anchorId={`hand-${c.iid}`}
                playable={myTurn && CARDS[c.defId].cost <= me.energy}
                selected={isSelected}
                onClick={() => clickHandCard(c.iid, c.defId)}
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
          <button className="btn small ghost" onClick={() => setSound(toggleSound())} title="Som">
            {sound ? '🔊' : '🔇'}
          </button>
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
            ? 'Escolha o alvo do ataque — criatura inimiga ou o comandante'
            : selectedHandDef?.target === 'friendly-creature'
              ? 'Escolha uma criatura aliada'
              : 'Escolha um alvo inimigo'}
          <span className="dim"> · Esc cancela</span>
        </div>
      )}

      {arrow && (
        <svg className="aim-arrow" width="100%" height="100%">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill={selection?.kind === 'attacker' ? '#e3b341' : '#b083f0'} />
            </marker>
          </defs>
          <path
            d={`M ${arrow.x1} ${arrow.y1} Q ${(arrow.x1 + arrow.x2) / 2} ${Math.min(arrow.y1, arrow.y2) - 60} ${arrow.x2} ${arrow.y2}`}
            stroke={selection?.kind === 'attacker' ? '#e3b341' : '#b083f0'}
            strokeWidth="3"
            strokeDasharray="8 6"
            fill="none"
            markerEnd="url(#arrowhead)"
          />
        </svg>
      )}

      {banner && <div className="turn-banner" key={banner.at}>{banner.text}</div>}
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

function HeroPlate({ seat, seatIdx, isEnemy, onFaceClick, targetable, fx }: {
  seat: SeatView;
  seatIdx: number;
  isEnemy?: boolean;
  onFaceClick?: () => void;
  targetable?: boolean;
  fx: FloatFx[];
}) {
  const hit = fx.some((f) => f.kind === 'dmg');
  return (
    <div className={`hero-plate ${isEnemy ? 'enemy' : ''}`}>
      <button
        className={`portrait ${targetable ? 'targetable' : ''} ${hit ? 'hit' : ''}`}
        data-anchor={`face-${seatIdx}`}
        onClick={onFaceClick}
        disabled={!onFaceClick}
      >
        <span className="portrait-avatar">{seat.avatar}</span>
        <span className="hp-orb">{seat.hp}</span>
        {seat.shield > 0 && <span className="shield-orb">🛡️{seat.shield}</span>}
        <FxLayer fx={fx} />
      </button>
      <div className="hero-info">
        <span className="hero-name">
          {seat.name}
          {!seat.connected && <em className="dc-tag"> · reconectando…</em>}
        </span>
        <span className="energy-crystals" title={`Energia ${seat.energy}/${seat.maxEnergy}`}>
          {Array.from({ length: Math.min(MAX_ENERGY, Math.max(seat.maxEnergy, seat.energy)) }, (_, i) => (
            <i key={i} className={i < seat.energy ? 'crystal full' : 'crystal'} />
          ))}
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

function Creature({ c, bonus, mine, selected, buffTarget, fx, onClick }: {
  c: CreatureOnBoard;
  bonus: number;
  mine?: boolean;
  selected?: boolean;
  buffTarget?: boolean;
  fx: FloatFx[];
  onClick: () => void;
}) {
  const def = CARDS[c.defId];
  const hit = fx.some((f) => f.kind === 'dmg');
  const classes = [
    'creature',
    mine ? 'mine' : '',
    selected ? 'selected' : '',
    mine && c.canAttack ? 'ready' : '',
    buffTarget && mine ? 'buff-target' : '',
    c.health < c.baseHealth ? 'wounded' : '',
    hit ? 'hit' : '',
  ].join(' ');
  return (
    <button className={classes} data-anchor={`cr-${c.iid}`} onClick={onClick} title={def.text}>
      <span className="creature-art">{def.art}</span>
      <span className="creature-name">{def.name}</span>
      <span className="creature-stats">
        <b className="atk">{c.attack + bonus}</b>
        <b className="hp">{c.health}</b>
      </span>
      {mine && c.canAttack && <span className="ready-dot" />}
      <FxLayer fx={fx} />
    </button>
  );
}

function GhostCreature({ g }: { g: Ghost }) {
  const def = CARDS[g.creature.defId];
  return (
    <span className="creature ghost">
      <span className="creature-art">{def.art}</span>
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
