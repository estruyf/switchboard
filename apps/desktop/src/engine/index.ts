/**
 * Entry point of the engine utilityProcess. Main forks this once and hands it
 * one MessagePort per window; everything the UI needs goes over those ports.
 */
import { createEngine } from '@switchboard/engine';
import { mainPortTransport } from '../shared/mainPortTransport.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const dataDir = argValue('--data-dir');
if (!dataDir) {
  console.error('[engine] missing --data-dir');
  process.exit(1);
}

const engine = createEngine({
  dataDir,
  onLog: (entry) => console.error(`[engine] ${entry.level}: ${entry.message}`),
});

// One misbehaving session must never take the whole engine (and every other session) down.
process.on('uncaughtException', (error) => engine.log('error', `Uncaught: ${error.stack ?? error.message}`));
process.on('unhandledRejection', (reason) =>
  engine.log('error', `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`),
);

process.parentPort.on('message', (event) => {
  const port = event.ports[0];
  if ((event.data as { type?: unknown } | null)?.type !== 'connect' || !port) return;
  const detach = engine.attach(mainPortTransport(port));
  port.on('close', detach);
});

engine.log('info', `Engine started (pid ${process.pid})`);
