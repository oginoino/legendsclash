import { useCallback, useEffect, useRef, useState } from 'react';
import type { InspectCard } from '../view-model';

export function useCardInspection() {
  const [inspect, setInspect] = useState<InspectCard | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearInspect = useCallback((source?: InspectCard['source']) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setInspect((current) => (!source || current?.source === source ? null : current));
  }, []);

  const showInspect = useCallback((next: InspectCard, ttlMs?: number) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setInspect(next);
    if (!ttlMs) return;

    timerRef.current = window.setTimeout(() => {
      setInspect((current) => (
        current?.iid === next.iid && current.source === next.source ? null : current
      ));
      timerRef.current = null;
    }, ttlMs);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return { clearInspect, inspect, showInspect };
}
