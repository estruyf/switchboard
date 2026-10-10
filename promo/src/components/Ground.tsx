import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { T } from '../theme';

/// The panel everything sits on. It never cuts (scenes dissolve over it), so its slow drift is what keeps a long
/// hold alive. The jack grid is one repeating radial gradient: a hole every 36px, lit faintly from above.
export const Ground: React.FC<{ tint?: string }> = ({ tint = T.glow }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const drift = interpolate(t, [0, 1], [0, -72]);
  const glowX = interpolate(t, [0, 1], [72, 30]);

  return (
    <AbsoluteFill style={{ backgroundColor: T.ground }}>
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.075) 0 1.6px, transparent 2.4px)',
          backgroundSize: '36px 36px',
          backgroundPosition: `${drift}px ${drift / 2}px`,
          maskImage: 'radial-gradient(1200px 760px at 50% 45%, black 20%, transparent 90%)',
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(1100px 620px at ${glowX}% -12%, rgba(${tint},0.16), transparent 68%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(900px 600px at ${100 - glowX}% 112%, rgba(116,192,252,0.08), transparent 66%)` }} />
      <AbsoluteFill style={{ background: 'radial-gradient(1500px 900px at 50% 46%, transparent 40%, rgba(0,0,0,0.55) 100%)' }} />
    </AbsoluteFill>
  );
};

/// A hairline filling along the bottom edge over the whole piece: the one element that never dissolves.
export const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, durationInFrames - 1], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.05)' }}>
      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: T.accent, boxShadow: `0 0 14px ${T.accent}` }} />
    </div>
  );
};
