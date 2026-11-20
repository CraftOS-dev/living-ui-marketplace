/**
 * "Your theses" (fix 3): one card per thesis that says what it is in words:
 * its name, its criteria as plain chips ("Fintech", "Seed to Series A",
 * "US and Europe"), how many new companies wait for review, and when the
 * app last looked and where ("Checked 2 h ago from SEC filings, Show HN and
 * GitHub"). A card opens the thesis. Fix 4: its parts (name / Looks for /
 * to review) are divided by hairlines.
 */
import { ChevronRight } from 'lucide-react';
import { StatusDot, Tag } from '../ui.tsx';
import { useMe } from '../../lib/auth.ts';
import type { ThesisTile } from './types.ts';
import { agoWords, criteriaChips, sourcesPhrase } from './types.ts';

/** "Checked 2 h ago from SEC filings and Show HN", or what keeps it from checking. */
export function checkedLine(t: ThesisTile, pulling: boolean): string {
  const r = t.radar;
  if (pulling) return 'Checking the sources now';
  if (r === null) return 'Not looking for companies yet';
  const from = r.sources.length > 0 ? ` from ${sourcesPhrase(r.sources)}` : '';
  if (r.status === 'paused') return `Paused; last checked${r.last_run_at !== '' ? ` ${agoWords(r.last_run_at)}` : ' never'}`;
  if (r.last_run_at === '') return `First check ${r.schedule.label !== undefined && r.schedule.label !== '' ? `on ${r.schedule.label}` : 'soon'}${from}`;
  return `Checked ${agoWords(r.last_run_at)}${from}`;
}

/** "12 new companies to review" (net-new: screened in plus waiting for your AI agent). */
export function reviewLine(n: number): React.JSX.Element {
  if (n === 0) return <span className="text-[var(--vo-muted)]">No new companies to review</span>;
  return (
    <span>
      <span className="vo-mono vo-num font-semibold">{n}</span> new {n === 1 ? 'company' : 'companies'} to review
    </span>
  );
}

export function ThesisCards({ tiles, pulling, onOpen }: { tiles: ThesisTile[]; pulling: Set<string>; onOpen: (id: string) => void }): React.JSX.Element {
  const me = useMe();
  const cur = me?.firm.base_currency ?? 'USD';
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {tiles.map((t) => {
        const busy = pulling.has(t.id) || (t.radar !== null && t.radar.steps.state === 'screening');
        const chips = criteriaChips(t.criteria, cur);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className="vo-panel vo-focus group flex min-w-0 cursor-pointer flex-col divide-y divide-[var(--vo-line)] overflow-hidden text-left transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]"
          >
            <span className="flex min-w-0 items-center gap-2 px-4 py-3">
              <span className="vo-wrap min-w-0 flex-1 text-[14px] font-semibold leading-5 text-[var(--vo-ink)]">{t.name}</span>
              {busy && <StatusDot tone="agent" pulse title={pulling.has(t.id) ? 'Checking the sources' : 'Your AI agent is screening what was found'} />}
              <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--vo-muted)] transition-colors duration-150 group-hover:text-[var(--vo-ink)]" />
            </span>
            {chips.length > 0 && (
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3">
                <span className="text-[12px] text-[var(--vo-muted)]">Looks for</span>
                <span className="flex min-w-0 flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <Tag key={c} className="max-w-full">
                      <span className="truncate">{c}</span>
                    </Tag>
                  ))}
                </span>
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-1 px-4 py-3">
              <span className="text-[13px] text-[var(--vo-ink)]">{reviewLine(t.net_new)}</span>
              <span className="vo-wrap text-[12px] leading-4 text-[var(--vo-muted)]">{checkedLine(t, pulling.has(t.id))}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
