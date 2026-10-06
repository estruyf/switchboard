/** An on/off switch (`role="switch"`). Pass `label` for its accessible name when it has no visible label. */
export function Switch({ checked, onChange, disabled, label, dataAttrs }: { checked: boolean; onChange(checked: boolean): void; disabled?: boolean; label?: string; dataAttrs?: Record<`data-${string}`, string | boolean | undefined> }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-border'}`}
      {...dataAttrs}
    >
      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/** A labelled on/off switch, as in Settings. `attr` is the data- hook the smoke test clicks. */
export function Toggle({ label, detail, checked, attr, onChange }: { label: string; detail: string; checked: boolean; attr: string; onChange(checked: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-[12.5px]">{label}</span>
        <span className="block text-[12px] text-muted">{detail}</span>
      </span>
      <Switch checked={checked} onChange={onChange} dataAttrs={{ [attr as `data-${string}`]: true }} />
    </label>
  );
}
