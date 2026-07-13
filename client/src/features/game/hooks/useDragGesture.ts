import { useCallback, useEffect, useRef } from 'react';
import type * as React from 'react';
import { pendingDragIntent } from '../drag-gesture-model';
import type { DragState } from '../drag-gesture-model';

export interface DragGestureApi {
  begin: (drag: DragState) => void;
  move: (drag: DragState, x: number, y: number) => void;
  finish: (drag: DragState, x: number, y: number) => void;
  cancel: (drag: DragState) => void;
}

function releaseCapture(drag: DragState): void {
  if (drag.pointerId < 0 || !drag.captureEl) return;
  try {
    if (drag.captureEl.hasPointerCapture(drag.pointerId)) {
      drag.captureEl.releasePointerCapture(drag.pointerId);
    }
  } catch { /* o navegador pode liberar a captura antes do pointercancel */ }
}

export function useDragGesture(onTouchTapRelease: () => void) {
  const dragRef = useRef<DragState | null>(null);
  const dragApiRef = useRef<DragGestureApi | null>(null);
  const suppressClickRef = useRef(false);
  const touchTapReleaseRef = useRef(onTouchTapRelease);
  touchTapReleaseRef.current = onTouchTapRelease;

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    releaseCapture(drag);
    dragApiRef.current?.cancel(drag);
  }, []);

  useEffect(() => {
    const suppressSyntheticClick = () => {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 400);
    };
    const moveDrag = (drag: DragState, x: number, y: number) => {
      const api = dragApiRef.current;
      if (!api) return;
      if (drag.mode === 'pending') {
        const intent = pendingDragIntent(drag, x, y);
        if (intent === 'pending') return;
        if (intent === 'pan') {
          drag.mode = 'pan';
          return;
        }

        api.begin(drag);
        const activeMode = drag.mode as DragState['mode'];
        if ((activeMode === 'target' || activeMode === 'lift') && drag.pointerId >= 0 && drag.captureEl) {
          try { drag.captureEl.setPointerCapture(drag.pointerId); } catch { /* melhoria progressiva */ }
        }
      }
      if (drag.mode === 'pan' || drag.mode === 'dead') return;
      api.move(drag, x, y);
    };
    const finishDrag = (drag: DragState, x: number, y: number) => {
      const api = dragApiRef.current;
      if (!api) return;
      dragRef.current = null;
      releaseCapture(drag);
      if (drag.mode === 'pending') {
        if (drag.pointerType === 'touch') touchTapReleaseRef.current();
        return;
      }
      // Pointer Events podem sintetizar click depois de drag/pan.
      suppressSyntheticClick();
      if (drag.mode === 'pan' || drag.mode === 'dead') {
        api.cancel(drag);
        return;
      }
      api.finish(drag, x, y);
    };
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId || !dragApiRef.current) return;
      moveDrag(drag, event.clientX, event.clientY);
      if (drag.pointerType === 'touch' && (drag.mode === 'target' || drag.mode === 'lift')) {
        event.preventDefault();
      }
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId || !dragApiRef.current) {
        if (event.pointerType === 'touch') touchTapReleaseRef.current();
        return;
      }
      finishDrag(drag, event.clientX, event.clientY);
    };
    const onCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId || !dragApiRef.current) return;
      cancelDrag();
    };
    const onMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      // Fallback para navegadores sem Pointer Events; evita processar os dois.
      if (!drag || drag.pointerId !== -1) return;
      moveDrag(drag, event.clientX, event.clientY);
    };
    const onMouseUp = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== -1) return;
      finishDrag(drag, event.clientX, event.clientY);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelDrag();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', cancelDrag);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cancelDrag]);

  const consumeSyntheticClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { cancelDrag, consumeSyntheticClick, dragApiRef, dragRef };
}
