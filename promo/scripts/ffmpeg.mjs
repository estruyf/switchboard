// The ffmpeg every script here uses: Remotion's own build, which is already in
// node_modules and has libx264, so a broken or missing system ffmpeg doesn't stop
// a capture. PROMO_FFMPEG picks another one.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED = resolve(HERE, '../node_modules/@remotion/compositor-darwin-arm64');

export function ffmpeg(args) {
  const bin = process.env.PROMO_FFMPEG ?? join(BUNDLED, 'ffmpeg');
  // The bundled binary loads its libraries from its own folder.
  const env = process.env.PROMO_FFMPEG ? process.env : { ...process.env, DYLD_LIBRARY_PATH: BUNDLED };
  execFileSync(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit', env });
}
