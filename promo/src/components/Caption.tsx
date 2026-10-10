import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { CAPTION_BASELINE, COLUMN, HEIGHT, MONO, SANS, T } from '../theme';

const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;

/// The headline comes up a word at a time from behind a mask, the way type is set in on a title card. Each word
/// is its own clipped box, so the line breaks fall where they would for the plain sentence.
const Words: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {text.split(' ').map((word, i) => {
        const t = interpolate(frame, [delay + i * 2.5, delay + i * 2.5 + 18], [0, 1], ease);
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', marginRight: '0.24em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - t) * 105}%)` }}>{word}</span>
          </span>
        );
      })}
    </>
  );
};

/// The kicker: a lit jack in the chapter's colour, then the chapter in small capitals.
export const Kicker: React.FC<{ text: string; color?: string; delay?: number; size?: number }> = ({ text, color = T.accent, delay = 0, size = 20 }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [delay, delay + 14], [0, 1], ease);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: t, transform: `translateX(${(1 - t) * -12}px)` }}>
      <span style={{ width: size * 0.62, height: size * 0.62, borderRadius: '50%', background: color, boxShadow: `0 0 ${size}px ${color}` }} />
      <span style={{ fontFamily: MONO, fontSize: size, fontWeight: 600, letterSpacing: size * 0.16, textTransform: 'uppercase', color }}>{text}</span>
    </div>
  );
};

/// Beside the picture (`side`) or above it (`wide`). On `wide` the block is bottom-aligned to CAPTION_BASELINE, so
/// a headline that wraps grows up into the empty frame rather than down into the picture.
export const Caption: React.FC<{
  kicker?: string;
  color?: string;
  headline: string;
  note?: string;
  where?: 'side' | 'wide';
  /// Fades the block out from this frame, for a caption that changes while the picture doesn't.
  outAt?: number;
}> = ({ kicker, color, headline, note, where = 'side', outAt }) => {
  const frame = useCurrentFrame();
  const side = where === 'side';
  const out = outAt === undefined ? 1 : interpolate(frame, [outAt, outAt + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const noteIn = interpolate(frame, [10, 28], [0, 1], ease);

  return (
    <div
      style={{
        position: 'absolute',
        left: side ? COLUMN.left : 0,
        width: side ? COLUMN.width : '100%',
        top: 0,
        height: side ? HEIGHT : CAPTION_BASELINE,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: side ? 'center' : 'flex-end',
        alignItems: side ? 'flex-start' : 'center',
        textAlign: side ? 'left' : 'center',
        fontFamily: SANS,
        opacity: out,
      }}
    >
      {kicker ? <Kicker text={kicker} color={color} /> : null}
      <div
        style={{
          marginTop: kicker ? (side ? 26 : 18) : 0,
          maxWidth: side ? COLUMN.width : 1500,
          fontSize: side ? 58 : 56,
          lineHeight: 1.06,
          fontWeight: 700,
          letterSpacing: -1.6,
          color: T.bright,
        }}
      >
        <Words text={headline} delay={3} />
      </div>
      {note ? (
        <div
          style={{
            marginTop: side ? 26 : 16,
            maxWidth: side ? COLUMN.width - 20 : 1180,
            fontSize: 25,
            lineHeight: 1.45,
            color: T.muted,
            opacity: noteIn,
            transform: `translateY(${(1 - noteIn) * 10}px)`,
            textWrap: 'pretty',
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};
