import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, MessageChannelMain, nativeTheme, shell } from 'electron';
import { IpcChannel, type RendererReadyReport } from '@switchboard/protocol/bridge';
import { EngineProcess } from './engineProcess.ts';

const here = import.meta.dirname;
const smokeOutDir = process.env.SWITCHBOARD_SMOKE_OUT;

// The smoke test runs against a throwaway profile so it never touches real app data.
if (smokeOutDir) app.setPath('userData', mkdtempSync(join(tmpdir(), 'switchboard-smoke-')));

if (!app.requestSingleInstanceLock()) app.quit();

let engine: EngineProcess;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151517' : '#fbfbfa',
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // The renderer is a local app: links open in the browser, never inside the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

/** Each request gets a fresh channel: one end to the engine, the other to the asking window. */
ipcMain.on(IpcChannel.requestEnginePort, (event) => {
  const { port1, port2 } = new MessageChannelMain();
  engine.connect(port1);
  event.sender.postMessage(IpcChannel.enginePort, null, [port2]);
});

/** Stops the engine supervisor first: app.exit() skips will-quit, and the supervisor would otherwise restart it. */
function exitApp(code: number): void {
  engine?.stop();
  app.exit(code);
}

interface TimedReport extends RendererReadyReport {
  /** ms from process start until the UI could talk to the engine. */
  connectedMs: number;
  /** ms from process start until the full diagnostics (shell env, claude version) were loaded. */
  loadedMs: number;
}
const readyReports: TimedReport[] = [];
ipcMain.on(IpcChannel.rendererReady, (event, report: RendererReadyReport) => {
  const timed: TimedReport = {
    ...report,
    connectedMs: Math.round(report.connectedAt - performance.timeOrigin),
    loadedMs: Math.round(performance.now()),
  };
  readyReports.push(timed);
  if (readyReports.length === 1) {
    console.log(`[main] engine connected ${timed.connectedMs}ms, diagnostics loaded ${timed.loadedMs}ms after process start`);
  }
  if (smokeOutDir) void runSmokeStep(BrowserWindow.fromWebContents(event.sender));
});

/** Polls a condition in the renderer (smoke test only). */
async function waitInPage(win: BrowserWindow, expression: string, timeoutMs = 10_000): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Smoke test: first ready → screenshot, open the newest session and screenshot
 * its transcript, then kill the engine; second ready (after the automatic
 * restart + reconnect) → write results and quit.
 */
let crashedAt = 0;
let transcriptOpened = false;
async function runSmokeStep(win: BrowserWindow | null): Promise<void> {
  if (!smokeOutDir || !win) return;
  mkdirSync(smokeOutDir, { recursive: true });
  if (readyReports.length === 1) {
    await waitInPage(win, "document.querySelector('[data-session-id]')", 5_000);
    writeFileSync(join(smokeOutDir, 'window.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-session-id]')?.click()");
    transcriptOpened = await waitInPage(win, "document.querySelector('[data-transcript-item]')");
    // Give the virtualiser a frame to measure and scroll to the end before capturing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(join(smokeOutDir, 'transcript.png'), (await win.webContents.capturePage()).toPNG());
    crashedAt = performance.now();
    engine.crash();
    return;
  }
  writeFileSync(
    join(smokeOutDir, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        connectedMs: readyReports[0]!.connectedMs,
        loadedMs: readyReports[0]!.loadedMs,
        restartRecoveryMs: Math.round(performance.now() - crashedAt),
        sessionCount: readyReports[0]!.sessionCount,
        transcriptOpened,
        reports: readyReports,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      },
      null,
      2,
    ),
  );
  exitApp(0);
}

app.whenReady().then(() => {
  engine = new EngineProcess({
    entry: join(here, 'engine.js'),
    dataDir: app.getPath('userData'),
    onRestarted: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.engineRestarted);
    },
  });
  engine.start();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (smokeOutDir) setTimeout(() => exitApp(2), 45_000).unref();
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => engine?.stop());
