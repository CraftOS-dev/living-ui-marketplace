/**
 * What your AI agent did: a timeline by day of everything it created,
 * proposed, posted, matched and read, each linked to its record, with how
 * busy it was per day and what waits on people now.
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight, Bot, Inbox, Sparkles, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { EVENT_GROUPS, clock, eventGroup, eventIcon, localDay, openRecord } from '../../components/agent/words.ts';
import { Bars } from '../../components/charts.tsx';
import type { BarPoint } from '../../components/charts.tsx';
import { Chips, Segmented } from '../../components/controls.tsx';
import { Card, CardHeader, Empty, LoadError, PageHeader, PageSkeleton, StatusPill } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addDays, dayLabel, today } from '../../lib/dates.ts';
import { plural } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { AgentActivity } from '../../lib/types/agent.ts';
import type { AuditEntry } from '../../lib/types.ts';

type Range = '7' | '30' | '90';
const IMPORT_ENTITIES = new Set(['parties', 'items', 'accounts', 'employees', 'opening_accounts', 'opening_documents', 'opening_stock']);

function linkOf(e: AuditEntry): (() => void) | null {
  if ((e.kind === 'import' || e.kind === 'import_undo') && IMPORT_ENTITIES.has(e.entity)) return () => navigate('settings', { tab: 'import' });
  return openRecord(e.entity, e.ref);
}

export function AgentActivityPage({ query }: PageProps): React.JSX.Element {
  const range: Range = query.get('range') === '30' ? '30' : query.get('range') === '90' ? '90' : '7';
  const group = query.get('kind') ?? '';
  const [day, setDay] = useState('');
  const from = addDays(today(), -(Number(range) - 1));
  const data = useLive(() => op<AgentActivity>('agent.activity', { from, limit: 500 }, { quiet: true }), ['audit', ...READS.agent], [from]);

  const setQuery = (next: { range?: Range | undefined; kind?: string | undefined }): void => {
    const r = next.range ?? range;
    const k = next.kind ?? group;
    replaceQuery('agent-activity', { range: r === '7' ? undefined : r, kind: k === '' ? undefined : k });
  };

  const entries = data.data?.entries ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) {
      const g = eventGroup(e.kind);
      c[g] = (c[g] ?? 0) + 1;
    }
    return c;
  }, [entries]);
  const shown = entries.filter((e) => (group === '' || eventGroup(e.kind) === group) && (day === '' || localDay(e.at) === day));
  const days = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of shown) {
      const d = localDay(e.at);
      const last = out[out.length - 1];
      if (last !== undefined && last.day === d) last.items.push(e);
      else out.push({ day: d, items: [e] });
    }
    return out;
  }, [shown]);
  const points: BarPoint[] = useMemo(() => {
    const per: Record<string, number> = {};
    for (const e of entries) {
      if (group !== '' && eventGroup(e.kind) !== group) continue;
      const d = localDay(e.at);
      per[d] = (per[d] ?? 0) + 1;
    }
    const n = Number(range);
    const t = today();
    return Array.from({ length: n }, (_, i) => {
      const d = addDays(t, i - n + 1);
      const v = per[d] ?? 0;
      const axis = n <= 7 ? new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).toLocaleDateString(undefined, { weekday: 'short' }) : String(Number(d.slice(8, 10)));
      return { key: d, label: dayLabel(d), axis, value: v, text: plural(v, 'action'), current: d === t };
    });
  }, [entries, range, group]);

  if (data.data === null && data.error !== null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null) return <PageSkeleton rows={6} />;
  const a = data.data;

  return (
    <div>
      <PageHeader title="What your AI agent did" subtitle="Everything it created, proposed, posted, matched and read, newest first." />

      <div className="mb-5 grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="dark" className="@min-[900px]:col-span-5" delay={1}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-[var(--erp-dark-2)] text-[var(--erp-accent)]">
              <Sparkles size={18} aria-hidden />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Today</p>
              <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{plural(a.today, 'action')}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => navigate('proposals')} className="rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
              <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Proposals waiting</span>
              <span className="num mt-0.5 flex items-center gap-1.5 text-[15px] font-bold">
                {a.proposals_waiting}
                <ArrowUpRight size={14} aria-hidden className="text-[var(--erp-on-dark-muted)]" />
              </span>
            </button>
            <button type="button" onClick={() => navigate('inbox')} className="rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
              <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Files to read</span>
              <span className="num mt-0.5 flex items-center gap-1.5 text-[15px] font-bold">
                {a.inbox_waiting}
                <ArrowUpRight size={14} aria-hidden className="text-[var(--erp-on-dark-muted)]" />
              </span>
            </button>
          </div>
          <p className="mt-4 text-[12px] leading-5 text-[var(--erp-on-dark-muted)]">It works while it is running, through the same operations as the screens, and only posts what you approve or allowed in Settings.</p>
        </Card>
        <Card className="@min-[900px]:col-span-7" delay={2}>
          <CardHeader title="Actions per day" subtitle={`The last ${range} days`} />
          <Bars points={points} height={150} onPick={(d) => setDay(d === day ? '' : d)} format={(n) => String(Math.round(n))} />
        </Card>
      </div>

      <div className="erp-rise erp-d2 mb-4 flex flex-wrap items-center gap-3">
        <Chips
          ariaLabel="Kind"
          value={group}
          onChange={(k) => setQuery({ kind: k })}
          className="w-full min-w-0 @min-[640px]:w-auto @min-[640px]:flex-1"
          options={[
            { value: '', label: 'Everything', count: entries.length },
            ...EVENT_GROUPS.map((g) => ({ value: g.value, label: g.label, count: counts[g.value] ?? 0 })),
            ...((counts['other'] ?? 0) > 0 ? [{ value: 'other', label: 'Other', count: counts['other'] }] : []),
          ]}
        />
        <Segmented
          ariaLabel="Period"
          onShell
          value={range}
          onChange={(r) => {
            setDay('');
            setQuery({ range: r });
          }}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />
      </div>

      {day !== '' && (
        <div className="mb-4 flex">
          <button type="button" onClick={() => setDay('')} className="erp-on-ink inline-flex h-9 items-center gap-2 rounded-full bg-[var(--erp-ink)] pl-4 pr-2 text-[13px] font-semibold text-[var(--erp-shell)]">
            Only {dayLabel(day)}
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--erp-shell)]/15">
              <X size={13} aria-label="Show every day" />
            </span>
          </button>
        </div>
      )}

      <Card delay={3}>
        {days.length === 0 ? (
          <Empty icon={Bot} title="Nothing in this period">
            When your AI agent reads a file, drafts a document or proposes a posting, it shows here.
          </Empty>
        ) : (
          <div className="flex flex-col gap-6">
            {days.map((d) => (
              <section key={d.day}>
                <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-[14px] font-bold">{dayLabel(d.day)}</h2>
                  <span className="num text-[12px] text-[var(--erp-muted)]">{plural(d.items.length, 'action')}</span>
                </div>
                <ol className="flex flex-col gap-1">
                  {d.items.map((e) => (
                    <Entry key={e.id} e={e} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </Card>
      {entries.length >= 500 && (
        <p className="mt-3 flex items-center gap-2 px-1 text-[12px] text-[var(--erp-muted)]">
          <Inbox size={13} aria-hidden /> Showing the latest 500 actions. Choose a shorter period to see the rest.
        </p>
      )}
    </div>
  );
}

function Entry({ e }: { e: AuditEntry }): React.JSX.Element {
  const Icon = eventIcon(e.kind);
  const go = linkOf(e);
  const failed = e.kind === 'read_failed';
  const body = (
    <>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', failed ? 'bg-[var(--erp-red)]/15 text-[var(--erp-red-text)]' : 'bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]')}>
        <Icon size={16} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-5">{e.summary !== '' ? e.summary : e.label}</span>
        {e.label !== '' && e.summary !== '' && e.entity !== 'proposals' && e.kind !== 'read' && e.kind !== 'read_failed' && <span className="block truncate text-[12px] text-[var(--erp-muted)]">{e.label}</span>}
      </span>
      {e.kind === 'propose' && (
        <StatusPill tone="accent" size="sm" className="hidden @min-[480px]:inline-flex">
          Proposal
        </StatusPill>
      )}
      <span className="num shrink-0 whitespace-nowrap text-right text-[12px] text-[var(--erp-muted)]">{clock(e.at)}</span>
      {go !== null && <ArrowUpRight size={15} aria-hidden className="shrink-0 text-[var(--erp-muted)]" />}
    </>
  );
  return (
    <li>
      {go !== null ? (
        <button type="button" onClick={go} className="flex w-full items-center gap-3 rounded-[16px] px-2 py-2 text-left transition-colors hover:bg-[var(--erp-row)]">
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-2 py-2">{body}</div>
      )}
    </li>
  );
}

