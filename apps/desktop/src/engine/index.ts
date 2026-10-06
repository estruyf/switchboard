/**
 * Entry point of the engine utilityProcess. Main forks this once and hands it
 * one MessagePort per window; everything the UI needs goes over those ports.
 */
import { createEngine, type TrashScope } from '@switchboard/engine';
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

/** Moving files to the Trash needs Electron's shell, which lives in the main process. */
let nextTrashId = 1;
const pendingTrash = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
const trash = (paths: string[], scope: TrashScope) =>
  new Promise<void>((resolve, reject) => {
    const id = nextTrashId++;
    pendingTrash.set(id, { resolve, reject });
    process.parentPort.postMessage({ type: 'trash', id, paths, ...scope });
  });

const engine = createEngine({
  dataDir,
  trash,
  onLog: (entry) => console.error(`[engine] ${entry.level}: ${entry.message}`),
});

// One misbehaving session must never take the whole engine (and every other session) down.
process.on('uncaughtException', (error) => engine.log('error', `Uncaught: ${error.stack ?? error.message}`));
process.on('unhandledRejection', (reason) =>
  engine.log('error', `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`),
);

process.parentPort.on('message', (event) => {
  const data = event.data as { type?: unknown; id?: number; error?: string } | null;
  if (data?.type === 'trash-result' && typeof data.id === 'number') {
    const pending = pendingTrash.get(data.id);
    pendingTrash.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve();
    return;
  }
  const port = event.ports[0];
  if ((event.data as { type?: unknown } | null)?.type !== 'connect' || !port) return;
  const detach = engine.attach(mainPortTransport(port));
  port.on('close', detach);
});

engine.log('info', `Engine started (pid ${process.pid})`);
