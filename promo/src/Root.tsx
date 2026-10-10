import React from 'react';
import { Composition } from 'remotion';
import { DURATION, Promo } from './Promo';
import { FPS, HEIGHT, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    {/* About fifty seconds: the pitch. Its length follows the recordings (public/clips.json). */}
    <Composition id="Promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);
