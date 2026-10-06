import { create } from 'zustand';

/** The settings export or import dialog, opened from Settings → Backup or the command palette. */
interface BackupState {
  open: 'export' | 'import' | null;
  show(which: 'export' | 'import'): void;
  close(): void;
}

export const useBackup = create<BackupState>()((set) => ({
  open: null,
  show: (open) => set({ open }),
  close: () => set({ open: null }),
}));
