/**
 * Which radars this tab is pulling right now (radars.run answers when the
 * sources have answered, a few seconds to half a minute). Kept outside the
 * page so the Pull dot survives the page remounting on a new thesis route.
 */
import { useSyncExternalStore } from 'react';
import { op } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';

const now = new Set<string>();
const subs = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const fn of subs) fn();
}

/** Run a radar now; the thesis shows Pull until the sources answered. */
export async function runRadar(radarId: string, thesisId: string): Promise<void> {
  if (now.has(thesisId)) return;
  now.add(thesisId);
  bump();
  try {
    await act([], () => op('radars.run', { radar: radarId }), ['signals', 'radars', 'theses', 'agent_requests']);
  } finally {
    now.delete(thesisId);
    bump();
  }
}

export function usePulling(): Set<string> {
  useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
  );
  return now;
}
