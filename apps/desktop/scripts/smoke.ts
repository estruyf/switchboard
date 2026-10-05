/**
 * Launches the built app in smoke mode and checks that it starts, talks to the
 * engine, and recovers when the engine process is killed.
 * Usage: npm run smoke (builds first). Writes .smoke/window.png and .smoke/result.json.
 */
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');
const outDir = join(appDir, '.smoke');
rmSync(outDir, { recursive: true, force: true });

const electronPath = createRequire(import.meta.url)('electron') as unknown as string;
const started = performance.now();
const child = spawn(electronPath, [appDir], {
  env: { ...process.env, SWITCHBOARD_SMOKE_OUT: outDir, ELECTRON_ENABLE_LOGGING: '0' },
  stdio: 'inherit',
});

const code: number = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
if (code !== 0) {
  console.error(`✗ smoke test failed: app exited with code ${code}`);
  process.exit(1);
}

const result = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
console.log(`✓ UI talking to the engine ${result.connectedMs}ms after process start (diagnostics loaded at ${result.loadedMs}ms)`);
console.log(`✓ engine restarted and renderer reconnected in ${result.restartRecoveryMs}ms`);
console.log(`  claude ${result.reports[0].claudeVersion ?? 'not found'} · engine ping ${result.reports[0].pingMs}ms · electron ${result.versions.electron}`);
console.log(`  total wall time ${Math.round(performance.now() - started)}ms, screenshot: ${join(outDir, 'window.png')}`);
