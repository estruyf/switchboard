import { useEffect, useId, useRef, useState } from 'react';
import type { PermissionDecision, PermissionRequest } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Markdown } from '../transcript/Markdown.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
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
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        data-tooltip="Say no, and optionally tell Claude what to do instead"
        className={`${button} border border-border text-muted hover:text-text`}
      >
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
        aria-label="Tell Claude what to do instead (optional)"
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[12px] outline-none focus:border-accent-ink/60"
      />
      <button type="submit" disabled={busy} className={`${button} border border-border text-text`}>
        {label}
      </button>
    </form>
  );
}

/** What the card asks, in one line: its heading, and what the session announces when it appears. */
export function permissionTitle(request: PermissionRequest, cwd: string | null): string {
  if (request.toolName === 'AskUserQuestion') return 'Claude has a question for you';
  if (request.toolName === 'ExitPlanMode') return 'Claude has a plan. Ready to start?';
  return request.title ?? `Claude wants to use ${toolSummary(request.toolName, request.input, cwd).label}`;
}

/**
 * Puts focus on the main answer, but only when nothing else has it: a prompt that pops up while
 * you type in the message box must not catch your Enter and approve something you didn't read.
 * Otherwise the session announces it, and ⇧Tab from the message box reaches it.
 */
function useFocusIfIdle() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  }, []);
  return ref;
}

function ToolPermission({ request, cwd, titleId }: { request: PermissionRequest; cwd: string | null; titleId: string }) {
  const { respond, busy, error } = useRespond(request);
  const [showInput, setShowInput] = useState(false);
  const allowRef = useFocusIfIdle();
  const inputId = useId();
  const { detail } = toolSummary(request.toolName, request.input, cwd);
  const command = request.toolName === 'Bash' ? (request.input as { command?: string }).command : undefined;
  return (
    <div className="grid gap-2">
      <h2 id={titleId} className="text-[13px] font-medium">
        {permissionTitle(request, cwd)}
      </h2>
      {command ? (
        <pre className="max-h-40 overflow-auto rounded-md bg-sidebar px-2.5 py-1.5 font-mono text-[12px] whitespace-pre-wrap select-text">{command}</pre>
      ) : (
        detail && <p className="truncate font-mono text-[12px] text-muted">{detail}</p>
      )}
      {request.description && <p className="text-[12px] text-muted">{request.description}</p>}
      {request.decisionReason && <p className="text-[11px] text-muted">{request.decisionReason}</p>}
      <button
        type="button"
        onClick={() => setShowInput((v) => !v)}
        aria-expanded={showInput}
        aria-controls={showInput ? inputId : undefined}
        className="w-fit text-[11px] text-muted hover:text-text"
      >
        {showInput ? 'Hide details' : 'Show details'}
      </button>
      {showInput && (
        <pre id={inputId} className="max-h-56 overflow-auto rounded-md bg-sidebar px-2.5 py-1.5 font-mono text-[11.5px] whitespace-pre-wrap text-muted select-text">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          ref={allowRef}
          type="button"
          data-permission-allow
          disabled={busy}
          onClick={() => void respond({ behavior: 'allow' })}
          data-tooltip="Allow this once; Claude asks again next time"
          className={`${button} bg-accent text-on-accent`}
        >
          Allow once
        </button>
        {request.alwaysLabel && (
          <button
            type="button"
            disabled={busy}
            data-tooltip={`Always allow: ${request.alwaysLabel}`}
            onClick={() => void respond({ behavior: 'allow', always: true })}
            className={`${button} max-w-80 truncate border border-border text-text`}
          >
            Always allow: {request.alwaysLabel}
          </button>
        )}
        <DenyWithFeedback respond={respond} busy={busy} />
      </div>
      {error && (
        <p className="text-[12px] text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

function AskUserQuestion({ request, titleId }: { request: PermissionRequest; titleId: string }) {
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
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        const result = Object.fromEntries(questions.map((q) => [q.question, final(q).join(', ')]));
        void respond({ behavior: 'allow', updatedInput: { ...(request.input as Record<string, never>), answers: result } });
      }}
    >
      <h2 id={titleId} className="sr-only">
        {permissionTitle(request, null)}
      </h2>
      {questions.map((q) => (
        <fieldset key={q.question} className="grid gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">
            {q.header && <span className="mr-2 rounded bg-border/70 px-1.5 py-0.5 text-[11px] text-muted uppercase">{q.header}</span>}
            {q.question}
          </legend>
          {(() => {
            const noneChecked = (answers[q.question] ?? []).length === 0;
            const options = q.options.map((option, i) => {
              const checked = (answers[q.question] ?? []).includes(option.label);
              const row = `w-full rounded-md border px-2.5 py-1.5 ${checked ? 'border-accent-ink/60 bg-accent/10' : 'border-border hover:border-faint'}`;
              const content = (
                <>
                  <span className="text-[13px]">{option.label}</span>
                  {option.description && <span className="block text-[11px] text-muted">{option.description}</span>}
                </>
              );
              return q.multiSelect ? (
                <Checkbox key={option.label} checked={checked} onChange={() => toggle(q, option.label)} className={row} dataAttrs={{ 'data-question-option': option.label }}>
                  {content}
                </Checkbox>
              ) : (
                <Radio key={option.label} checked={checked} tabbable={noneChecked && i === 0} onSelect={() => toggle(q, option.label)} className={row} dataAttrs={{ 'data-question-option': option.label }}>
                  {content}
                </Radio>
              );
            });
            return q.multiSelect ? (
              options
            ) : (
              <RadioGroup label={q.question} className="grid gap-1.5">
                {options}
              </RadioGroup>
            );
          })()}
          <input
            value={other[q.question] ?? ''}
            onChange={(e) => setOther((c) => ({ ...c, [q.question]: e.target.value }))}
            placeholder={q.multiSelect ? 'Something else (optional)' : 'Or type your own answer'}
            aria-label={`Your own answer to: ${q.question}`}
            className="h-7 rounded-md border border-border bg-bg px-2 text-[12px] outline-none focus:border-accent-ink/60"
          />
        </fieldset>
      ))}
      <div className="flex items-center gap-1.5">
        <button type="submit" disabled={busy || !complete} className={`${button} bg-accent text-on-accent`}>
          Answer
        </button>
        <DenyWithFeedback respond={respond} busy={busy} label="Skip" />
        {!complete && !busy && <span className="text-[11px] text-muted">{questions.length > 1 ? 'Answer every question to send.' : 'Pick an answer to send.'}</span>}
      </div>
      {error && (
        <p className="text-[12px] text-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function PlanApproval({ request, titleId }: { request: PermissionRequest; titleId: string }) {
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
      <h2 id={titleId} className="text-[13px] font-medium">
        {permissionTitle(request, null)}
      </h2>
      <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border bg-bg px-3 py-2">
        <Markdown text={plan} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void approveWithEdits()}
          data-tooltip="Start, and let Claude edit files without asking each time"
          className={`${button} bg-accent text-on-accent`}
        >
          Approve and accept edits
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond({ behavior: 'allow' })}
          data-tooltip="Start, and ask before each file edit"
          className={`${button} border border-border text-text`}
        >
          Approve, ask before edits
        </button>
        <DenyWithFeedback respond={respond} busy={busy} label="Keep planning" />
      </div>
      {error && (
        <p className="text-[12px] text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A pending permission prompt, rendered above the composer. It's a labelled region, so VoiceOver
 * users can jump to it; the session view announces it when it appears.
 */
export function PermissionCard({ request, cwd }: { request: PermissionRequest; cwd: string | null }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-warn/50 bg-warn/5 px-4 py-3 shadow-sm" data-permission-request>
      {request.agentId && <p className="mb-1 text-[11px] text-muted">From a subagent</p>}
      {request.toolName === 'AskUserQuestion' ? (
        <AskUserQuestion request={request} titleId={titleId} />
      ) : request.toolName === 'ExitPlanMode' ? (
        <PlanApproval request={request} titleId={titleId} />
      ) : (
        <ToolPermission request={request} cwd={cwd} titleId={titleId} />
      )}
    </section>
  );
}
