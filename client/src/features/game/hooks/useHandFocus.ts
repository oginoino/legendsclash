import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameView } from '@legendsclash/shared';
import type { HandFocus } from '../view-model';

const TOUCH_CONFIRM_QUERY = '(hover: none), (pointer: coarse)';

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
    const firstCard = hand.querySelector<HTMLElement>('.card:first-child');
    if (!firstCard) return;
    const handRect = hand.getBoundingClientRect();
    const firstCardRect = firstCard.getBoundingClientRect();
    const minLeft = handRect.left + 10;
    if (firstCardRect.left < minLeft) {
      hand.scrollLeft = Math.max(0, hand.scrollLeft - (minLeft - firstCardRect.left));
    }
  }, [handSignature]);

  return { handFocus, handRef, setHandFocus, touchPlayConfirm };
}
