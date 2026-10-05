import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, nativeTheme, shell } from 'electron';
import { IpcChannel, type RendererReadyReport } from '@switchboard/protocol/bridge';
import { EngineProcess } from './engineProcess.ts';
import type { AttentionEvent } from './attention.ts';
import { Notifier } from './notifier.ts';
import { isTrashableSessionPath } from './trashGuard.ts';

const here = import.meta.dirname;
const smokeOutDir = process.env.SWITCHBOARD_SMOKE_OUT;

// The smoke test runs against a throwaway profile so it never touches real app data.
if (smokeOutDir) app.setPath('userData', mkdtempSync(join(tmpdir(), 'switchboard-smoke-')));

if (!app.requestSingleInstanceLock()) app.quit();

let engine: EngineProcess;
let notifier: Notifier;
let focusedSession: string | null = null;
const recordedNotifications: Array<AttentionEvent & { suppressed: boolean }> = [];

ipcMain.on(IpcChannel.focusSession, (_event, sessionId: unknown) => {
  focusedSession = typeof sessionId === 'string' ? sessionId : null;
});

function openSession(sessionId: string): void {
  const win = BrowserWindow.getAllWindows()[0] ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send(IpcChannel.selectSession, sessionId);
}

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
  // Attach a red square through the attach button's file input, like picking a file.
  await win.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e03131';
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('[data-attach-input]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'square.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-composer]').closest('div').parentElement.querySelector('img')", 3_000))) return 'attached image not shown';
  await setFieldValue(win, '[data-composer]', 'Run exactly this with the Bash tool: touch smoke-ui.txt — then reply with the colour of the attached square in one word, followed by exactly: SMOKE OK');
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
  if (!(await waitInPage(win, "document.querySelector('[data-transcript-image] img')", 5_000))) return 'the attached image is not shown in the transcript';
  const colour = await win.webContents.executeJavaScript(
    "[...document.querySelectorAll('[data-item-kind=\"text\"]')].map((el) => el.innerText).find((t) => t.includes('SMOKE OK'))",
  );
  console.log(`[smoke] Claude about the attached image: ${JSON.stringify(colour)}`);

  // Slash commands: "/" opens the palette with the session's commands; pick /context with the keyboard.
  await win.webContents.executeJavaScript("document.querySelector('[data-composer]').focus()");
  await win.webContents.insertText('/');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-palette] [role=option]').length > 5", 15_000))) return 'slash palette did not open';
  const paletteCount = await win.webContents.executeJavaScript("document.querySelectorAll('[data-palette] [role=option]').length");
  await win.webContents.insertText('conte');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await shot('palette.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const composed = await win.webContents.executeJavaScript("document.querySelector('[data-composer]').value");
  if (!String(composed).startsWith('/context')) return `palette composed ${JSON.stringify(composed)}`;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => /Context Usage/i.test(el.innerText))", 30_000))) return '/context output not shown';
  console.log(`[smoke] palette showed ${paletteCount} commands; /context output rendered`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shot('slash-command.png');

  // Open the same session in the Claude Code TUI: it runs here, so the panel offers to stop it first.
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-open-claude-tui]')", 3_000))) return 'no terminal panel';
  await js("document.querySelector('[data-open-claude-tui]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-terminal-panel] button')].some((b) => b.innerText === 'Stop it here and open')", 5_000))) {
    return 'expected the stop-and-open choice for a session running here';
  }
  await js("[...document.querySelectorAll('[data-terminal-panel] button')].find((b) => b.innerText === 'Stop it here and open').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-terminal] textarea')", 10_000))) return 'Claude TUI did not open';
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await shot('claude-tui.png');
  // Close the TUI and give its process time to leave the registry, or delete would (rightly) refuse.
  await js("document.querySelector('[data-terminal-panel] [aria-label^=\"Close\"]')?.click()");
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 3_000));

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
let terminalOpened = false;
let actionRan = false;
let highlighted = false;
let rendering: Record<string, number> = {};

/** Adds a project action through the editor, runs it from the header and checks it opened a terminal tab. */
async function runActionStep(win: BrowserWindow): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-actions-menu]')?.click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[role=menuitem]')].some((b) => /action/i.test(b.innerText))", 3_000))) return false;
  await js("[...document.querySelectorAll('[role=menuitem]')].find((b) => /action/i.test(b.innerText)).click()");
  if (!(await waitInPage(win, "document.querySelector('[data-add-action]')", 3_000))) return false;
  await js("document.querySelector('[data-add-action]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-action-name]')", 3_000))) return false;
  await setFieldValue(win, '[data-action-name]', 'Smoke action');
  await setFieldValue(win, '[data-action-command]', 'echo "action ran on ${branch} in $PWD"');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await shot(win, 'action-editor.png');
  await js("document.querySelector('[data-save-action]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[role=dialog] li')].some((li) => li.innerText.includes('Smoke action'))", 3_000))) return false;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  if (!(await waitInPage(win, "document.querySelector('[data-action=\"smoke-action\"]') && !document.querySelector('[role=dialog]')", 3_000))) return false;
  await js("document.querySelector('[data-action=\"smoke-action\"]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-terminal-panel] button')].some((b) => b.innerText.includes('Smoke action'))", 5_000))) return false;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await shot(win, 'action.png');
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  return true;
}

async function shot(win: BrowserWindow, name: string): Promise<void> {
  writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
}

/** Opens the terminal panel on the open session, runs a harmless command and screenshots it. */
async function runTerminalStep(win: BrowserWindow): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-terminal-panel]')", 3_000))) return false;
  await js("document.querySelector('[data-new-terminal]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-terminal] textarea')", 5_000))) return false;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await js("document.querySelector('[data-terminal] textarea').focus()");
  await win.webContents.insertText('echo "terminal works: $TERM_PROGRAM" && pwd');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  writeFileSync(join(smokeOutDir!, 'terminal.png'), (await win.webContents.capturePage()).toPNG());
  // Leave the next run's panel closed again.
  await js("document.querySelector('[data-toggle-terminal]')?.click()");
  return true;
}
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
    terminalOpened = await runTerminalStep(win);
    actionRan = await runActionStep(win);
    // Diagnostics renders a sample through Shiki, which loads in its own chunks on first use.
    await win.webContents.executeJavaScript("[...document.querySelectorAll('footer button')].find((b) => b.title === 'Diagnostics')?.click()");
    highlighted = await waitInPage(win, "document.querySelector('[data-rendering-check] .shiki span[style*=\"--shiki\"]')", 5_000);
    await shot(win, 'diagnostics.png');
    await win.webContents.executeJavaScript("[...document.querySelectorAll('footer button')].find((b) => b.title === 'Diagnostics')?.click()");
    rendering = await win.webContents.executeJavaScript(
      "({ diffs: document.querySelectorAll('[data-diff]').length, highlighted: document.querySelectorAll('.shiki').length, codeBlocks: document.querySelectorAll('.code-block').length, todos: document.querySelectorAll('[data-todos]').length, images: document.querySelectorAll('[data-transcript-image] img').length })",
    );
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
        notifications: recordedNotifications,
        transcriptOpened,
        liveSession,
        terminalOpened,
        actionRan,
        highlighted,
        rendering,
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
  // Packaged builds take the icon from the bundle's icon.icns; in development, set it on the Dock.
  if (!app.isPackaged) app.dock?.setIcon(join(here, '../../build/icon.png'));
  app.setAboutPanelOptions({ applicationName: 'Switchboard', iconPath: join(here, '../../build/icon.png') });
  engine = new EngineProcess({
    entry: join(here, 'engine.js'),
    dataDir: app.getPath('userData'),
    onRequest: handleEngineRequest,
    onRestarted: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.engineRestarted);
      notifier.connect();
    },
  });
  engine.start();
  notifier = new Notifier({
    engine,
    window: () => BrowserWindow.getAllWindows()[0],
    focusedSession: () => focusedSession,
    openSession,
    ...(smokeOutDir ? { record: (event: AttentionEvent & { suppressed: boolean }) => void recordedNotifications.push(event) } : {}),
  });
  notifier.connect();
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
