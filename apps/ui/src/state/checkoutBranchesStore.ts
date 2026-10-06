import { create } from 'zustand';

interface CheckoutBranchesState {
  /** The branch checked out right now in a session's folder, read from git (null: detached HEAD). */
  byCwd: Map<string, string | null>;
  /** Goes up after every branch switch, so views of the same checkout reload what depends on it. */
  switches: number;
  set(cwds: string[], branch: string | null): void;
  switched(): void;
}

/**
 * Live branches of checkouts, as the session header reads them. Transcripts only record the branch
 * Claude Code last saw; the header and the sidebar rows of running sessions show this one instead.
 */
export const useCheckoutBranches = create<CheckoutBranchesState>()((set) => ({
  byCwd: new Map(),
  switches: 0,
  set: (cwds, branch) =>
    set((state) => {
      if (cwds.every((cwd) => state.byCwd.has(cwd) && state.byCwd.get(cwd) === branch)) return {};
      const byCwd = new Map(state.byCwd);
      for (const cwd of cwds) byCwd.set(cwd, branch);
      return { byCwd };
    }),
  switched: () => set((state) => ({ switches: state.switches + 1 })),
}));
