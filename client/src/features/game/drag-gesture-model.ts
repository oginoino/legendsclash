/** Movimento mínimo para mouse/caneta virar arrasto em vez de clique. */
export const DRAG_THRESHOLD_PX = 8;
/** O dedo oscila mais que o mouse: uma margem maior preserva o tap intencional. */
export const TOUCH_DRAG_THRESHOLD_PX = 14;
/** Deslocamento vertical mínimo para assumir que o dedo quer sair da mão. */
export const TOUCH_VERTICAL_INTENT_PX = 10;
/** Margem ao redor de um alvo para compensar a área escondida sob o dedo. */
export const TOUCH_TARGET_MAGNET_PX = 32;
/** Tolerância fora da borda visual da mesa ao soltar uma criatura. */
export const TOUCH_DROP_SLOP_PX = 24;
/** Elevação mínima para jogar uma carta sem alvo. */
export const PLAY_LIFT_PX = 48;
export const TOUCH_PLAY_LIFT_PX = 56;

const TOUCH_AXIS_BIAS_PX = 6;

export interface DragOrigin {
  kind: 'hand' | 'creature';
  iid: string;
  defId: string;
}

/**
 * Gesto em andamento. `pending` ainda pode virar clique; `pan` pertence à
 * rolagem da mão; `target` mira; `lift` joga sem alvo; `dead` consome o gesto.
 */
export interface DragState extends DragOrigin {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  mode: 'pending' | 'pan' | 'target' | 'lift' | 'dead';
  captureEl?: HTMLElement | null;
  lockedTarget?: string | null;
}

export interface DragCardVisual {
  iid: string;
  defId: string;
  x: number;
  y: number;
  mode: 'target' | 'play';
  valid: boolean;
  label: string;
  pointerType: string;
  magnetized: boolean;
}

export type PendingDragIntent = 'pending' | 'pan' | 'activate';

/** Classifica o gesto antes de qualquer efeito ou captura de ponteiro. */
export function pendingDragIntent(
  drag: Pick<DragState, 'pointerType' | 'startX' | 'startY'>,
  x: number,
  y: number,
): PendingDragIntent {
  const dx = x - drag.startX;
  const dy = y - drag.startY;
  const threshold = drag.pointerType === 'touch'
    ? TOUCH_DRAG_THRESHOLD_PX
    : DRAG_THRESHOLD_PX;
  if (Math.hypot(dx, dy) < threshold) return 'pending';
  if (drag.pointerType !== 'touch') return 'activate';

  const horizontalIntent = Math.abs(dx) > Math.abs(dy) + TOUCH_AXIS_BIAS_PX;
  const upwardIntent = -dy >= TOUCH_VERTICAL_INTENT_PX;
  return horizontalIntent || !upwardIntent ? 'pan' : 'activate';
}
