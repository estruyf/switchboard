import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateState } from '@switchboard/protocol/bridge';
import { readUpdateMarker, Updater, type UpdaterOptions } from './updater.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const markerPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-update-'));
  dirs.push(dir);
  return join(dir, 'update-marker.json');
};

function fakeUpdater(offer: { version: string; releaseNotes?: unknown } | Error) {
  const progress: Array<(p: { percent: number }) => void> = [];
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    channel: null as string | null,
    forceDevUpdateConfig: false,
    logger: null as unknown,
    feed: null as unknown,
    installed: 0,
    setFeedURL(options: unknown) {
      this.feed = options;
    },
    async checkForUpdates() {
      if (offer instanceof Error) throw offer;
      return { updateInfo: offer, isUpdateAvailable: offer.version !== '0.0.3' };
    },
    async downloadUpdate() {
      progress.forEach((l) => l({ percent: 50 }));
      return [];
    },
    quitAndInstall() {
      this.installed++;
    },
    on(_event: 'download-progress', listener: (p: { percent: number }) => void) {
      progress.push(listener);
    },
  };
  return fake;
}

function setup(fake: ReturnType<typeof fakeUpdater>, extra: Partial<UpdaterOptions> = {}) {
  const states: UpdateState[] = [];
  let stopped = 0;
  const updater = new Updater({
    currentVersion: '0.0.3',
    channel: 'stable',
    autoCheck: false,
    disabledReason: null,
    markerFile: markerPath(),
    onState: (s) => states.push(s),
    beforeInstall: () => void stopped++,
    log: () => {},
    load: async () => fake,
    ...extra,
  });
  return { updater, states, stopped: () => stopped };
}

describe('Updater', () => {
  it('checks, downloads with progress, and installs after writing the marker', async () => {
    const fake = fakeUpdater({ version: '0.0.4', releaseNotes: '<ul><li>Restart works</li></ul>' });
    const { updater, states, stopped } = setup(fake);
    await updater.check();
    expect(fake.autoDownload).toBe(false);
    expect(fake).toMatchObject({ channel: 'latest', allowPrerelease: false, allowDowngrade: false });
    expect(updater.state).toMatchObject({ status: 'available', availableVersion: '0.0.4', releaseNotes: '- Restart works' });
    await updater.download();
    expect(states.map((s) => s.status)).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloaded']);
    expect(states[3]!.downloadPercent).toBe(50);
    await updater.install();
    expect(updater.state.status).toBe('installing');
    expect(fake.installed).toBe(1);
    expect(stopped()).toBe(1);
  });

  it('turns a failed check into a retryable error, and Retry checks again', async () => {
    const fake = fakeUpdater(new Error('net::ERR_INTERNET_DISCONNECTED\nmore detail'));
    const { updater } = setup(fake);
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED', canRetry: true });
    const feedError = Object.assign(new Error('Cannot find latest-mac.yml'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });
    const { updater: second } = setup(fakeUpdater(feedError));
    await second.check();
    expect(second.state.canRetry).toBe(false);
  });

  it('switches to Nightly and checks pre-releases at once; going back to Stable allows a downgrade', async () => {
    const fake = fakeUpdater({ version: '0.0.4-nightly.20261006.1' });
    const { updater } = setup(fake);
    updater.setChannel('nightly');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake).toMatchObject({ channel: 'nightly', allowPrerelease: true, allowDowngrade: false });
    expect(updater.state).toMatchObject({ channel: 'nightly', status: 'available', availableVersion: '0.0.4-nightly.20261006.1' });

    const onNightly = fakeUpdater({ version: '0.0.4' });
    const { updater: back } = setup(onNightly, { currentVersion: '0.0.4-nightly.20261006.1', channel: 'nightly' });
    back.setChannel('stable');
    await new Promise((r) => setTimeout(r, 0));
    expect(onNightly).toMatchObject({ channel: 'latest', allowPrerelease: false, allowDowngrade: true });
    expect(back.state.status).toBe('available');
  });

  it('points at the mock feed', async () => {
    const fake = fakeUpdater({ version: '0.0.3' });
    const { updater } = setup(fake, { mockFeedUrl: 'http://localhost:8484' });
    await updater.check();
    expect(fake.feed).toEqual({ provider: 'generic', url: 'http://localhost:8484' });
    expect(fake.forceDevUpdateConfig).toBe(true);
    expect(updater.state.status).toBe('up-to-date');
  });

  it('never loads electron-updater when turned off', async () => {
    let loaded = false;
    const updater = new Updater({
      currentVersion: '0.0.3',
      channel: 'stable',
      autoCheck: true,
      disabledReason: 'Updates are turned off in development builds.',
      markerFile: markerPath(),
      onState: () => {},
      beforeInstall: () => {},
      log: () => {},
      load: async () => ((loaded = true), fakeUpdater({ version: '9.9.9' })),
    });
    updater.start();
    updater.run('check');
    await updater.check();
    expect(loaded).toBe(false);
    expect(updater.state).toMatchObject({ status: 'disabled', disabledReason: 'Updates are turned off in development builds.' });
    updater.stop();
  });
});

describe('update marker', () => {
  it('says the update installed, or that it did not, once', () => {
    const file = markerPath();
    writeFileSync(file, JSON.stringify({ version: '0.0.4', at: 1000 }));
    expect(readUpdateMarker(file, '0.0.4', 2000)).toEqual({ updatedTo: '0.0.4', error: null });
    expect(existsSync(file)).toBe(false);
    expect(readUpdateMarker(file, '0.0.4', 2000)).toEqual({ updatedTo: null, error: null });
    writeFileSync(file, JSON.stringify({ version: '0.0.4', at: 1000 }));
    expect(readUpdateMarker(file, '0.0.3', 2000).error).toMatch(/v0\.0\.4 didn’t install/);
    writeFileSync(file, JSON.stringify({ version: '0.0.4', at: 1000 }));
    expect(readUpdateMarker(file, '0.0.4', 1000 + 60 * 60_000)).toEqual({ updatedTo: null, error: null });
    writeFileSync(file, 'not json');
    expect(readUpdateMarker(file, '0.0.4')).toEqual({ updatedTo: null, error: null });
  });
});
