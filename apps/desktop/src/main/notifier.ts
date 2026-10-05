import { app, MessageChannelMain, Notification, type BrowserWindow } from 'electron';
import { createRpcClient, type Contract, type RpcClient } from '@switchboard/protocol/client';
import { mainPortTransport } from '../shared/mainPortTransport.ts';
import { Attention, type AttentionEvent } from './attention.ts';
import type { EngineProcess } from './engineProcess.ts';

export interface NotifierOptions {
  engine: EngineProcess;
  window: () => BrowserWindow | undefined;
  /** The session the user is looking at (reported by the renderer). */
  focusedSession: () => string | null;
  openSession: (sessionId: string) => void;
  /** Smoke tests record events (and whether they'd be suppressed) instead of showing notifications. */
  record?: (event: AttentionEvent & { suppressed: boolean }) => void;
}

/**
 * Main's own connection to the engine, so notifications and the dock badge
 * work even with the window closed.
 */
export class Notifier {
  private client: RpcClient<Contract> | undefined;
  private readonly attention = new Attention();
  /** Notifications must be referenced until closed, or macOS drops their click handlers. */
  private readonly shown = new Set<Notification>();

  constructor(private readonly options: NotifierOptions) {}

  /** (Re)connects; call again after the engine restarts. */
  connect(): void {
    this.client?.dispose();
    this.attention.reset();
    const { port1, port2 } = new MessageChannelMain();
    this.options.engine.connect(port1);
    const client = createRpcClient<Contract>(mainPortTransport(port2), { timeoutMs: 15_000 });
    this.client = client;

    client.on('sessions.changed', ({ upserted }) => upserted.forEach((s) => this.attention.setTitle(s.id, s.title)));
    client.on('session.host', (info) => this.handle(this.attention.onHost(info)));
    client.on('session.permission', (request) => this.handle(this.attention.onPermission(request)));
    client.on('session.permissionResolved', ({ requestId }) => {
      this.attention.onPermissionResolved(requestId);
      this.updateBadge();
    });
    client.on('sessions.live', ({ live }) => this.handle(this.attention.onLive(live)));
    client.on('terminals.changed', ({ terminals }) => this.handle(this.attention.onTerminals(terminals)));

    // Seed state silently: only changes from here on deserve a notification.
    void Promise.all([client.call('sessions.list', {}), client.call('hosts.list', {}), client.call('terminal.list', {})])
      .then(([sessions, hosts, terminals]) => {
        sessions.sessions.forEach((s) => this.attention.setTitle(s.id, s.title));
        hosts.hosts.forEach((h) => this.attention.onHost(h));
        hosts.permissions.forEach((p) => this.attention.onPermission(p));
        this.attention.onLive(sessions.live);
        this.attention.onTerminals(terminals.terminals);
        this.updateBadge();
      })
      .catch(() => {});
  }

  private handle(events: AttentionEvent[]): void {
    const win = this.options.window();
    const focused = !!win && win.isFocused() && !win.isMinimized();
    for (const event of events) {
      // Already looking at it: no need to interrupt.
      const suppressed = focused && this.options.focusedSession() === event.sessionId;
      if (this.options.record) {
        this.options.record({ ...event, suppressed });
        continue;
      }
      if (suppressed) continue;
      if (Notification.isSupported()) {
        const notification = new Notification({ title: event.title, body: event.body });
        notification.on('click', () => this.options.openSession(event.sessionId));
        notification.on('close', () => this.shown.delete(notification));
        this.shown.add(notification);
        notification.show();
      }
      if (event.kind === 'needs-you' && !focused) app.dock?.bounce('informational');
    }
    this.updateBadge();
  }

  private updateBadge(): void {
    const count = this.attention.badge();
    app.dock?.setBadge(count > 0 ? String(count) : '');
  }
}
