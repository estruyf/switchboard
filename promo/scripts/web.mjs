// Re-encodes the render for a web page or a README, with a poster.
//
//   npm run web
//
// out/promo.mp4 is the master (CRF 17): upload that anywhere that re-encodes for you. out/web/ holds what a page
// serves itself: no audio track (the piece is silent), `faststart` so playback can begin on the first packet, and
// a poster taken where the app is fully on screen under its caption, not the title card.

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from './ffmpeg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../out');
const WEB = join(OUT, 'web');
mkdirSync(WEB, { recursive: true });
const mb = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;

const encode = (to, scale) => {
  ffmpeg([
    '-i', join(OUT, 'promo.mp4'),
    ...(scale ? ['-vf', `scale=${scale}:flags=lanczos`] : []),
    '-c:v', 'libx264', '-crf', '25', '-preset', 'slow',
    '-profile:v', 'high', '-level', '4.0',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-an',
    join(WEB, to),
  ]);
  console.log(`out/web/${to}  ${mb(join(WEB, to))}`);
};

encode('promo.mp4', null);
encode('promo-720p.mp4', '1280:720');

// A GIF for the README, since GitHub doesn't play a video committed to the repo inline. 720px at 10 fps with a
// 128-colour palette stays under GitHub's 10 MB image limit. The output `-r` drops frames after the filters (the
// bundled ffmpeg has no `fps` filter), and `stats_mode=diff` builds the palette from what moves, not the dark ground.
ffmpeg([
  '-i', join(OUT, 'promo.mp4'),
  '-vf', 'scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  '-r', '10', '-loop', '0',
  join(WEB, 'promo.gif'),
]);
console.log(`out/web/promo.gif  ${mb(join(WEB, 'promo.gif'))}`);

// The poster: Home under its caption, about seven seconds in.
ffmpeg(['-ss', '7', '-i', join(OUT, 'promo.mp4'), '-frames:v', '1', '-q:v', '3', join(WEB, 'poster.jpg')]);
console.log(`out/web/poster.jpg  ${mb(join(WEB, 'poster.jpg'))}`);
