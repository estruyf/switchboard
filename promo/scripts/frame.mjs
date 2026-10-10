// One frame of a recorded beat, to check a capture without opening the studio.
//   node scripts/frame.mjs <clip> <frame> [out.png]     e.g. node scripts/frame.mjs companion 120
import { resolve } from 'node:path';
import { CLIP_FPS } from './clips.mjs';
import { ffmpeg } from './ffmpeg.mjs';

const [name, frame, out = `/tmp/${name}-${frame}.png`] = process.argv.slice(2);
ffmpeg(['-ss', String(Number(frame) / CLIP_FPS), '-i', resolve(import.meta.dirname, `../public/clips/${name}.mp4`), '-frames:v', '1', '-vf', 'scale=1280:-2', out]);
console.log(out);
