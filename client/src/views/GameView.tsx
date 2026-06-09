import { useEffect, useMemo, useState } from 'react';
import { CARDS } from '@legendsclash/shared';
import type { CreatureOnBoard, SeatView } from '@legendsclash/shared';
import { dismissGameOver, send, useAppState } from '../store';
import { CardView } from '../components/CardView';
import { Chat } from '../components/Chat';
import { LeagueBadge } from '../components/LeagueBadge';

type Selection =
  | { kind: 'hand'; iid: string }
  | { kind: 'attacker'; iid: string }
  | null;

export function GameView() {
  const s = useAppState();
  const [selection, setSelection] = useState<Selection>(null);
  const [now, setNow] = useState(Date.now());

  const game = s.game;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // limpa a seleção quando o turno muda
  useEffect(() => setSelection(null), [game?.turnSeat, game?.turnNumber]);

  const me = useMemo(
    () => (game && game.yourSeat >= 0 ? game.seats[game.yourSeat] : null),
    [game],
  );

  if (!game || !me) return null;

  const myTurn = game.turnSeat === game.yourSeat && game.status === 'active';
  const enemySeatIdx = game.seats.findIndex((_, i) => i !== game.yourSeat);
  const enemy = game.seats[enemySeatIdx];
  const secondsLeft = Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000));

  const selectedHandDef = selection?.kind === 'hand'
    ? CARDS[game.hand.find((c) => c.iid === selection.iid)?.defId ?? '']
    : null;

  function clickHandCard(iid: string, defId: string) {
    if (!myTurn) return;
    const def = CARDS[defId];
    if (def.cost > me!.energy) return;
    if (def.target === 'none' || !def.target) {
      send({ t: 'game:play', iid });
      setSelection(null);
    } else {
      setSelection(selection?.kind === 'hand' && selection.iid === iid ? null : { kind: 'hand', iid });
    }
  }

  function clickMyCreature(c: CreatureOnBoard) {
    if (!myTurn) return;
    if (selectedHandDef?.target === 'friendly-creature' && selection?.kind === 'hand') {
      send({ t: 'game:play', iid: selection.iid, target: { seat: game!.yourSeat, iid: c.iid } });
      setSelection(null);
      return;
    }
    if (c.canAttack) {
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
      setSelection(null);
      return;
    }
    if (selection?.kind === 'attacker') {
      send({ t: 'game:attack', attackerIid: selection.iid, target: { seat: enemySeatIdx, iid: c.iid } });
      setSelection(null);
    }
  }

  function clickEnemyFace() {
    if (!myTurn) return;
    if (selection?.kind === 'hand' && selectedHandDef?.target === 'enemy-any') {
      send({ t: 'game:play', iid: selection.iid, target: { seat: enemySeatIdx } });
      setSelection(null);
      return;
    }
    if (selection?.kind === 'attacker') {
      send({ t: 'game:attack', attackerIid: selection.iid, target: { seat: enemySeatIdx } });
      setSelection(null);
    }
  }

  const targetingEnemy =
    (selection?.kind === 'attacker') ||
    (selection?.kind === 'hand' && selectedHandDef?.target !== 'friendly-creature');

  return (
    <div className="game-screen">
      <div className="game-board">
        <PlayerBar seat={enemy} isEnemy onFaceClick={clickEnemyFace} targetable={targetingEnemy} />

        <div className={`board-row enemy-row ${targetingEnemy ? 'targetable' : ''}`}>
          {enemy.board.map((c) => (
            <Creature key={c.iid} c={c} bonus={enemy.attackBonus} onClick={() => clickEnemyCreature(c)} />
          ))}
          {enemy.board.length === 0 && <div className="board-empty">mesa vazia</div>}
        </div>

        <div className="board-divider">
          <span className={myTurn ? 'turn-pill mine' : 'turn-pill'}>
            {game.status !== 'active'
              ? 'Partida encerrada'
              : myTurn
                ? `Seu turno · ${secondsLeft}s`
                : `Turno de ${game.seats[game.turnSeat].name} · ${secondsLeft}s`}
          </span>
          {myTurn && (
            <button className="btn small" onClick={() => send({ t: 'game:endTurn' })}>
              Encerrar turno ▸
            </button>
          )}
        </div>

        <div className="board-row my-row">
          {me.board.map((c) => (
            <Creature
              key={c.iid}
              c={c}
              bonus={me.attackBonus}
              mine
              selected={selection?.kind === 'attacker' && selection.iid === c.iid}
              buffTarget={selectedHandDef?.target === 'friendly-creature'}
              onClick={() => clickMyCreature(c)}
            />
          ))}
          {me.board.length === 0 && <div className="board-empty">invoque criaturas aqui</div>}
        </div>

        <PlayerBar seat={me} />

        <div className="hand">
          {game.hand.map((c) => (
            <CardView
              key={c.iid}
              defId={c.defId}
              playable={myTurn && CARDS[c.defId].cost <= me.energy}
              selected={selection?.kind === 'hand' && selection.iid === c.iid}
              onClick={() => clickHandCard(c.iid, c.defId)}
            />
          ))}
        </div>
      </div>

      <aside className="game-side">
        <div className="panel log-panel">
          <h3>Eventos</h3>
          <ul className="game-log">
            {game.log.slice(-12).map((l, i) => <li key={i}>{l.text}</li>)}
          </ul>
        </div>
        <div className="panel side-chat">
          <h3>Chat</h3>
          <Chat />
        </div>
        <button className="btn ghost danger" onClick={() => send({ t: 'game:surrender' })}>
          🏳️ Desistir
        </button>
      </aside>

      {s.gameOver && <GameOverOverlay />}
    </div>
  );
}

function PlayerBar({ seat, isEnemy, onFaceClick, targetable }: {
  seat: SeatView;
  isEnemy?: boolean;
  onFaceClick?: () => void;
  targetable?: boolean;
}) {
  return (
    <div className={`player-bar ${isEnemy ? 'enemy' : ''}`}>
      <button
        className={`face ${targetable ? 'targetable' : ''}`}
        onClick={onFaceClick}
        disabled={!onFaceClick}
      >
        <span className="avatar-lg">{seat.avatar}</span>
        <span className="face-name">
          {seat.name}
          {!seat.connected && <em className="dc-tag"> · reconectando…</em>}
        </span>
      </button>
      <span className="stat hp" title="Vida">❤️ {seat.hp}</span>
      {seat.shield > 0 && <span className="stat shield" title="Escudo">🛡️ {seat.shield}</span>}
      <span className="stat energy" title="Energia">
        ⚡ {seat.energy}/{seat.maxEnergy}
      </span>
      <span className="stat dim" title="Cartas no deck">🂠 {seat.deckCount}</span>
      {isEnemy && <span className="stat dim" title="Cartas na mão">✋ {seat.handCount}</span>}
      {seat.attackBonus > 0 && <span className="stat" title="Estandarte de Guerra">⚔️ +{seat.attackBonus}</span>}
    </div>
  );
}

function Creature({ c, bonus, mine, selected, buffTarget, onClick }: {
  c: CreatureOnBoard;
  bonus: number;
  mine?: boolean;
  selected?: boolean;
  buffTarget?: boolean;
  onClick: () => void;
}) {
  const def = CARDS[c.defId];
  const classes = [
    'creature',
    mine ? 'mine' : '',
    selected ? 'selected' : '',
    mine && c.canAttack ? 'ready' : '',
    buffTarget && mine ? 'buff-target' : '',
    c.health < c.baseHealth ? 'wounded' : '',
  ].join(' ');
  return (
    <button className={classes} onClick={onClick} title={def.text}>
      <span className="creature-name">{def.name}</span>
      <span className="creature-stats">
        <b className="atk">{c.attack + bonus}</b>/<b className="hp">{c.health}</b>
      </span>
    </button>
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
      <div className={`panel game-over ${won ? 'won' : 'lost'}`}>
        <h2>{won ? '🏆 Vitória!' : '💀 Derrota'}</h2>
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
        <button className="btn primary big" onClick={dismissGameOver}>
          Jogar de novo
        </button>
      </div>
    </div>
  );
}
