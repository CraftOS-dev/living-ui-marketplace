/**
 * The deal's Overview: on the left the deal's own facts, the deck facts
 * with their grades and the thesis checks (intake.verdict); on the right
 * the brief for the next meeting (network), the next steps (tasks) and the
 * timeline of every module (records.timeline).
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Briefcase, Building2, CalendarCheck, CalendarClock, CheckCheck, Circle, CircleDot, FileText, Gavel, Grid3x3, Inbox, Landmark, Layers, LayoutGrid, Mail, NotebookPen, PhoneCall, Plus, Presentation, Radar, Scale, Sparkle, Target, TriangleAlert, User, UserPlus, Vote, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AgentTag, Avatar, Checkbox, CheckChip, Citation, Fact, GradeDot, Input, Panel, Sheet, SheetHeader, Skeleton, StepTrack, Tag, Tip } from '../ui.tsx';
import type { Check3, Grade } from '../ui.tsx';
import { op, runOp } from '../../lib/api.ts';
import { ago, fmtDay, humanize, time } from '../../lib/format.ts';
import { act, drop, insert, tempId, useLive, useOp } from '../../lib/live.ts';
import { useMe } from '../../lib/auth.ts';
import type { Deal, TaskView } from './types.ts';

interface VerdictFact {
  key: string;
  label: string;
  text: string;
  grade: Grade;
  file?: string | undefined;
  file_name?: string | undefined;
  page?: number | undefined;
}

interface Verdict {
  item: { id: string; number: string; name: string } | null;
  facts: VerdictFact[];
  checks: { thesis: { id: string; name: string }; state: Check3; checks: { key: string; label: string; status: Check3; required: boolean }[] }[];
  missing: { key: string; label: string }[];
}

interface BriefRow {
  id: string;
  state: 'queued' | 'reading' | 'ready' | 'failed';
  steps: { labels: string[]; at: number } | null;
  event: { id: string; title: string; start_at: string; deal: { id: string } | null };
}

interface BriefFull {
  id: string;
  state: string;
  sections: Record<string, string>;
  event: { title: string; start_at: string } | null;
  attendees: { name: string; external: boolean; strength: { band: string } | null }[];
}

interface TimelineItem {
  at: string;
  module: string;
  kind: string;
  title: string;
  href?: string | undefined;
  icon?: string | undefined;
  actor?: string | undefined;
}

const SOURCE: Record<string, string> = { inbound: 'Inbound', referral: 'Referral', outbound: 'Outbound', scout: 'Scout', event: 'Event', sourced: 'Sourced', co_investor: 'Co-investor', portfolio: 'Portfolio', other: 'Other' };
const INSTRUMENT: Record<string, string> = { safe_cap: 'SAFE (cap)', safe_discount: 'SAFE (discount)', safe_mfn: 'SAFE (MFN)', note: 'Note', priced: 'Priced', other: 'Other' };
const BRIEF_LABEL: Record<string, string> = { who: 'Who', history: 'History', deal: 'Deal', questions: 'Questions', news: 'News' };

/** Timeline items name their icon; the ones the modules send (lucide names), else a plain dot. */
const ICONS: Record<string, LucideIcon> = { ArrowRight, Briefcase, Building2, CalendarCheck, CalendarClock, CheckCheck, CircleDot, FileText, Gavel, Grid3x3, Inbox, Landmark, Layers, LayoutGrid, Mail, NotebookPen, PhoneCall, Presentation, Radar, Scale, Sparkle, Target, TriangleAlert, User, UserPlus, Vote, Waypoints };

function iconOf(name: string | undefined): LucideIcon {
  return (name !== undefined ? ICONS[name] : undefined) ?? Circle;
}

function BriefSheet({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const live = useOp<{ brief: BriefFull }>('briefs.get', { brief: id }, ['briefs', 'cal_events'], { name: 'briefs.get' });
  const b = live.data?.brief ?? null;
  return (
    <Sheet open onClose={onClose} label="Brief" width={560}>
      <SheetHeader title={b?.event?.title ?? 'Brief'} onClose={onClose} actions={b !== null ? <AgentTag /> : undefined} />
      <div className="vo-scroll flex-1 overflow-y-auto p-5">
        {b === null ? (
          <Skeleton className="h-60 w-full" />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {b.attendees.filter((a) => a.external).map((a) => (
                <span key={a.name} className="inline-flex items-center gap-1.5 text-[13px]">
                  <Avatar name={a.name} size={20} />
                  {a.name}
                </span>
              ))}
            </div>
            <dl className="flex flex-col gap-3">
              {Object.entries(b.sections)
                .filter(([, v]) => v !== '')
                .map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
                    <dt className="text-[12px] leading-5 text-[var(--vo-muted)]">{BRIEF_LABEL[k] ?? humanize(k)}</dt>
                    <dd className="vo-wrap whitespace-pre-wrap text-[13px] leading-5">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function NextSteps({ deal, canWrite }: { deal: Deal; canWrite: boolean }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ tasks: TaskView[] }>('tasks.list', { deal: deal.id, view: 'all', status: 'open', limit: 50 }, ['tasks'], { name: 'deal.tasks' });
  const [text, setText] = useState('');
  const tasks = live.data?.tasks ?? [];
  const add = async (): Promise<void> => {
    const title = text.trim();
    if (title === '') return;
    setText('');
    await act([insert('tasks', { id: tempId(), title, assignee: me.member.id, assignee_name: me.member.name, due_day: '', status: 'open', actor: 'person', deal: deal.id })], () => op('tasks.save', { title, ref_collection: 'deals', ref_id: deal.id }), ['tasks']);
  };
  const done = (t: TaskView): void => {
    void act([drop(t.id)], () => op('tasks.complete', { task: t.id }), ['tasks']);
  };
  return (
    <Panel label="Next steps" flush>
      {live.data === null ? (
        <Skeleton className="m-4 h-16" />
      ) : (
        <ul className="flex flex-col">
          {tasks.map((t) => (
            <li key={t.id} className="flex h-9 min-w-0 items-center gap-2.5 border-b border-[var(--vo-hair)] px-4">
              <Checkbox label={`Done: ${t.title}`} hideLabel checked={false} onChange={() => done(t)} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
              {t.actor === 'agent' && <AgentTag />}
              {t.assignee_name !== '' && (
                <Tip text={t.assignee_name}>
                  <Avatar name={t.assignee_name} size={20} />
                </Tip>
              )}
              <span className="vo-mono vo-num w-14 shrink-0 text-right text-[12px] text-[var(--vo-muted)]">{t.due_day !== '' ? fmtDay(t.due_day, { year: 'auto' }) : ''}</span>
            </li>
          ))}
          {canWrite && (
            <li className="flex h-10 items-center gap-2 px-3">
              <Plus size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
              <Input aria-label="Add a next step" placeholder="Add a step" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} className="h-8 border-transparent bg-transparent px-1 shadow-none hover:border-[var(--vo-line)]" />
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

function Timeline({ deal }: { deal: Deal }): React.JSX.Element {
  const live = useOp<{ items: TimelineItem[] }>('records.timeline', { deal: deal.id, limit: 40 }, ['stage_events', 'notes', 'files', 'deals', 'intake_items', 'memos', 'decisions', 'holdings'], { name: 'deal.timeline' });
  const items = live.data?.items ?? [];
  return (
    <Panel label="Timeline" flush>
      {live.data === null ? (
        <Skeleton className="m-4 h-24" />
      ) : items.length === 0 ? (
        <div className="px-4 py-3 text-[13px] text-[var(--vo-muted)]">Nothing yet</div>
      ) : (
        <ol className="vo-scroll flex max-h-[420px] flex-col overflow-y-auto">
          {items.map((it, i) => {
            const Icon = iconOf(it.icon);
            const row = (
              <>
                <Icon size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
                <span className="vo-wrap min-w-0 flex-1 text-[13px] leading-5">{it.title}</span>
                {it.actor === 'agent' && <AgentTag />}
                <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]">{ago(it.at)}</span>
              </>
            );
            return (
              <li key={it.at + i} className="border-b border-[var(--vo-hair)] last:border-b-0">
                {it.href !== undefined && it.href !== '' ? (
                  <a href={it.href} className="vo-focus flex min-h-9 items-center gap-2.5 px-4 py-1.5 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                    {row}
                  </a>
                ) : (
                  <div className="flex min-h-9 items-center gap-2.5 px-4 py-1.5">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

export function OverviewTab({ deal, canWrite }: { deal: Deal; canWrite: boolean }): React.JSX.Element {
  // intake's op, named as data so the deal page does not compile against another module's catalog.
  const verdict = useLive<Verdict>((signal) => runOp<Verdict>('intake.verdict', { deal: deal.id }, { quiet: true, signal }), ['intake_items', 'facts'], [deal.id], { name: 'deal.verdict' });
  const briefs = useOp<{ briefs: BriefRow[] }>('briefs.list', {}, ['briefs', 'cal_events'], { name: 'briefs.list' });
  const [briefOpen, setBriefOpen] = useState('');
  const brief = useMemo(() => (briefs.data?.briefs ?? []).find((b) => b.event.deal?.id === deal.id) ?? null, [briefs.data, deal.id]);
  const v = verdict.data;
  const founders = deal.people.filter((p) => p.role === 'founder');
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel label="Deal">
          <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {deal.company !== null && (
              <Fact label="Company">
                <a href={'#/companies/' + deal.company.id} className="vo-link">
                  {deal.company.domain || deal.company.name}
                </a>
              </Fact>
            )}
            {founders.length > 0 && (
              <Fact label="Founders">
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {founders.map((f) => (
                    <a key={f.id} href={'#/people/' + f.id} className="vo-link inline-flex items-center gap-1.5">
                      <Avatar name={f.name} size={18} />
                      {f.name}
                    </a>
                  ))}
                </span>
              </Fact>
            )}
            {deal.source !== '' && <Fact label="Source">{SOURCE[deal.source] ?? deal.source}</Fact>}
            {deal.source_person !== null && <Fact label="Introduced by">{deal.source_person.name}</Fact>}
            {deal.fund !== null && <Fact label="Fund">{deal.fund.name}</Fact>}
            {deal.instrument !== '' && <Fact label="Instrument">{INSTRUMENT[deal.instrument] ?? deal.instrument}</Fact>}
          </div>
        </Panel>
        {v !== null && v.facts.length > 0 && (
          <Panel label="Facts" aside={v.item !== null ? <a href={'#/inbox?item=' + v.item.id} className="vo-link vo-mono text-[12px]">{v.item.number}</a> : undefined}>
            <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {v.facts.map((f) => (
                <div key={f.key} className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px] text-[var(--vo-muted)]">
                    <GradeDot grade={f.grade} />
                    <span className="truncate">{f.label}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <span className={f.grade === 'unknown' ? 'text-[13px] text-[var(--vo-muted)]' : 'vo-mono vo-num truncate text-[13px]'}>{f.text}</span>
                    {f.page !== undefined && f.page > 0 && <Citation label={`p.${f.page}`} quote={f.file_name} />}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
        {v !== null && (v.checks.length > 0 || v.missing.length > 0) && (
          <Panel label="Thesis">
            <div className="flex min-w-0 flex-col gap-3">
              {v.checks.map((t) => (
                <div key={t.thesis.id} className="flex min-w-0 flex-col gap-2">
                  <span className="text-[13px] font-medium">{t.thesis.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {t.checks.map((c) => (
                      <CheckChip key={c.key} state={c.status} label={c.label} />
                    ))}
                  </div>
                </div>
              ))}
              {v.missing.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[12px] text-[var(--vo-muted)]">Missing</span>
                  {v.missing.map((m) => (
                    <Tag key={m.key} tone="warn" icon={FileText}>
                      {m.label}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        {brief !== null && (
          <Panel label="Brief" flush>
            <button type="button" onClick={() => brief.state === 'ready' && setBriefOpen(brief.id)} className="vo-focus vo-tap flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
              <CalendarClock size={15} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{brief.event.title}</span>
                <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">
                  {fmtDay(brief.event.start_at, { year: 'auto', weekday: true })} {time(brief.event.start_at)}
                </span>
              </span>
              {brief.state === 'ready' ? (
                <span className="inline-flex items-center gap-1.5 text-[13px]">
                  <Sparkle size={13} aria-hidden />
                  Brief
                  <ArrowRight size={13} aria-hidden />
                </span>
              ) : brief.steps !== null ? (
                <StepTrack labels={brief.steps.labels} at={brief.steps.at} compact className="w-16" />
              ) : null}
            </button>
          </Panel>
        )}
        <NextSteps deal={deal} canWrite={canWrite} />
        <Timeline deal={deal} />
      </div>
      {briefOpen !== '' && <BriefSheet id={briefOpen} onClose={() => setBriefOpen('')} />}
    </div>
  );
}
