import { useState } from 'react';
import type { PermissionDecision, PermissionRequest } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Markdown } from '../transcript/Markdown.tsx';
import { toolSummary } from '../transcript/toolSummary.ts';

type Respond = (decision: PermissionDecision) => Promise<void>;

function useRespond(request: PermissionRequest): { respond: Respond; busy: boolean; error: string | null } {
  const connection = useEngineConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond: Respond = async (decision) => {
    if (connection.status !== 'connected') return;
    setBusy(true);
    try {
      await connection.client.call('session.respond', { requestId: request.requestId, decision });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return { respond, busy, error };
}

const button = 'rounded-md px-3 py-1 text-[12px] font-medium disabled:opacity-40';

function DenyWithFeedback({ respond, busy, label = 'Deny' }: { respond: Respond; busy: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  if (!open) {
    return (
      <button type="button" disabled={busy} onClick={() => setOpen(true)} className={`${button} border border-border text-muted hover:text-text`}>
        {label}…
      </button>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-1 gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void respond({ behavior: 'deny', message: message.trim() || 'The user declined this action.' });
      }}
    >
      <input
        autoFocus
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Tell Claude what to do instead (optional)"
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[12px] outline-none focus:border-accent-ink/60"
      />
      <button type="submit" disabled={busy} className={`${button} border border-border text-text`}>
        {label}
      </button>
    </form>
  );
}

function ToolPermission({ request, cwd }: { request: PermissionRequest; cwd: string | null }) {
  const { respond, busy, error } = useRespond(request);
  const [showInput, setShowInput] = useState(false);
  const { label, detail } = toolSummary(request.toolName, request.input, cwd);
  const command = request.toolName === 'Bash' ? (request.input as { command?: string }).command : undefined;
  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-medium">{request.title ?? `Claude wants to use ${label}`}</p>
      {command ? (
        <pre className="max-h-40 overflow-auto rounded-md bg-sidebar px-2.5 py-1.5 font-mono text-[12px] whitespace-pre-wrap select-text">{command}</pre>
      ) : (
        detail && <p className="truncate font-mono text-[12px] text-muted">{detail}</p>
      )}
      {request.description && <p className="text-[12px] text-muted">{request.description}</p>}
      {request.decisionReason && <p className="text-[11px] text-faint">{request.decisionReason}</p>}
      <button type="button" onClick={() => setShowInput((v) => !v)} className="w-fit text-[11px] text-faint hover:text-muted">
        {showInput ? 'Hide details' : 'Show details'}
      </button>
      {showInput && (
        <pre className="max-h-56 overflow-auto rounded-md bg-sidebar px-2.5 py-1.5 font-mono text-[11.5px] whitespace-pre-wrap text-muted select-text">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" data-permission-allow disabled={busy} onClick={() => void respond({ behavior: 'allow' })} className={`${button} bg-accent text-on-accent`} autoFocus>
          Allow
        </button>
        {request.alwaysLabel && (
          <button
            type="button"
            disabled={busy}
            title={request.alwaysLabel}
            onClick={() => void respond({ behavior: 'allow', always: true })}
            className={`${button} max-w-80 truncate border border-border text-text`}
          >
            Always: {request.alwaysLabel}
          </button>
        )}
        <DenyWithFeedback respond={respond} busy={busy} />
      </div>
      {error && <p className="text-[12px] text-error">{error}</p>}
    </div>
  );
}

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

function AskUserQuestion({ request }: { request: PermissionRequest }) {
  const { respond, busy, error } = useRespond(request);
  const input = request.input as { questions?: Question[] };
  const questions = input.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const toggle = (q: Question, label: string) =>
    setAnswers((current) => {
      const picked = current[q.question] ?? [];
      const next = q.multiSelect ? (picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]) : [label];
      return { ...current, [q.question]: next };
    });

  const final = (q: Question) => [...(answers[q.question] ?? []), ...(other[q.question]?.trim() ? [other[q.question]!.trim()] : [])];
  const complete = questions.every((q) => final(q).length > 0);

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const result = Object.fromEntries(questions.map((q) => [q.question, final(q).join(', ')]));
        void respond({ behavior: 'allow', updatedInput: { ...(request.input as Record<string, never>), answers: result } });
      }}
    >
      {questions.map((q) => (
        <fieldset key={q.question} className="grid gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">
            {q.header && <span className="mr-2 rounded bg-border/70 px-1.5 py-0.5 text-[10px] text-muted uppercase">{q.header}</span>}
            {q.question}
          </legend>
          {q.options.map((option) => {
            const checked = (answers[q.question] ?? []).includes(option.label);
            return (
              <label key={option.label} className={`flex cursor-pointer gap-2 rounded-md border px-2.5 py-1.5 ${checked ? 'border-accent-ink/60 bg-accent/10' : 'border-border'}`}>
                <input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.question} checked={checked} onChange={() => toggle(q, option.label)} className="mt-0.5 accent-[var(--sb-accent)]" />
                <span>
                  <span className="text-[13px]">{option.label}</span>
                  {option.description && <span className="block text-[11px] text-muted">{option.description}</span>}
                </span>
              </label>
            );
          })}
          <input
            value={other[q.question] ?? ''}
            onChange={(e) => setOther((c) => ({ ...c, [q.question]: e.target.value }))}
            placeholder="Other answer"
            className="h-7 rounded-md border border-border bg-bg px-2 text-[12px] outline-none focus:border-accent-ink/60"
          />
        </fieldset>
      ))}
      <div className="flex items-center gap-1.5">
        <button type="submit" disabled={busy || !complete} className={`${button} bg-accent text-on-accent`}>
          Answer
        </button>
        <DenyWithFeedback respond={respond} busy={busy} label="Skip" />
      </div>
      {error && <p className="text-[12px] text-error">{error}</p>}
    </form>
  );
}

function PlanApproval({ request }: { request: PermissionRequest }) {
  const { respond, busy, error } = useRespond(request);
  const connection = useEngineConnection();
  const plan = (request.input as { plan?: string }).plan ?? '';
  const approveWithEdits = async () => {
    await respond({ behavior: 'allow' });
    if (connection.status === 'connected') {
      await connection.client.call('session.setPermissionMode', { sessionId: request.sessionId, mode: 'acceptEdits' }).catch(() => {});
    }
  };
  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-medium">Claude has a plan. Ready to start?</p>
      <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border bg-bg px-3 py-2">
        <Markdown text={plan} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={busy} onClick={() => void approveWithEdits()} className={`${button} bg-accent text-on-accent`}>
          Approve and accept edits
        </button>
        <button type="button" disabled={busy} onClick={() => void respond({ behavior: 'allow' })} className={`${button} border border-border text-text`}>
          Approve, ask before edits
        </button>
        <DenyWithFeedback respond={respond} busy={busy} label="Keep planning" />
      </div>
      {error && <p className="text-[12px] text-error">{error}</p>}
    </div>
  );
}

/** A pending permission prompt, rendered above the composer. */
export function PermissionCard({ request, cwd }: { request: PermissionRequest; cwd: string | null }) {
  return (
    <div className="rounded-xl border border-warn/50 bg-warn/5 px-4 py-3 shadow-sm" data-permission-request>
      {request.agentId && <p className="mb-1 text-[11px] text-faint">From a subagent</p>}
      {request.toolName === 'AskUserQuestion' ? (
        <AskUserQuestion request={request} />
      ) : request.toolName === 'ExitPlanMode' ? (
        <PlanApproval request={request} />
      ) : (
        <ToolPermission request={request} cwd={cwd} />
      )}
    </div>
  );
}
