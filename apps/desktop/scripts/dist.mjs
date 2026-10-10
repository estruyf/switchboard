// Packages Switchboard for the OS this runs on, with that platform's flags in one place; any other arguments
// (--config, --publish, -c.publish.channel=nightly) are passed on to electron-builder.
// Usage: node scripts/dist.mjs [electron-builder arguments]   (npm run dist runs electron-vite build first)
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const PLATFORM_ARGS = {
  // The .dmg, .zip and folder are Apple Silicon only (electron-builder.yml).
  darwin: ['--mac', '--arm64'],
  // The per-user installer names its folder after the package (%LOCALAPPDATA%\Programs\<name>), which would be
  // "@switchboarddesktop". Only the installer sees this name: the data folder comes from productName. It's set
  // here rather than in electron-builder.yml because on macOS it would also move the updater's download cache.
  win32: ['--win', '-c.extraMetadata.name=switchboard'],
};

/**
 * Signing on Windows with Azure Trusted Signing, when the release workflow sets these (docs/building-and-signing.md).
 * The account's credentials come from AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET, which electron-builder
 * reads itself. A certificate file (WIN_CSC_LINK) needs nothing here either.
 */
const AZURE_SIGNING = {
  endpoint: 'AZURE_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGNING_ACCOUNT',
  certificateProfileName: 'AZURE_SIGNING_PROFILE',
  // Also written to the app's update feed settings: an update must be signed by the same publisher to install.
  publisherName: 'AZURE_SIGNING_PUBLISHER',
};

function azureSigningArgs() {
  const set = Object.entries(AZURE_SIGNING).filter(([, name]) => process.env[name]);
  if (set.length === 0) return [];
  const missing = Object.values(AZURE_SIGNING).filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Azure Trusted Signing needs ${missing.join(', ')} too.`);
    process.exit(1);
  }
  return set.map(([option, name]) => `-c.win.azureSignOptions.${option}=${process.env[name]}`);
}

const platformArgs = PLATFORM_ARGS[process.platform];
if (!platformArgs) {
  console.error(`Switchboard is packaged on macOS and Windows, not on ${process.platform}.`);
  process.exit(1);
}
const signingArgs = process.platform === 'win32' ? azureSigningArgs() : [];
const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
const result = spawnSync(process.execPath, [cli, ...platformArgs, ...signingArgs, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
