// Rewrites the shortcuts tables in README.md from the registry (apps/ui/src/lib/shortcuts.ts).
// Run with `npm run docs:shortcuts` after adding or changing a shortcut.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withShortcuts } from '../src/lib/shortcutsDoc.ts';

const readme = fileURLToPath(new URL('../../../README.md', import.meta.url));
const before = readFileSync(readme, 'utf8');
const after = withShortcuts(before);
if (after === before) console.log('README.md shortcuts are up to date.');
else {
  writeFileSync(readme, after);
  console.log('README.md shortcuts updated.');
}
