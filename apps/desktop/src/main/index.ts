import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, MessageChannelMain, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import { IpcChannel, sanitizePreferences, type AppInfo, type DeepLinkMessage, type RendererReadyReport, type UpdateCommand } from '@switchboard/protocol/bridge';
import { EngineProcess } from './engineProcess.ts';
import type { AttentionEvent } from './attention.ts';
import { DEEP_LINK_SCHEME, linkFromArgv, parseDeepLink } from './deepLink.ts';
import { Notifier } from './notifier.ts';
import { PreferencesStore, windowBackground } from './preferences.ts';
import { QuitGuard } from './quitGuard.ts';
import { isConfigDir, isTrashableRepoFile, isTrashableSessionPath } from './trashGuard.ts';
import { Updater } from './updater.ts';
import { updatesDisabledReason } from './updateState.ts';

const here = import.meta.dirname;
const smokeOutDir = process.env.SWITCHBOARD_SMOKE_OUT;

// `Switchboard --version` prints the version for scripts and support, before any window opens.
if (process.argv.includes('--version')) {
  process.stdout.write(`${app.getVersion()}\n`);
  app.exit(0);
}

/** The running build. The commit is baked in at build time (electron.vite.config.ts). */
const appInfo: AppInfo = { version: app.getVersion(), commit: __SWITCHBOARD_COMMIT__ || null, dev: !app.isPackaged };
ipcMain.on(IpcChannel.getAppInfo, (event) => {
  event.returnValue = appInfo;
});

// The smoke test runs against a throwaway profile so it never touches real app data.
if (smokeOutDir) app.setPath('userData', mkdtempSync(join(tmpdir(), 'switchboard-smoke-')));

if (!app.requestSingleInstanceLock()) app.quit();

// SWITCHBOARD_COLOR_SCHEME=light|dark forces a scheme without saving it (to check both in the smoke test).
const forcedScheme = process.env.SWITCHBOARD_COLOR_SCHEME;
const preferences = new PreferencesStore(join(app.getPath('userData'), 'preferences.json'), sanitizePreferences({ colorScheme: forcedScheme }).colorScheme);
// The smoke steps need sessions to click; on the real ~/.claude most were started elsewhere.
if (smokeOutDir) preferences.update({ sessionScope: 'all' });

// SWITCHBOARD_MOCK_UPDATES=1 points the updater at a local feed (scripts/mock-update-server.ts).
const mockFeedUrl = process.env.SWITCHBOARD_MOCK_UPDATES === '1' ? (process.env.SWITCHBOARD_MOCK_UPDATES_URL ?? 'http://localhost:8484') : undefined;
const updater = new Updater({
  currentVersion: app.getVersion(),
  channel: preferences.get().updateChannel,
  autoCheck: preferences.get().autoUpdate,
  disabledReason: updatesDisabledReason({
    env: process.env,
    packaged: app.isPackaged,
    devServer: Boolean(process.env.ELECTRON_RENDERER_URL),
    hasFeed: app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),
    mockFeed: Boolean(mockFeedUrl),
  }),
  markerFile: join(app.getPath('userData'), 'update-marker.json'),
  ...(mockFeedUrl ? { mockFeedUrl } : {}),
  onState: (state) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.updateState, state);
  },
  beforeInstall: () => engine?.stop(),
  log: (message) => console.log(`[updater] ${message}`),
});
ipcMain.on(IpcChannel.getUpdateState, (event) => {
  event.returnValue = updater.state;
});
ipcMain.on(IpcChannel.updateCommand, (_event, command: unknown) => {
  if (command === 'check' || command === 'download' || command === 'install' || command === 'retry' || command === 'dismiss') updater.run(command satisfies UpdateCommand);
});

/** Applies a change from any window or the menu bar, and tells every window. */
function updatePreferences(patch: unknown): void {
  const next = preferences.update(patch);
  updater.setAutoCheck(next.autoUpdate);
  updater.setChannel(next.updateChannel);
  const item = Menu.getApplicationMenu()?.getMenuItemById(`scheme-${next.colorScheme}`);
  if (item) item.checked = true;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.preferencesChanged, next);
}

ipcMain.on(IpcChannel.getPreferences, (event) => {
  event.returnValue = preferences.get();
});
ipcMain.on(IpcChannel.setPreferences, (_event, patch: unknown) => updatePreferences(patch));
// Keep the area behind the page in step (resizing shows it briefly).
nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(windowBackground());
});

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
  const request = message as { type?: unknown; id?: unknown; paths?: unknown; repoRoot?: unknown; configDir?: unknown } | null;
  if (request?.type !== 'trash' || typeof request.id !== 'number' || !Array.isArray(request.paths)) return undefined;
  // Each Claude profile has its own config folder; session files must be inside its projects folder.
  const configDir = isConfigDir(request.configDir) ? request.configDir : process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const paths = request.paths.filter((p): p is string => typeof p === 'string');
  // Session files, or (for a git revert) new files inside the repository being reverted.
  const repoRoot = typeof request.repoRoot === 'string' ? request.repoRoot : null;
  const refused = paths.filter((p) => (repoRoot ? !isTrashableRepoFile(p, repoRoot) : !isTrashableSessionPath(p, configDir)));
  if (refused.length > 0 || paths.length !== request.paths.length) {
    const where = repoRoot ? `the repository ${repoRoot}` : "Claude Code's projects folder";
    return { type: 'trash-result', id: request.id, error: `Refusing to move files outside ${where}: ${refused.join(', ')}` };
  }
  try {
    for (const path of paths) await shell.trashItem(path);
    return { type: 'trash-result', id: request.id };
  } catch (error) {
    return { type: 'trash-result', id: request.id, error: (error as Error).message };
  }
}

/** Windows whose renderer is up and can show the quit prompt. */
const readyRenderers = new Set<number>();
let quitRecorded = false;

const quitGuard = new QuitGuard({
  ask() {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && readyRenderers.has(win.webContents.id)) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(IpcChannel.quitRequested);
      return;
    }
    // No window to ask in (all closed, or still loading): ask natively. This is the one prompt that stays
    // system UI on purpose, since there is no renderer to draw the themed one in.
    void dialog
      .showMessageBox({ type: 'question', message: 'Quit Switchboard?', detail: 'Sessions running in Switchboard will stop.', buttons: ['Quit', 'Cancel'], defaultId: 0, cancelId: 1 })
      .then(({ response }) => quitGuard.answer(response === 0 ? 'quit' : 'cancel'));
  },
  quit: () => quitApp(),
});

ipcMain.on(IpcChannel.quitAnswer, (_event, answer: unknown) => {
  if (answer === 'quit' || answer === 'cancel') quitGuard.answer(answer);
});

/** Links that arrived before a window could take them: one that launched the app, or one during an engine restart. */
const pendingLinks: DeepLinkMessage[] = [];

/**
 * Opens a `switchboard://` link. It is validated here, then handed to the window, which fills in New
 * session (never sends) or shows the session. A refused link only shows why.
 */
function openDeepLink(url: string): void {
  const parsed = parseDeepLink(url);
  const message: DeepLinkMessage = parsed.ok ? { link: parsed.link } : { error: parsed.error };
  console.log(`[main] link: ${parsed.ok ? parsed.link.action : `refused (${parsed.error})`}`);
  if (!app.isReady()) {
    pendingLinks.push(message);
    return;
  }
  const win = BrowserWindow.getAllWindows()[0] ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (readyRenderers.has(win.webContents.id)) win.webContents.send(IpcChannel.deepLink, message);
  else pendingLinks.push(message);
}

// The smoke test checks quitting without ending its own run.
const quitApp = () => (smokeOutDir ? (quitRecorded = true) : app.quit());

function openSettings(section: 'about' | null = null): void {
  const win = BrowserWindow.getAllWindows()[0] ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send(IpcChannel.openSettings, section);
}

/** Switchboard → Check for Updates…: checks, and opens Settings → About where the result shows. */
function checkForUpdates(): void {
  updater.run('check');
  openSettings('about');
}

/** The standard macOS menu, except that ⌘Q goes through the quit guard. */
function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Switchboard',
      submenu: [
        { role: 'about' },
        { id: 'check-updates', label: 'Check for Updates…', click: () => checkForUpdates() },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { id: 'quit', label: 'Quit Switchboard', accelerator: 'CmdOrCtrl+Q', click: () => (preferences.get().confirmQuit ? quitGuard.request() : quitApp()) },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: (['system', 'light', 'dark'] as const).map((scheme) => ({
            id: `scheme-${scheme}`,
            label: scheme === 'system' ? 'Match System' : scheme === 'light' ? 'Light' : 'Dark',
            type: 'radio' as const,
            checked: preferences.get().colorScheme === scheme,
            click: () => updatePreferences({ colorScheme: scheme }),
          })),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  const contentsId = win.webContents.id;
  win.webContents.on('did-start-loading', () => readyRenderers.delete(contentsId));
  win.webContents.on('render-process-gone', () => readyRenderers.delete(contentsId));
  win.on('closed', () => readyRenderers.delete(contentsId));

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

/** The smoke run has no one to answer a file dialog: it exports to (and previews) a file in its throwaway profile. */
const smokeSettingsFile = () => join(app.getPath('userData'), 'smoke-settings-export.json');

ipcMain.handle(IpcChannel.chooseExportFile, async (event, defaultName: unknown) => {
  if (smokeOutDir) return smokeSettingsFile();
  const win = BrowserWindow.fromWebContents(event.sender);
  const name = typeof defaultName === 'string' && /^[\w.-]+\.json$/.test(defaultName) ? defaultName : 'switchboard-settings.json';
  const options: Electron.SaveDialogOptions = {
    title: 'Export Switchboard settings',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Switchboard settings', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath.toLowerCase().endsWith('.json') ? result.filePath : `${result.filePath}.json`;
});

ipcMain.handle(IpcChannel.chooseImportFile, async (event) => {
  if (smokeOutDir) return smokeSettingsFile();
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Import Switchboard settings',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Switchboard settings', extensions: ['json'] }],
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
  readyRenderers.add(event.sender.id);
  for (const message of pendingLinks.splice(0)) event.sender.send(IpcChannel.deepLink, message);
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

/** Picks an option in one of the app's `Select` dropdowns by clicking, like a user (smoke test only). */
async function chooseOption(win: BrowserWindow, selector: string, value: string): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const option = `document.querySelector('[data-select-list] [data-option-value=${JSON.stringify(JSON.stringify(value)).slice(1, -1)}]')`;
  if (!(await waitInPage(win, option, 3_000))) return false;
  await js(`${option}.click()`);
  return waitInPage(win, `!document.querySelector('[data-select-list]') && document.querySelector(${JSON.stringify(selector)}).dataset.value === ${JSON.stringify(value)}`, 3_000);
}

/**
 * Optional live step (SWITCHBOARD_SMOKE_LIVE_CWD): starts a real Haiku session
 * through the UI, approves its permission prompt and waits for the reply.
 */
async function runLiveSessionStep(win: BrowserWindow, cwd: string): Promise<string> {
  const click = (selector: string) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot = async (name: string) => writeFileSync(join(smokeOutDir!, name), (await win.webContents.capturePage()).toPNG());
  await click('[data-new-session]');
  // Pick the sandbox in the folder picker: open it, filter by the path, choose the match.
  await click('[data-folder-select]');
  if (!(await waitInPage(win, "document.querySelector('[data-folder-list] input')", 3_000))) return 'folder picker did not open';
  await setFieldValue(win, '[data-folder-list] input', cwd);
  if (!(await waitInPage(win, `document.querySelector('[data-folder-option=${JSON.stringify(JSON.stringify(cwd)).slice(1, -1)}]')`, 5_000))) return 'folder not offered';
  await shot('folder-picker.png');
  await win.webContents.executeJavaScript(`document.querySelector('[data-folder-option=${JSON.stringify(JSON.stringify(cwd)).slice(1, -1)}]').click()`);
  await click('[data-model-select]');
  if (!(await waitInPage(win, "document.querySelector('[data-menu=\"model\"] [data-choice=\"haiku\"]')", 3_000))) return 'Haiku not offered in the model menu';
  await click('[data-menu="model"] [data-choice="haiku"]');
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
  const chosen = await win.webContents.executeJavaScript("document.querySelector('[data-folder-select]').dataset.value");
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
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const liveId = (await js("document.querySelector('[data-current-session]').dataset.currentSession")) as string;

  // An agent: the header shows "1 agent" while it runs, and the dialog shows what it's doing.
  // The prompt has inline code, so the user bubble must render it as code.
  await setFieldValue(win, '[data-composer]', 'Use the Agent tool (subagent_type `general-purpose`) to list the files in this folder with the Glob tool and count them. Then reply with exactly: AGENT OK');
  await js("document.querySelector('[data-composer-submit]').click()");
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-item-kind=\"user\"] code')].some((c) => c.innerText === 'general-purpose')", 10_000))) return 'inline code in your message is not styled';
  if (!(await waitInPage(win, "document.querySelector('[data-agents-button]')", 60_000))) return 'no agents pill while the agent ran';
  const pill = ((await js("document.querySelector('[data-agents-button]').innerText")) as string).trim();
  await js("document.querySelector('[data-agents-button]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-agents] [data-agent-run]')", 5_000))) return 'agents dialog empty';
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await shot('agents.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => el.innerText.includes('AGENT OK'))", 90_000))) return 'no reply after the agent';
  if (!(await waitInPage(win, "!document.querySelector('[data-agents-button]')", 5_000))) return 'the agents pill stayed after the agent finished';
  console.log(`[smoke] agents pill showed ${JSON.stringify(pill)} and its run; your inline code was styled`);

  // Tools, live: the session runs here, so its MCP servers can be switched.
  await js("document.querySelector('[data-open-tools]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-capabilities]')?.innerText.includes('Live from this session')", 20_000))) return 'Tools did not answer live';
  const switches = await js("document.querySelectorAll('[data-capabilities] [role=switch]').length");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await waitInPage(win, "!document.querySelector('[data-capabilities]')", 2_000);

  // Effort can change mid-session, and the context meter opens a breakdown like /context.
  if (!(await chooseOption(win, '[data-effort-select]', 'low'))) return 'effort did not change';
  await chooseOption(win, '[data-effort-select]', '');
  if (!(await waitInPage(win, "document.querySelector('[data-context-meter] button')", 15_000))) return 'no context meter for the running session';
  const contextLabel = ((await js("document.querySelector('[data-context-meter] button').innerText")) as string).trim();
  await js("document.querySelector('[data-context-meter] button').click()");
  if (!(await waitInPage(win, "document.querySelectorAll('[data-context-breakdown] li').length > 1", 15_000))) return 'context breakdown did not load';
  const categories = (await js("document.querySelectorAll('[data-context-breakdown] li').length")) as number;
  await shot('context.png');
  await js("document.querySelector('[data-context-meter] button').click()");
  console.log(`[smoke] effort changed to low and back; context ${JSON.stringify(contextLabel)} with ${categories - 1} categories`);

  // Undo file changes since the prompt: the preview answers (Bash's touch isn't a tracked edit).
  await js("document.querySelector('[data-item-kind=\"user\"] [data-message-actions] button[aria-label^=\"Undo file changes\"]').click()");
  if (!(await waitInPage(win, "document.querySelector('[role=alertdialog]') && !document.querySelector('[role=alertdialog]').innerText.includes('Checking what changed')", 20_000))) return 'rewind preview did not answer';
  const rewindPreview = ((await js("document.querySelector('[role=alertdialog]').innerText")) as string).replace(/\s+/g, ' ').slice(0, 120);
  await shot('rewind.png');
  await js("[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText === 'Cancel').click()");

  // Fork from Claude's reply: a new session opens with the conversation up to there.
  await js("[...document.querySelectorAll('[data-item-kind=\"text\"]')].find((el) => el.innerText.includes('SMOKE OK')).querySelector('[data-message-actions] button').click()");
  if (!(await waitInPage(win, `document.querySelector('[data-current-session]') && document.querySelector('[data-current-session]').dataset.currentSession !== '${liveId}' && [...document.querySelectorAll('[data-item-kind=\"text\"]')].some((el) => el.innerText.includes('SMOKE OK'))`, 20_000))) {
    return 'fork from the reply did not open a new session with the conversation';
  }
  console.log(`[smoke] live tools: ${switches} MCP switches; rewind preview: ${JSON.stringify(rewindPreview)}; forked from the reply`);
  await js(`document.querySelector('[data-session-id="${liveId}"]').click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${liveId}"]')`, 5_000))) return 'could not return to the session after forking';

  // Open the same session in the Claude Code TUI: it runs here, so the panel offers to stop it first.
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
/** The session the smoke steps work in (the newest one with messages). */
let smokeSessionId: string | null = null;
let liveSession: string | null = null;
let terminalOpened = false;
let actionRan = false;
let highlighted = false;
let usageBand: string | null = null;
let quitGuarded = false;
let settingsResult = 'not run';
let transcriptAtBottom: number | null = null;
let activity: { groups: number; steps: number; label: string } | null = null;
let changesPanel: string = 'not run';
let searchResult = 'not run';
let paletteResult = 'not run';
let toolsResult = 'not run';
let splitResult = 'not run';
let settleResult = 'not run';
let dropResult = 'not run';
let controlsResult = 'not run';
let projectsResult = 'not run';
let profilesResult = 'not run';
let aboutResult = 'not run';
let backupResult = 'not run';
let newSessionResult = 'not run';
let deepLinkResult = 'not run';
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
/** ⌘Q asks first; Cancel keeps the app open; a second ⌘Q while asking quits (recorded, not performed, in smoke mode). */
async function runQuitStep(win: BrowserWindow): Promise<boolean> {
  const pressQuit = () => Menu.getApplicationMenu()?.getMenuItemById('quit')?.click();
  const prompt = "[...document.querySelectorAll('[role=alertdialog]')].find((el) => el.innerText.includes('Quit Switchboard'))";
  pressQuit();
  if (!(await waitInPage(win, prompt, 3_000))) return false;
  await shot(win, 'quit.png');
  await win.webContents.executeJavaScript(`[...${prompt}.querySelectorAll('button')].find((b) => b.innerText === 'Cancel').click()`);
  if (!(await waitInPage(win, `!${prompt}`, 3_000)) || quitRecorded || quitGuard.asking) return false;
  pressQuit();
  if (!(await waitInPage(win, prompt, 3_000))) return false;
  pressQuit();
  const quitOnSecondPress = quitRecorded && !quitGuard.asking;
  quitRecorded = false;
  // A real second press ends the app; here the prompt is still up, so dismiss it (a late answer is ignored).
  await win.webContents.executeJavaScript(`[...${prompt}.querySelectorAll('button')].find((b) => b.innerText === 'Cancel').click()`);
  return quitOnSecondPress && !quitRecorded && (await waitInPage(win, `!${prompt}`, 3_000));
}

/**
 * Drives the Settings view: theme (the page and the menu bar follow), sidebar style (row heights
 * change), and turning off the quit prompt. Everything must be saved, then is put back.
 */
async function runSettingsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const background = 'getComputedStyle(document.body).backgroundColor';
  const rowHeight = "document.querySelector('[data-session-id]').offsetHeight";
  const pause = () => new Promise((resolve) => setTimeout(resolve, 300));

  const section = async (id: string) => {
    await click(`[data-settings-section="${id}"]`);
    return waitInPage(win, `document.querySelector('[data-settings-page="${id}"]')`, 2_000);
  };
  // The sidebar lists Settings' sections while it is open, so session rows are checked with it closed.
  const withSettingsClosed = async (check: string) => {
    await click('[data-close-settings]');
    const ok = await waitInPage(win, `!document.querySelector('[data-settings]') && ${check}`, 2_000);
    await click('[data-open-settings]');
    await waitInPage(win, "document.querySelector('[data-settings]')", 2_000);
    return ok;
  };

  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings]') && document.querySelector('[data-settings-nav]') && !document.querySelector('[data-session-list]')", 3_000))) return 'settings did not open with its sections in the sidebar';
  if (!(await section('theme'))) return 'the Theme section did not open';
  await click('[data-color-scheme="light"]');
  if (!(await waitInPage(win, `${background} === 'rgb(255, 255, 255)'`, 2_000))) return 'Light did not apply';
  if (!(await section('sidebar'))) return 'the Sidebar section did not open';
  await click('[data-sidebar-style="large"]');
  if (!(await withSettingsClosed(`${rowHeight} === 66 && [...document.querySelectorAll('[data-session-id] > *')].some((el) => el.offsetWidth === 34)`))) return 'Large icons did not apply';
  await pause();
  await shot(win, 'settings-light.png');
  await section('theme');
  await click('[data-color-scheme="dark"]');
  if (!(await waitInPage(win, `${background} === 'rgb(21, 24, 31)'`, 2_000))) return 'Dark did not apply';
  await section('sidebar');
  await click('[data-sidebar-style="compact"]');
  if (!(await withSettingsClosed(`${rowHeight} === 32`))) return 'Compact did not apply';
  await pause();
  await shot(win, 'settings-dark.png');

  // The close button leaves Settings; opening it again returns to the same section.
  await section('conversation');
  await click('[data-tool-activity="steps"]');
  await pause();
  await click('[data-close-settings]');
  const everyStep = await waitInPage(win, "!document.querySelector('[data-settings]') && !document.querySelector('[data-activity]') && document.querySelector('[data-tool]')", 3_000);
  await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"conversation\"]')", 3_000))) return 'settings did not reopen on the same section';
  if (!everyStep) return 'Every step did not show the tool cards, or Close did not leave Settings';

  // Turning off "sessions from other apps" leaves only Switchboard's own in the sidebar.
  await section('sidebar');
  await click('[data-session-scope]');
  const scoped = await withSettingsClosed("document.querySelector('[data-session-list]') && !document.querySelector('[data-session-id][data-in-app=\"false\"]')");
  await section('sidebar');

  await section('general');
  await click('[data-startup-view="new"]');
  await click('[data-confirm-quit]');
  await pause();
  Menu.getApplicationMenu()?.getMenuItemById('quit')?.click();
  const quitWithoutAsking = quitRecorded && !quitGuard.asking;
  quitRecorded = false;
  const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as Record<string, unknown>;
  const menuChecked = Menu.getApplicationMenu()?.getMenuItemById('scheme-dark')?.checked === true;

  await click('[data-confirm-quit]');
  await click('[data-startup-view="last"]');
  await section('sidebar');
  await click('[data-session-scope]');
  await click('[data-sidebar-style="standard"]');
  await section('theme');
  await click('[data-color-scheme="system"]');
  await section('conversation');
  await click('[data-tool-activity="summary"]');
  await pause();
  const restored = preferences.get();
  if (!scoped) return 'other apps\' sessions stayed in the sidebar with the setting off';
  if (!quitWithoutAsking) return '⌘Q still asked with the prompt turned off';
  if (saved.colorScheme !== 'dark' || saved.sidebarStyle !== 'compact' || saved.toolActivity !== 'steps' || saved.confirmQuit !== false || saved.sessionScope !== 'switchboard' || saved.startupView !== 'new') return `not saved: ${JSON.stringify(saved)}`;
  if (!menuChecked) return 'View → Appearance did not follow';
  if (restored.colorScheme !== 'system' || restored.sidebarStyle !== 'standard' || restored.toolActivity !== 'summary' || !restored.confirmQuit || restored.sessionScope !== 'all' || restored.startupView !== 'last') return 'could not restore the defaults';
  // Escape closes Settings too.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-settings]')", 2_000))) return 'Escape did not close Settings';
  return 'ok';
}

/**
 * Projects are added by hand: the throwaway profile starts with none, the Add project dialog offers the
 * folders Claude Code has sessions for, and a project's defaults reach the New session view. Only the
 * throwaway profile's own project list changes (nothing on disk); the project is removed again at the end.
 */
async function runProjectsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-sidebar-onboarding]')", 3_000))) return 'a new profile did not offer to add a project';
  await click('[data-open-projects]');
  if (!(await waitInPage(win, "document.querySelector('[data-project-manager] [data-no-projects]')", 3_000))) return 'the Projects view did not open empty';
  await click('[data-manager-add]');
  if (!(await waitInPage(win, "document.querySelector('[data-add-project-dialog] [data-known-project]')", 5_000))) return 'no folders with sessions offered';
  const known = (await js("document.querySelectorAll('[data-known-project]').length")) as number;
  const root = (await js("document.querySelector('[data-known-project][data-added=\"false\"]')?.dataset.knownProject ?? null")) as string | null;
  if (!root) return 'every offered folder was already a project';
  const rowSelector = `[data-project-row=${JSON.stringify(root)}]`;
  const row = (selector = '') => `document.querySelector(${JSON.stringify(selector ? `${rowSelector} ${selector}` : rowSelector)})`;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'add-project.png');
  await click(`[data-known-project=${JSON.stringify(root)}]`);
  if (!(await waitInPage(win, "document.querySelector('[data-known-project][data-added=\"true\"]')", 3_000))) return 'the folder was not marked as added';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, `!document.querySelector('[data-add-project-dialog]') && ${row()} && !document.querySelector('[data-sidebar-onboarding]')`, 3_000))) return 'the project did not appear in the list';

  await js(`${row('[data-project-toggle]')}.click()`);
  if (!(await waitInPage(win, `${row('[data-default-effort]')}`, 3_000))) return 'the defaults editor did not open';
  // Themed dropdown: open with a click, ↓ moves, Escape closes and focus returns.
  const modelSelect = `${rowSelector} [data-default-model]`;
  await js(`document.querySelector(${JSON.stringify(modelSelect)}).click()`);
  if (!(await waitInPage(win, `document.querySelectorAll('[data-select-list] [role=option]').length > 1 && document.querySelector(${JSON.stringify(modelSelect)}).getAttribute('aria-expanded') === 'true'`, 3_000))) return 'the model dropdown did not open';
  const before = (await js("document.querySelector('[data-select-list]').getAttribute('aria-activedescendant')")) as string;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = (await js("document.querySelector('[data-select-list]').getAttribute('aria-activedescendant')")) as string;
  await shot(win, 'select.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, `!document.querySelector('[data-select-list]') && document.activeElement?.matches(${JSON.stringify(modelSelect)})`, 2_000))) return 'Escape did not close the dropdown';
  if (before === after) return '↓ did not move in the dropdown';
  if (!(await waitInPage(win, `${row('[data-default-model]')}.dataset.value === ''`, 1_000))) return 'Escape changed the model default';
  if (!(await chooseOption(win, `${rowSelector} [data-default-effort]`, 'high'))) return 'could not pick an effort default';
  if (!(await waitInPage(win, `${row('[data-defaults-summary]')}.innerText.includes('high effort')`, 3_000))) return 'the effort default was not saved';
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'projects.png');

  // A new session in the project starts from its defaults; a change there can be saved back.
  await click('[data-new-session]');
  const pickedEffort = "document.querySelector('[data-effort-dial] [aria-checked=\"true\"]')?.dataset.effort";
  if (!(await waitInPage(win, `document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(root)} && ${pickedEffort} === 'high'`, 5_000))) {
    return `New session did not start from the project's defaults (${String(await js(`document.querySelector('[data-folder-select]')?.dataset.value + ' ' + ${pickedEffort}`))})`;
  }
  await click('[data-effort="low"]');
  if (!(await waitInPage(win, "document.querySelector('[data-save-project-defaults]')", 3_000))) return 'no Save as project default after a change';
  await click('[data-save-project-defaults]');
  if (!(await waitInPage(win, "!document.querySelector('[data-save-project-defaults]')", 3_000))) return 'Save as project default did not save';

  await click('[data-open-projects]');
  if (!(await waitInPage(win, `${row('[data-defaults-summary]')}?.innerText.includes('low effort')`, 3_000))) return 'the saved default did not reach the Projects view';
  await js(`${row('[data-remove-project]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000))) return 'no confirmation before removing';
  await click('[data-confirm]');
  if (!(await waitInPage(win, "document.querySelector('[data-no-projects]')", 3_000))) return 'the project was not removed';
  await click('[data-open-projects]');
  return `ok: ${known} folders offered; added one, dropdown keyboard and Escape, its defaults reached New session, saved a change back, removed it`;
}

/**
 * Claude profiles: with one, nothing about profiles shows outside Settings. Adding a second (a config
 * folder inside the throwaway app profile, never a real one) marks sessions with their profile and
 * offers a choice in New session; it becomes the default, then is removed again.
 */
async function runProfilesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const folder = join(app.getPath('userData'), 'smoke-claude-work');
  if (await js("!!document.querySelector('[data-profile-badge]')")) return 'profile badges shown with a single profile';
  await click('[data-open-settings]');
  await click('[data-settings-section="profiles"]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 1", 3_000))) return 'Settings did not list the built-in profile';
  await click('[data-profile-guide-toggle]');
  if (!(await waitInPage(win, "document.querySelector('[data-profile-guide] ol')?.innerText.includes('CLAUDE_CONFIG_DIR=')", 2_000))) return 'the setup guide did not open';
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'profile-guide.png');
  await click('[data-profile-guide-toggle]');
  await click('[data-add-profile]');
  if (!(await waitInPage(win, "document.querySelector('[data-new-profile-folder]')", 3_000))) return 'the add profile form did not open';
  await setFieldValue(win, '[data-new-profile-name]', 'Smoke work');
  await setFieldValue(win, '[data-new-profile-folder]', folder);
  await click('[data-add-profile-submit]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 2", 5_000))) {
    return `the profile was not added (${String(await js("document.querySelector('[data-add-profile-form]')?.innerText ?? ''"))})`;
  }
  const id = (await js("document.querySelectorAll('[data-profiles] [data-profile]')[1].dataset.profile")) as string;
  const card = `[data-profile=${JSON.stringify(id)}]`;
  if (!(await js(`document.querySelector(${JSON.stringify(card)}).innerText.includes(${JSON.stringify(folder)})`))) return 'the sign-in command does not name the folder';
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'profiles.png');
  await click(`[data-profile-default=${JSON.stringify(id)}]`);
  await click('[data-close-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-session-id] [data-profile-badge]')", 3_000))) return 'sessions do not show their profile with two profiles';
  await click('[data-new-session]');
  if (!(await waitInPage(win, `document.querySelector('[data-profile-select]')?.dataset.value === ${JSON.stringify(id)}`, 5_000))) {
    return 'New session did not offer the profiles with the new default chosen';
  }
  await click('[data-profile-select]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-menu=\"profile\"] [role=menuitemradio]').length === 2", 3_000))) return 'the profile menu did not list both profiles';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });

  await click('[data-open-settings]');
  await click('[data-settings-section="profiles"]');
  if (!(await waitInPage(win, `document.querySelector(${JSON.stringify(`${card} [data-remove-profile]`)})`, 3_000))) return 'no way to remove the profile';
  await click(`${card} [data-remove-profile]`);
  if (!(await waitInPage(win, "document.querySelector('[data-confirm]')", 3_000))) return 'no confirmation before removing';
  await click('[data-confirm]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-profiles] [data-profile]').length === 1", 5_000))) return 'the profile was not removed';
  const builtinDefault = await js("document.querySelector('[data-profile-default=\"default\"]').getAttribute('aria-checked') === 'true'");
  await click('[data-close-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-session-id]') && !document.querySelector('[data-session-id] [data-profile-badge]')", 3_000))) return 'sessions still show a profile after removing it';
  if (!builtinDefault) return 'the built-in profile did not become the default again';
  return 'ok: added a second profile, sessions and New session showed it, made it the default, removed it';
}

/**
 * Settings → About shows the running version (matching app.getVersion()) and the update controls, and
 * Check for Updates… is in the app menu. Nothing is checked, downloaded or installed: the menu item is
 * only clicked when updates are turned off (as in an unpackaged build), where it just opens About.
 */
async function runAboutStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('check-updates');
  if (!menuItem) return 'no Check for Updates… in the app menu';
  const off = updater.state.status === 'disabled';
  if (off) menuItem.click();
  else {
    await js("document.querySelector('[data-open-settings]').click()");
    await waitInPage(win, "document.querySelector('[data-settings-section=\"about\"]')", 3_000);
    await js("document.querySelector('[data-settings-section=\"about\"]').click()");
  }
  if (!(await waitInPage(win, "document.querySelector('[data-settings-page=\"about\"] [data-about]')", 3_000))) return off ? 'Check for Updates… did not open Settings → About' : 'Settings → About did not open';
  const shown = (await js("document.querySelector('[data-app-version]')?.dataset.appVersion ?? null")) as string | null;
  if (shown !== app.getVersion()) return `About shows version ${shown}, the app is ${app.getVersion()}`;
  const navVersion = (await js("document.querySelector('[data-settings-version]')?.innerText ?? ''")) as string;
  if (app.isPackaged ? navVersion !== `v${app.getVersion()}` : !navVersion.startsWith('dev')) return `the Settings sidebar shows "${navVersion}"`;
  const controls = (await js(
    `['[data-check-updates]', '[data-auto-update]', '[data-update-channel="stable"][aria-checked=true]', '[data-update-channel="nightly"]', '[data-changelog-link]'].filter((s) => !document.querySelector(s))`,
  )) as string[];
  if (controls.length > 0) return `missing: ${controls.join(', ')}`;
  if (off) {
    const status = (await js("document.querySelector('[data-update-status]')?.innerText ?? ''")) as string;
    if (!(await js("document.querySelector('[data-update-status=\"disabled\"]') && document.querySelector('[data-check-updates]').disabled"))) return 'updates are off but About does not say so';
    if (status !== updater.state.disabledReason) return `About says "${status}" instead of the reason updates are off`;
    if (await js("document.querySelector('[data-update-pill]')")) return 'the sidebar shows an update pill while updates are off';
  }
  // With the mock feed (scripts/mock-update-server.ts --fake <newer version>), check it once; never download.
  let mockCheck = '';
  if (mockFeedUrl) {
    await js("document.querySelector('[data-check-updates]').click()");
    if (!(await waitInPage(win, "['available', 'up-to-date', 'error'].includes(document.querySelector('[data-update-status]')?.dataset.updateStatus)", 10_000))) return 'the mock check did not finish';
    if (updater.state.status === 'error') return `the mock check failed: ${updater.state.error}`;
    if (updater.state.status === 'available' && !(await waitInPage(win, "document.querySelector('[data-update-pill=\"available\"]') && document.querySelector('[data-about-release-notes]')", 3_000))) {
      return 'an update was found but the sidebar pill or the release notes did not show';
    }
    mockCheck = `, mock feed: ${updater.state.status === 'available' ? `v${updater.state.availableVersion} offered, pill shown` : 'up to date'}`;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'about.png');
  await js("document.querySelector('[data-close-settings]').click()");
  return `ok: ${navVersion}${off ? `, updates off ("${updater.state.disabledReason}")` : `, updates ${updater.state.status}`}${mockCheck}`;
}

/**
 * Settings → Backup: exports to a file in the throwaway profile (main skips the save dialog in a smoke run)
 * and checks it parses, then opens the import preview of that file and cancels. Nothing is imported.
 */
async function runBackupStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const file = smokeSettingsFile();
  rmSync(file, { force: true });
  if (!(await js("Boolean(document.querySelector('[data-settings]'))"))) await click('[data-open-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-settings-section=\"backup\"]')", 3_000))) return 'Settings has no Backup section';
  await click('[data-settings-section="backup"]');
  if (!(await waitInPage(win, "document.querySelector('[data-backup-export]')", 2_000))) return 'the Backup section did not open';
  await click('[data-backup-export]');
  if (!(await waitInPage(win, "document.querySelector('[data-export-dialog] [data-export-section=\"sessions\"][aria-checked=\"false\"]')", 2_000))) return 'the export dialog did not open with sessions left out';
  await click('[data-export-settings]');
  if (!(await waitInPage(win, "document.querySelector('[data-export-saved]')", 5_000))) return 'the export did not finish';
  await shot(win, 'backup-export.png');
  let exported: Record<string, unknown>;
  try {
    exported = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return `the exported file does not parse: ${(error as Error).message}`;
  }
  if (exported.kind !== 'switchboard-settings' || exported.format !== 1) return `not a settings file: ${JSON.stringify(exported).slice(0, 200)}`;
  if (typeof exported.preferences !== 'object' || !Array.isArray(exported.projects) || typeof exported.actions !== 'object' || 'sessions' in exported) {
    return `unexpected sections: ${Object.keys(exported).join(', ')}`;
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-export-dialog]')", 2_000))) return 'Escape did not close the export dialog';

  // The preview of the file just exported: everything is already set up, so there is nothing to import.
  await click('[data-backup-import]');
  if (!(await waitInPage(win, "document.querySelector('[data-import-dialog] [data-import-preview]')", 5_000))) return 'the import preview did not open';
  await click('[data-import-mode="replace"]');
  const summary = (await js("document.querySelector('[data-import-summary]')?.textContent ?? ''")) as string;
  const disabled = (await js("document.querySelector('[data-import-settings]')?.disabled === true")) as boolean;
  await shot(win, 'backup-import.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  if (!(await waitInPage(win, "!document.querySelector('[data-import-dialog]') && document.querySelector('[data-settings]')", 2_000))) return 'Escape did not close only the import dialog';
  await click('[data-close-settings]');
  if (existsSync(join(app.getPath('userData'), 'backups'))) return 'a backup was written without importing';
  if (!disabled) return `importing the file just exported would change something: ${summary}`;
  return `ok (${summary})`;
}

/** Tool calls are summarised by default: open the last finished group and count its steps. */
async function runActivityStep(win: BrowserWindow): Promise<{ groups: number; steps: number; label: string } | null> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const groups = (await js("document.querySelectorAll('[data-activity]').length")) as number;
  if (groups === 0) return null;
  // The last finished group, or the live one when Claude is still on its first.
  const group = "([...document.querySelectorAll('[data-activity=\"done\"]')].at(-1) ?? [...document.querySelectorAll('[data-activity]')].at(-1))";
  const label = (await js(`${group}?.querySelector('button')?.innerText.replace(/\\s+/g, ' ') ?? ''`)) as string;
  await js(`${group}?.querySelector('button')?.click()`);
  await waitInPage(win, `${group}?.querySelector('[data-steps]')`, 2_000);
  await js(`${group}?.querySelector('[data-step] button')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'activity.png');
  const steps = (await js(`${group}?.querySelectorAll('[data-step]').length ?? 0`)) as number;
  await js(`${group}?.querySelector('[data-step] button')?.click()`);
  await js(`${group}?.querySelector('button')?.click()`);
  return { groups, steps, label };
}

/**
 * Read-only: opens the Changes panel on the session's real checkout, expands the first file's
 * diff and closes it again. Never stages or reverts (this is the user's own project).
 */
async function runChangesStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await waitInPage(win, "document.querySelector('[data-toggle-changes]')", 5_000))) return 'no Changes button (not a git checkout?)';
  const wasOpen = (await js("!!document.querySelector('[data-changes-panel]')")) as boolean;
  if (!wasOpen) await js("document.querySelector('[data-toggle-changes]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-changes-panel]') && !document.querySelector('[data-changes-panel]').innerText.includes('Loading')", 5_000))) return 'panel did not load';
  const files = (await js("document.querySelectorAll('[data-changed-file]').length")) as number;
  if (files > 0) {
    await js("document.querySelector('[data-file-toggle]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-file-diff] div')", 5_000))) return `${files} files, but the diff did not load`;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'changes.png');
  const messageActions = (await js("document.querySelectorAll('[data-message-actions]').length")) as number;
  if (!wasOpen) await js("document.querySelector('[data-toggle-changes]').click()");
  return `ok: ${files} changed files${files ? ', first diff shown' : ''}; ${messageActions} messages with fork/rewind actions`;
}

/** ⌘⇧F, type a word, open the first hit: the session opens with that message highlighted. */
async function runSearchStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['meta', 'shift'] });
  if (!(await waitInPage(win, "document.querySelector('[data-search] input')", 3_000))) return '⌘⇧F did not open search';
  await setFieldValue(win, '[data-search] input', 'session');
  // The index is built in the background from a fresh profile; hits fill in as it goes.
  if (!(await waitInPage(win, "document.querySelector('[data-search-hit]')", 30_000))) {
    const footer = await js("document.querySelector('[data-search]').innerText.slice(-80)");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    return `no hits after 30 s (${JSON.stringify(footer)})`;
  }
  const groups = (await js("document.querySelectorAll('[data-search-group]').length")) as number;
  const indexing = (await js("document.querySelector('[data-search]').innerText.match(/Indexing \\d+ of \\d+/)?.[0] ?? 'index complete'")) as string;
  await shot(win, 'search.png');
  await js("document.querySelector('[data-search-hit]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-search]') && document.querySelector('.search-highlight')", 8_000))) return `${groups} sessions matched, but opening the hit did not highlight it`;
  await shot(win, 'search-opened.png');
  // Back to the session under test: the steps after this one work in its folder.
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]').click()`);
  await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
  return `ok: ${groups} sessions matched (${indexing}); opened and highlighted the first`;
}

/**
 * The new session view, read-only: project header, model menu (Escape closes it), effort dial with
 * reset, permission menu and the route tray. Nothing is submitted; the session under test is reopened after.
 */
async function runNewSessionStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const escape = () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  };
  const newSession = () => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['meta'] });
  const promptFocused = "document.activeElement?.matches('[data-composer]')";
  newSession();
  if (!(await waitInPage(win, "document.querySelector('[data-project-header]') && document.querySelector('[data-route-tray]')", 3_000))) return 'the new session view did not open';
  // Projects are added by hand: the throwaway profile has none yet, so there may be no folder to preselect.
  if (!(await waitInPage(win, "document.querySelector('[data-folder-select]').dataset.value || document.querySelector('[data-sidebar-onboarding]')", 5_000))) return 'no folder chosen by default';
  // Without a folder the prompt is disabled, so there is nothing to focus.
  const hasFolder = (await js("!!document.querySelector('[data-folder-select]').dataset.value")) as boolean;
  if (hasFolder && !(await waitInPage(win, promptFocused, 3_000))) return '⌘N did not focus the prompt';
  await click('[data-model-select]');
  if (!(await waitInPage(win, "document.activeElement?.closest('[data-menu=\"model\"]')", 2_000))) return 'the model menu did not open with focus';
  escape();
  if (!(await waitInPage(win, "!document.querySelector('[data-menu=\"model\"]') && document.activeElement?.matches('[data-model-select]')", 2_000))) return 'Escape did not close the model menu';
  const effortBefore = (await js("document.querySelector('[data-effort-dial] [aria-checked=\"true\"]')?.dataset.effort ?? ''")) as string;
  // Clicking the picked bar again clears it, so pick one that isn't picked yet.
  const pick = effortBefore === 'high' ? 'max' : 'high';
  await click(`[data-effort="${pick}"]`);
  if (!(await waitInPage(win, `document.querySelector('[data-effort="${pick}"]').getAttribute('aria-checked') === 'true' && document.querySelector('[data-effort-reset]')`, 2_000))) return 'picking an effort did not stick';
  await click('[data-mode-select]');
  if (!(await waitInPage(win, "document.querySelectorAll('[data-menu=\"mode\"] [role=menuitemradio]').length >= 4", 2_000))) return 'the permission menu did not open';
  await new Promise((resolve) => setTimeout(resolve, 200));
  await shot(win, 'new-session-view.png');
  escape();
  await click('[data-effort-reset]');
  if (!(await waitInPage(win, "!document.querySelector('[data-effort-dial] [aria-checked=\"true\"]') && !document.querySelector('[data-effort-reset]')", 2_000))) return 'Default did not clear the effort';
  // Put back the effort the profile had, so the remembered defaults are as they were.
  if (effortBefore) await click(`[data-effort="${effortBefore}"]`);
  // ⌘N while already on New session puts the cursor back in the prompt.
  await js("document.querySelector('[data-model-select]').focus()");
  newSession();
  if (hasFolder && !(await waitInPage(win, promptFocused, 2_000))) return '⌘N on an open New session did not focus the prompt';
  const hint = (await js("document.querySelector('[data-route-hint]').innerText.replace(/\\s+/g, ' ')")) as string;
  await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
  return `ok: ${hint}`;
}

/**
 * `switchboard://` links, fed to the handler directly (no `open`, so the system's link handlers are
 * untouched). A new-session link fills in the folder and prompt and says where the prompt came from,
 * but sends nothing; a bad link shows why and changes nothing; a repo with no checkout leaves the folder
 * empty; a session link opens the session under test again.
 */
async function runDeepLinkStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const prompt = 'Smoke test from a link:\nsummarise this folder.';
  const folder = homedir();
  const composer = "document.querySelector('[data-new-session-view] [data-composer]')";
  openDeepLink(`switchboard://new-session?prompt=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(folder)}`);
  if (!(await waitInPage(win, `${composer}?.value === ${JSON.stringify(prompt)} && document.querySelector('[data-folder-select]')?.dataset.value === ${JSON.stringify(folder)}`, 5_000))) {
    return `the link did not fill in New session (${String(await js(`${composer}?.value + ' in ' + document.querySelector('[data-folder-select]')?.dataset.value`))})`;
  }
  if (!(await waitInPage(win, "document.querySelector('[data-link-notice]')?.innerText.includes('external link')", 2_000))) return 'no notice that the prompt came from a link';
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'deep-link.png');

  // A refused link explains itself and leaves the prompt alone.
  openDeepLink('switchboard://delete-everything?cwd=/');
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('delete-everything')", 3_000))) return 'an unknown action showed no error';
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'deep-link-error.png');
  if ((await js(`${composer}?.value`)) !== prompt) return 'a refused link changed the prompt';
  await js("document.querySelector('[data-link-error] button').click()");

  // Clear empties the prompt and ends the notice. Nothing was sent all along.
  await js("document.querySelector('[data-clear-link-prompt]').click()");
  if (!(await waitInPage(win, `${composer}?.value === '' && !document.querySelector('[data-link-notice]')`, 2_000))) return 'Clear did not empty the prompt and the notice';
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]')"))) return 'the link left New session (was something started?)';

  // A project that isn't one of yours is refused before anything changes.
  openDeepLink('switchboard://new-session?project=switchboard-smoke-no-such-project&prompt=hi');
  if (!(await waitInPage(win, "document.querySelector('[data-link-error]')?.innerText.includes('switchboard-smoke-no-such-project')", 5_000))) return 'an unknown project showed no error';
  if ((await js(`${composer}?.value`)) !== '') return 'an unknown project still filled in the prompt';
  await js("document.querySelector('[data-link-error] button').click()");

  // No folder in the link: nothing is guessed, the folder list opens, and even autostart waits.
  openDeepLink('switchboard://new-session?prompt=Wait%20for%20me&autostart=1');
  if (!(await waitInPage(win, `${composer}?.value === 'Wait for me' && document.querySelector('[data-folder-select]')?.dataset.value === '' && document.querySelector('[data-folder-select]')?.getAttribute('aria-expanded') === 'true'`, 5_000))) {
    return 'a link without a folder did not leave it empty with the folder list open';
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (!(await js("!!document.querySelector('[data-new-session-view]') && !document.querySelector('[data-current-session]') && document.querySelector('[data-link-notice]')?.innerText.includes('Read it')"))) return 'autostart without a folder did not wait';
  await shot(win, 'deep-link-no-folder.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });

  // No checkout of this repository: the folder is left empty, with the reason.
  openDeepLink('switchboard://new-session?repo=switchboard-smoke/no-such-repo&prompt=hi');
  if (!(await waitInPage(win, "document.querySelector('[data-folder-select]')?.dataset.value === '' && document.querySelector('[data-route-hint]')?.innerText.includes('switchboard-smoke/no-such-repo')", 20_000))) {
    return `a repo without a checkout did not leave the folder empty (${String(await js("document.querySelector('[data-route-hint]')?.innerText"))})`;
  }

  if (!smokeSessionId) return 'ok: filled in folder and prompt, refused a bad link, empty folder for an unknown repo (no session to open)';
  openDeepLink(`switchboard://session/${smokeSessionId}`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${smokeSessionId}"]')`, 5_000))) return 'a session link did not open the session';
  return 'ok: filled in folder and prompt with a notice, sent nothing, refused a bad link and an unknown project, no folder (even with autostart) opens the list and waits, empty folder for an unknown repo, opened a session';
}

/** ⌘K, type "tog chan", Enter: the Changes panel toggles; again to put it back. */
async function runPaletteStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const panelOpen = () => js("!!document.querySelector('[data-changes-panel]')") as Promise<boolean>;
  const before = await panelOpen();
  const runCommand = async (text: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta'] });
    if (!(await waitInPage(win, "document.querySelector('[data-palette] input')", 3_000))) return false;
    await setFieldValue(win, '[data-palette] input', text);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const first = await js("document.querySelector('[data-palette-item]')?.dataset.paletteItem ?? null");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    await waitInPage(win, "!document.querySelector('[data-palette]')", 2_000);
    return first;
  };
  const first = await runCommand('tog chan');
  if (first !== 'changes') return `"tog chan" ranked ${String(first)} first`;
  if (!(await waitInPage(win, before ? "!document.querySelector('[data-changes-panel]')" : "!!document.querySelector('[data-changes-panel]')", 2_000))) return 'Toggle changes did nothing';
  await runCommand('tog chan');
  if ((await panelOpen()) !== before) return 'could not toggle the panel back';
  return 'ok: "tog chan" found Toggle changes, and Enter ran it';
}

/** The Tools window: MCP servers, skills, agents and plugins for the session's folder (a prompt-less helper answers). */
async function runToolsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-open-tools]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-capabilities]') && !document.querySelector('[data-capabilities]').innerText.includes('Asking Claude Code')", 30_000))) {
    return 'the Tools window did not load';
  }
  const counts = (await js(
    "Object.fromEntries([...document.querySelectorAll('[data-capabilities-tab]')].map((t) => [t.dataset.capabilitiesTab, Number(t.querySelector('span')?.innerText ?? 0)]))",
  )) as Record<string, number>;
  await shot(win, 'tools.png');
  await js("document.querySelector('[data-capabilities-tab=\"commands\"]').click()");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await shot(win, 'tools-commands.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await waitInPage(win, "!document.querySelector('[data-capabilities]')", 2_000);
  return `ok: ${counts.mcp} MCP servers, ${counts.commands} skills and commands, ${counts.agents} agents, ${counts.plugins} plugins`;
}

/** ⌥-click a second session: two panes; clicking one makes it active; closing one leaves the other. */
async function runSplitStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const active = () => js("document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane ?? null") as Promise<string | null>;
  await js(
    `[...document.querySelectorAll('[data-session-id]')].find((row) => row.dataset.sessionId !== '${smokeSessionId}').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`,
  );
  if (!(await waitInPage(win, "document.querySelectorAll('[data-pane]').length === 2", 5_000))) return '⌥-click did not open a second pane';
  if ((await active()) !== 'split') return 'the new pane is not the active one';
  await waitInPage(win, "document.querySelectorAll('[data-transcript-item]').length > 0", 5_000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(win, 'split.png');
  // Nothing may stick out past a pane's right edge (the composer and footer used to).
  const overflow = (await js(
    "[...document.querySelectorAll('[data-current-session]')].flatMap((pane) => { const edge = pane.getBoundingClientRect().right + 1; return [...pane.querySelectorAll('[data-composer-submit], [data-open-tools], [data-context-meter]')].filter((el) => el.getBoundingClientRect().right > edge).map((el) => el.dataset.composerSubmit !== undefined ? 'send' : el.dataset.openTools !== undefined ? 'tools' : 'context'); })",
  )) as string[];
  if (overflow.length) return `in split view these stick out of their pane: ${overflow.join(', ')}`;
  await js("document.querySelector('[data-pane=\"main\"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
  if (!(await waitInPage(win, "document.querySelector('[data-pane-active=\"true\"]')?.dataset.pane === 'main'", 2_000))) return 'clicking the left pane did not make it active';
  await js("document.querySelector('[data-pane=\"split\"] [data-close-pane]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-split]') && document.querySelector('[data-current-session]')", 2_000))) return 'closing the pane did not go back to one';
  // Closing the last session lands on New session; picking it in the sidebar opens it again.
  const remaining = (await js("document.querySelector('[data-current-session]').dataset.currentSession")) as string;
  await js("document.querySelector('[data-close-session]').click()");
  if (!(await waitInPage(win, "!document.querySelector('[data-current-session]') && document.querySelector('[data-new-session-view]')", 2_000))) return 'closing the session did not land on New session';
  await js(`document.querySelector('[data-session-id="${remaining}"]').click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-current-session="${remaining}"]')`, 3_000))) return 'could not reopen the closed session';
  return 'ok: ⌥-click opened a second pane, focus follows clicks, closing returns to one, closing that lands on New session';
}

/**
 * The app's own controls: drag the sidebar edge (clamped at both ends, double-click resets), a themed
 * tooltip on hover, and the pointer cursor on buttons. Only the throwaway profile's state changes, and
 * it is put back. The themed dropdown is checked in the projects step, on a throwaway project's defaults.
 */
async function runControlsStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const pause = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
  const center = async (selector: string) => (await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
  const width = () => js("Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().width)") as Promise<number>;
  const drag = async (dx: number) => {
    const { x, y } = await center('[data-sidebar-resize]');
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round((dx * i) / 5), y, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y, button: 'left', clickCount: 1 });
    await pause();
  };

  // Sidebar: wider, clamped at 520, narrower, clamped at 240, double-click back to 320.
  const start = await width();
  await drag(400);
  const widest = await width();
  await drag(-600);
  const narrowest = await width();
  // At the narrowest width, rows truncate instead of sticking out.
  const overflowing = (await js("(() => { const edge = document.querySelector('[data-sidebar]').getBoundingClientRect().right + 1; return [...document.querySelectorAll('[data-session-id]')].filter((row) => row.getBoundingClientRect().right > edge).length; })()")) as number;
  await shot(win, 'sidebar-narrow.png');
  const { x, y } = await center('[data-sidebar-resize]');
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 2 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 2 });
  await pause();
  const reset = await width();
  if (widest !== 520 || narrowest !== 240) return `sidebar resize not clamped: ${start} → ${widest} → ${narrowest}`;
  if (overflowing) return `${overflowing} sidebar rows stick out at the minimum width`;
  if (reset !== 320) return `double-click did not reset the sidebar (${reset}px)`;

  // Buttons show the pointer; the resize handle keeps its own cursor.
  const cursors = (await js("({ button: getComputedStyle(document.querySelector('[data-new-session]')).cursor, handle: getComputedStyle(document.querySelector('[data-sidebar-resize]')).cursor })")) as { button: string; handle: string };
  if (cursors.button !== 'pointer' || cursors.handle !== 'col-resize') return `cursors: ${JSON.stringify(cursors)}`;

  // Tooltip on hover.
  const tip = await center('[data-new-session]');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: tip.x, y: tip.y });
  const tooltip = await waitInPage(win, "document.querySelector('[data-tooltip-layer]')?.innerText.includes('New session')", 2_000);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: tip.x + 400, y: tip.y + 300 });
  if (!tooltip) return 'no themed tooltip on the New session button';

  if (smokeSessionId) await js(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  return `ok: sidebar ${start} → ${widest} → ${narrowest} → ${reset}px, pointer cursors, themed tooltip`;
}

/**
 * Dragging images over a session shows a drop target on the message box; other files offer an @ mention. Synthetic drag events only:
 * nothing is dropped, so nothing is attached or sent.
 */
async function runDropStep(win: BrowserWindow): Promise<string> {
  if (smokeSessionId) await win.webContents.executeJavaScript(`document.querySelector('[data-session-id="${smokeSessionId}"]')?.click()`);
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-composer]') && !document.querySelector('[data-drop-overlay]')", 5_000))) return 'no session view to drag onto';
  const report = (await win.webContents.executeJavaScript(`(async () => {
    const view = document.querySelector('[data-current-session]');
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    const overlay = () => { const el = view.querySelector('[data-drop-overlay]'); return el ? el.dataset.dropState + (Number(el.dataset.dropMention) > 0 ? '+mention' : '') + (el.dataset.dropOver === 'true' ? '+over' : '') : 'none'; };
    const drag = (type, target, extra = {}) => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'smoke', { type }));
      const event = new DragEvent(extra.kind ?? 'dragover', { bubbles: true, cancelable: true, dataTransfer: data, relatedTarget: extra.relatedTarget ?? null });
      target.dispatchEvent(event);
    };
    const transcript = view.querySelector('[data-transcript]');
    const composer = view.querySelector('[data-composer]');
    const steps = [];
    drag('image/png', transcript, { kind: 'dragenter' });
    drag('image/png', transcript);
    await settle();
    steps.push(overlay());
    drag('image/png', composer, { kind: 'dragenter' });
    drag('image/png', composer);
    await settle();
    steps.push(overlay());
    drag('image/png', composer, { kind: 'dragleave', relatedTarget: document.querySelector('[data-sidebar]') ?? document.body });
    await settle();
    steps.push(overlay());
    drag('application/pdf', transcript, { kind: 'dragenter' });
    drag('application/pdf', transcript);
    await settle();
    steps.push(overlay());
    window.dispatchEvent(new DragEvent('dragend'));
    await settle();
    steps.push(overlay());
    return steps;
  })()`)) as string[];
  // dropEffect can't be read back from synthetic events (it only sticks during a real drag), so this checks the overlay.
  // A PDF can't be attached; it would be mentioned as @path instead.
  const expected = ['ok', 'ok+over', 'none', 'ok+mention', 'none'];
  if (report.join(' ') !== expected.join(' ')) return `drop target went ${report.join(' → ')} (expected ${expected.join(' → ')})`;
  // Hold a drag over the message box for the screenshot, then end it.
  await win.webContents.executeJavaScript(`(() => {
    const composer = document.querySelector('[data-current-session] [data-composer]');
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'smoke.png', { type: 'image/png' }));
    composer.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    window.__smokeDrag = setInterval(() => composer.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })), 50);
  })()`);
  if (!(await waitInPage(win, "document.querySelector('[data-drop-overlay]')", 1_000))) return 'no overlay while a drag is held over the message box';
  await new Promise((resolve) => setTimeout(resolve, 150));
  await shot(win, 'drop-target.png');
  await win.webContents.executeJavaScript("clearInterval(window.__smokeDrag); window.dispatchEvent(new DragEvent('dragend'))");
  if (!(await waitInPage(win, "!document.querySelector('[data-drop-overlay]')", 1_000))) return 'the overlay stayed after the drag ended';
  return 'ok: overlay on enter, stronger over the message box, gone on leave, offers to mention a PDF, cleared on dragend';
}

/**
 * Right-click → Settle moves a session out of the main list, even one that's working (its updates
 * used to bring it straight back); "Move back" returns it. Flags live in the throwaway profile.
 */
async function runSettleStep(win: BrowserWindow): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  // Prefer a session that's working right now: that's the case that used to do nothing.
  const id = (await js(
    "(() => { const rows = [...document.querySelectorAll('[data-session-id]')]; const busy = rows.find((r) => r.querySelector('[aria-label=\"Claude is working\"]')); return (busy ?? rows[0])?.dataset.sessionId ?? null; })()",
  )) as string | null;
  if (!id) return 'no session to settle';
  const working = (await js(`!!document.querySelector('[data-session-id="${id}"] [aria-label="Claude is working"]')`)) as boolean;
  const menu = async (label: string) => {
    const opened = await js(
      `(() => { const row = document.querySelector('[data-session-id="${id}"]'); if (!row) return false; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); return true; })()`,
    );
    if (!opened) return false;
    if (!(await waitInPage(win, `[...document.querySelectorAll('[role=menuitem]')].some((b) => b.innerText.startsWith(${JSON.stringify(label)}))`, 3_000))) return false;
    await js(`[...document.querySelectorAll('[role=menuitem]')].find((b) => b.innerText.startsWith(${JSON.stringify(label)})).click()`);
    return true;
  };
  // In the main list: rendered and above the "Settled" header. The list is virtualised, so check from the top.
  const toTop = "document.querySelector('[data-session-list]').scrollTop = 0";
  const inMainList = `(() => { const row = document.querySelector('[data-session-id="${id}"]'); if (!row) return false; const header = document.querySelector('[data-settled-toggle]'); return !header || row.getBoundingClientRect().top < header.getBoundingClientRect().top; })()`;
  if (!(await menu('Settle'))) return 'no Settle item';
  await js(toTop);
  if (!(await waitInPage(win, `!${inMainList}`, 3_000))) return `settling did nothing${working ? ' (a working session)' : ''}`;
  // Open the Settled section (scroll down until its header renders) and move it back.
  for (let i = 0; i < 40 && !(await js("!!document.querySelector('[data-settled-toggle]')")); i++) {
    await js("document.querySelector('[data-session-list]').scrollTop += 400");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if ((await js("document.querySelector('[data-settled-toggle]')?.dataset.open ?? 'missing'")) === 'false') await js("document.querySelector('[data-settled-toggle]').click()");
  // Settled rows render as they scroll into view: keep scrolling until this one appears.
  for (let i = 0; i < 60 && !(await js(`!!document.querySelector('[data-session-id="${id}"]')`)); i++) {
    await js("document.querySelector('[data-session-list]').scrollTop += 300");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await js(`document.querySelector('[data-session-id="${id}"]')?.scrollIntoView({ block: 'center' })`);
  if (!(await waitInPage(win, `!!document.querySelector('[data-session-id="${id}"]')`, 3_000))) {
    const seen = await js(
      `JSON.stringify({ header: document.querySelector('[data-settled-toggle]')?.innerText, open: document.querySelector('[data-settled-toggle]')?.dataset.open, rows: document.querySelectorAll('[data-session-id]').length, scroll: document.querySelector('[data-settled-toggle]')?.closest('.overflow-y-auto')?.scrollTop })`,
    );
    return `settled session not found under Settled: ${seen}`;
  }
  if (!(await menu('Move back'))) return 'no "Move back" item';
  await js(toTop);
  if (!(await waitInPage(win, inMainList, 3_000))) return 'moving back did nothing';
  return `ok: settled ${working ? 'a working session' : 'a session'} and moved it back`;
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
    // The newest session with messages and tool activity (a brand-new or chat-only one has less to check);
    // failing that, the newest with messages.
    let fallback: string | null = null;
    for (let i = 0; i < 8 && !transcriptOpened; i++) {
      const id = (await win.webContents.executeJavaScript(
        `(() => { const row = document.querySelectorAll('[data-session-id]')[${i}]; row?.click(); return row?.dataset.sessionId ?? null; })()`,
      )) as string | null;
      if (!id || !(await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000))) continue;
      fallback ??= id;
      if (await waitInPage(win, "document.querySelector('[data-activity], [data-tool]')", 1_000)) {
        smokeSessionId = id;
        transcriptOpened = true;
      }
    }
    if (!transcriptOpened && fallback) {
      smokeSessionId = fallback;
      await win.webContents.executeJavaScript(`document.querySelector('[data-session-id="${fallback}"]').click()`);
      transcriptOpened = await waitInPage(win, "document.querySelector('[data-transcript-item]')", 5_000);
    }
    // It must open scrolled to the very end, with space between the last message and the composer.
    const atBottom = "(() => { const el = document.querySelector('[data-transcript]'); return el.scrollHeight - el.scrollTop - el.clientHeight < 2; })()";
    const bottomGap =
      "(() => { const el = document.querySelector('[data-transcript]'); const rows = [...el.querySelectorAll('[data-transcript-item]')]; const last = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom)); return Math.round(el.getBoundingClientRect().bottom - last); })()";
    // Images in the last rows load after they're first measured, and a live session keeps growing:
    // read the position and the gap together, and give the view up to 4 s to settle at the end.
    if (transcriptOpened) {
      const deadline = Date.now() + 4_000;
      let reading: { atEnd: boolean; gap: number } = { atEnd: false, gap: 0 };
      do {
        reading = (await win.webContents.executeJavaScript(`({ atEnd: ${atBottom}, gap: ${bottomGap} })`)) as typeof reading;
        if (reading.atEnd && reading.gap >= 16 && reading.gap <= 60) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      transcriptAtBottom = reading.atEnd ? reading.gap : null;
    }
    if (transcriptAtBottom === null || transcriptAtBottom < 16 || transcriptAtBottom > 60) {
      console.log(
        `[smoke] transcript scroll: ${await win.webContents.executeJavaScript(
          "(() => { const el = document.querySelector('[data-transcript]'); const list = el.firstElementChild; return JSON.stringify({ scrollHeight: el.scrollHeight, scrollTop: Math.round(el.scrollTop), clientHeight: el.clientHeight, listHeight: list?.offsetHeight, streaming: !!el.querySelector('[data-streaming]'), lastKind: [...el.querySelectorAll('[data-transcript-item]')].at(-1)?.dataset.itemKind, gap: " + bottomGap + " }); })()",
        )}`,
      );
    }
    // Give the virtualiser a frame to measure and scroll to the end before capturing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(join(smokeOutDir, 'transcript.png'), (await win.webContents.capturePage()).toPNG());
    activity = await runActivityStep(win);
    changesPanel = await runChangesStep(win);
    searchResult = await runSearchStep(win).catch((error: Error) => `failed: ${error.message}`);
    paletteResult = await runPaletteStep(win).catch((error: Error) => `failed: ${error.message}`);
    toolsResult = await runToolsStep(win).catch((error: Error) => `failed: ${error.message}`);
    splitResult = await runSplitStep(win).catch((error: Error) => `failed: ${error.message}`);
    settleResult = await runSettleStep(win).catch((error: Error) => `failed: ${error.message}`);
    dropResult = await runDropStep(win).catch((error: Error) => `failed: ${error.message}`);
    controlsResult = await runControlsStep(win).catch((error: Error) => `failed: ${error.message}`);
    newSessionResult = await runNewSessionStep(win).catch((error: Error) => `failed: ${error.message}`);
    deepLinkResult = await runDeepLinkStep(win).catch((error: Error) => `failed: ${error.message}`);
    usageBand = (await waitInPage(win, "document.querySelector('[data-usage-band]')", 15_000))
      ? await win.webContents.executeJavaScript("document.querySelector('[data-usage-band]').innerText.replace(/\\s+/g, ' ')")
      : null;
    if (usageBand) await shot(win, 'usage.png');
    quitGuarded = await runQuitStep(win);
    settingsResult = await runSettingsStep(win).catch((error: Error) => `failed: ${error.message}`);
    terminalOpened = await runTerminalStep(win);
    actionRan = await runActionStep(win);
    projectsResult = await runProjectsStep(win).catch((error: Error) => `failed: ${error.message}`);
    profilesResult = await runProfilesStep(win).catch((error: Error) => `failed: ${error.message}`);
    aboutResult = await runAboutStep(win).catch((error: Error) => `failed: ${error.message}`);
    backupResult = await runBackupStep(win).catch((error: Error) => `failed: ${error.message}`);
    // Diagnostics (in Settings) renders a sample through Shiki, which loads in its own chunks on first use.
    await win.webContents.executeJavaScript("document.querySelector('[data-open-settings]').click()");
    await waitInPage(win, "document.querySelector('[data-settings-section=\"diagnostics\"]')", 3_000);
    await win.webContents.executeJavaScript("document.querySelector('[data-settings-section=\"diagnostics\"]').click()");
    highlighted = await waitInPage(win, "document.querySelector('[data-rendering-check] .shiki span[style*=\"--shiki\"]')", 5_000);
    await shot(win, 'diagnostics.png');
    await win.webContents.executeJavaScript("document.querySelector('[data-close-settings]').click()");
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
        transcriptAtBottom,
        activity,
        changesPanel,
        searchResult,
        paletteResult,
        toolsResult,
        splitResult,
        settleResult,
        dropResult,
        controlsResult,
        newSessionResult,
        deepLinkResult,
        liveSession,
        terminalOpened,
        quitGuarded,
        settingsResult,
        actionRan,
        projectsResult,
        profilesResult,
        aboutResult,
        backupResult,
        highlighted,
        usageBand,
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
  // The commit shows in brackets after the version, handy when someone reports a bug from a build.
  app.setAboutPanelOptions({
    applicationName: 'Switchboard',
    applicationVersion: appInfo.dev ? `${appInfo.version} (dev)` : appInfo.version,
    version: appInfo.commit ?? '',
    iconPath: join(here, '../../build/icon.png'),
  });
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
  installMenu();
  notifier = new Notifier({
    engine,
    window: () => BrowserWindow.getAllWindows()[0],
    focusedSession: () => focusedSession,
    openSession,
    showAllSessions: () => preferences.get().sessionScope === 'all',
    ...(smokeOutDir ? { record: (event: AttentionEvent & { suppressed: boolean }) => void recordedNotifications.push(event) } : {}),
  });
  notifier.connect();
  createWindow();
  updater.start();
  // The packaged app declares the scheme in Info.plist; this also takes it back if another app claimed it.
  // Development and smoke builds leave the system's link handlers alone.
  if (app.isPackaged && !smokeOutDir && !app.isDefaultProtocolClient(DEEP_LINK_SCHEME)) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  const launchLink = linkFromArgv(process.argv);
  if (launchLink) openDeepLink(launchLink);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (smokeOutDir) setTimeout(() => exitApp(2), process.env.SWITCHBOARD_SMOKE_LIVE_CWD ? 180_000 : 45_000).unref();
});

// macOS delivers links here, also the one that launched the app (before 'ready', so it waits in pendingLinks).
app.on('open-url', (event, url) => {
  event.preventDefault();
  openDeepLink(url);
});

app.on('second-instance', (_event, argv) => {
  // Elsewhere a link arrives as an argument to a second instance.
  const link = linkFromArgv(argv);
  if (link) return openDeepLink(link);
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  updater.stop();
  engine?.stop();
});
