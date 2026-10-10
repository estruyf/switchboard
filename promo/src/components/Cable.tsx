import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { T } from '../theme';

type Point = { x: number; y: number };

/// A patch cable: a sagging curve from `from` to `to` that draws itself between `start` and `start + length`
/// frames, with a plug at each end. It belongs to the frame, never to a window: it runs between pictures, not
/// over what the app drew.
export const Cable: React.FC<{
  from: Point;
  to: Point;
  start: number;
  length?: number;
  /// How far the cable hangs below the straight line between its ends.
  sag?: number;
  color?: string;
  width?: number;
  /// Fades the whole cable out from this frame.
  outAt?: number;
}> = ({ from, to, start, length = 24, sag = 160, color = T.accent, width = 6, outAt }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + length], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const fade = outAt === undefined ? 1 : interpolate(frame, [outAt, outAt + 12], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (t === 0 || fade === 0) return null;
  const mid = { x: (from.x + to.x) / 2, y: Math.max(from.y, to.y) + sag };
  const d = `M ${from.x} ${from.y} Q ${mid.x} ${mid.y} ${to.x} ${to.y}`;
  // A long dash revealed from one end: pathLength normalises the path, so this works for any curve.
  const plug = (p: Point, on: boolean) => (
    <g opacity={on ? 1 : 0}>
      <circle cx={p.x} cy={p.y} r={width * 2.4} fill={T.ground} stroke={color} strokeWidth={width * 0.8} />
      <circle cx={p.x} cy={p.y} r={width * 0.9} fill={color} />
    </g>
  );
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', opacity: fade }}>
      <defs>
        <filter id="cable-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={d} pathLength={1} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={width + 6} strokeLinecap="round" strokeDasharray={`${t} 1`} transform="translate(0 6)" />
      <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={`${t} 1`} filter="url(#cable-glow)" />
      {plug(from, true)}
      {plug(to, t >= 1)}
    </svg>
  );
};

/// A lit jack: a hole in the panel with a coloured light, as the status colours appear on the title and outro.
export const Jack: React.FC<{ x: number; y: number; color: string; on: number; size?: number }> = ({ x, y, color, on, size = 18 }) => (
  <div style={{ position: 'absolute', left: x - size, top: y - size, width: size * 2, height: size * 2, borderRadius: '50%', background: '#0c0f15', boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08)' }}>
    <div
      style={{
        position: 'absolute',
        inset: size * 0.42,
        borderRadius: '50%',
        background: color,
        opacity: on,
        boxShadow: `0 0 ${size * 1.6}px ${size * 0.4}px ${color}`,
      }}
    />
  </div>
);
