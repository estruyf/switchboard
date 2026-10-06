/**
 * A local update feed for testing Switchboard's updater without publishing anything.
 *
 *   node scripts/mock-update-server.ts --dir dist            # serve a real build (latest-mac.yml + .zip)
 *   node scripts/mock-update-server.ts --fake 0.0.9          # serve a made-up feed offering v0.0.9
 *   node scripts/mock-update-server.ts --fake 0.0.9-nightly.20261006.1
 *
 * Then start Switchboard with SWITCHBOARD_MOCK_UPDATES=1 (and SWITCHBOARD_MOCK_UPDATES_URL if you
 * changed --port). A fake feed is enough to see a check find an update and its release notes; the
 * download then fails, since there is no build behind it. See docs/building-and-signing.md.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    fake: { type: 'string' },
    port: { type: 'string', default: '8484' },
  },
});
const port = Number(values.port);
const dir = values.dir ? resolve(values.dir) : null;
if (!dir && !values.fake) {
  console.error('Pass --dir <folder with latest-mac.yml> or --fake <version>.');
  process.exit(1);
}

/** A feed for `version`, named the way electron-builder names it (nightly-mac.yml for nightlies). */
function fakeFeed(version: string): { name: string; body: string } {
  const channel = /-nightly\./.test(version) ? 'nightly' : 'latest';
  const zip = `Switchboard-${version}-arm64-mac.zip`;
  const sha512 = Buffer.alloc(64).toString('base64');
  const body = [
    `version: ${version}`,
    'files:',
    `  - url: ${zip}`,
    `    sha512: ${sha512}`,
    '    size: 1024',
    `path: ${zip}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    'releaseNotes: |',
    '  ### Updates',
    '',
    '  - A made-up release from the mock update server.',
    '  - **Restart to update** installs it (a fake feed has no build, so downloading fails).',
    '',
  ].join('\n');
  return { name: `${channel}-mac.yml`, body };
}

const fake = values.fake ? fakeFeed(values.fake) : null;

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '');
  console.log(`${request.method} /${path}`);
  if (fake && path === fake.name) {
    response.writeHead(200, { 'content-type': 'text/yaml' });
    response.end(fake.body);
    return;
  }
  const file = dir ? normalize(join(dir, path)) : null;
  if (!file || !file.startsWith(dir!) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-length': statSync(file).size });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Mock update feed on http://localhost:${port} (${fake ? `fake ${fake.name} offering ${values.fake}` : dir})`);
  console.log(`Start Switchboard with SWITCHBOARD_MOCK_UPDATES=1${port === 8484 ? '' : ` SWITCHBOARD_MOCK_UPDATES_URL=http://localhost:${port}`}`);
});
