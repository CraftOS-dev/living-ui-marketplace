/**
 * Reports: the standard reports the server runs (reports/run) in the
 * reader's language, each with its few options, shown as a sortable table
 * with CSV export. The report on screen follows its data as it changes.
 * Also the daily digest: preview your own (digest/preview) and, for
 * managers, send everyone's now (digest/send).
 */
import { useEffect, useRef, useState } from 'react';
import { BarChart3, Mailbox, Play, Send } from 'lucide-react';
import { Button, Select, toast } from '../../kit/index.ts';
import { useConfirm } from '../components/confirm.tsx';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveReload } from '../lib/live.ts';
import { addDays, fmtDate, fmtDateTime, fmtMoney, fmtNumber, today } from '../lib/format.ts';
import { enumLabel, getLang, t, tn } from '../lib/i18n.ts';
import { useHashParam } from '../lib/router.ts';
import type { ModuleKey, ReportColumn, ReportResult } from '../lib/shapes.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { Checkbox, EmptyHint, Field, Loading, Notice, PageHeader, Section, TONE_TEXT } from '../components/ui.tsx';
import { DATE_INPUT_CLS, errMsg } from '../components/workShared.tsx';

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

type ReportKey =
  | 'deadlines'
  | 'portfolio'
  | 'agreements_expiring'
  | 'chain_of_title'
  | 'renewal_decisions'
  | 'forecast'
  | 'approvals'
  | 'royalties'
  | 'seals'
  | 'distributions'
  | 'permissions'
  | 'music_unregistered'
  | 'trademark_gaps'
  | 'enforcement'
  | 'audit';

interface Params {
  days?: number;
  years?: number;
  include_dead?: boolean;
  include_closed?: boolean;
  from?: string;
  to?: string;
}

interface ReportDef {
  module: ModuleKey | null;
  editOnly?: boolean;
  defaults: () => Params;
  days?: number[];
  years?: number[];
}

/** Each report's options follow runReport() in lib_reports.js. */
const DEFS: Record<ReportKey, ReportDef> = {
  deadlines: { module: null, defaults: () => ({ days: 90 }), days: [30, 60, 90, 180, 365] },
  portfolio: { module: null, defaults: () => ({ include_dead: false }) },
  agreements_expiring: { module: null, defaults: () => ({ days: 180 }), days: [30, 90, 180, 365] },
  chain_of_title: { module: null, defaults: () => ({}) },
  renewal_decisions: { module: null, defaults: () => ({}) },
  forecast: { module: null, defaults: () => ({ years: 5 }), years: [3, 5, 10] },
  approvals: { module: 'approvals', defaults: () => ({ include_closed: false }) },
  royalties: { module: 'royalties', defaults: () => ({}) },
  seals: { module: 'royalties', defaults: () => ({}) },
  distributions: { module: 'committees', defaults: () => ({}) },
  permissions: { module: 'permissions', defaults: () => ({ days: 90 }), days: [30, 60, 90, 180] },
  music_unregistered: { module: 'music', defaults: () => ({}) },
  trademark_gaps: { module: null, defaults: () => ({}) },
  enforcement: { module: null, defaults: () => ({ include_closed: false }) },
  audit: { module: null, editOnly: true, defaults: () => ({ from: addDays(today(), -30), to: today() }) },
};

function isReportKey(v: string): v is ReportKey {
  return Object.prototype.hasOwnProperty.call(DEFS, v);
}

function reportName(k: ReportKey): string {
  switch (k) {
    case 'deadlines':
      return t('Open deadlines');
    case 'portfolio':
      return t('Trademark and design register');
    case 'agreements_expiring':
      return t('Agreements ending');
    case 'chain_of_title':
      return t('Chain of title');
    case 'renewal_decisions':
      return t('Renewal decisions');
    case 'forecast':
      return t('Renewal cost forecast');
    case 'approvals':
      return t('Product approvals');
    case 'royalties':
      return t('Royalties and minimum guarantees');
    case 'seals':
      return t('Seals against production');
    case 'distributions':
      return t('Committee distributions');
    case 'permissions':
      return t('Third-party permissions');
    case 'music_unregistered':
      return t('Songs not registered with a society');
    case 'trademark_gaps':
      return t('Licences without a trademark');
    case 'enforcement':
      return t('Enforcement cases');
    case 'audit':
      return t('Audit log');
  }
}

function reportDescription(k: ReportKey): string {
  switch (k) {
    case 'deadlines':
      return t('Open deadlines due within the period, overdue ones included, with their legal basis.');
    case 'portfolio':
      return t('Every trademark and design with its numbers, classes, dates, status and next deadline.');
    case 'agreements_expiring':
      return t('Active agreements whose term ends within the period, and whether they renew automatically.');
    case 'chain_of_title':
      return t('For each character and title: rights layers, what is cleared, and gaps such as missing Article 27 and 28 wording.');
    case 'renewal_decisions':
      return t('Renewals not yet confirmed or lapsed: the decision, the instruction, fees and the provider.');
    case 'forecast':
      return t('Renewal fees expected over the coming years, scheduled and projected, in your home currency.');
    case 'approvals':
      return t('Product approvals (kanshu) with their round, reply date, age and who they wait for.');
    case 'royalties':
      return t('Royalties earned and paid per agreement, minimum guarantees not yet earned, and late statements.');
    case 'seals':
      return t('Seals (shoshi) issued, used and returned, against the production licensees report.');
    case 'distributions':
      return t('Committee distributions by period: gross receipts, window and lead fees, and what members receive.');
    case 'permissions':
      return t('Game, music and platform permissions in force, with their limits and those ending soon.');
    case 'music_unregistered':
      return t('Songs that are published or released but not registered with JASRAC, NexTone or another society.');
    case 'trademark_gaps':
      return t('Licensed classes and territories with no trademark behind them, by character, talent and franchise.');
    case 'enforcement':
      return t('Enforcement cases with their type, forum, platform, status and evidence.');
    case 'audit':
      return t('Who changed what, and why, between two dates.');
  }
}

function paramsText(k: ReportKey, p: Params): string {
  const parts: string[] = [];
  if (p.days !== undefined) parts.push(t('Next {n} days', { n: p.days }));
  if (p.years !== undefined) parts.push(tn(p.years, '{n} year', '{n} years'));
  if (p.include_dead === true) parts.push(t('Includes lapsed and refused rights'));
  if (p.include_closed === true) parts.push(k === 'approvals' ? t('Includes decided approvals') : t('Includes closed cases'));
  if (k === 'audit' && p.from !== undefined && p.to !== undefined) parts.push(t('{from} to {to}', { from: fmtDate(p.from), to: fmtDate(p.to) }));
  return parts.join(' · ');
}

/** What each report reads; a change there re-runs the report on screen. */
const SOURCES: Record<ReportKey, string[]> = {
  deadlines: ['deadlines'],
  portfolio: ['matters', 'goods_services'],
  agreements_expiring: ['agreements'],
  chain_of_title: ['characters', 'character_assets', 'titles', 'clearances'],
  renewal_decisions: ['renewals', 'matters'],
  forecast: ['deadlines', 'renewals', 'matters', 'fx_rates'],
  approvals: ['approvals', 'products'],
  royalties: ['agreements', 'royalty_reports', 'royalty_lines'],
  seals: ['seal_orders', 'royalty_lines'],
  distributions: ['distributions'],
  permissions: ['permissions'],
  music_unregistered: ['songs', 'society_registrations', 'releases'],
  trademark_gaps: ['matters', 'grants', 'goods_services'],
  enforcement: ['enforcement_cases', 'evidence'],
  audit: ['audit_log'],
};

/** Columns that carry a select value (the server sends the code with spaces). */
const ENUM_COLS: Partial<Record<ReportKey, Record<string, string>>> = {
  deadlines: { category: 'deadlines.category' },
  portfolio: { status: 'matters.status' },
  agreements_expiring: { type: 'agreements.agreement_type' },
  approvals: { stage: 'approvals.stage', status: 'approvals.status' },
  royalties: { basis: 'agreements.royalty_basis' },
  distributions: { status: 'distributions.status' },
  permissions: { type: 'permissions.permission_type', archive: 'permissions.archive' },
  enforcement: { type: 'enforcement_cases.case_type', forum: 'enforcement_cases.forum', status: 'enforcement_cases.status' },
};

/** Number columns that are amounts: in the row's currency, else the home currency. */
const MONEY_COLS: Partial<Record<ReportKey, string[]>> = {
  royalties: ['earned', 'paid', 'mg', 'mg_remaining'],
  renewal_decisions: ['home'],
  forecast: ['home'],
};

function kindWord(v: string): string {
  switch (v) {
    case 'character':
      return t('Character');
    case 'talent':
      return t('Talent');
    case 'franchise':
      return t('Franchise');
    default:
      return v;
  }
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type Row = { id: string } & Record<string, unknown>;

interface RunState {
  key: ReportKey;
  params: Params;
  data: ReportResult;
}

export function ReportsPage(): React.JSX.Element {
  const { can, on, meta } = useApp();
  const [current, setCurrent] = useHashParam('report', '');
  const [params, setParams] = useState<Partial<Record<ReportKey, Params>>>({});
  const [running, setRunning] = useState<ReportKey | null>(null);
  const [result, setResult] = useState<RunState | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const available = (meta?.reports ?? Object.keys(DEFS)).filter(isReportKey).filter((k) => {
    const d = DEFS[k];
    if (d.editOnly === true && !can.edit) return false;
    return d.module === null || on(d.module);
  });
  const paramsOf = (k: ReportKey): Params => params[k] ?? DEFS[k].defaults();

  const run = async (k: ReportKey, p: Params, quiet = false): Promise<void> => {
    if (!quiet) setRunning(k);
    try {
      const data = await op<ReportResult>('reports/run', { report: k, params: { ...p }, lang: getLang() });
      setResult({ key: k, params: p, data });
      if (!quiet) {
        setCurrent(k);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    } catch (e) {
      if (!quiet) toast.error(errMsg(e));
    } finally {
      if (!quiet) setRunning(null);
    }
  };

  // A report named in the address runs on arrival.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || current === '' || !isReportKey(current) || meta === null) return;
    started.current = true;
    if (available.includes(current)) void run(current, paramsOf(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, meta]);

  // The report on screen follows its data, changed by anyone, including CraftBot.
  useLiveReload(result !== null ? SOURCES[result.key] : [], () => {
    if (result !== null) void run(result.key, result.params, true);
  }, result !== null);

  return (
    <div>
      <PageHeader title={t('Reports')} subtitle={t('Standard reports in your language, ready to sort, choose columns and export as CSV.')} />
      <div className="flex flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {available.map((k) => (
            <ReportCard
              key={k}
              k={k}
              params={paramsOf(k)}
              onParams={(p) => setParams((x) => ({ ...x, [k]: p }))}
              running={running === k}
              current={result?.key === k}
              onRun={() => void run(k, paramsOf(k))}
            />
          ))}
        </div>

        <div ref={resultRef} className="min-w-0 scroll-mt-4">
          {result !== null ? (
            <ResultSection result={result} />
          ) : running !== null ? (
            <Section title={reportName(running)}>
              <Loading />
            </Section>
          ) : null}
        </div>

        <DigestSection />
      </div>
    </div>
  );
}

function ReportCard({
  k,
  params,
  onParams,
  running,
  current,
  onRun,
}: {
  k: ReportKey;
  params: Params;
  onParams: (p: Params) => void;
  running: boolean;
  current: boolean;
  onRun: () => void;
}): React.JSX.Element {
  const def = DEFS[k];
  const badRange = k === 'audit' && (params.from ?? '') !== '' && (params.to ?? '') !== '' && (params.from ?? '') > (params.to ?? '');
  const noOptions = def.days === undefined && def.years === undefined && params.include_dead === undefined && params.include_closed === undefined && k !== 'audit';
  return (
    <div className={`flex min-w-0 flex-col gap-3 border bg-[var(--agent-app-surface)] p-4 ${current ? 'border-[var(--agent-app-accent)]/60' : 'border-[var(--agent-app-border)]'}`}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold">{reportName(k)}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{reportDescription(k)}</p>
      </div>
      <div className="min-w-0 flex-1">
        {def.days !== undefined && (
          <Select
            label={t('Period')}
            value={String(params.days ?? def.days[0] ?? 90)}
            options={def.days.map((n) => ({ value: String(n), label: t('Next {n} days', { n }) }))}
            onChange={(e) => onParams({ ...params, days: Number(e.target.value) })}
          />
        )}
        {def.years !== undefined && (
          <Select
            label={t('Horizon')}
            value={String(params.years ?? 5)}
            options={def.years.map((n) => ({ value: String(n), label: tn(n, '{n} year', '{n} years') }))}
            onChange={(e) => onParams({ ...params, years: Number(e.target.value) })}
          />
        )}
        {params.include_dead !== undefined && (
          <Checkbox checked={params.include_dead} onChange={(v) => onParams({ ...params, include_dead: v })} label={t('Include lapsed and refused rights')} />
        )}
        {params.include_closed !== undefined && (
          <Checkbox
            checked={params.include_closed}
            onChange={(v) => onParams({ ...params, include_closed: v })}
            label={k === 'approvals' ? t('Include decided approvals') : t('Include closed cases')}
          />
        )}
        {k === 'audit' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('From')}>
              <input type="date" aria-label={t('From')} className={DATE_INPUT_CLS} value={params.from ?? ''} onChange={(e) => onParams({ ...params, from: e.target.value })} />
            </Field>
            <Field label={t('To')}>
              <input type="date" aria-label={t('To')} className={DATE_INPUT_CLS} value={params.to ?? ''} onChange={(e) => onParams({ ...params, to: e.target.value })} />
            </Field>
            {badRange && <p className={`col-span-2 text-xs ${TONE_TEXT.bad}`}>{t('The start date is after the end date.')}</p>}
          </div>
        )}
        {noOptions && <p className="text-xs text-[var(--agent-app-muted)]">{t('No options.')}</p>}
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant={current ? 'primary' : 'outline'} loading={running} disabled={badRange} onClick={onRun}>
          <Play size={13} aria-hidden /> {t('Run')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

function ResultSection({ result }: { result: RunState }): React.JSX.Element {
  const { homeCurrency } = useApp();
  const { key, data } = result;
  const rows: Row[] = data.rows.map((r, i) => ({ ...r, id: String(i) }));
  const enumCols = ENUM_COLS[key] ?? {};
  const moneyCols = new Set(MONEY_COLS[key] ?? []);
  const hasCurrency = data.columns.some((c) => c.key === 'currency');

  const text = (c: ReportColumn, r: Row): string => {
    const v = r[c.key];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return String(o['label'] ?? o['ja'] ?? o['en'] ?? '');
    }
    const s = String(v);
    const field = enumCols[c.key];
    if (field !== undefined && s !== '') {
      const code = s.replace(/ /g, '_');
      const label = enumLabel(field, code);
      return label === code ? s : label;
    }
    if (key === 'trademark_gaps' && c.key === 'kind') return kindWord(s);
    if (key === 'audit' && c.key === 'when' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return fmtDateTime(`${s}:00.000Z`);
    return s;
  };
  const amount = (c: ReportColumn, r: Row): string => {
    const v = r[c.key];
    if (typeof v !== 'number') return v === null || v === undefined ? '' : String(v);
    const isMoney = c.type === 'money' || moneyCols.has(c.key);
    if (!isMoney) return fmtNumber(v);
    const cur = hasCurrency && typeof r['currency'] === 'string' && r['currency'] !== '' ? (r['currency'] as string) : homeCurrency;
    return fmtMoney(v, cur);
  };

  const columns: Col<Row>[] = data.columns.map((c) => {
    if (c.type === 'date') {
      return {
        key: c.key,
        label: c.label,
        value: (r) => (typeof r[c.key] === 'string' ? (r[c.key] as string) : ''),
        render: (r) => <span className="whitespace-nowrap tabular-nums">{typeof r[c.key] === 'string' ? fmtDate(r[c.key] as string) : ''}</span>,
      };
    }
    if (c.type === 'number' || c.type === 'money') {
      return {
        key: c.key,
        label: c.label,
        align: 'right',
        value: (r) => (typeof r[c.key] === 'number' ? (r[c.key] as number) : ''),
        render: (r) => <span className="whitespace-nowrap">{amount(c, r)}</span>,
      };
    }
    if (c.type === 'link') {
      return {
        key: c.key,
        label: c.label,
        value: (r) => text(c, r),
        render: (r) => {
          const v = r[c.key];
          const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
          const link = o !== null ? String(o['href'] ?? o['link'] ?? '') : typeof v === 'string' && v.startsWith('#/') ? v : '';
          const label = text(c, r) || link;
          return link !== '' ? (
            <a href={link} className="break-words text-[var(--agent-app-accent)] hover:underline">
              {label}
            </a>
          ) : (
            label
          );
        },
      };
    }
    return {
      key: c.key,
      label: c.label,
      value: (r) => text(c, r),
      render: (r) => {
        const s = text(c, r);
        const mono = c.key === 'ref' || c.key === 'application_no' || c.key === 'registration_no';
        return <span className={`block max-w-[28rem] break-words ${mono ? 'whitespace-nowrap font-mono text-[12px]' : s.length > 60 ? 'min-w-[14rem]' : ''}`}>{s}</span>;
      },
    };
  });

  const ptext = paramsText(key, result.params);
  return (
    <Section title={data.title} flush>
      {(ptext !== '' || data.note !== undefined) && (
        <div className="flex flex-col gap-2 border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
          {ptext !== '' && <span>{ptext}</span>}
          {data.note !== undefined && data.note !== '' && <Notice>{data.note}</Notice>}
        </div>
      )}
      <DataTable<Row>
        key={key}
        tableId={`report-${key}`}
        rows={rows}
        columns={columns}
        exportName={`${key}-${today()}`}
        dense
        empty={<EmptyHint compact icon={BarChart3} title={t('No rows')} message={t('Nothing matches this report right now. Try a longer period or other options.')} />}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Digest                                                              */
/* ------------------------------------------------------------------ */

interface DigestResult {
  sections: { title: string; items: string[]; link: string }[];
  text: string;
  lang: string;
  counts: { overdue: number; soon: number; sections: number };
}

function DigestSection(): React.JSX.Element {
  const { can, settings } = useApp();
  const [confirmEl, confirm] = useConfirm();
  const [digest, setDigest] = useState<DigestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const preview = async (): Promise<void> => {
    setLoading(true);
    try {
      setDigest(await op<DigestResult>('digest/preview', { days: 45 }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const send = async (): Promise<void> => {
    const ok = await confirm(t('Send the daily digest to everyone now? People who already received it today get it again.'), t('Send digests now'));
    if (!ok) return;
    setSending(true);
    try {
      const r = await op<{ sent: number; failures?: string[] | undefined }>('digest/send', {});
      const failures = r.failures ?? [];
      if (r.sent === 0 && failures.length === 0) toast.info(t('Nobody had anything to report, so no digest was sent.'));
      else toast.success(tn(r.sent, 'Digest sent to {n} person', 'Digest sent to {n} people'));
      if (failures.length > 0) toast.error(t('Some deliveries failed: {list}', { list: failures.slice(0, 3).join('; ') }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSending(false);
    }
  };

  const schedule =
    settings === null
      ? undefined
      : settings.digest_enabled
        ? t('Sent daily at {hour}:00 ({channel})', { hour: String(settings.digest_hour).padStart(2, '0'), channel: enumLabel('settings.digest_channel', settings.digest_channel || 'in_app') })
        : t('Automatic sending is off');

  return (
    <Section
      title={t('Daily digest')}
      meta={schedule}
      actions={
        <>
          <Button size="sm" variant="outline" loading={loading} onClick={() => void preview()} aria-label={digest === null ? t('Preview my digest') : t('Refresh')}>
            <Mailbox size={13} aria-hidden /> <span className="hidden sm:inline">{digest === null ? t('Preview my digest') : t('Refresh')}</span>
          </Button>
          {can.manage && (
            <Button size="sm" variant="outline" loading={sending} onClick={() => void send()} title={t('Send digests now')}>
              <Send size={13} aria-hidden /> <span className="hidden sm:inline">{t('Send digests now')}</span>
            </Button>
          )}
        </>
      }
    >
      {confirmEl}
      {digest === null ? (
        <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
          {t('Each person gets a summary of what needs their attention: overdue and coming deadlines, Inbox items, approvals and decisions in their area. Preview yours to see what it says today.')}
        </p>
      ) : digest.sections.length === 0 ? (
        <Notice>{t('Nothing needs your attention today, so your digest would be empty.')}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {digest.sections.map((s, i) => (
            <div key={`${i}-${s.title}`} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 break-words text-[13px] font-semibold">
                  {s.title} <span className="font-normal tabular-nums text-[var(--agent-app-muted)]">{s.items.length}</span>
                </h3>
                {s.link !== '' && (
                  <a href={s.link} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
                    {t('Open|action')}
                  </a>
                )}
              </div>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-[13px] leading-relaxed">
                {s.items.map((it, j) => (
                  <li key={j} className="break-words">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
