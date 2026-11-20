/**
 * Opening balances (payroll-core, QA3): what people were paid before HR OS
 * in a tax year that began earlier. The first pay day in HR OS, the
 * entity's "nobody was paid earlier this tax year" switch, and a dense table
 * of the people employed before HR OS with the year to date figures their
 * rule packs read (columns come from the packs: tags and codes), edited in
 * place, or imported from a spreadsheet with a dry run first.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Calculator, Download, Ellipsis, FileUp, Upload } from 'lucide-react';
import { Button, DayPicker, Dialog, Empty, FileDrop, Hint, LoadError, Loading, Menu, MenuItem, Money, Notice, PageBody, PageHeader, Panel, Row, StatusDot, Textarea, Toggle, majorParam, toast } from '../../../components/ui.tsx';
import { op, saveText } from '../../../lib/api.ts';
import type { PageProps } from '../../../lib/contract.ts';
import { dayOf, fmtDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { moneyInputText, parseMoney } from '../../../lib/money.ts';
import { navigate } from '../../../lib/router.ts';
import { useUi } from '../../../lib/store.tsx';
import { plainError, runTitle } from '../../../components/payroll/bits.tsx';
import { useEntity } from './Setup.tsx';

interface Col {
  key: string;
  kind: 'tag' | 'code';
  label: string;
  help: string;
  pack: string;
  pack_name: string;
  use: 'calc' | 'withheld';
}

interface PersonRow {
  employment: string;
  number: string;
  name: string;
  start_day: string;
  end_day: string;
  tax_year_start: string;
  packs: string[];
  columns: string[];
  opening: { id: string; day: string; source: string; note: string; values_minor: Record<string, number> } | null;
  status: 'needed' | 'done' | 'confirmed';
}

interface Sheet {
  entity: { id: string; name: string; country: string; currency: string };
  go_live_day: string;
  from: string;
  opening_day: string;
  required: boolean;
  payrun: { id: string; number: string; label: string; status: string; kind: string; period_start: string; period_end: string } | null;
  confirmed: { on: boolean; by_name: string; at: string };
  columns: Col[];
  people: PersonRow[];
  needed: number;
  can: { edit: boolean; confirm: boolean };
}

interface ImportCheck {
  rows: { row: number; employment: string; number: string; name: string; values_minor: Record<string, number | null>; replaces: boolean }[];
  problems: { row: number; column?: string; message: string }[];
  ok: boolean;
  would_save: number;
}

const READS = ['ytd_openings', 'payroll_settings', 'payruns', 'payslips', 'employments', 'tax_profiles', 'rule_packs'];
const STATUS_TONE = { needed: 'warn', done: 'good', confirmed: 'faint' } as const;

/** One figure: typed the person's way, saved when they leave the cell (minor units in, minor units out). */
function Cell({ value, currency, label, disabled, onCommit }: { value: number | null; currency: string; label: string; disabled: boolean; onCommit: (v: number | null) => Promise<boolean> }): React.JSX.Element {
  const [text, setText] = useState(() => moneyInputText(value, currency));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(moneyInputText(value, currency)), [value, currency]);
  const commit = async (): Promise<void> => {
    const s = text.trim();
    const v = s === '' ? null : parseMoney(s, currency);
    if (s !== '' && v === null) {
      setBad(true);
      return;
    }
    setBad(false);
    if (v === value) return;
    if (!(await onCommit(v))) setText(moneyInputText(value, currency));
  };
  return (
    <input
      value={text}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={bad}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        setBad(false);
      }}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(moneyInputText(value, currency));
          setBad(false);
        }
      }}
      className="hr-tap hr-mono hr-num h-8 w-full min-w-[104px] rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-transparent px-2 text-right text-[13px] text-[var(--hr-ink)] outline-none transition-[border-color] hover:border-[var(--hr-line-2)] focus:border-[var(--hr-ink-2)] focus:bg-[var(--hr-raised)] disabled:cursor-default disabled:hover:border-transparent aria-[invalid=true]:border-[var(--hr-bad)]"
    />
  );
}

/** A CSV cell (quoted when needed). */
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function OpeningsPage({ query }: PageProps): React.JSX.Element {
  const { hidePay } = useUi();
  const runRef = query.get('payrun') ?? '';
  const ent = useEntity(query);
  const params = runRef !== '' ? { payrun: runRef } : { entity: ent.id };
  const live = useOp<Sheet>('ytd.sheet', params, READS, { skip: runRef === '' && ent.id === '' });
  const d = live.data;
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [importOpen, setImportOpen] = useState(false);
  const groups = useMemo(() => {
    const out: { pack: string; name: string; cols: Col[] }[] = [];
    for (const c of d?.columns ?? []) {
      let g = out.find((x) => x.pack === c.pack);
      if (g === undefined) {
        g = { pack: c.pack, name: c.pack_name, cols: [] };
        out.push(g);
      }
      g.cols.push(c);
    }
    return out;
  }, [d]);
  if (d === null)
    return (
      <>
        <PageHeader title={t('payroll.open.title')} back={runRef !== '' ? '#/payroll/runs/' + runRef + '?tab=issues' : '#/payroll'}>
          {runRef === '' && ent.picker}
        </PageHeader>
        <PageBody>
          {runRef === '' && ent.phonePicker}
          {live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}
        </PageBody>
      </>
    );
  const cur = d.entity.currency;
  const cols = groups.flatMap((g) => g.cols);
  const entity = d.entity.id;
  const upTo = fmtDay(d.opening_day, { year: 'always', entity });
  const editable = d.can.edit && !hidePay;
  const run = d.payrun;
  const runOpen = run !== null && ['draft', 'calculated', 'approved'].indexOf(run.status) >= 0;

  const saveCell = async (p: PersonRow, key: string, v: number | null): Promise<boolean> => {
    try {
      await op('ytd.sheet-save', { employment: p.employment, values: { [key]: v === null ? '' : (majorParam(v, cur) ?? '') }, payrun: run?.id }, { quiet: true });
      setSaved((x) => ({ ...x, [p.employment]: true }));
      changed('ytd_openings', 'payruns');
      return true;
    } catch (e) {
      toast.error(plainError(e));
      return false;
    }
  };
  const setGoLive = async (day: string): Promise<void> => {
    setBusy('golive');
    try {
      await op('payroll.settings-save', { entity, go_live_day: day }, { quiet: true });
      changed('payroll_settings', 'payruns');
    } catch (e) {
      toast.error(plainError(e));
    } finally {
      setBusy('');
    }
  };
  const setConfirmed = async (on: boolean): Promise<void> => {
    setBusy('confirm');
    try {
      await op('ytd.no-earlier-pay', { entity, on }, { quiet: true });
      changed('payroll_settings', 'payruns');
      toast.success(on ? t('payroll.open.confirmed_toast') : t('payroll.open.unconfirmed_toast'));
    } catch (e) {
      toast.error(plainError(e));
    } finally {
      setBusy('');
    }
  };
  const recalc = async (): Promise<void> => {
    if (run === null) return;
    setBusy('calc');
    try {
      let r = await op<{ done: boolean }>('payruns.calculate', { payrun: run.id });
      for (let i = 0; i < 40 && !r.done; i++) r = await op<{ done: boolean }>('payruns.calculate', { payrun: run.id, continue: true });
      changed('payruns', 'payslips');
      navigate('/payroll/runs/' + run.id, { tab: 'issues' });
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  const template = (): void => {
    const lines = [['employee'].concat(cols.map((c) => c.key)).join(',')];
    for (const p of d.people) lines.push([csvCell(p.number)].concat(cols.map((c) => (p.columns.indexOf(c.key) >= 0 && p.opening !== null && p.opening.values_minor[c.key] !== undefined ? majorParam(p.opening.values_minor[c.key], cur) ?? '' : ''))).join(','));
    saveText(lines.join('\r\n') + '\r\n', 'opening-balances-' + d.entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv');
  };

  // The entity picker names the entity; from a run (no picker) the meta does.
  const meta = (runRef !== '' ? [d.entity.name] : []).concat([t('payroll.open.up_to', { day: upTo }), tn('payroll.open.n_people', d.people.length)]).join(' · ');
  return (
    <>
      <PageHeader title={t('payroll.open.title')} meta={meta} back={run !== null ? '#/payroll/runs/' + run.id + '?tab=issues' : '#/payroll'}>
        {runRef === '' && ent.picker}
        {run !== null && runOpen && d.can.edit && (
          <Button variant="primary" icon={Calculator} busy={busy === 'calc'} onClick={() => void recalc()} aria-label={t('payroll.open.recalc', { run: runTitle(run) })}>
            <span className="hidden sm:inline">{t('payroll.open.recalc_short')}</span>
          </Button>
        )}
        {d.people.length > 0 && (
          <Menu icon={Ellipsis} label={t('ui.more')}>
            {(close) => (
              <>
                {d.can.edit && (
                  <MenuItem icon={Upload} onClick={() => { close(); setImportOpen(true); }}>
                    {t('payroll.open.import')}
                  </MenuItem>
                )}
                <MenuItem icon={Download} onClick={() => { close(); template(); }}>
                  {t('payroll.open.template')}
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        {runRef === '' && ent.phonePicker}
        <div className="hr-in flex min-w-0 flex-col gap-3">
          <Panel index="01" label={t('payroll.open.start')}>
            <div className="flex flex-col gap-1">
              <Row label={t('payroll.set.go_live')} hint={t('payroll.open.go_live_hint')}>
                <DayPicker value={d.go_live_day} onChange={(v) => void setGoLive(v)} label={t('payroll.set.go_live')} clearable disabled={!d.can.edit || busy === 'golive'} />
              </Row>
              <Row label={t('payroll.open.none_paid')} hint={t('payroll.open.none_paid_hint')}>
                <Toggle checked={d.confirmed.on} onChange={(v) => void setConfirmed(v)} label={t('payroll.open.none_paid')} disabled={!d.can.confirm || busy === 'confirm'} />
              </Row>
              {d.confirmed.on && d.confirmed.by_name !== '' && (
                <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.open.confirmed_by', { who: d.confirmed.by_name, day: fmtDay(dayOf(d.confirmed.at, { entity }), { year: 'always', entity }) })}</div>
              )}
            </div>
          </Panel>
          {d.required && d.needed > 0 && <Notice tone="warn">{tn('payroll.open.needed', d.needed, { day: upTo })}</Notice>}
          {!d.required && d.people.length > 0 && <Notice>{t('payroll.open.after_first_run')}</Notice>}
          {hidePay && d.people.length > 0 && <Notice>{t('payroll.open.hide_pay')}</Notice>}
          <Panel index="02" label={t('payroll.open.figures', { day: upTo })} flush>
            {d.people.length === 0 ? (
              <Empty icon={CalendarCheck} title={t('payroll.open.empty')}>
                {t('payroll.open.empty_hint')}
              </Empty>
            ) : (
              <div className="hr-scroll min-w-0 overflow-x-auto">
                <table className="w-max min-w-full border-collapse">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="sticky left-0 z-[1] min-w-[160px] max-w-[220px] border-b border-r border-[var(--hr-hair)] bg-[var(--hr-panel)] px-3 py-1.5 text-left align-bottom max-sm:min-w-[136px]">
                        <span className="hr-label">{t('payroll.open.person')}</span>
                      </th>
                      {groups.map((g) => (
                        <th key={g.pack} colSpan={g.cols.length} className="border-b border-l border-[var(--hr-hair)] px-2 py-1.5 text-left">
                          <span className="hr-label">{g.name}</span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {cols.map((c, i) => (
                        <th key={c.key} className={'max-w-[168px] border-b border-[var(--hr-hair)] px-2 py-1.5 text-right align-bottom font-normal' + (i === 0 || cols[i - 1]?.pack !== c.pack ? ' border-l' : '')}>
                          <span className="inline-flex items-end justify-end gap-1 text-[12px] leading-tight text-[var(--hr-ink-2)]">
                            <span className="hr-wrap">{c.label}</span>
                            {c.help !== '' && <Hint text={c.help} />}
                          </span>
                          <span className="hr-mono block text-[10.5px] text-[var(--hr-faint)]">{c.use === 'withheld' ? t('payroll.open.withheld') : c.key}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.people.map((p) => (
                      <tr key={p.employment} className="border-b border-[var(--hr-hair)] last:border-b-0">
                        <td className="sticky left-0 z-[1] border-r border-[var(--hr-hair)] bg-[var(--hr-panel)] px-3 py-1.5 align-middle">
                          <div className="flex min-w-0 items-center gap-2">
                            <StatusDot tone={STATUS_TONE[p.status]} />
                            <div className="min-w-0">
                              <a href={'#/people/' + p.number + '?tab=pay'} className="hr-link hit block max-w-[180px] cursor-pointer truncate text-[13px] font-medium">
                                {p.name}
                              </a>
                              <div className="hr-mono text-[10.5px] text-[var(--hr-faint)]">
                                {p.number}
                                {saved[p.employment] === true ? ' · ' + t('ui.saved') : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        {cols.map((c, i) => {
                          const mine = p.columns.indexOf(c.key) >= 0;
                          const v = p.opening !== null && p.opening.values_minor[c.key] !== undefined ? p.opening.values_minor[c.key] ?? null : null;
                          return (
                            <td key={c.key} className={'px-1 py-1 align-middle' + (i === 0 || cols[i - 1]?.pack !== c.pack ? ' border-l border-[var(--hr-hair)]' : '') + (mine ? '' : ' bg-[var(--hr-sunk)]')}>
                              {!mine ? null : editable ? (
                                <Cell value={v} currency={cur} label={p.name + ', ' + c.label} disabled={false} onCommit={(nv) => saveCell(p, c.key, nv)} />
                              ) : v === null ? null : (
                                <Money minor={v} currency={cur} display="code" className="block px-2 text-right text-[13px]" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {d.people.length > 0 && <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.open.note', { day: upTo, currency: cur })}</div>}
        </div>
      </PageBody>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} params={params} currency={cur} cols={cols} />
    </>
  );
}

/** A spreadsheet of opening figures: checked first (nothing changes), then saved all at once. */
function ImportDialog({ open, onClose, params, currency, cols }: { open: boolean; onClose: () => void; params: Record<string, string>; currency: string; cols: Col[] }): React.JSX.Element {
  const [csv, setCsv] = useState('');
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (k: string): string => cols.find((c) => c.key === k)?.label ?? k;
  const run = async (commit: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (commit) {
        const r = await op<{ saved: number }>('ytd.import', { ...params, csv }, { quiet: true });
        toast.success(tn('payroll.open.imported', r.saved));
        changed('ytd_openings', 'payruns');
        setCheck(null);
        setCsv('');
        onClose();
      } else setCheck(await op<ImportCheck>('ytd.import-check', { ...params, csv }, { quiet: true }));
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('payroll.open.import')}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button icon={FileUp} busy={busy} disabled={csv.trim() === ''} onClick={() => void run(false)}>
            {t('payroll.act.check_csv')}
          </Button>
          <Button variant="primary" icon={Upload} busy={busy} disabled={check === null || !check.ok} onClick={() => void run(true)}>
            {t('payroll.act.import')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.open.import_hint', { currency })}</div>
        <FileDrop
          label={t('payroll.open.choose_file')}
          accept=".csv,text/csv"
          onFiles={(files) => {
            const f = files[0];
            if (f !== undefined)
              void f.text().then((text) => {
                setCsv(text);
                setCheck(null);
              });
          }}
        />
        <Textarea value={csv} onChange={(e) => { setCsv(e.target.value); setCheck(null); }} minRows={5} maxRows={10} className="hr-mono text-[12px]" aria-label={t('payroll.open.paste')} placeholder={'employee,' + cols.slice(0, 3).map((c) => c.key).join(',')} />
        {error !== null && <Notice tone="bad">{error}</Notice>}
        {check !== null && (
          <div className="flex flex-col gap-1.5">
            {check.problems.map((p, i) => (
              <Notice key={i} tone="bad">
                {t('payroll.import.row', { row: p.row }) + ': ' + p.message}
              </Notice>
            ))}
            {check.rows.map((r) => (
              <div key={r.row} className="flex min-w-0 items-start gap-2 text-[13px]">
                <span className="mt-1.5">
                  <StatusDot tone="good" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.name}</span> <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{r.number}</span>
                  <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">
                    {Object.keys(r.values_minor).map((k, i) => (
                      <span key={k}>
                        {i > 0 ? ', ' : ''}
                        {label(k) + ' '}
                        {r.values_minor[k] === null || r.values_minor[k] === undefined ? t('payroll.open.cleared') : <Money minor={r.values_minor[k]} currency={currency} />}
                      </span>
                    ))}
                  </span>
                </span>
                {r.replaces && <span className="text-[12px] text-[var(--hr-muted)]">{t('payroll.open.updates')}</span>}
              </div>
            ))}
            {check.ok && <div className="text-[12px] text-[var(--hr-muted)]">{tn('payroll.open.would_save', check.would_save)}</div>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
