import type { HoverTarget, Selection } from './targeting-model';

export interface ArrowGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function resolveAimArrow({
  enemySeatIdx,
  hover,
  hoverValid,
  mouse,
  rectForAnchor,
  selection,
}: {
  enemySeatIdx: number;
  hover: HoverTarget;
  hoverValid: boolean;
  mouse: { x: number; y: number } | null;
  rectForAnchor: (anchor: string) => AnchorRect | null;
  selection: Selection;
}): { arrow: ArrowGeometry | null; lockOn: boolean } {
  if (!selection || !mouse) return { arrow: null, lockOn: false };

  const originAnchor = selection.kind === 'attacker'
    ? `cr-${selection.iid}`
    : `hand-${selection.iid}`;
  const origin = rectForAnchor(originAnchor);
  if (!origin) return { arrow: null, lockOn: false };

  let x2 = mouse.x;
  let y2 = mouse.y;
  let lockOn = false;
  if (hoverValid && hover) {
    const targetAnchor = hover.kind === 'face'
      ? `face-${enemySeatIdx}`
      : `cr-${hover.iid}`;
    const target = rectForAnchor(targetAnchor);
    if (target) {
      x2 = target.left + target.width / 2;
      y2 = target.top + target.height / 2;
      lockOn = true;
    }
  }

  return {
    arrow: {
      x1: origin.left + origin.width / 2,
      y1: origin.top + origin.height / 2,
      x2,
      y2,
    },
    lockOn,
  };
}

export function arrowPath(arrow: ArrowGeometry): string {
  const cx = (arrow.x1 + arrow.x2) / 2;
  const cy = Math.min(arrow.y1, arrow.y2) - 60;
  return `M ${arrow.x1} ${arrow.y1} Q ${cx} ${cy} ${arrow.x2} ${arrow.y2}`;
}

export function arrowPoint(arrow: ArrowGeometry, t: number): { x: number; y: number } {
  const cx = (arrow.x1 + arrow.x2) / 2;
  const cy = Math.min(arrow.y1, arrow.y2) - 60;
  const remaining = 1 - t;
  return {
    x: remaining * remaining * arrow.x1 + 2 * remaining * t * cx + t * t * arrow.x2,
    y: remaining * remaining * arrow.y1 + 2 * remaining * t * cy + t * t * arrow.y2,
  };
}
