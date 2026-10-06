import { Download, Upload, type LucideIcon } from 'lucide-react';
import { useBackup } from '../../state/backupStore.ts';

function Row({ label, detail, button, icon: Icon, onClick, attr }: { label: string; detail: string; button: string; icon: LucideIcon; onClick(): void; attr: `data-${string}` }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-[12.5px]">{label}</span>
        <span className="block text-[12px] text-muted">{detail}</span>
      </span>
      <button type="button" onClick={onClick} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] text-text hover:bg-border/50" {...{ [attr]: true }}>
        <Icon size={13} /> {button}
      </button>
    </div>
  );
}

/** Settings → Backup: export to and import from a settings file. */
export function BackupSettings() {
  const show = useBackup((s) => s.show);
  return (
    <div className="grid gap-4">
      <Row
        label="Export settings"
        detail="Choose what to include and save it to a file."
        button="Export settings…"
        icon={Upload}
        onClick={() => show('export')}
        attr="data-backup-export"
      />
      <Row
        label="Import settings"
        detail="See what a file would change before anything happens. Your current settings are backed up first."
        button="Import settings…"
        icon={Download}
        onClick={() => show('import')}
        attr="data-backup-import"
      />
    </div>
  );
}
