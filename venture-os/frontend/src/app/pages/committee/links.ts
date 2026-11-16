/**
 * Old deal links: the Memo and Decision tabs became one IC tab. A link with
 * `?tab=memo` or `?tab=decision` (sent before, or written by another
 * module) opens the IC tab; `memo` keeps its place with `part=memo`.
 * Loaded once with the committee module.
 */
import { currentRoute, setQuery } from '../../lib/router.ts';

function rewrite(): void {
  const r = currentRoute();
  if (!/^\/deals\/[^/]+$/.test(r.path)) return;
  const tab = r.query.get('tab');
  if (tab === 'memo') setQuery({ tab: 'ic', part: 'memo' });
  else if (tab === 'decision') setQuery({ tab: 'ic' });
}

let installed = false;

/** Rewrite the current link now and on every later hash change. */
export function installIcLinks(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('hashchange', rewrite);
  rewrite();
}
