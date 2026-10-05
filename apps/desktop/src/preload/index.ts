import { contextBridge, ipcRenderer } from 'electron';
import { ENGINE_PORT_MESSAGE, IpcChannel, type RendererReadyReport, type SwitchboardBridge } from '@switchboard/protocol/bridge';

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
  reportFocus: (sessionId: string | null) => ipcRenderer.send(IpcChannel.focusSession, sessionId),
  onSelectSession(listener) {
    const handler = (_event: unknown, sessionId: string) => listener(sessionId);
    ipcRenderer.on(IpcChannel.selectSession, handler);
    return () => ipcRenderer.off(IpcChannel.selectSession, handler);
  },
};

contextBridge.exposeInMainWorld('switchboard', bridge);
