import React from 'react';
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from 'remotion';
import { Kicker } from '../components/Caption';
import { WINDOW } from '../components/Framed';
import { stageBox, Still, Window } from '../components/Shot';
import { SANS, T } from '../theme';

/// What the montage runs through: a still each, its line on the left. Each is a whole window, so the picture is
/// the app as it is, not a detail.
export const MONTAGE = [
  { shot: 'split', line: 'Two sessions side by side.' },
  { shot: 'session', line: 'Review the changes. Commit with one click.' },
  { shot: 'palette', line: '⌘K for every command.' },
  { shot: 'search', line: 'Search every conversation.' },
];
export const MONTAGE_STEP = 54;

const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;

/// "And more": windows land one on another like a stack of cards, the ones underneath pushed back and dimmed.
export const Montage: React.FC = () => {
  const frame = useCurrentFrame();
  const box = stageBox('side', WINDOW);
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <div style={{ position: 'absolute', left: 96, top: 0, height: 1080, width: 520, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Kicker text="And more" />
        <div style={{ position: 'relative', marginTop: 26, height: 260 }}>
          {MONTAGE.map((item, i) => {
            const start = i * MONTAGE_STEP;
            const t = interpolate(frame, [start, start + 14], [0, 1], ease);
            const out = i === MONTAGE.length - 1 ? 1 : interpolate(frame, [start + MONTAGE_STEP - 6, start + MONTAGE_STEP + 4], [1, 0], ease);
            return (
              <div
                key={item.shot}
                style={{ position: 'absolute', top: 0, fontSize: 60, lineHeight: 1.06, fontWeight: 700, letterSpacing: -1.6, color: T.bright, opacity: Math.min(t, out), transform: `translateY(${(1 - t) * 30 - (1 - out) * 30}px)` }}
              >
                {item.line}
              </div>
            );
          })}
        </div>
        {/* A jack per item, lit as it comes up. */}
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          {MONTAGE.map((item, i) => (
            <span key={item.shot} style={{ width: 12, height: 12, borderRadius: '50%', background: frame >= i * MONTAGE_STEP ? T.accent : T.line, boxShadow: frame >= i * MONTAGE_STEP ? `0 0 12px ${T.accent}` : 'none' }} />
          ))}
        </div>
      </div>

      {MONTAGE.map((item, i) => {
        const start = i * MONTAGE_STEP;
        // How many windows have landed on top of this one since: each pushes it back a step.
        const above = interpolate(frame, [start + MONTAGE_STEP, start + MONTAGE_STEP + 16, start + 2 * MONTAGE_STEP, start + 2 * MONTAGE_STEP + 16], [0, 1, 1, 2], ease);
        if (above >= 2) return null;
        return (
          <Sequence key={item.shot} from={start} layout="none">
            <div style={{ position: 'absolute', inset: 0, transform: `translate(${-above * 46}px, ${-above * 34}px) scale(${1 - above * 0.06})`, transformOrigin: '70% 50%' }}>
              <Window box={box} rect={WINDOW} enter={0} dim={above * 0.5}>
                <Still name={item.shot} />
              </Window>
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
