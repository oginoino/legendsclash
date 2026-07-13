import type * as React from 'react';
import { arrowPath, arrowPoint } from '../aim-geometry-model';
import type { ArrowGeometry } from '../aim-geometry-model';
import type { AimMode } from '../presentation-model';

const AIM_PALETTE: Record<AimMode, { color: string; accent: string }> = {
  lethal: { color: '#e8665d', accent: '#ffd6a3' },
  attack: { color: '#d7a84c', accent: '#f2d28a' },
  support: { color: '#4fc36b', accent: '#a7efb1' },
  spell: { color: '#9d7ce8', accent: '#9fc3ff' },
};

export function AimOverlay({ arrow, lockOn, mode, tactic }: {
  arrow: ArrowGeometry;
  lockOn: boolean;
  mode: AimMode;
  tactic: boolean;
}) {
  const { color, accent } = AIM_PALETTE[mode];
  const lethal = mode === 'lethal';
  const label = lethal
    ? 'LETAL'
    : mode === 'attack'
      ? 'ATAQUE'
      : mode === 'support'
        ? 'ALIADO'
        : tactic
          ? 'TÁTICA'
          : 'MAGIA';
  const midpoint = arrowPoint(arrow, 0.52);
  const runeA = arrowPoint(arrow, 0.32);
  const runeB = arrowPoint(arrow, 0.72);
  const cssVars = {
    ['--aim' as string]: color,
    ['--aim-2' as string]: accent,
  } as React.CSSProperties;

  return (
    <>
      <svg
        className={`aim-arrow aim-${mode} ${lockOn ? 'locked' : ''}`}
        width="100%"
        height="100%"
        style={{ ...cssVars, filter: `drop-shadow(0 0 3px ${color}66)` }}
      >
        <defs>
          <linearGradient id="aim-gradient" gradientUnits="userSpaceOnUse" x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}>
            <stop offset="0%" stopColor={accent} stopOpacity="0.62" />
            <stop offset="54%" stopColor={color} stopOpacity="0.82" />
            <stop offset="100%" stopColor={lethal ? '#f4aaa0' : accent} stopOpacity="0.68" />
          </linearGradient>
          <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="6.7" refY="5" orient="auto">
            <path
              d="M1,1 L9,5 L1,9 L3.2,5 Z"
              fill={lethal ? '#f1a097' : accent}
              fillOpacity="0.78"
              stroke={color}
              strokeOpacity="0.7"
              strokeWidth="0.65"
            />
          </marker>
        </defs>

        <g className="aim-origin" opacity="0.72">
          <circle cx={arrow.x1} cy={arrow.y1} r="14" fill="none" stroke={accent} strokeOpacity="0.16" strokeWidth="6" />
          <circle cx={arrow.x1} cy={arrow.y1} r="7.5" fill="none" stroke={color} strokeOpacity="0.42" strokeWidth="1.4" />
        </g>

        <path className="aim-aura" d={arrowPath(arrow)} stroke="url(#aim-gradient)" strokeOpacity="0.07" strokeWidth="15" strokeLinecap="round" fill="none" />
        <path className="aim-trail" d={arrowPath(arrow)} stroke="url(#aim-gradient)" strokeOpacity="0.15" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path className="aim-rail" d={arrowPath(arrow)} stroke="url(#aim-gradient)" strokeOpacity="0.44" strokeWidth="5.25" strokeLinecap="round" fill="none" />
        <path
          className="aim-flow"
          d={arrowPath(arrow)}
          stroke="url(#aim-gradient)"
          strokeOpacity="0.82"
          strokeWidth="2.75"
          strokeLinecap="round"
          fill="none"
          markerEnd={lockOn ? undefined : 'url(#arrowhead)'}
          style={{ strokeDasharray: 'none', strokeDashoffset: 0 }}
        />
        <path
          className="aim-core"
          d={arrowPath(arrow)}
          stroke={lethal ? '#fff2cb' : '#fff9e6'}
          strokeOpacity="0.34"
          strokeWidth="0.95"
          strokeLinecap="round"
          fill="none"
          style={{ strokeDasharray: 'none', strokeDashoffset: 0 }}
        />

        <g className="aim-rune" transform={`translate(${runeA.x} ${runeA.y}) rotate(45)`} opacity="0.56">
          <rect x="-3.25" y="-3.25" width="6.5" height="6.5" rx="1.15" fill={color} fillOpacity="0.12" stroke={accent} strokeOpacity="0.55" strokeWidth="1" />
          <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="2.2s" repeatCount="indefinite" additive="sum" />
        </g>
        <g className="aim-rune delay" transform={`translate(${runeB.x} ${runeB.y}) rotate(45)`} opacity="0.44">
          <rect x="-2.6" y="-2.6" width="5.2" height="5.2" rx="1" fill={accent} fillOpacity="0.12" stroke={color} strokeOpacity="0.48" strokeWidth="0.9" />
          <animateTransform attributeName="transform" type="scale" values="1;1.06;1" dur="2.6s" repeatCount="indefinite" additive="sum" />
        </g>

        {lockOn && (
          <g className={`aim-reticle ${lethal ? 'lethal' : ''}`} opacity="0.9">
            <circle className="reticle-aura" cx={arrow.x2} cy={arrow.y2} r="25" fill={color} fillOpacity="0.055" />
            <circle className="reticle-ring" cx={arrow.x2} cy={arrow.y2} r="19" fill="none" stroke="url(#aim-gradient)" strokeOpacity="0.72" strokeWidth="1.75" />
            <circle className="reticle-ping" cx={arrow.x2} cy={arrow.y2} r="19" fill="none" stroke={color} strokeOpacity="0.38" strokeWidth="1.5">
              <animate attributeName="r" values="19;25" dur="1.65s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.38;0" dur="1.65s" repeatCount="indefinite" />
            </circle>
            <rect className="reticle-gem" x={arrow.x2 - 3.5} y={arrow.y2 - 3.5} width="7" height="7" rx="1.2" fill={accent} fillOpacity="0.18" stroke={color} strokeOpacity="0.62" strokeWidth="1" transform={`rotate(45 ${arrow.x2} ${arrow.y2})`} />
            <g stroke={color} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round">
              <line x1={arrow.x2 - 25} y1={arrow.y2} x2={arrow.x2 - 17} y2={arrow.y2} />
              <line x1={arrow.x2 + 17} y1={arrow.y2} x2={arrow.x2 + 25} y2={arrow.y2} />
              <line x1={arrow.x2} y1={arrow.y2 - 25} x2={arrow.x2} y2={arrow.y2 - 17} />
              <line x1={arrow.x2} y1={arrow.y2 + 17} x2={arrow.x2} y2={arrow.y2 + 25} />
            </g>
          </g>
        )}
      </svg>
      <div
        className={`aim-callout aim-${mode} ${lockOn ? 'locked' : ''}`}
        style={{ left: midpoint.x, top: midpoint.y, ...cssVars }}
      >
        {label}
      </div>
    </>
  );
}
