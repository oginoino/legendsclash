import { useEffect, useMemo } from 'react';
import type { GameView as GameViewState } from '@legendsclash/shared';
import { preloadCardImages } from '../../../preload';
import type { Reveal } from '../feedback-model';

export function useCardImagePreload(
  game: GameViewState | null,
  reveals: Reveal[],
): void {
  const visibleImageKey = useMemo(() => {
    if (!game) return '';
    const ids = [
      ...game.hand.map((card) => card.defId),
      ...game.seats.flatMap((seat) => seat.board.map((card) => card.defId)),
      ...reveals.map((reveal) => reveal.cardId),
    ];
    return [...new Set(ids)].join('|');
  }, [game, reveals]);

  useEffect(() => {
    if (!visibleImageKey) return;
    void preloadCardImages(visibleImageKey.split('|'), { priority: 'high', decode: true });
  }, [visibleImageKey]);
}
