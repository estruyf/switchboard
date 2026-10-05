import type { ReactNode } from 'react';
import type { LogLevel } from '@switchboard/protocol/client';
import { useDiagnostics } from '../engine/useDiagnostics.ts';
import { useEngineConnection } from '../engine/useEngine.ts';

type Tone = 'ok' | 'warn' | 'error' | 'idle';

const toneClass: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
  idle: 'bg-faint',
};

function Dot({ tone }: { tone: Tone }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${toneClass[tone]}`} />;
}

function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[12px] font-medium text-muted">{title}</h3>
        {aside}
      </header>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-4 px-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 select-text truncate">{children}</dd>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[12px]">{children}</span>;

const logTone: Record<LogLevel, string> = {
  debug: 'text-faint',
  info: 'text-muted',
  warn: 'text-warn',
  error: 'text-error',
};

export function EngineDiagnostics() {
  const connection = useEngineConnection();
  const { info, pingMs, logs, error, refreshPing } = useDiagnostics();

  const connectionRow =
    connection.status === 'unavailable' ? (
      <span className="flex items-center gap-2">
        <Dot tone="error" /> Not running inside the Switchboard app
      </span>
    ) : connection.status === 'connecting' ? (
      <span className="flex items-center gap-2">
        <Dot tone="warn" /> Connecting…
      </span>
    ) : (
      <span className="flex items-center gap-2">
        <Dot tone="ok" /> Connected
        {connection.generation > 1 && <span className="text-faint">· reconnected {connection.generation - 1}×</span>}
      </span>
    );

  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-6">
      {error && (
        <div className="rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-error">{error}</div>
      )}

      <Card
        title="Engine"
        aside={
          <button
            type="button"
            onClick={refreshPing}
            disabled={connection.status !== 'connected'}
            className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-border/60 disabled:opacity-40"
          >
            Ping again
          </button>
        }
      >
        <Row label="Status">{connectionRow}</Row>
        <Row label="Round trip">{pingMs === null ? '—' : <Mono>{pingMs.toFixed(2)} ms (median of 20)</Mono>}</Row>
        <Row label="Engine version">{info ? <Mono>{info.engineVersion}</Mono> : '—'}</Row>
      </Card>

      <Card title="Claude Code">
        <Row label="Binary">
          {!info ? (
            '—'
          ) : info.claude ? (
            <span className="flex items-center gap-2">
              <Dot tone="ok" />
              <Mono>{info.claude.version ?? 'unknown version'}</Mono>
              <span className="truncate text-faint">{info.claude.path}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Dot tone="error" /> Not found on PATH. Install Claude Code or set its path in Settings.
            </span>
          )}
        </Row>
        <Row label="Config dir">{info ? <Mono>{info.paths.claudeConfigDir}</Mono> : '—'}</Row>
        <Row label="Shell environment">
          {info ? (
            <span className="flex items-center gap-2">
              <Dot tone={info.shell.resolved ? 'ok' : 'warn'} />
              {info.shell.resolved ? 'Loaded from' : 'Fell back to app environment for'} <Mono>{info.shell.path}</Mono>
              <span className="text-faint">· {info.shell.durationMs} ms</span>
            </span>
          ) : (
            '—'
          )}
        </Row>
      </Card>

      <Card title="Runtime">
        <Row label="Electron">{info ? <Mono>{info.versions.electron ?? 'n/a'}</Mono> : '—'}</Row>
        <Row label="Node">{info ? <Mono>{info.versions.node}</Mono> : '—'}</Row>
        <Row label="SQLite">{info ? <Mono>{info.versions.sqlite}</Mono> : '—'}</Row>
        <Row label="Cache database">{info ? <Mono>{info.paths.database}</Mono> : '—'}</Row>
      </Card>

      <Card title="Engine log">
        <div className="max-h-48 overflow-y-auto px-4 py-2 font-mono text-[12px] select-text">
          {logs.length === 0 ? (
            <p className="text-faint">No messages since this window connected.</p>
          ) : (
            logs.map((entry, i) => (
              <p key={i} className={logTone[entry.level]}>
                <span className="text-faint">{new Date(entry.at).toLocaleTimeString()}</span> {entry.message}
              </p>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
