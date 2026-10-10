// Where a recorded beat changes: for each frame, how much of the picture differs from the frame before (the pointer
// is small, so its moves barely register; a panel opening is a spike). Use it to find the frame a caption should
// switch on, then look at that frame with scripts/frame.mjs.
//   node scripts/activity.mjs <clip> [threshold=0.4]
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED = resolve(HERE, '../node_modules/@remotion/compositor-darwin-arm64');
const [name, threshold = '0.4'] = process.argv.slice(2);
const W = 160;
const H = 100;
const raw = execFileSync(
  join(BUNDLED, 'ffmpeg'),
  ['-hide_banner', '-loglevel', 'error', '-i', resolve(HERE, `../public/clips/${name}.mp4`), // Remotion's ffmpeg has the rawvideo encoder but not its muxer; image2pipe writes the frames back to back all the same.
    '-vf', `scale=${W}:${H},format=gray`, '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', 'gray', '-'],
  { env: { ...process.env, DYLD_LIBRARY_PATH: BUNDLED }, maxBuffer: 1 << 30 },
);
const frames = raw.length / (W * H);
let quiet = 0;
for (let f = 1; f < frames; f++) {
  let changed = 0;
  for (let i = 0; i < W * H; i++) if (Math.abs(raw[f * W * H + i] - raw[(f - 1) * W * H + i]) > 12) changed++;
  const pct = (100 * changed) / (W * H);
  if (pct >= Number(threshold)) {
    if (quiet) console.log(`        … ${quiet} quiet`);
    quiet = 0;
    console.log(`${String(f).padStart(5)}  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.min(60, Math.round(pct)))}`);
  } else quiet++;
}
console.log(`${frames} frames`);
