import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, nativeTheme, shell } from 'electron';
import { IpcChannel, type RendererReadyReport } from '@switchboard/protocol/bridge';
import { EngineProcess } from './engineProcess.ts';
import { isTrashableSessionPath } from './trashGuard.ts';

const here = import.meta.dirname;
const smokeOutDir = process.env.SWITCHBOARD_SMOKE_OUT;

// The smoke test runs against a throwaway profile so it never touches real app data.
if (smokeOutDir) app.setPath('userData', mkdtempSync(join(tmpdir(), 'switchboard-smoke-')));

if (!app.requestSingleInstanceLock()) app.quit();

let engine: EngineProcess;

async function handleEngineRequest(message: unknown): Promise<unknown> {
  const request = message as { type?: unknown; id?: unknown; paths?: unknown } | null;
  if (request?.type !== 'trash' || typeof request.id !== 'number' || !Array.isArray(request.paths)) return undefined;
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const paths = request.paths.filter((p): p is string => typeof p === 'string');
  const refused = paths.filter((p) => !isTrashableSessionPath(p, configDir));
  if (refused.length > 0 || paths.length !== request.paths.length) {
    return { type: 'trash-result', id: request.id, error: `Refusing to move files outside Claude Code's projects folder: ${refused.join(', ')}` };
  }
  try {
    for (const path of paths) await shell.trashItem(path);
    return { type: 'trash-result', id: request.id };
  } catch (error) {
    return { type: 'trash-result', id: request.id, error: (error as Error).message };
  }
}

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
ipcMain.handle(IpcChannel.pickFolder, async (event, defaultPath: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for the new session',
    properties: ['openDirectory', 'createDirectory'],
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(IpcChannel.pickImage, async (event, defaultPath: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a project icon',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['svg', 'png', 'ico', 'jpg', 'jpeg', 'webp', 'gif'] }],
    ...(typeof defaultPath === 'string' ? { defaultPath } : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

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

/** Sets a React-controlled field the way a user would, so onChange fires (smoke test only). */
function setFieldValue(win: BrowserWindow, selector: string, value: string): Promise<unknown> {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
}

/**
 * Optional live step (SWITCHBOARD_SMOKE_LIVE_CWD): starts a real Haiku session
 * through the UI, approves its permission prompt and waits for the reply.
 */
async function runLiveSessionStep(win: BrowserWindow, cwd: string): Promise<string> {
  const click = (selector: string) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot = async (name: string) => writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
  await click('[data-new-session]');
  if (!(await waitInPage(win, `[...document.querySelectorAll('[data-folder-select] option')].some((o) => o.value === ${JSON.stringify(cwd)})`))) {
    return 'folder not offered';
  }
  await setFieldValue(win, '[data-folder-select]', cwd);
  await setFieldValue(win, '[data-model-select]', 'haiku');
  await setFieldValue(win, '[data-composer]', 'Run exactly this with the Bash tool: touch smoke-ui.txt — then reply with exactly: SMOKE OK');
  if (!(await waitInPage(win, "!document.querySelector('[data-composer-submit]').disabled"))) return 'submit stayed disabled';
  // Never start a session anywhere but the requested sandbox folder.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const chosen = await win.webContents.executeJavaScript("document.querySelector('[data-folder-select]').value");
  if (chosen !== cwd) return `aborted: folder field shows ${chosen}, not the sandbox`;
  await shot('new-session.png');
  await click('[data-composer-submit]');
  if (!(await waitInPage(win, "document.querySelector('[data-permission-allow]')", 60_000))) return 'no permission prompt';
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot('permission.png');
  await click('[data-permission-allow]');
  // The prompt itself contains the phrase, so only an assistant text item counts.
  const replied = "[...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => el.innerText.includes('SMOKE OK'))";
  if (!(await waitInPage(win, replied, 60_000))) return 'no reply';
  await new Promise((resolve) => setTimeout(resolve, 800));
  await shot('session.png');

  // Delete it again through the context menu; the transcript must land in the Trash.
  const sessionId = await win.webContents.executeJavaScript("document.querySelector('[data-current-session]')?.getAttribute('data-current-session')");
  if (!sessionId) return 'could not find the new session row';
  await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-session-id="${sessionId}"]');
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 }));
  })()`);
  if (!(await waitInPage(win, "[...document.querySelectorAll('[role=menuitem]')].some((b) => b.innerText.startsWith('Delete session'))", 5_000))) return 'no delete menu item';
  await win.webContents.executeJavaScript("[...document.querySelectorAll('[role=menuitem]')].find((b) => b.innerText.startsWith('Delete session')).click()");
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 5_000))) return 'no confirmation dialog';
  await shot('delete-confirm.png');
  await win.webContents.executeJavaScript("document.querySelector('[data-confirm]').click()");
  if (!(await waitInPage(win, `!document.querySelector('[data-session-id="${sessionId}"]') && !document.querySelector('[role=alertdialog]')`, 15_000))) {
    const message = await win.webContents.executeJavaScript("document.querySelector('[role=alertdialog]')?.innerText ?? ''");
    return `session row still there after delete ${message}`;
  }
  const trashed = existsSync(join(homedir(), '.Trash', `${sessionId}.jsonl`));
  return trashed ? 'ok' : 'deleted, but the transcript is not in ~/.Trash';
}

/**
 * Smoke test: first ready → screenshot, open the newest session and screenshot
 * its transcript, then kill the engine; second ready (after the automatic
 * restart + reconnect) → write results and quit.
 */
let crashedAt = 0;
let transcriptOpened = false;
let liveSession: string | null = null;
async function runSmokeStep(win: BrowserWindow | null): Promise<void> {
  if (!smokeOutDir || !win) return;
  mkdirSync(smokeOutDir, { recursive: true });
  if (readyReports.length === 1) {
    await waitInPage(win, "document.querySelector('[data-session-id]')", 5_000);
    writeFileSync(join(smokeOutDir, 'window.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-project-filter]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(join(smokeOutDir, 'projects.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-project-filter]')?.click()");
    await win.webContents.executeJavaScript("document.querySelector('[data-session-id]')?.click()");
    transcriptOpened = await waitInPage(win, "document.querySelector('[data-transcript-item]')");
    // Give the virtualiser a frame to measure and scroll to the end before capturing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(join(smokeOutDir, 'transcript.png'), (await win.webContents.capturePage()).toPNG());
    const liveCwd = process.env.SWITCHBOARD_SMOKE_LIVE_CWD;
    if (liveCwd) liveSession = await runLiveSessionStep(win, liveCwd).catch((error: Error) => `failed: ${error.message}`);
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
        liveSession,
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
    onRequest: handleEngineRequest,
    onRestarted: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.engineRestarted);
    },
  });
  engine.start();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (smokeOutDir) setTimeout(() => exitApp(2), process.env.SWITCHBOARD_SMOKE_LIVE_CWD ? 180_000 : 45_000).unref();
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
