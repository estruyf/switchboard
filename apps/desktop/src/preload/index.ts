import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ENGINE_PORT_MESSAGE, IpcChannel, type Preferences, type RendererReadyReport, type SwitchboardBridge } from '@switchboard/protocol/bridge';

// MessagePorts can't cross contextBridge, so forward them to the page with window.postMessage.
ipcRenderer.on(IpcChannel.enginePort, (event) => {
  window.postMessage(ENGINE_PORT_MESSAGE, '*', event.ports);
});

const bridge: SwitchboardBridge = {
  platform: process.platform,
  requestEnginePort: () => ipcRenderer.send(IpcChannel.requestEnginePort),
  onEngineRestarted(listener) {
    const handler = () => listener();
    ipcRenderer.on(IpcChannel.engineRestarted, handler);
    return () => ipcRenderer.off(IpcChannel.engineRestarted, handler);
  },
  reportReady: (report: RendererReadyReport) => ipcRenderer.send(IpcChannel.rendererReady, report),
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke(IpcChannel.pickFolder, defaultPath) as Promise<string | null>,
  pickImage: (defaultPath?: string) => ipcRenderer.invoke(IpcChannel.pickImage, defaultPath) as Promise<string | null>,
  // File.path is gone from Electron; webUtils is how a sandboxed page learns where a dropped file lives.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  reportFocus: (sessionId: string | null) => ipcRenderer.send(IpcChannel.focusSession, sessionId),
  onSelectSession(listener) {
    const handler = (_event: unknown, sessionId: string) => listener(sessionId);
    ipcRenderer.on(IpcChannel.selectSession, handler);
    return () => ipcRenderer.off(IpcChannel.selectSession, handler);
  },
  onQuitRequested(listener) {
    const handler = () => listener();
    ipcRenderer.on(IpcChannel.quitRequested, handler);
    return () => ipcRenderer.off(IpcChannel.quitRequested, handler);
  },
  answerQuit: (answer) => ipcRenderer.send(IpcChannel.quitAnswer, answer),
  // Tiny and read once at startup; synchronous so the first paint has the right layout.
  preferences: ipcRenderer.sendSync(IpcChannel.getPreferences) as Preferences,
  setPreferences: (patch) => ipcRenderer.send(IpcChannel.setPreferences, patch),
  onPreferencesChanged(listener) {
    const handler = (_event: unknown, preferences: Preferences) => listener(preferences);
    ipcRenderer.on(IpcChannel.preferencesChanged, handler);
    return () => ipcRenderer.off(IpcChannel.preferencesChanged, handler);
  },
  onOpenSettings(listener) {
    const handler = () => listener();
    ipcRenderer.on(IpcChannel.openSettings, handler);
    return () => ipcRenderer.off(IpcChannel.openSettings, handler);
  },
};

contextBridge.exposeInMainWorld('switchboard', bridge);
