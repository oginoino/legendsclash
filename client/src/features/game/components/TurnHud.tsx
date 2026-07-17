import type * as React from 'react';
import { TAUNTS } from '@legendsclash/shared';
import type { GameView as GameState, SeatView } from '@legendsclash/shared';
import { TauntIcon } from '../../../cosmetics';
import {
  IcoAttack,
  IcoBot,
  IcoCheck,
  IcoDeath,
  IcoEnergy,
  IcoHint,
  IcoPause,
  IcoTaunt,
  IcoTimer,
  IcoWarning,
} from '../../../icons';
import type { GameHudModel } from '../hud-model';

const PACE_HUD_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 0,
  maxWidth: 'min(44vw, 520px)',
  height: 28,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  flexWrap: 'nowrap',
  lineHeight: 1,
};

const PACE_CHIP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
  maxWidth: 180,
  height: 24,
  padding: '0 8px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  flex: '0 1 auto',
  lineHeight: 1,
  verticalAlign: 'middle',
};

const PACE_CHIP_TIGHT_STYLE: React.CSSProperties = {
  ...PACE_CHIP_STYLE,
  maxWidth: 132,
  flex: '0 0 auto',
};

const PACE_CHIP_TEXT_STYLE: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function formatTurnClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

interface TurnHudProps {
  game: GameState;
  player: SeatView;
  hud: GameHudModel;
  myTurn: boolean;
  turnOwnerIsMe: boolean;
  secondsLeft: number;
  timeUrgent: boolean;
  timerPct: number;
  tauntOpen: boolean;
  onEndTurn: () => void;
  onToggleTaunt: () => void;
  onTaunt: (id: string) => void;
}

export function TurnHud({
  game,
  player,
  hud,
  myTurn,
  turnOwnerIsMe,
  secondsLeft,
  timeUrgent,
  timerPct,
  tauntOpen,
  onEndTurn,
  onToggleTaunt,
  onTaunt,
}: TurnHudProps) {
  const turnOwnerName = game.seats[game.turnSeat].name;
  return (
    <div className="board-divider no-divider-line">
      <div
        className={`turn-pill ${turnOwnerIsMe ? 'mine' : ''} ${game.turnPaused ? 'paused' : ''} ${timeUrgent ? 'urgent' : ''}`}
        style={{ '--timer-angle': `${timerPct * 3.6}deg` } as React.CSSProperties}
        aria-label={game.turnPaused
          ? `Cronômetro pausado em ${formatTurnClock(secondsLeft)} durante o tutorial inicial`
          : `${turnOwnerIsMe ? 'Seu turno' : `Turno de ${turnOwnerName}`}. ${formatTurnClock(secondsLeft)} restantes`}
      >
        <span className="turn-clock" aria-hidden="true">
          {game.turnPaused ? <IcoPause className="ic" /> : <IcoTimer className="ic" />}
        </span>
        <span className="turn-time-copy">
          <span className="turn-time-eyebrow">
            <span className="turn-label-full">
              {game.status !== 'active'
                ? 'Partida encerrada'
                : game.turnPaused
                  ? 'Tutorial inicial'
                  : turnOwnerIsMe
                    ? 'Seu turno'
                    : `Turno de ${turnOwnerName}`}
            </span>
            <span className="turn-label-compact">
              {game.status !== 'active' ? 'Fim' : game.turnPaused ? 'Pausa' : turnOwnerIsMe ? 'Seu turno' : 'Oponente'}
            </span>
          </span>
          <strong className={timeUrgent ? 'time-urgent' : ''} role="timer">
            {game.status !== 'active'
              ? 'Encerrada'
              : game.turnPaused
                ? 'Pausado'
                : formatTurnClock(secondsLeft)}
          </strong>
        </span>
        {/* Evita repetir o aviso do leitor de tela a cada segundo. */}
        <span className="sr-only" role="status" aria-live="assertive">
          {game.turnPaused ? 'Cronômetro pausado durante o tutorial inicial' : timeUrgent ? 'Tempo do seu turno acabando' : ''}
        </span>
        <span className="timer-track" aria-hidden="true">
          <span
            className={`timer-fill ${timeUrgent ? 'urgent' : ''} ${game.turnPaused ? 'paused' : ''}`}
            style={{ width: `${timerPct}%` }}
          />
        </span>
      </div>

      <div className="pace-hud" style={PACE_HUD_STYLE} aria-label="Ritmo do turno">
        <span className="pace-turn" style={PACE_CHIP_TIGHT_STYLE} aria-label={`Turno ${game.turnNumber}`}>
          <span style={PACE_CHIP_TEXT_STYLE}>Turno {game.turnNumber}</span>
        </span>
        {player.fatigue > 0 && (
          <span
            className="pace-fatigue pace-fatigue-active"
            style={PACE_CHIP_STYLE}
            aria-label={`Fadiga ativa! Cada compra causa ${player.fatigue + 1} de dano.`}
          >
            <IcoDeath className="ic" />
            <span style={PACE_CHIP_TEXT_STYLE}>Fadiga ativa</span>
            <strong>{player.fatigue}</strong>
          </span>
        )}
        {player.fatigue === 0 && player.deckCount <= 3 && (
          <span
            className="pace-fatigue"
            style={PACE_CHIP_STYLE}
            aria-label={`Seu baralho está acabando. ${player.deckCount} cartas no deck antes da fadiga.`}
          >
            <IcoWarning className="ic" />
            <span style={PACE_CHIP_TEXT_STYLE}>Fadiga à vista</span>
            <strong>{player.deckCount}</strong>
          </span>
        )}
        {hud.enemyFatiguePressure && (
          <span
            className="pace-opportunity"
            style={PACE_CHIP_STYLE}
            aria-label="O oponente está perto de sofrer dano por fadiga."
          >
            <IcoDeath className="ic" />
            <span style={PACE_CHIP_TEXT_STYLE}>Pressione o deck</span>
          </span>
        )}
        {hud.actionCoach && (
          <span
            className={`pace-action ${hud.actionCoach.done ? 'done' : ''}`}
            style={PACE_CHIP_STYLE}
            aria-label={hud.actionCoach.aria}
          >
            <IcoHint className="ic" />
            <span style={PACE_CHIP_TEXT_STYLE}>{hud.actionCoach.label}</span>
          </span>
        )}
      </div>

      <div className={`turn-coach ${hud.turnCoach.tone}`} role="status" aria-live="polite">
        <span className="turn-coach-icon">
          {hud.turnCoach.tone === 'bot'
            ? <IcoBot />
            : hud.turnCoach.tone === 'attack' || hud.turnCoach.tone === 'lethal'
              ? <IcoAttack />
              : hud.turnCoach.tone === 'play'
                ? <IcoEnergy />
                : hud.turnCoach.tone === 'end'
                  ? <IcoCheck />
                  : <IcoHint />}
        </span>
        <span className="turn-coach-copy">
          <strong>{hud.turnCoach.title}</strong>
          <span>{hud.turnCoach.body}</span>
        </span>
      </div>

      {myTurn && (
        <button
          className={`btn end-turn ${hud.noMovesLeft ? 'pulse' : ''}`}
          aria-label={hud.noMovesLeft ? 'Encerrar turno, sem ações disponíveis' : 'Encerrar turno'}
          onClick={onEndTurn}
        >
          Encerrar turno ▸
        </button>
      )}

      <div className="taunt-dock">
        {tauntOpen && (
          <div className="taunt-wheel">
            {TAUNTS.map((taunt) => (
              <button key={taunt.id} type="button" className="taunt-pick" onClick={() => onTaunt(taunt.id)}>
                <TauntIcon id={taunt.icon} className="ic" /> {taunt.text}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`btn small taunt-toggle ${tauntOpen ? 'active' : ''}`}
          onClick={onToggleTaunt}
          title="Provocar o oponente"
          aria-label="Provocar o oponente"
        >
          <IcoTaunt />
        </button>
      </div>
    </div>
  );
}
