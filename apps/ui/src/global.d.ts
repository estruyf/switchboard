import type { SwitchboardBridge } from '@switchboard/protocol/bridge';

declare global {
  interface Window {
    /** Set by the Electron preload. Undefined when the UI is opened in a plain browser. */
    switchboard?: SwitchboardBridge;
  }
}
