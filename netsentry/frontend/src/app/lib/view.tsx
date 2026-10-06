/**
 * Plain words by default; technical words one level deeper. There are no
 * modes or toggles: the deeper pages (an issue's "Technical details", an
 * item's "Everything we see", More settings…) wrap themselves in a
 * DetailScope, and shared components ask `useDetailed()` which words to use.
 */
import { createContext, useContext } from 'react';
import type { Finding, Incident, Remediation } from './types.ts';

const Ctx = createContext(false);

/** Everything inside shows its detailed (technical) version. */
export function DetailScope({ on, children }: { on: boolean; children: React.ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={on}>{children}</Ctx.Provider>;
}

export function useDetailed(): boolean {
  return useContext(Ctx);
}

/** The title to show for an issue in the current view. */
export function issueTitle(f: Pick<Finding, 'title'> & { plain_title?: string }, detailed: boolean): string {
  return detailed ? f.title : f.plain_title || f.title;
}

/** The title to show for a fix in the current view. */
export function fixTitle(r: Pick<Remediation, 'title'> & { plain_title?: string }, detailed: boolean): string {
  return detailed ? r.title : r.plain_title || r.title;
}

/** Case titles are written technically by the server; the simple view says what a case is. */
export function caseTitle(c: Pick<Incident, 'title' | 'finding_count'>, on: string, detailed: boolean): string {
  if (detailed) return c.title;
  return `${c.finding_count} related problem${c.finding_count === 1 ? '' : 's'}${on ? ` on ${on}` : ''}`;
}
