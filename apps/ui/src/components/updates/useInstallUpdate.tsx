import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useQuitImpact } from '../QuitPrompt.tsx';

/**
 * Restarting to update quits Switchboard, so with sessions or terminals open it asks first,
 * the way the quit prompt does. Render `dialog` somewhere in the caller.
 */
export function useInstallUpdate(): { install(): void; dialog: ReactNode } {
  const impact = useQuitImpact();
  const [asking, setAsking] = useState(false);
  const install = () => (impact ? setAsking(true) : window.switchboard?.update('install'));
  const dialog = asking ? (
    <ConfirmDialog
      title="Restart to update?"
      body={
        <>
          <p>{impact}</p>
          <p className="mt-2">Switchboard installs the update and opens again.</p>
        </>
      }
      confirmLabel="Restart and update"
      onConfirm={async () => window.switchboard?.update('install')}
      onClose={() => setAsking(false)}
    />
  ) : null;
  return { install, dialog };
}
