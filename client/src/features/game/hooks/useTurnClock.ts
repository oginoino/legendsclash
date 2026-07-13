import { useEffect, useState } from 'react';
import { TURN_SECONDS } from '@legendsclash/shared';
import type { GameView as GameViewState } from '@legendsclash/shared';
import { sfx } from '../../../sounds';

export interface TurnClockState {
  myTurn: boolean;
  now: number;
  secondsLeft: number;
  timeUrgent: boolean;
  timerPct: number;
  turnOwnerIsMe: boolean;
}

export function useTurnClock(
  game: GameViewState | null,
  hasPlayerSeat: boolean,
): TurnClockState {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const turnOwnerIsMe = !!game
    && hasPlayerSeat
    && game.turnSeat === game.yourSeat
    && game.status === 'active';
  const myTurn = turnOwnerIsMe && !game?.turnPaused;
  const secondsLeft = game
    ? Math.max(0, Math.ceil(
      (game.turnPaused ? game.turnTimeLeftMs : game.turnEndsAt - now) / 1000,
    ))
    : 0;
  const timerPct = Math.min(100, (secondsLeft / TURN_SECONDS) * 100);
  const timeUrgent = myTurn
    && !game?.turnPaused
    && secondsLeft <= 10
    && secondsLeft > 0;

  useEffect(() => {
    if (myTurn && secondsLeft > 0 && secondsLeft <= 5) sfx.tick();
  }, [secondsLeft, myTurn]);

  return { myTurn, now, secondsLeft, timeUrgent, timerPct, turnOwnerIsMe };
}
