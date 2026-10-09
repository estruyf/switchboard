/**
 * Bundles the extension (and the shared protocol it imports from packages/protocol) into one CommonJS file,
 * dist/extension.cjs, which is all the .vsix ships. `--watch` rebuilds on change; `--production` minifies.
 *
 * In watch mode it prints `[watch] build started` and `[watch] build finished`, with each error as
 * `file:line:column: error: message` in between, which the "Watch extension" task in .vscode/tasks.json reads.
 */
import { context, type Plugin } from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const report: Plugin = {
  name: 'watch-report',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const message of [...result.errors, ...result.warnings]) {
        const kind = result.errors.includes(message) ? 'error' : 'warning';
        const where = message.location ? `${message.location.file}:${message.location.line}:${message.location.column + 1}: ` : '';
        console.error(`${where}${kind}: ${message.text}`);
      }
      console.log('[watch] build finished');
    });
  },
};

const build = await context({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Provided by VS Code at runtime.
  external: ['vscode'],
  sourcemap: production ? false : 'linked',
  minify: production,
  // Watching, the plugin reports each build; a single build lets esbuild say what it wrote.
  logLevel: watch ? 'silent' : 'info',
  plugins: watch ? [report] : [],
});

if (watch) await build.watch();
else {
  await build.rebuild();
  await build.dispose();
}
