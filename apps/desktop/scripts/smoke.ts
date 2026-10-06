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

// --packaged runs the built Switchboard.app (npm run dist) instead of the development build.
const packaged = process.argv.includes('--packaged');
const command = packaged
  ? join(appDir, 'dist', 'mac-arm64', 'Switchboard.app', 'Contents', 'MacOS', 'Switchboard')
  : (createRequire(import.meta.url)('electron') as unknown as string);
const started = performance.now();
const child = spawn(command, packaged ? [] : [appDir], {
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
console.log(`${result.sessionCount > 0 ? '✓' : '✗'} ${result.sessionCount} sessions listed on first load`);
console.log(`${result.transcriptOpened ? '✓' : '✗'} newest session with messages rendered`);
const gapOk = result.transcriptFits || (typeof result.transcriptAtBottom === 'number' && result.transcriptAtBottom >= 16 && result.transcriptAtBottom <= 60);
console.log(`${gapOk ? '✓' : '✗'} transcript opens at the end, ${result.transcriptFits ? 'conversation shorter than the window' : `${result.transcriptAtBottom ?? '?'}px above the composer`}`);
if (!gapOk) process.exitCode = 1;
console.log(`${result.activity?.steps ? '✓' : '✗'} tool calls summarised: ${result.activity ? `${result.activity.groups} groups; "${result.activity.label}" opens to ${result.activity.steps} steps` : 'no groups'}`);
if (!result.activity?.steps) process.exitCode = 1;
console.log(`${String(result.changesPanel).startsWith('ok') ? '✓' : '✗'} changes panel: ${result.changesPanel}`);
if (!String(result.changesPanel).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.branchResult).startsWith('ok') ? '✓' : '✗'} branch button: ${result.branchResult}`);
if (!String(result.branchResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.openInResult).startsWith('ok') ? '✓' : '✗'} open in menu: ${result.openInResult}`);
if (!String(result.openInResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.gitResult).startsWith('ok') ? '✓' : '✗'} git menu: ${result.gitResult}`);
if (!String(result.gitResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.findResult).startsWith('ok') ? '✓' : '✗'} find in session: ${result.findResult}`);
if (!String(result.findResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.searchResult).startsWith('ok') ? '✓' : '✗'} search: ${result.searchResult}`);
if (!String(result.searchResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.paletteResult).startsWith('ok') ? '✓' : '✗'} command palette: ${result.paletteResult}`);
if (!String(result.paletteResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.toolsResult).startsWith('ok') ? '✓' : '✗'} tools: ${result.toolsResult}`);
if (!String(result.toolsResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.splitResult).startsWith('ok') ? '✓' : '✗'} split panes: ${result.splitResult}`);
if (!String(result.splitResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.settleResult).startsWith('ok') ? '✓' : '✗'} settle: ${result.settleResult}`);
if (!String(result.settleResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.archiveResult).startsWith('ok') ? '✓' : '✗'} multi-select and archive: ${result.archiveResult}`);
if (!String(result.archiveResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.dropResult).startsWith('ok') ? '✓' : '✗'} drop target: ${result.dropResult}`);
if (!String(result.dropResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.controlsResult).startsWith('ok') ? '✓' : '✗'} controls: ${result.controlsResult}`);
if (!String(result.controlsResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.newSessionResult).startsWith('ok') ? '✓' : '✗'} new session view: ${result.newSessionResult}`);
if (!String(result.newSessionResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.deepLinkResult).startsWith('ok') ? '✓' : '✗'} links: ${result.deepLinkResult}`);
if (!String(result.deepLinkResult).startsWith('ok')) process.exitCode = 1;
console.log(`${result.quitGuarded ? '✓' : '✗'} ⌘Q asks first, Cancel keeps the app open, a second ⌘Q quits`);
console.log(`${result.settingsResult === 'ok' ? '✓' : '✗'} settings: theme, sidebar style, session scope, tool activity, startup and quit prompt apply at once and are saved${result.settingsResult === 'ok' ? '' : ` (${result.settingsResult})`}`);
console.log(`${result.terminalOpened ? '✓' : '✗'} terminal panel opened a shell`);
console.log(`${result.actionRan ? '✓' : '✗'} project action added through the editor and run in a terminal tab`);
console.log(`${String(result.projectsResult).startsWith('ok') ? '✓' : '✗'} projects: ${result.projectsResult}`);
if (!String(result.projectsResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.profilesResult).startsWith('ok') ? '✓' : '✗'} profiles: ${result.profilesResult}`);
if (!String(result.profilesResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.aboutResult).startsWith('ok') ? '✓' : '✗'} about: ${result.aboutResult}`);
if (!String(result.aboutResult).startsWith('ok')) process.exitCode = 1;
console.log(`${String(result.backupResult).startsWith('ok') ? '✓' : '✗'} backup: ${result.backupResult}`);
if (!String(result.backupResult).startsWith('ok')) process.exitCode = 1;
console.log(`${result.highlighted ? '✓' : '✗'} syntax highlighting loaded and coloured a code block`);
console.log(`${result.usageBand ? '✓' : '✗'} usage band above the composer: ${result.usageBand ?? 'not shown'}`);
console.log(`  rendering on screen: ${JSON.stringify(result.rendering)}`);
if (result.notifications.length) console.log(`  notifications: ${result.notifications.map((n: { kind: string; title: string; suppressed: boolean }) => `${n.kind} "${n.title}"${n.suppressed ? ' (suppressed: you were looking)' : ''}`).join('; ')}`);
if (!result.quitGuarded || result.settingsResult !== 'ok' || !result.terminalOpened || !result.actionRan || !result.highlighted) process.exitCode = 1;
if (result.liveSession !== null) {
  console.log(`${result.liveSession === 'ok' ? '✓' : '✗'} live session through the UI: ${result.liveSession}`);
  if (result.liveSession !== 'ok') process.exitCode = 1;
}
console.log(`✓ engine restarted and renderer reconnected in ${result.restartRecoveryMs}ms`);
if (!result.transcriptOpened || result.sessionCount === 0) process.exitCode = 1;
console.log(`  claude ${result.reports[0].claudeVersion ?? 'not found'} · engine ping ${result.reports[0].pingMs}ms · electron ${result.versions.electron}`);
if (packaged) console.log('  (packaged app)');
console.log(`  total wall time ${Math.round(performance.now() - started)}ms, screenshots in ${outDir}`);
