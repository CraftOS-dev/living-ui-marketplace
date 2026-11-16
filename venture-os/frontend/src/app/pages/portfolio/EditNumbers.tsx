/**
 * Edit numbers (fix 5): a person adds or corrects a portfolio company's KPI
 * values in a small table. Pick the month; every metric the firm tracks is
 * a row with its value (money in major units, percents as 72.5, counts as
 * whole numbers) and, for money, its currency. Save enters each changed
 * value through kpis.save: verified at once, with the person as its source,
 * audited by the server. Your AI agent never does this (it stages values
 * for a person to verify).
 */
import { useMemo, useState } from 'react';
import { Button, Input, LoadError, Section, Sections, Select, Sheet, SheetHeader, Skeleton, StatusDot } from '../../components/ui.tsx';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { fmtMonth, majorParam, today } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { KPI_READS } from './Overview.tsx';
import type { KpiList, KpiPoint, Metric } from './types.ts';

/** The last day of the month `n` months after the month of `day`. */
function monthEnd(day: string, n = 0): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

function pointAt(m: Metric, end: string): KpiPoint | undefined {
  return m.points.find((p) => p.period_end === end && p.months === 1 && p.value !== null);
}

/** Major-unit text grouped as people write it: "8,100,000" (decimals only when there are any). */
function grouped(text: string): string {
  const neg = text.startsWith('-');
  const [int = '', frac = ''] = (neg ? text.slice(1) : text).split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const f = frac.replace(/0+$/, '');
  return (neg ? '-' : '') + g + (f !== '' ? '.' + f : '');
}

/** A stored value as the person types it. */
function inputOf(m: Metric, p: KpiPoint | undefined): string {
  if (p === undefined || p.value === null) return '';
  if (m.unit === 'money') return grouped(majorParam(p.value, p.currency) ?? '');
  if (m.unit === 'percent') return String(Math.round(p.value / 100) / 100);
  return String(p.value);
}

function valid(m: Metric, v: string): boolean {
  const s = v.trim().replace(/,/g, '');
  if (s === '') return true;
  if (m.unit === 'money') return /^-?\d+(\.\d{1,3})?$/.test(s);
  if (m.unit === 'percent') return /^-?\d+(\.\d+)?%?$/.test(s);
  return /^-?\d+$/.test(s);
}

interface Edit {
  value: string;
  currency: string;
}

export function EditNumbers({ company, name, open, onClose }: { company: string; name: string; open: boolean; onClose: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return <Body company={company} name={name} onClose={onClose} />;
}

function Body({ company, name, onClose }: { company: string; name: string; onClose: () => void }): React.JSX.Element {
  const live = useOp<KpiList>('kpis.list', { company, currency: 'native' }, KPI_READS, { name: 'kpis.list', keep: true });
  const k = live.data;
  const metrics = useMemo(() => (k?.metrics ?? []).filter((m) => m.unit !== 'months'), [k]);
  // The latest month with a monthly value, else the last complete month.
  const latest = useMemo(() => {
    let best = '';
    for (const m of metrics) for (const p of m.points) if (p.months === 1 && p.period_end > best) best = p.period_end;
    return best !== '' ? best : monthEnd(today(), -1);
  }, [metrics]);
  const months = useMemo(() => {
    const top = monthEnd(latest, 1) > monthEnd(today(), 0) ? monthEnd(latest, 0) : monthEnd(latest, 1);
    const out: string[] = [];
    for (let i = 0; i < 24; i++) out.push(monthEnd(top, -i));
    return out;
  }, [latest]);
  const [month, setMonth] = useState('');
  const at = month !== '' ? month : latest;
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
  const report = k?.report_currency ?? 'USD';

  const keyOf = (m: Metric): string => at + '|' + m.key;
  const valueOf = (m: Metric): Edit => {
    const e = edits[keyOf(m)];
    if (e !== undefined) return e;
    const p = pointAt(m, at);
    return { value: inputOf(m, p), currency: p?.currency !== undefined && p.currency !== '' ? p.currency : report };
  };
  const counted = (end: string): number => metrics.filter((m) => pointAt(m, end) !== undefined).length;

  // Every edit that differs from what is stored, in every month the person touched.
  const changes = Object.entries(edits).flatMap(([key, e]) => {
    const [end = '', mk = ''] = key.split('|');
    const m = metrics.find((x) => x.key === mk);
    if (m === undefined) return [];
    const p = pointAt(m, end);
    const before = inputOf(m, p);
    const cur = p?.currency !== undefined && p.currency !== '' ? p.currency : report;
    if (e.value.trim() === before.trim() && (m.unit !== 'money' || e.currency.trim().toUpperCase() === cur)) return [];
    return [{ m, end, e, cleared: e.value.trim() === '' && before !== '', bad: !valid(m, e.value) || (m.unit === 'money' && !/^[A-Za-z]{3}$/.test(e.currency.trim())) }];
  });
  const cleared = changes.some((c) => c.cleared);
  const bad = changes.some((c) => c.bad);
  const todo = changes.filter((c) => !c.cleared && c.e.value.trim() !== '');

  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act(
      [],
      async () => {
        for (const c of todo) await op('kpis.save', { company, key: c.m.key, period_end: c.end, months: 1, value: c.e.value.trim().replace(/,/g, '').replace(/%$/, ''), currency: c.m.unit === 'money' ? c.e.currency.trim().toUpperCase() : undefined });
        return true;
      },
      KPI_READS,
    );
    setBusy(false);
    if (out !== null) onClose();
  };

  return (
    <Sheet open onClose={onClose} label="Edit numbers" width={600}>
      <SheetHeader title={'Edit numbers: ' + name} onClose={onClose} />
      {live.error !== null && k === null ? (
        <div className="p-5">
          <LoadError message={live.error} onRetry={live.reload} />
        </div>
      ) : k === null ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="vo-scroll min-h-0 flex-1 overflow-y-auto">
          <Sections pad="card">
            <Section title="Month" tip="The month the numbers cover. Pick a new month to add its numbers.">
              <Select value={at} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="max-w-[280px]">
                {months.map((d) => {
                  const n = counted(d);
                  return (
                    <option key={d} value={d}>
                      {fmtMonth(d) + (n > 0 ? ' (' + n + (n === 1 ? ' number)' : ' numbers)') : ' (no numbers yet)')}
                    </option>
                  );
                })}
              </Select>
            </Section>
            <Section title={'Numbers for ' + fmtMonth(at)} tip="What you enter is verified at once, with you as its source; the charts, runway and alerts use it. Money in whole units of its currency, percents as 72.5.">
              <div role="table" aria-label={'Numbers for ' + fmtMonth(at)} className="flex min-w-0 flex-col">
                <div role="row" className="grid grid-cols-[minmax(0,1fr)_minmax(110px,150px)_64px] items-center gap-2 border-b border-[var(--vo-line)] pb-1.5 text-[12px] font-medium text-[var(--vo-muted)]">
                  <span role="columnheader">Metric</span>
                  <span role="columnheader" className="text-right">
                    Value
                  </span>
                  <span role="columnheader">Currency</span>
                </div>
                {metrics.map((m) => {
                  const v = valueOf(m);
                  const p = pointAt(m, at);
                  const ed = edits[keyOf(m)];
                  const changed = ed !== undefined && (ed.value.trim() !== inputOf(m, p).trim() || (m.unit === 'money' && ed.currency.trim().toUpperCase() !== (p?.currency || report)));
                  const isBad = !valid(m, v.value) || (p !== undefined && v.value.trim() === '');
                  return (
                    <div role="row" key={m.key} className="grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(110px,150px)_64px] items-center gap-2 border-b border-[var(--vo-hair)] py-1.5">
                      <span role="cell" className="flex min-w-0 flex-col">
                        <span className="vo-wrap text-[13px] font-medium text-[var(--vo-ink)]">{m.label}</span>
                        <span className="text-[12px] leading-4">{changed ? <StatusDot tone="a" label="Changed" /> : p === undefined ? <span className="text-[var(--vo-muted)]">Not reported</span> : p.status === 'verified' ? <StatusDot tone="good" label="Verified" /> : <StatusDot tone="warn" label="Staged, not verified" />}</span>
                      </span>
                      <span role="cell" className="min-w-0">
                        <Input
                          className={cn('vo-mono text-right', isBad && 'border-[var(--vo-bad)]')}
                          value={v.value}
                          inputMode="decimal"
                          aria-label={m.label + ' for ' + fmtMonth(at)}
                          aria-invalid={isBad}
                          title={p !== undefined && v.value.trim() === '' ? 'A reported number is corrected, not removed.' : undefined}
                          onChange={(e) => setEdits({ ...edits, [keyOf(m)]: { value: e.target.value, currency: v.currency } })}
                        />
                      </span>
                      <span role="cell" className="min-w-0">
                        {m.unit === 'money' ? (
                          <Input className="vo-mono uppercase" value={v.currency} maxLength={3} aria-label={m.label + ' currency'} onChange={(e) => setEdits({ ...edits, [keyOf(m)]: { value: v.value, currency: e.target.value.toUpperCase() } })} />
                        ) : (
                          <span className="pl-1 text-[12px] text-[var(--vo-muted)]">{m.unit === 'percent' ? '%' : 'count'}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          </Sections>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--vo-line)] px-5 py-3">
        {cleared && <span className="mr-auto text-[12px] text-[var(--vo-bad)]">A reported number is corrected, not removed.</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={todo.length === 0 || bad || cleared} onClick={() => void save()}>
          {todo.length > 1 ? 'Save ' + todo.length + ' numbers' : 'Save'}
        </Button>
      </div>
    </Sheet>
  );
}
