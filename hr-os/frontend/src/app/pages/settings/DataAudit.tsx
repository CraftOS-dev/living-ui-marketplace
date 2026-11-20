/**
 * Data: bring people in from a spreadsheet (checked row by row first, then
 * all rows or none), take them out as CSV, and the history of imports.
 * Audit: every change with who made it (a person, your AI agent or HR OS),
 * filtered and paged by scroll, with the before and after of each.
 */
import { useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, History, Upload } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, DateRange, Empty, FileDrop, Loading, Notice, Panel, Row, SearchInput, Segmented, StatusDot, Tag, Toggle } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { errMessage, opForm, op, saveText } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { ago, fmtDay, fmtDateTime } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import type { AuditEntry } from '../people/types.ts';

interface Report {
  rows: number;
  ok: number;
  errors: { line: number; field: string; message: string }[];
}

const TEMPLATE = 'legal_name,entity,start_day,family_name,given_name,work_email,phone,birth_date,title,department,location,manager,employment_type,pay_basis,pay_amount,pay_per\n';

export function DataSection(): React.JSX.Element {
  const me = useMe();
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<{ report: Report; preview: { line: number; legal_name: string; entity: string; start_day: string; title: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withPay, setWithPay] = useState(false);
  const history = useOp<{ imports: { id: string; kind: string; status: string; rows: number; report: Partial<Report>; created: string }[] }>('imports.list', { kind: 'people', limit: 20 }, ['imports'], { name: 'settings.imports' });
  const canImport = can(me, 'people', 'full');
  const run = async (f: File): Promise<void> => {
    setFile(f);
    setCheck(null);
    setError(null);
    setBusy(true);
    try {
      const r = await opForm<{ report: Report; preview: { line: number; legal_name: string; entity: string; start_day: string; title: string }[] }>('people.import-check', {}, { file: f }, { quiet: true });
      setCheck(r);
      changed('imports');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = async (): Promise<void> => {
    if (file === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opForm<{ imported: number }>('people.import', {}, { file }, { quiet: true });
      changed('employees', 'employments', 'job_records', 'pay_records', 'imports');
      toast.success(tn('data.imported', r.imported));
      setFile(null);
      setCheck(null);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('people.export', { status: 'all', include_pay: withPay });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {canImport && (
        <Panel index="01" label={t('data.import_people')} aside={<Button size="sm" variant="ghost" icon={Download} onClick={() => saveText(TEMPLATE, 'people-template.csv')}>{t('data.template')}</Button>}>
          {check === null ? (
            <FileDrop onFiles={(f) => f[0] !== undefined && void run(f[0])} accept=".csv,text/csv" label={busy ? t('data.checking') : t('data.choose_csv')}>
              <FileSpreadsheet size={20} aria-hidden className="text-[var(--hr-muted)]" />
              <span className="text-[12px] text-[var(--hr-muted)]">{t('data.drop_csv')}</span>
            </FileDrop>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="hr-wrap min-w-0 flex-1 text-[13px] font-medium">{file?.name}</span>
                <StatusDot tone={check.report.errors.length === 0 ? 'good' : 'warn'} label={t('data.ready', { ok: check.report.ok, n: check.report.rows })} />
              </div>
              {check.report.errors.length > 0 && (
                <ul className="hr-scroll max-h-[220px] overflow-y-auto rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)]">
                  {check.report.errors.map((e, i) => (
                    <li key={i} className="flex gap-3 border-b border-[var(--hr-hair)] px-3 py-1.5 text-[13px] last:border-b-0">
                      <span className="hr-num w-12 shrink-0 whitespace-nowrap text-[var(--hr-muted)]">{t('data.line', { n: e.line })}</span>
                      <span className="hr-mono w-28 shrink-0 truncate text-[var(--hr-ink-2)]">{e.field}</span>
                      <span className="hr-wrap min-w-0 flex-1 text-[var(--hr-bad)]">{e.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              {check.report.errors.length === 0 && check.preview.length > 0 && (
                <ul className="flex flex-col rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)]">
                  {check.preview.slice(0, 6).map((p) => (
                    <li key={p.line} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px] gap-3 border-b border-[var(--hr-hair)] px-3 py-1.5 text-[13px] last:border-b-0">
                      <span className="min-w-0 truncate">{p.legal_name}</span>
                      <span className="min-w-0 truncate text-[var(--hr-muted)]">{[p.title, p.entity].filter((x) => x !== '').join(' · ')}</span>
                      <span className="hr-mono text-right text-[var(--hr-ink-2)]">{fmtDay(p.start_day)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={() => (setCheck(null), setFile(null))}>{t('data.other_file')}</Button>
                <Button variant="primary" icon={Upload} busy={busy} disabled={check.report.errors.length > 0 || check.report.ok === 0} onClick={() => void commit()}>
                  {tn('data.import_n', check.report.ok)}
                </Button>
              </div>
            </div>
          )}
          {error !== null && (
            <Notice tone="bad" className="mt-3">
              {error}
            </Notice>
          )}
        </Panel>
      )}
      <div className="flex flex-col gap-3">
        <Panel index="02" label={t('data.export')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
          <Row label={t('data.export_people')} hint={t('data.export_hint')}>
            <Button size="sm" icon={Download} onClick={() => void exportCsv()}>
              {t('ui.export')}
            </Button>
          </Row>
          {can(me, 'payroll', 'view') && (
            <Row label={t('data.include_pay')}>
              <Toggle checked={withPay} onChange={setWithPay} label={t('data.include_pay')} />
            </Row>
          )}
        </Panel>
        <Panel index="03" label={t('data.history')}>
          {history.data === null ? (
            <Loading className="min-h-[80px]" />
          ) : history.data.imports.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('data.no_history')}</p>
          ) : (
            <ul className="flex flex-col">
              {history.data.imports.map((h) => (
                <li key={h.id} className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0">
                  {h.status === 'committed' ? <CheckCircle2 size={14} aria-hidden className="text-[var(--hr-good)]" /> : <History size={14} aria-hidden className="text-[var(--hr-muted)]" />}
                  <span className="flex-1">{t(`data.status.${h.status}`, { n: h.rows })}</span>
                  <span className="hr-label">{ago(h.created)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Diff({ before, after }: { before: unknown; after: unknown }): React.JSX.Element | null {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || typeof a !== 'object') return null;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]) && k !== 'updated' && k !== 'created');
  if (keys.length === 0) return null;
  const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <dl className="mt-1.5 grid grid-cols-[minmax(100px,auto)_1fr] gap-x-3 gap-y-0.5 text-[12px]">
      {keys.slice(0, 12).map((k) => (
        <div key={k} className="contents">
          <dt className="hr-mono text-[var(--hr-muted)]">{k}</dt>
          <dd className="hr-wrap min-w-0">
            {s(b[k]) !== '' && <span className="text-[var(--hr-muted)] line-through decoration-[var(--hr-line-2)]">{s(b[k])}</span>}
            {s(b[k]) !== '' && <span className="mx-1.5 text-[var(--hr-faint)]">{'>'}</span>}
            {s(a[k])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const PAGE = 50;

export function AuditSection(): React.JSX.Element {
  const [q, setQ] = useState('');
  const [actor, setActor] = useState<'' | 'person' | 'agent' | 'system'>('');
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState('');
  const live = useOp<{ entries: AuditEntry[]; total: number }>('audit.list', { q: q.trim() === '' ? undefined : q.trim(), actor: actor === '' ? undefined : actor, from: range.from === '' ? undefined : range.from, to: range.to === '' ? undefined : range.to, limit }, ['audit'], { name: 'settings.audit', keep: true });
  const columns: Column<AuditEntry>[] = [
    { key: 'at', label: t('audit.when'), width: '150px', mono: true, render: (e) => fmtDateTime(e.at) },
    { key: 'who', label: t('audit.who'), width: 'minmax(120px,1fr)', render: (e) => (e.actor === 'agent' ? <Tag tone="agent">{t('agent.name')}</Tag> : e.who) },
    {
      key: 'what',
      label: t('audit.what'),
      width: 'minmax(260px,3fr)',
      phone: 'title',
      render: (e) => (
        <span className="block">
          <span className="hr-wrap block whitespace-normal">{e.summary}</span>
          {open === e.id && <Diff before={e.before} after={e.after} />}
        </span>
      ),
    },
    { key: 'op', label: t('audit.op'), width: '170px', mono: true, hideBelow: 'lg', render: (e) => <span className="text-[var(--hr-muted)]">{e.op}</span> },
  ];
  return (
    <Panel label={t('settings.audit')} aside={live.data !== null ? <span className="hr-label">{tn('audit.n', live.data.total)}</span> : undefined} flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-3.5 py-2">
        <SearchInput value={q} onChange={(v) => (setQ(v), setLimit(PAGE))} className="w-full sm:w-[240px]" placeholder={t('audit.search')} />
        <Segmented value={actor === '' ? 'all' : actor} onChange={(v) => (setActor(v === 'all' ? '' : v), setLimit(PAGE))} label={t('audit.who')} size="sm" options={(['all', 'person', 'agent', 'system'] as const).map((a) => ({ value: a, label: t(`audit.actor.${a}`) }))} />
        <DateRange from={range.from} to={range.to} onChange={(from, to) => (setRange({ from, to }), setLimit(PAGE))} label={t('audit.range')} className="w-[200px]" />
      </div>
      {live.data === null ? (
        <Loading />
      ) : (
        <DataTable
          label={t('settings.audit')}
          columns={columns}
          rows={live.data.entries}
          rowKey={(e) => e.id}
          onRowClick={(e) => setOpen((o) => (o === e.id ? '' : e.id))}
          rowClass={(e) => cn(open === e.id && 'bg-[var(--hr-sunk)]')}
          hasMore={live.data.total > live.data.entries.length}
          onMore={() => setLimit((l) => l + PAGE)}
          loadingMore={live.loading}
          empty={<Empty icon={History} title={t('audit.none')} />}
        />
      )}
    </Panel>
  );
}
