import type { ReactNode } from 'react';
import type { ColorScheme, SidebarStyle, ToolActivity } from '@switchboard/protocol/bridge';
import { usePreferences } from '../state/preferencesStore.ts';
import { ProfilesSettings } from './profiles/ProfilesSettings.tsx';

/** The Demo Time palettes, fixed here so each preview shows its own theme whatever is active. */
const PALETTE = {
  light: { bg: '#ffffff', sidebar: '#f4f6fa', line: '#d1d5db', text: '#202736', accent: '#ffd43b' },
  dark: { bg: '#15181f', sidebar: '#202736', line: '#374151', text: '#d9dbe1', accent: '#ffd43b' },
};

function ThemePreview({ theme }: { theme: 'light' | 'dark' }) {
  const p = PALETTE[theme];
  return (
    <div className="absolute inset-0 flex" style={{ background: p.bg }}>
      <div className="flex w-[34%] flex-col gap-1.5 p-2" style={{ background: p.sidebar }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: p.text, opacity: 0.7 }} />
        <div className="h-3 rounded" style={{ background: p.accent, opacity: 0.35 }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: p.line }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: p.line }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: p.text, opacity: 0.8 }} />
        <div className="h-1.5 w-5/6 rounded-full" style={{ background: p.line }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: p.line }} />
        <div className="mt-auto h-4 rounded border" style={{ borderColor: p.line }}>
          <div className="mt-[3px] mr-[3px] ml-auto h-2 w-5 rounded-sm" style={{ background: p.accent }} />
        </div>
      </div>
    </div>
  );
}

/** A session row in miniature, drawn with the live theme tokens. */
function RowPreview({ style }: { style: SidebarStyle }) {
  const icon = (size: number) => <div className="shrink-0 rounded-[4px] bg-accent" style={{ width: size, height: size }} />;
  const line = (width: string, strong = false) => <div className={`h-1.5 rounded-full ${strong ? 'bg-text/70' : 'bg-faint/50'}`} style={{ width }} />;
  const rows = [0, 1, 2];
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-1.5 bg-sidebar px-3">
      {rows.map((i) =>
        style === 'compact' ? (
          <div key={i} className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${i === 0 ? 'bg-accent/15' : ''}`}>
            {icon(8)}
            {line('60%', true)}
          </div>
        ) : (
          <div key={i} className={`flex items-center gap-2 rounded px-1.5 py-1 ${i === 0 ? 'bg-accent/15' : ''} ${i === 2 ? 'hidden' : ''}`}>
            {style === 'large' && icon(20)}
            <div className="grid flex-1 gap-1">
              <div className="flex items-center gap-1">
                {style === 'standard' && icon(6)}
                {line('40%')}
              </div>
              {line('75%', true)}
              {line('30%')}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** A conversation in miniature: Claude's messages, with its steps summarised or listed. */
function ActivityPreview({ mode }: { mode: ToolActivity }) {
  const line = (width: string, strong = false) => <div className={`h-1.5 rounded-full ${strong ? 'bg-text/60' : 'bg-faint/50'}`} style={{ width }} />;
  const step = (width: string) => (
    <div className="flex items-center gap-1.5 rounded border border-border px-1.5 py-[3px]">
      <div className="size-1.5 rounded-full bg-ok" />
      {line(width)}
    </div>
  );
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-1.5 bg-bg px-3">
      {line('70%', true)}
      {mode === 'summary' ? (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="flex gap-[2px]">
            <span className="size-1 rounded-full bg-accent-ink" />
            <span className="size-1 rounded-full bg-accent-ink/60" />
            <span className="size-1 rounded-full bg-accent-ink/30" />
          </span>
          {line('45%')}
          <span className="text-[8px] leading-none text-faint">›</span>
        </div>
      ) : (
        <>
          {step('50%')}
          {step('35%')}
          {step('42%')}
        </>
      )}
      {line('55%', true)}
    </div>
  );
}

function Choice<T extends string>({ value, current, label, attr, onSelect, children }: { value: T; current: T; label: string; attr: string; onSelect(value: T): void; children: ReactNode }) {
  const selected = value === current;
  return (
    <button type="button" role="radio" aria-checked={selected} {...{ [attr]: value }} onClick={() => onSelect(value)} className="group flex flex-col gap-2 text-left">
      <span className={`relative block h-24 overflow-hidden rounded-lg border ${selected ? 'border-accent-ink ring-2 ring-accent/60' : 'border-border group-hover:border-faint'}`}>{children}</span>
      <span className={`text-[12px] ${selected ? 'font-semibold text-text' : 'text-muted'}`}>{label}</span>
    </button>
  );
}

/** A labelled on/off switch. `attr` is the data- hook the smoke test clicks. */
function Toggle({ label, detail, checked, attr, onChange }: { label: string; detail: string; checked: boolean; attr: string; onChange(checked: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-[12.5px]">{label}</span>
        <span className="block text-[12px] text-muted">{detail}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        {...{ [attr]: true }}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-border'}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-border py-6 last:border-b-0">
      <div>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const SCHEMES: Array<{ value: ColorScheme; label: string }> = [
  { value: 'system', label: 'Match System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const ACTIVITY: Array<{ value: ToolActivity; label: string }> = [
  { value: 'summary', label: 'Summarised' },
  { value: 'steps', label: 'Every step' },
];

const STYLES: Array<{ value: SidebarStyle; label: string }> = [
  { value: 'large', label: 'Large icons' },
  { value: 'standard', label: 'Standard' },
  { value: 'compact', label: 'Compact' },
];

export function SettingsView() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);

  return (
    <div className="flex h-full min-h-0 flex-col" data-settings>
      <header className="drag flex h-13 shrink-0 items-center border-b border-border px-6">
        <h1 className="text-[13px] font-semibold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6">
          <Section title="Theme" description="Colours from the Demo Time theme. Match System follows macOS.">
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-4">
              {SCHEMES.map(({ value, label }) => (
                <Choice key={value} value={value} current={prefs.colorScheme} label={label} attr="data-color-scheme" onSelect={(colorScheme) => update({ colorScheme })}>
                  {value === 'system' ? (
                    <>
                      <ThemePreview theme="light" />
                      <span className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
                        <ThemePreview theme="dark" />
                      </span>
                    </>
                  ) : (
                    <ThemePreview theme={value} />
                  )}
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Sidebar" description="How sessions are listed. Large icons makes each session's project easy to spot.">
            <div role="radiogroup" aria-label="Sidebar style" className="grid grid-cols-3 gap-4">
              {STYLES.map(({ value, label }) => (
                <Choice key={value} value={value} current={prefs.sidebarStyle} label={label} attr="data-sidebar-style" onSelect={(sidebarStyle) => update({ sidebarStyle })}>
                  <RowPreview style={value} />
                </Choice>
              ))}
            </div>
            <Toggle
              label="Show sessions from other apps"
              detail="Also list sessions from Terminal, Claude desktop and your editor. Off shows only sessions you started or continued in Switchboard."
              checked={prefs.sessionScope === 'all'}
              attr="data-session-scope"
              onChange={(all) => update({ sessionScope: all ? 'all' : 'switchboard' })}
            />
          </Section>

          <Section
            title="Conversation"
            description="Summarised shows each run of tool calls as one line, like Claude Code: what Claude is doing, or what it did. Click it to see the steps."
          >
            <div role="radiogroup" aria-label="Tool activity" className="grid grid-cols-3 gap-4">
              {ACTIVITY.map(({ value, label }) => (
                <Choice key={value} value={value} current={prefs.toolActivity} label={label} attr="data-tool-activity" onSelect={(toolActivity) => update({ toolActivity })}>
                  <ActivityPreview mode={value} />
                </Choice>
              ))}
            </div>
          </Section>

          <Section
            title="Claude profiles"
            description="Use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login. Link a project to a profile from its menu or the Projects view; other projects use the default."
          >
            <ProfilesSettings />
          </Section>

          <Section title="Quitting">
            <Toggle
              label="Ask before quitting"
              detail="⌘Q shows a prompt first; pressing ⌘Q again quits."
              checked={prefs.confirmQuit}
              attr="data-confirm-quit"
              onChange={(confirmQuit) => update({ confirmQuit })}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
