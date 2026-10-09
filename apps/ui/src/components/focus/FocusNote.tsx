import { ListEnd, Target } from 'lucide-react';
import { basename } from '../../lib/format.ts';
import type { FocusSummary } from '../../state/focusGate.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { FOCUS_DOT, FOCUS_TEXT, focusStateLabel } from './focusLabels.ts';

/**
 * Above the message box in New session, at the focus limit: the sessions that count, each with Open,
 * and a way to queue the idea. Start stays where it is (it asks first); Nudge also offers Start anyway here.
 */
export function FocusNote({ focus, now, canSave, onSaveForLater, onStartAnyway }: { focus: FocusSummary; now: number; canSave: boolean; onSaveForLater(): void; onStartAnyway(): void }) {
  const projects = useProjects((s) => s.projects);
  if (focus.limit === null) return null;
  const strict = focus.mode === 'strict';
  return (
    <Notice tone="accent" role="note" icon={<Target size={15} aria-hidden />} className="px-3.5! py-3!" data-focus-note={strict ? 'strict' : 'nudge'}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ui font-semibold text-text">
            You have {focus.count} of {focus.limit} sessions going
          </p>
          <p className="text-ui text-muted">That's your focus limit. Finish or read one of these first, or add this idea to the queue.</p>
        </div>
        <Button variant="quiet" size="sm" onClick={() => useSessions.getState().openSettings('focus')} className="-mt-0.5 shrink-0" data-focus-change-limit>
          Change limit
        </Button>
      </div>
      <ul className="mt-2 grid">
        {focus.sessions.map((session) => {
          const projectName = projects.get(session.projectRoot)?.name ?? basename(session.projectRoot);
          return (
            <li key={session.id} className="flex h-8 min-w-0 items-center gap-2.5" data-focus-session={session.id}>
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${FOCUS_DOT[session.state]}`} />
              <ProjectIcon project={projects.get(session.projectRoot)} root={session.projectRoot} size={16} />
              <span className="min-w-0 flex-1 truncate text-ui text-text">
                {session.title}
                <span className="text-faint"> · {projectName}</span>
              </span>
              <span className={`shrink-0 text-meta ${FOCUS_TEXT[session.state]}`}>{focusStateLabel(session, now)}</span>
              <Button size="sm" onClick={() => useSessions.getState().select(session.id)} aria-label={`Open ${session.title}`} data-focus-open={session.id}>
                Open
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2 border-t border-accent-ink/20 pt-2.5">
        <Button
          icon={<ListEnd size={13} aria-hidden />}
          onClick={onSaveForLater}
          disabled={!canSave}
          data-tooltip={canSave ? 'Keep this prompt, folder and settings in the queue' : 'Type a prompt to add it to the queue'}
          data-focus-save-later
        >
          Add to queue
        </Button>
        {!strict && (
          <Button variant="quiet" onClick={onStartAnyway} disabled={!canSave} className="ml-auto" data-focus-start-anyway>
            Start anyway
          </Button>
        )}
      </div>
    </Notice>
  );
}
