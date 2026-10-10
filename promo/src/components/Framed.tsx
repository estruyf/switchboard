import React from 'react';
import { Easing, interpolate } from 'remotion';
import { SOURCE } from '../theme';

/// A rectangle in the capture's own coordinates: 2560x1600, the numbers you would read off a file in public/shots
/// in Preview. Every shot says what part of the window it looks at in these terms and `Framed` works out the scale,
/// so a crop can be re-measured without touching any layout.
export type Rect = { x: number; y: number; w: number; h: number };

/// The whole window.
export const WINDOW: Rect = { x: 0, y: 0, w: SOURCE.width, h: SOURCE.height };

/// A crop in the window's own points (1280x800), which is how the app's layout is easiest to read.
export const pts = (x: number, y: number, w: number, h: number): Rect => ({ x: x * 2, y: y * 2, w: w * 2, h: h * 2 });

/// Moves between two crops of the same aspect, everything easing together, so a push reads as one move.
export const between = (a: Rect, b: Rect, t: number): Rect => ({
  x: interpolate(t, [0, 1], [a.x, b.x]),
  y: interpolate(t, [0, 1], [a.y, b.y]),
  w: interpolate(t, [0, 1], [a.w, b.w]),
  h: interpolate(t, [0, 1], [a.h, b.h]),
});

/// A camera that holds `a`, then eases to `b` over [from, to].
export const move =
  (a: Rect, b: Rect, from: number, to: number) =>
  (frame: number): Rect =>
    between(a, b, interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1) }));

/// The largest box of this aspect inside `maxW` x `maxH`.
export const fit = (ratio: number, maxW: number, maxH: number) => {
  const byHeight = { w: maxH * ratio, h: maxH };
  return byHeight.w <= maxW ? byHeight : { w: maxW, h: maxW / ratio };
};

/// Shows `rect` of the source at `width` x `height`: the child is laid out at the source's full size, then scaled
/// and shifted under a window that clips it, so a still and a recording share one component and a crop can move
/// without re-encoding anything.
export const Framed: React.FC<{ rect: Rect; width: number; height: number; children: React.ReactNode }> = ({ rect, width, height, children }) => {
  const scale = width / rect.w;
  return (
    <div style={{ width, height, overflow: 'hidden', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: SOURCE.width,
          height: SOURCE.height,
          transformOrigin: '0 0',
          transform: `scale(${scale}) translate(${-rect.x}px, ${-rect.y}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
