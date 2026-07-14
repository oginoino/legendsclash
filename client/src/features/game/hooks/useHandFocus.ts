import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameView } from '@legendsclash/shared';
import type { HandFocus } from '../view-model';

const TOUCH_CONFIRM_QUERY = '(hover: none), (pointer: coarse)';
/** Cobre os 350ms de `card-deal`, quando a geometria ainda é intermediária. */
const HAND_LAYOUT_SETTLE_MS = 400;

function revealFirstCard(hand: HTMLDivElement) {
  const firstCard = hand.querySelector<HTMLElement>('.card:first-child');
  if (!firstCard) return;
  const minLeft = hand.getBoundingClientRect().left + 10;
  if (firstCard.getBoundingClientRect().left < minLeft) hand.scrollLeft = 0;
}

export function useHandFocus(game: GameView | null, myTurn: boolean) {
  const [handFocus, setHandFocus] = useState<HandFocus>(null);
  const [touchPlayConfirm, setTouchPlayConfirm] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(TOUCH_CONFIRM_QUERY).matches
  ));
  const handRef = useRef<HTMLDivElement | null>(null);
  const handSignature = game?.hand.map((card) => card.iid).join('|') ?? '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(TOUCH_CONFIRM_QUERY);
    const update = () => setTouchPlayConfirm(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.('change', update);
    return () => mediaQuery.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!handFocus) return;
    if (!game || !myTurn || !game.hand.some((card) => card.iid === handFocus.iid)) {
      setHandFocus(null);
    }
  }, [game, handFocus, myTurn]);

  useLayoutEffect(() => {
    if (!handSignature) return;
    const hand = handRef.current;
    if (!hand) return;
    const scrollSnapType = hand.style.scrollSnapType;
    hand.style.scrollSnapType = 'none';
    revealFirstCard(hand);
    const frame = window.requestAnimationFrame(() => {
      revealFirstCard(hand);
    });
    const settle = window.setTimeout(() => {
      revealFirstCard(hand);
      hand.style.scrollSnapType = scrollSnapType;
    }, HAND_LAYOUT_SETTLE_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      hand.style.scrollSnapType = scrollSnapType;
    };
  }, [handSignature]);

  return { handFocus, handRef, setHandFocus, touchPlayConfirm };
}
