/**
 * Reports: standard reports run on the server (reports/run), shown as a
 * table, exported as CSV or copied as text, and saved (privately or shared)
 * with an optional schedule. Also the digest preview and, for managers, a
 * "send today's digest now" control.
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Bookmark, ClipboardCopy, Download, Mailbox, Play, Send, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection, useLiveReload } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, fmtDate, fmtDateTime, fmtNumber, today } from '../lib/format.ts';
import {
  AGREEMENT_TYPE_LABEL,
  DIRECTION_LABEL,
  DISCLOSURE_STAGE_LABEL,
  INSTRUCTION_LABEL,
  IP_TYPE_LABEL,
  KIND_LABEL,
  RENEWAL_DECISION_LABEL,
  STATUS_LABEL,
  WORK_TYPE_LABEL,
} from '../lib/labels.ts';
import { downloadText, toCsv } from '../lib/csv.ts';
import type { ReportResponse, SavedViewRec } from '../lib/types.ts';
import { DigestPreview } from '../components/adminShared.tsx';
import { EmptyHint, Field, Loading, PageHeader, Pill, Section, Segmented, Tag } from '../components/ui.tsx';

/* ------------------------------------------------------------------ */
/* Report catalog                                                      */
/* ------------------------------------------------------------------ */

type ReportKey = 'deadlines' | 'portfolio' | 'agreements_expiring' | 'chain_of_title' | 'renewal_decisions' | 'forecast' | 'inventions' | 'audit';

interface ReportParams {
  days?: number;
  years?: number;
  include_dead?: boolean;
  from?: string;
  to?: string;
}

interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  defaults: ReportParams;
  editOnly?: boolean;
}

const REPORTS: ReportDef[] = [
  { key: 'deadlines', title: 'Deadlines', description: 'Open deadlines due within the period, overdue ones included, with their legal basis.', defaults: { days: 90 } },
  { key: 'portfolio', title: 'Portfolio register', description: 'Every matter with its numbers, key dates, status and next deadline.', defaults: { include_dead: false } },
  { key: 'agreements_expiring', title: 'Agreements ending', description: 'Active agreements whose term ends within the period.', defaults: { days: 180 } },
  { key: 'chain_of_title', title: 'Chain of title by work', description: 'Clearance status, chain-of-title documents and copyright registrations for each work.', defaults: {} },
  { key: 'renewal_decisions', title: 'Renewal decisions', description: 'Renewals not yet confirmed or lapsed: decision, instruction, fees and provider.', defaults: {} },
  { key: 'forecast', title: 'Renewal forecast', description: 'Renewal and annuity costs expected over the coming years, in your home currency.', defaults: { years: 5 } },
  { key: 'inventions', title: 'Inventions pipeline', description: 'Invention disclosures with stage, review score and earliest bar date.', defaults: {} },
  { key: 'audit', title: 'Audit log', description: 'Who changed what, and why, between two dates.', defaults: {}, editOnly: true },
];

/** What each report reads; a change there re-runs the report on screen. */
const REPORT_SOURCES: Record<ReportKey, string[]> = {
  deadlines: ['deadlines', 'matters', 'agreements', 'users'],
  portfolio: ['matters', 'families', 'properties', 'deadlines'],
  agreements_expiring: ['agreements', 'parties'],
  chain_of_title: ['works', 'clearances', 'matters', 'documents'],
  renewal_decisions: ['renewals', 'matters'],
  forecast: ['renewals', 'deadlines', 'matters', 'goods_services', 'fee_schedule', 'fx_rates', 'settings'],
  inventions: ['disclosures', 'disclosure_reviews', 'involvements'],
  audit: ['audit_log'],
};

const REPORT_BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

function isReportKey(v: unknown): v is ReportKey {
  return typeof v === 'string' && REPORT_BY_KEY.has(v as ReportKey);
}

function defaultParams(key: ReportKey): ReportParams {
  if (key === 'audit') return { from: addDays(today(), -30), to: today() };
  return { ...(REPORT_BY_KEY.get(key)?.defaults ?? {}) };
}

function paramsText(key: ReportKey, p: ReportParams): string {
  switch (key) {
    case 'deadlines':
    case 'agreements_expiring':
      return `Next ${p.days ?? 90} days`;
    case 'portfolio':
      return p.include_dead === true ? 'Includes lapsed and abandoned rights' : 'Live and pending rights';
    case 'forecast':
      return `${p.years ?? 5} years`;
    case 'audit':
      return p.from !== undefined && p.to !== undefined ? `${fmtDate(p.from)} to ${fmtDate(p.to)}` : 'Last 30 days';
    default:
      return 'No options';
  }
}

/** Enum columns shown in plain words (by report and column key). */
const ENUM_LABELS: Partial<Record<ReportKey, Record<string, Record<string, string>>>> = {
  deadlines: { kind: KIND_LABEL },
  portfolio: { type: IP_TYPE_LABEL, status: STATUS_LABEL },
  agreements_expiring: { type: AGREEMENT_TYPE_LABEL, direction: DIRECTION_LABEL },
  chain_of_title: { type: WORK_TYPE_LABEL },
  renewal_decisions: { decision: RENEWAL_DECISION_LABEL, instruction: INSTRUCTION_LABEL },
  inventions: { stage: DISCLOSURE_STAGE_LABEL },
};

interface RunResult {
  report: ReportKey;
  params: ReportParams;
  data: ReportResponse;
  ranAt: string;
}

type Cell = string | number;

function textOf(report: ReportKey, key: string, v: Cell | undefined): string {
  if (v === undefined || v === '') return '';
  const map = ENUM_LABELS[report]?.[key];
  if (map !== undefined && typeof v === 'string') return map[v] ?? v;
  return String(v);
}

/** Screen text: like textOf, plus the audit report's UTC timestamps in local time. */
function displayOf(report: ReportKey, key: string, v: Cell | undefined): string {
  if (report === 'audit' && key === 'when' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return fmtDateTime(`${v}:00.000Z`);
  return textOf(report, key, v);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function ReportsPage(): React.JSX.Element {
  const { can, me, userName } = useApp();
  const [params, setParams] = useState<Record<ReportKey, ReportParams>>(() => {
    const o = {} as Record<ReportKey, ReportParams>;
    for (const r of REPORTS) o[r.key] = defaultParams(r.key);
    return o;
  });
  const [running, setRunning] = useState<ReportKey | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [saving, setSaving] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const saved = useCollection<SavedViewRec>('saved_views', { filter: 'page = "reports"', sort: 'name' });
  const [confirmEl, confirm] = useConfirm();

  const visible = REPORTS.filter((r) => r.editOnly !== true || can.edit);

  const run = async (key: ReportKey, p: ReportParams): Promise<void> => {
    setRunning(key);
    try {
      const data = await op<ReportResponse>('reports/run', { report: key, params: { ...p } });
      setResult({ report: key, params: p, data, ranAt: new Date().toISOString() });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setRunning(null);
    }
  };

  // The report on screen follows its data (changes by anyone, including an agent).
  useLiveReload(
    result !== null ? REPORT_SOURCES[result.report] : [],
    () => {
      const r = result;
      if (r === null) return;
      op<ReportResponse>('reports/run', { report: r.report, params: { ...r.params } })
        .then((data) => setResult((cur) => (cur !== null && cur.report === r.report ? { ...cur, data, ranAt: new Date().toISOString() } : cur)))
        .catch(() => undefined);
    },
    result !== null,
  );

  const runSaved = (v: SavedViewRec): void => {
    const f = v.filters ?? {};
    const rep = f['report'];
    if (!isReportKey(rep)) {
      toast.error('This saved report refers to a report that no longer exists.');
      return;
    }
    if (rep === 'audit' && !can.edit) {
      toast.error('The audit log is only available to people who can edit records.');
      return;
    }
    const raw = f['params'];
    const p: ReportParams = typeof raw === 'object' && raw !== null ? (raw as ReportParams) : {};
    setParams((x) => ({ ...x, [rep]: { ...defaultParams(rep), ...p } }));
    void run(rep, { ...defaultParams(rep), ...p });
  };

  const removeSaved = async (v: SavedViewRec): Promise<void> => {
    if (!(await confirm(`Delete the saved report "${v.name}"?${v.scope === 'shared' ? ' Other people will no longer see it.' : ''}`, 'Delete saved report?'))) return;
    try {
      await deleteRecord('saved_views', v.id);
      toast.success('Saved report deleted');
    } catch {
      /* the client already showed the server's message */
    }
  };

  const mine = saved.records.filter((v) => v.owner === me?.id);
  const shared = saved.records.filter((v) => v.owner !== me?.id);

  return (
    <div>
      {confirmEl}
      <PageHeader title="Reports" subtitle="Run a standard report, export it, or save it to get it in your daily digest." />
      <div className="flex flex-col gap-6">

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((r) => (
          <ReportCard
            key={r.key}
            def={r}
            params={params[r.key]}
            onParams={(p) => setParams((x) => ({ ...x, [r.key]: p }))}
            running={running === r.key}
            current={result?.report === r.key}
            onRun={() => void run(r.key, params[r.key])}
          />
        ))}
      </div>

      <div ref={resultRef} className="scroll-mt-4">
        {running !== null && result === null ? (
          <Section title="Running report">
            <Loading label="Running report" />
          </Section>
        ) : result !== null ? (
          <ResultSection key={result.ranAt} result={result} running={running === result.report} onSave={() => setSaving(true)} />
        ) : null}
      </div>

      <Section title="Saved reports" meta={saved.loading ? undefined : String(saved.records.length)} flush>
        {saved.loading ? (
          <Loading />
        ) : saved.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Bookmark}
            title="No saved reports yet"
            message="Run a report, then choose Save to keep its settings. Share it with the team or schedule it."
          />
        ) : (
          <div>
            {[
              { label: 'Mine', list: mine },
              { label: 'Shared by others', list: shared },
            ]
              .filter((g) => g.list.length > 0)
              .map((g) => (
                <div key={g.label}>
                  <div className="border-b border-[var(--agent-app-border)]/70 bg-[var(--agent-app-border)]/25 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                    {g.label} <span className="font-normal tabular-nums">{g.list.length}</span>
                  </div>
                  {g.list.map((v) => {
                    const f = v.filters ?? {};
                    const rep = f['report'];
                    const def = isReportKey(rep) ? REPORT_BY_KEY.get(rep) : undefined;
                    const p = typeof f['params'] === 'object' && f['params'] !== null ? (f['params'] as ReportParams) : {};
                    return (
                      <div key={v.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{v.name}</div>
                          <div className="truncate text-xs text-[var(--agent-app-muted)]">
                            {def !== undefined ? `${def.title} · ${paramsText(def.key, p)}` : 'Unknown report'}
                            {v.owner !== me?.id ? ` · by ${userName(v.owner)}` : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {v.schedule !== '' && v.schedule !== 'none' && <Tag>{SCHEDULE_LABEL[v.schedule]}</Tag>}
                          <Pill tone={v.scope === 'shared' ? 'info' : 'neutral'}>{v.scope === 'shared' ? 'Shared' : 'Private'}</Pill>
                          <Button size="sm" variant="outline" onClick={() => runSaved(v)} disabled={def === undefined} loading={def !== undefined && running === def.key}>
                            <Play size={13} aria-hidden /> Run
                          </Button>
                          {v.owner === me?.id && (
                            <Button size="sm" variant="ghost" aria-label={`Delete ${v.name}`} title="Delete" onClick={() => void removeSaved(v)}>
                              <Trash2 size={14} aria-hidden />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </Section>

      <DigestSection />

      </div>
      {saving && result !== null && me !== null && <SaveDialog result={result} ownerId={me.id} onClose={() => setSaving(false)} />}
    </div>
  );
}

const SCHEDULE_LABEL: Record<string, string> = { none: 'Not scheduled', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', '': 'Not scheduled' };

/* ------------------------------------------------------------------ */
/* Report card                                                          */
/* ------------------------------------------------------------------ */

function ReportCard({
  def,
  params,
  onParams,
  running,
  current,
  onRun,
}: {
  def: ReportDef;
  params: ReportParams;
  onParams: (p: ReportParams) => void;
  running: boolean;
  current: boolean;
  onRun: () => void;
}): React.JSX.Element {
  const auditBad = def.key === 'audit' && (params.from ?? '') !== '' && (params.to ?? '') !== '' && (params.from ?? '') > (params.to ?? '');
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border bg-[var(--agent-app-surface)] p-4',
        current ? 'border-[var(--agent-app-accent)]/60' : 'border-[var(--agent-app-border)]',
      )}
    >
      <div>
        <h3 className="text-[13px] font-semibold">{def.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{def.description}</p>
      </div>
      <div className="flex-1">
        {(def.key === 'deadlines' || def.key === 'agreements_expiring') && (
          <Field label="Period (days)">
            <div>
              <Segmented<string>
                size="sm"
                ariaLabel="Period in days"
                value={String(params.days ?? (def.key === 'deadlines' ? 90 : 180))}
                onChange={(v) => onParams({ ...params, days: Number(v) })}
                options={(def.key === 'deadlines' ? [30, 60, 90, 180, 365] : [30, 90, 180, 365]).map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          </Field>
        )}
        {def.key === 'forecast' && (
          <Field label="Horizon (years)">
            <div>
              <Segmented<string>
                size="sm"
                ariaLabel="Horizon in years"
                value={String(params.years ?? 5)}
                onChange={(v) => onParams({ ...params, years: Number(v) })}
                options={[3, 5, 10].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          </Field>
        )}
        {def.key === 'portfolio' && (
          <Switch checked={params.include_dead === true} onCheckedChange={(v) => onParams({ ...params, include_dead: v })} label="Include dead rights" />
        )}
        {def.key === 'audit' && (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
            <Input label="From" type="date" value={params.from ?? ''} onChange={(e) => onParams({ ...params, from: e.target.value })} />
            <Input label="To" type="date" value={params.to ?? ''} onChange={(e) => onParams({ ...params, to: e.target.value })} />
            {auditBad && <p className="col-span-2 text-xs xl:col-span-1 text-red-600 dark:text-red-400">The start date is after the end date.</p>}
          </div>
        )}
        {(def.key === 'chain_of_title' || def.key === 'renewal_decisions' || def.key === 'inventions') && (
          <p className="text-xs text-[var(--agent-app-muted)]">No options.</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant={current ? 'primary' : 'outline'} loading={running} disabled={auditBad} onClick={onRun}>
          <Play size={13} aria-hidden /> Run
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result table                                                         */
/* ------------------------------------------------------------------ */

function ResultSection({ result, running, onSave }: { result: RunResult; running: boolean; onSave: () => void }): React.JSX.Element {
  const { data, report } = result;
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const rows = useMemo(() => {
    if (sort === null) return data.rows;
    const col = data.columns.find((c) => c.key === sort.key);
    if (col === undefined) return data.rows;
    const copy = data.rows.slice();
    copy.sort((a, b) => {
      const va = a[col.key];
      const vb = b[col.key];
      const ea = va === undefined || va === '';
      const eb = vb === undefined || vb === '';
      if (ea && !eb) return 1;
      if (eb && !ea) return -1;
      const r =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : textOf(report, col.key, va).localeCompare(textOf(report, col.key, vb), undefined, { numeric: true });
      return sort.dir === 'asc' ? r : -r;
    });
    return copy;
  }, [data, sort, report]);

  /** Export values: ISO dates, raw numbers, enums in plain words. */
  const exportRows = (): Record<string, unknown>[] =>
    rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of data.columns) {
        const v = r[c.key];
        o[c.key] = c.type === 'number' ? (v ?? '') : textOf(report, c.key, v);
      }
      return o;
    });

  const download = (): void => {
    downloadText(`${slug(data.title) || report}-${today()}.csv`, toCsv(data.columns, exportRows()));
    toast.success('CSV downloaded');
  };

  const copy = async (): Promise<void> => {
    const clean = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
    const lines = [data.columns.map((c) => clean(c.label)).join('\t')];
    for (const r of exportRows()) lines.push(data.columns.map((c) => clean(r[c.key])).join('\t'));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(`Copied ${fmtNumber(rows.length)} row${rows.length === 1 ? '' : 's'}. Paste into a spreadsheet or email.`);
    } catch {
      toast.error('Your browser blocked copying. Use Download CSV instead.');
    }
  };

  return (
    <Section
      title={data.title}
      meta={`${fmtNumber(data.rows.length)} row${data.rows.length === 1 ? '' : 's'}`}
      flush
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={onSave} title="Save this report" aria-label="Save this report">
            <Bookmark size={13} aria-hidden /> <span className="hidden sm:inline">Save</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copy()} disabled={data.rows.length === 0} title="Copy as text" aria-label="Copy as text">
            <ClipboardCopy size={13} aria-hidden /> <span className="hidden sm:inline">Copy as text</span>
          </Button>
          <Button size="sm" variant="outline" onClick={download} disabled={data.rows.length === 0} title="Download CSV" aria-label="Download CSV">
            <Download size={13} aria-hidden /> <span className="hidden sm:inline">CSV</span>
          </Button>
        </>
      }
    >
      <div className={cn('transition-opacity', running && 'opacity-50')}>
        <div className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
          {paramsText(report, result.params)}
        </div>
        {data.rows.length === 0 ? (
          <EmptyHint compact icon={BarChart3} title="No rows" message="Nothing matches this report right now. Try a longer period or other options." />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-[var(--agent-app-surface)]">
                <tr className="border-b border-[var(--agent-app-border)]">
                  {data.columns.map((c) => {
                    const active = sort?.key === c.key;
                    return (
                      <th
                        key={c.key}
                        className={cn(
                          'whitespace-nowrap bg-[var(--agent-app-border)]/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]',
                          c.type === 'number' ? 'text-right' : 'text-left',
                        )}
                      >
                        <button
                          type="button"
                          className={cn('inline-flex items-center gap-1 uppercase hover:text-[var(--agent-app-text)]', active && 'text-[var(--agent-app-text)]')}
                          onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                        >
                          {c.label}
                          {active && (sort?.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--agent-app-border)]/60 last:border-0 hover:bg-[var(--agent-app-border)]/15">
                    {data.columns.map((c) => {
                      const v = r[c.key];
                      if (c.type === 'number') {
                        return (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {typeof v === 'number' ? fmtNumber(v) : (v ?? '')}
                          </td>
                        );
                      }
                      if (c.type === 'date') {
                        return (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2 tabular-nums">
                            {typeof v === 'string' ? fmtDate(v) : ''}
                          </td>
                        );
                      }
                      const t = displayOf(report, c.key, v);
                      const mono = c.key === 'ref' || c.key === 'application_no' || c.key === 'registration_no' || c.key === 'po';
                      const long = t.length > 60;
                      return (
                        <td
                          key={c.key}
                          title={long ? t : undefined}
                          className={cn('px-3 py-2 align-top', mono && 'font-mono text-[12px]', long ? 'min-w-[16rem] max-w-[36rem]' : 'whitespace-nowrap')}
                        >
                          {long ? <span className="line-clamp-3 break-words">{t}</span> : t}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Save dialog                                                          */
/* ------------------------------------------------------------------ */

function SaveDialog({ result, ownerId, onClose }: { result: RunResult; ownerId: string; onClose: () => void }): React.JSX.Element {
  const def = REPORT_BY_KEY.get(result.report);
  const [name, setName] = useState(`${def?.title ?? 'Report'}: ${paramsText(result.report, result.params)}`);
  const [scope, setScope] = useState<'private' | 'shared'>('private');
  const [schedule, setSchedule] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      await createRecord('saved_views', {
        name: name.trim(),
        page: 'reports',
        filters: { report: result.report, params: result.params },
        columns: [],
        scope,
        owner: ownerId,
        schedule,
      });
      toast.success('Report saved');
      onClose();
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Save this report"
      description="Saves the report and its options, not today's rows. Running it later shows the data as it is then."
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <Field label="Who can see it">
          <div>
            <Segmented<'private' | 'shared'>
              ariaLabel="Who can see it"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'private', label: 'Only me' },
                { value: 'shared', label: 'Everyone' },
              ]}
            />
          </div>
        </Field>
        <Field label="Schedule" help="Scheduled reports appear in the recipients' digest.">
          <Select
            aria-label="Schedule"
            value={schedule}
            options={[
              { value: 'none', label: 'Not scheduled' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
            onChange={(e) => {
              const v = e.target.value;
              setSchedule(v === 'daily' || v === 'weekly' || v === 'monthly' ? v : 'none');
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Digest                                                               */
/* ------------------------------------------------------------------ */

function DigestSection(): React.JSX.Element {
  const { can, settings } = useApp();
  const [sending, setSending] = useState(false);
  const send = async (): Promise<void> => {
    setSending(true);
    try {
      const r = await op<{ sent: number; failures?: string[]; skipped?: string }>('digest/send', {});
      const failures = r.failures ?? [];
      if (r.sent === 0 && failures.length === 0) toast.info('Nobody had anything to report, so no digest was sent.');
      else toast.success(`Digest sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`);
      if (failures.length > 0) toast.error(`Some deliveries failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? ` and ${failures.length - 3} more` : ''}`);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSending(false);
    }
  };
  const channel = settings?.digest_channel === 'email' ? 'by email' : settings?.digest_channel === 'slack' ? 'in Slack' : 'in IP Manager';
  return (
    <Section
      title="Daily digest"
      meta={settings !== null ? (settings.digest_enabled ? `Sent ${channel} at ${String(settings.digest_hour).padStart(2, '0')}:00` : 'Turned off') : undefined}
      actions={
        can.manage ? (
          <Button size="sm" variant="outline" loading={sending} onClick={() => void send()}>
            <Send size={13} aria-hidden /> Send today's digest now
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
          <Mailbox size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Everyone except viewers gets a daily summary of what needs attention. Turn yours off in Settings, My account.
            {can.manage ? " Sending now delivers today's digest again, even if it already went out." : ''}
          </span>
        </div>
        <DigestPreview compact />
      </div>
    </Section>
  );
}
