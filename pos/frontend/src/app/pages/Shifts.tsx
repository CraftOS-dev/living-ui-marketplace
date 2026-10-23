/**
 * Cash and shifts. This register in the dark card: open it with a counted
 * float, put cash in or take it out, print the X report, close it; under it
 * the live X report. Closing is a full screen that grows out of the Close
 * button and it is blind: the drawer is counted note by note first, then the
 * screen shows what was expected and the difference, with a note when it is
 * over or short. The Z report is frozen at close and can be printed. Beside
 * it, every shift of every register.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, Check, Lock, LockOpen, Printer, Wallet } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { denominations } from '../lib/denominations.ts';
import { dateTime, money, percent, plural, time } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { printNode } from '../lib/print.tsx';
import { can, useSession } from '../lib/session.ts';
import type { ShiftReport } from '../lib/types.ts';
import { CashMoveDialog } from '../components/CashMove.tsx';
import { OpenRegister } from '../components/register/SmallPanels.tsx';
import { Badge, Button, Card, CardHeader, Empty, Field, IconBadge, Modal, PageHeader, RevealScreen, ScreenHeader, Spinner, Step, originOf, rowCls, textareaCls } from '../components/ui.tsx';
import type { Origin, Tone } from '../components/ui.tsx';

const MOVE_LABEL: Record<string, string> = { pay_in: 'Paid in', pay_out: 'Paid out', drop: 'Safe drop' };

/* ------------------------------------------------------------ the report */

interface ReportLine {
  key: string;
  l: string;
  v: string;
  strong: boolean;
}

interface ReportSection {
  title: string;
  lines: ReportLine[];
  note: string;
  /** Long lines: the section takes the full width on screen. */
  wide: boolean;
}

/** What an X or Z report says, section by section. */
function sectionsOf(r: ShiftReport): ReportSection[] {
  const m = (n: number): string => money(n, r.currency, r.currency_decimals);
  const out: ReportSection[] = [];
  const row = (l: string, v: string, strong = false): Omit<ReportLine, 'key'> => ({ l, v, strong });
  const section = (title: string, rows: (Omit<ReportLine, 'key'> | false)[], note = '', wide = false): void => {
    const lines = rows.filter((x): x is Omit<ReportLine, 'key'> => x !== false).map((x, i) => ({ ...x, key: `${i} ${x.l}` }));
    out.push({ title, lines, note, wide });
  };
  section('Sales', [
    row(`Orders${r.sales.refunds > 0 ? ` (and ${r.sales.refunds === 1 ? '1 refund' : `${r.sales.refunds} refunds`})` : ''}`, String(r.sales.orders)),
    row('Items sold', String(r.sales.items)),
    row('Gross', m(r.sales.gross)),
    r.sales.discounts !== 0 && row('Discounts', m(-r.sales.discounts)),
    r.sales.returns !== 0 && row(`Returns (${r.sales.returned_items === 1 ? '1 item' : `${r.sales.returned_items} items`})`, m(-r.sales.returns)),
    row('Net sales before tax', m(r.sales.net)),
    r.sales.service_charge !== 0 && row('Service charge', m(r.sales.service_charge)),
    row('Tax', m(r.sales.tax)),
    r.sales.rounding !== 0 && row('Cash rounding', m(r.sales.rounding)),
    row('Collected', m(r.sales.total), true),
  ]);
  if (r.taxes.length > 0) {
    section(
      'Tax',
      r.taxes.map((t) => row(`${t.mark !== '' ? `${t.mark} ` : ''}${percent(t.rate_bp)} on ${m(t.base)}`, m(t.tax))),
    );
  }
  section('Payments', r.tenders.length === 0 ? [row('None', '')] : r.tenders.map((t) => row(`${t.name} (${t.count})`, m(t.amount))));
  section(
    'Cash drawer',
    [
      row('Opening float', m(r.cash.opening_float)),
      row('Cash taken', m(r.cash.cash_taken)),
      r.cash.cash_refunded !== 0 && row('Cash refunded', m(-r.cash.cash_refunded)),
      r.cash.pay_in !== 0 && row('Paid in', m(r.cash.pay_in)),
      r.cash.pay_out !== 0 && row('Paid out', m(-r.cash.pay_out)),
      r.cash.drops !== 0 && row('Safe drops', m(-r.cash.drops)),
      row('Expected', m(r.cash.expected), true),
      r.cash.counted !== null && row('Counted', m(r.cash.counted), true),
      r.cash.variance !== null && row(r.cash.variance === 0 ? 'Balanced' : r.cash.variance > 0 ? 'Over' : 'Short', m(Math.abs(r.cash.variance)), true),
    ],
    r.shift.note,
  );
  if (r.moves.length > 0) {
    section(
      'Cash in and out',
      r.moves.map((mv) => row(`${time(mv.created)} ${MOVE_LABEL[mv.kind] ?? mv.kind}: ${mv.reason} (${mv.staff}${mv.approver !== '' ? `, approved by ${mv.approver}` : ''})`, m(mv.kind === 'pay_in' ? mv.amount : -mv.amount))),
      '',
      true,
    );
  }
  if (r.categories.length > 0) {
    section(
      'Categories',
      r.categories.map((c) => row(`${c.name} (${c.qty})`, m(c.net))),
    );
  }
  if (r.staff.length > 0) {
    section(
      'Staff',
      r.staff.map((s) => row(`${s.name} (${s.orders})`, m(s.total))),
    );
  }
  if (r.overrides > 0 || r.voided_tickets > 0 || r.training_sales > 0) {
    section('Exceptions', [
      r.overrides > 0 && row('Manager approvals', String(r.overrides)),
      r.voided_tickets > 0 && row('Tickets voided', String(r.voided_tickets)),
      r.training_sales > 0 && row('Training sales (not counted)', String(r.training_sales)),
    ]);
  }
  return out;
}

/** The X or Z report: groups of soft rows on screen, plain black on white for receipt paper. */
export function ShiftSummary({ r, paper = false }: { r: ShiftReport; paper?: boolean }): React.JSX.Element {
  const sections = sectionsOf(r);
  const title = `${r.kind === 'z' ? 'Z report' : 'X report'} · ${r.shift.register?.name ?? ''} #${r.shift.number}`;
  const opened = `Opened ${dateTime(r.shift.opened_at)} by ${r.shift.opened_by}${r.shift.closed_at !== '' ? ` · closed ${dateTime(r.shift.closed_at)} by ${r.shift.closed_by}` : ''}`;
  if (paper) {
    return (
      <div className="flex w-[80mm] flex-col gap-2 px-3 py-3" style={{ background: 'var(--ps-paper)', color: 'var(--ps-paper-ink)', fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace" }}>
        <div>
          <p className="text-[14px] font-bold">{title}</p>
          <p className="text-[12px]">{opened}</p>
        </div>
        {sections.map((s) => (
          <div key={s.title} className="flex flex-col gap-0.5 border-t border-dashed border-current pt-1.5">
            <p className="text-[12px] font-bold">{s.title}</p>
            {s.lines.map((x) => (
              <div key={x.key} className={cn('flex justify-between gap-3 text-[12px]', x.strong && 'font-bold')}>
                <span className="min-w-0 truncate">{x.l}</span>
                <span className="num shrink-0">{x.v}</span>
              </div>
            ))}
            {s.note !== '' && <p className="text-[12px] italic">{s.note}</p>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[15px] font-bold leading-[22px]">{title}</p>
        <p className="mt-0.5 text-[13px] text-[var(--ps-muted)]">{opened}</p>
      </div>
      <div className="-mb-5 columns-1 gap-5 md:columns-2">
        {sections.map((s) => (
          <section key={s.title} className={cn('mb-5 flex break-inside-avoid flex-col gap-2', s.wide && '[column-span:all]')}>
            <h3 className="px-1 text-[13px] font-bold text-[var(--ps-ink-2)]">{s.title}</h3>
            <ul className="flex flex-col gap-1.5">
              {s.lines.map((x) => (
                <li key={x.key} className={cn('flex items-baseline justify-between gap-3 rounded-[14px] bg-[var(--ps-row)] px-4 py-2 text-[13px]', x.strong ? 'font-bold' : 'font-medium')}>
                  <span className="min-w-0 break-words">{x.l}</span>
                  <span className="num shrink-0">{x.v}</span>
                </li>
              ))}
            </ul>
            {s.note !== '' && <p className="px-1 text-[13px] italic text-[var(--ps-ink-2)]">{s.note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

export function printShift(r: ShiftReport): void {
  printNode(<ShiftSummary r={r} paper />, 80);
}

/** The drawer against what was expected, as a status pill. */
function variancePill(variance: number, currency: string, exp: number): { tone: Tone; text: string } {
  if (variance === 0) return { tone: 'good', text: 'Balanced' };
  return { tone: variance > 0 ? 'warn' : 'bad', text: `${variance > 0 ? 'Over' : 'Short'} ${money(Math.abs(variance), currency, exp)}` };
}

/* ------------------------------------------------------ closing the register */

/** Esc leaves the screen (unless a dialog is open over it). */
function EscToLeave({ onEsc }: { onEsc: () => void }): null {
  const fn = useRef(onEsc);
  fn.current = onEsc;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      fn.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

/** One sum of the check: a soft tile with a large number. */
function SumTile({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[22px] bg-[var(--ps-row)] p-4">
      <span className="text-[13px] font-semibold text-[var(--ps-muted)]">{label}</span>
      {value !== null ? (
        <span className="num truncate text-[26px] font-bold leading-8 tracking-[-0.01em]">{value}</span>
      ) : (
        <span role="img" className="text-[26px] font-bold leading-8 text-[var(--ps-muted)]" aria-label="Shown after the count">
          •••
        </span>
      )}
    </div>
  );
}

/**
 * Blind close as a full screen: count first, then see the difference, then
 * close. Once closed it shows the Z report until Done shrinks it back.
 */
function CloseRegister({
  origin,
  register,
  name,
  report,
  onShiftClosed,
  onClosed,
}: {
  origin: Origin;
  register: string;
  name: string;
  report: ShiftReport;
  /** The register is closed: the page reloads what it shows. */
  onShiftClosed: () => void;
  onClosed: () => void;
}): React.JSX.Element {
  const { currency, exp } = useApp();
  const notes = denominations(currency, exp);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [step, setStep] = useState<'count' | 'review'>('count');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [z, setZ] = useState<ShiftReport | null>(null);
  const check = useRef<HTMLDivElement | null>(null);
  const counted = notes.reduce((s, d) => s + d * (counts[String(d)] ?? 0), 0);
  const variance = counted - report.cash.expected;
  const m = (n: number): string => money(n, currency, exp);
  const close = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const closed = await api.closeShift(register, counts, note.trim());
      toast.success(`${name} is closed`);
      setZ(closed);
      onShiftClosed();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  }, [register, counts, note, name, onShiftClosed]);

  // On a narrow screen the check sits under the count: bring it into view.
  useEffect(() => {
    if (step === 'review') check.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [step]);

  const reviewing = step === 'review';
  return (
    <RevealScreen origin={origin} label={`Close ${name}`} onClosed={onClosed}>
      {(leave) => {
        const back = (): void => {
          if (!busy) leave();
        };
        if (z !== null) {
          const pill = variancePill(z.cash.variance ?? 0, z.currency, z.currency_decimals);
          return (
            <div className="mx-auto w-full max-w-[920px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
              <EscToLeave onEsc={leave} />
              <ScreenHeader title={`${name} is closed`} subtitle={`Closed ${dateTime(z.shift.closed_at)} · ${z.shift.closed_by}`} onBack={leave} />
              <Card delay={2}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <Badge tone={pill.tone}>{pill.text}</Badge>
                  <Button icon={Printer} onClick={() => printShift(z)}>
                    Print the Z report
                  </Button>
                </div>
                <ShiftSummary r={z} />
              </Card>
              <Button variant="primary" size="lg" icon={Check} dot className="ps-rise ps-d3 mt-5 w-full" onClick={leave}>
                Done
              </Button>
            </div>
          );
        }
        return (
          <div className="mx-auto w-full max-w-[1040px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
            <EscToLeave onEsc={back} />
            <div className="mx-auto max-w-[560px] min-[1000px]:max-w-none">
              <ScreenHeader title={`Close ${name}`} subtitle={`Open since ${dateTime(report.shift.opened_at)} · ${report.shift.opened_by}`} onBack={back} backDisabled={busy} />
            </div>
            <div className="mx-auto grid max-w-[560px] gap-4 min-[1000px]:max-w-none min-[1000px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] min-[1000px]:gap-5">
              {/* 1. Count */}
              <Step n={1} state={reviewing ? 'done' : 'current'} title="Count the drawer" hint="Notes and coins" delay={2}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {notes.map((d) => {
                    const n = counts[String(d)] ?? 0;
                    return (
                      <label key={d} className={cn(rowCls, 'flex items-center gap-2 py-1.5 pl-4 pr-1.5')}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="num truncate text-[14px] font-bold leading-5">{m(d)}</span>
                          {n > 0 && <span className="num truncate text-[12px] leading-4 text-[var(--ps-muted)]">{m(d * n)}</span>}
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          placeholder="0"
                          value={counts[String(d)] ?? ''}
                          readOnly={reviewing}
                          onChange={(e) => setCounts({ ...counts, [String(d)]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                          className="num h-11 w-[76px] shrink-0 rounded-full bg-[var(--ps-card)] px-4 text-right text-[14px] font-semibold text-[var(--ps-ink)] outline-none ring-[var(--ps-ink)] transition-shadow focus-visible:ring-2"
                          aria-label={`How many ${m(d)}`}
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="ps-on-dark mt-3 rounded-[22px] bg-[var(--ps-dark)] p-5 text-[var(--ps-on-dark)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold text-[var(--ps-muted)]">Counted</span>
                    <span className="rounded-full bg-[var(--ps-dark-2)] px-3 py-1 text-[12px] font-semibold">{currency}</span>
                  </div>
                  <p className="num mt-3 truncate text-[26px] font-extrabold leading-8 tracking-[-0.01em]" aria-live="polite">
                    {m(counted)}
                  </p>
                </div>
                <Button variant="primary" size="lg" className="mt-3 w-full" disabled={reviewing} onClick={() => setStep('review')}>
                  Counted {m(counted)}
                </Button>
              </Step>

              {/* 2. Check and close */}
              <div ref={check} className="flex min-w-0 flex-col">
                <Step n={2} state={reviewing ? 'current' : 'todo'} title="Check and close" delay={3} className="flex-1" {...(reviewing ? {} : { hint: 'After the count' })}>
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <SumTile label="Expected in the drawer" value={reviewing ? m(report.cash.expected) : null} />
                      <SumTile label="Counted" value={m(counted)} />
                    </div>
                    {reviewing && (
                      <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[22px] p-4', variance === 0 ? 'bg-[var(--ps-green)]/14 text-[var(--ps-green-text)]' : 'bg-[var(--ps-red)]/14 text-[var(--ps-red-text)]')}>
                        <span className="text-[15px] font-bold">{variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'}</span>
                        <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{m(Math.abs(variance))}</span>
                      </div>
                    )}
                    {reviewing && variance !== 0 && (
                      <Field label={`Why is it ${variance > 0 ? 'over' : 'short'}?`}>
                        <textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} className={textareaCls} autoFocus />
                      </Field>
                    )}
                    {report.open_tickets > 0 && (
                      <div>
                        <Badge tone="warn">{report.open_tickets === 1 ? '1 ticket is still open' : `${report.open_tickets} tickets are still open`}</Badge>
                      </div>
                    )}
                    <span className="min-h-2 flex-1" />
                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                      {reviewing && (
                        <Button size="lg" disabled={busy} onClick={() => setStep('count')}>
                          Count again
                        </Button>
                      )}
                      <Button variant="primary" size="lg" icon={Lock} dot loading={busy} disabled={!reviewing || (variance !== 0 && note.trim() === '')} onClick={() => void close()} className="sm:min-w-0 sm:flex-1">
                        Close the register
                      </Button>
                    </div>
                  </div>
                </Step>
              </div>
            </div>
          </div>
        );
      }}
    </RevealScreen>
  );
}

/* ------------------------------------------------------------ this register */

/** One number in the dark card. */
function DarkTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-[18px] bg-[var(--ps-dark-2)] px-4 py-3 sm:flex-col sm:items-start sm:justify-start sm:gap-1">
      <dt className="truncate text-[12px] font-semibold text-[var(--ps-muted)]">{label}</dt>
      <dd className="num max-w-full truncate text-[15px] font-bold">{value}</dd>
    </div>
  );
}

const onDarkPill = 'bg-[var(--ps-dark-2)] text-[var(--ps-on-dark)] hover:bg-[var(--ps-dark-2)] hover:opacity-90';

/** The dark card: this device's register while it is open. */
function RegisterCard({ name, report, showExpected, onCash, onClose }: { name: string; report: ShiftReport; showExpected: boolean; onCash: () => void; onClose: (origin: Origin) => void }): React.JSX.Element {
  const m = (n: number): string => money(n, report.currency, report.currency_decimals);
  return (
    <Card tone="dark" delay={1}>
      <div className="flex items-center gap-3">
        <IconBadge icon={Wallet} size={44} tone="dark" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold leading-[22px]">{name}</h2>
          <p className="mt-0.5 text-[13px] text-[var(--ps-muted)]">{`Open since ${dateTime(report.shift.opened_at)} · ${report.shift.opened_by}`}</p>
        </div>
      </div>
      <div className="mt-5">
        <p className="text-[13px] font-semibold text-[var(--ps-muted)]">Collected</p>
        <p className="num mt-1 truncate text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{m(report.sales.total)}</p>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <DarkTile label="Orders" value={String(report.sales.orders)} />
        <DarkTile label="Float" value={m(report.cash.opening_float)} />
        <DarkTile label="Cash expected" value={showExpected ? m(report.cash.expected) : 'Counted at close'} />
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button icon={Banknote} className={cn(onDarkPill, 'flex-1 sm:flex-none')} onClick={onCash}>
          Cash in or out
        </Button>
        {showExpected && (
          <Button icon={Printer} className={cn(onDarkPill, 'flex-1 sm:flex-none')} onClick={() => printShift(report)}>
            X report
          </Button>
        )}
        <Button variant="accent" icon={Lock} className="w-full sm:ml-auto sm:w-auto" onClick={(e) => onClose(originOf(e.currentTarget))}>
          Close
        </Button>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- earlier shifts */

/** Every shift of every register; `wide` when it has the page's full width. */
function History({ wide }: { wide: boolean }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [limit, setLimit] = useState(30);
  const d = useLive(() => api.shifts({ limit }), ['shifts'], [limit]);
  const [open, setOpen] = useState<string | null>(null);
  const rep = useLive(() => (open === null ? Promise.resolve(null) : api.shiftReport(open)), ['shifts'], [open]);
  const list = d.data?.shifts ?? [];
  // The report of the shift that was opened (not the one looked at before it).
  const shown = rep.data !== null && rep.data.shift.id === open ? rep.data : null;
  return (
    <Card delay={2}>
      <CardHeader title="Earlier shifts" subtitle="Every register" />
      {d.data === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <Empty icon={Wallet} title="No shifts yet" compact />
      ) : (
        <div role="list" className={cn('grid grid-cols-1 gap-2', wide && 'lg:grid-cols-2')}>
          {list.map((s) => {
            const pill = s.variance === null ? null : variancePill(s.variance, currency, exp);
            return (
              <div role="listitem" key={s.id}>
                <button type="button" onClick={() => setOpen(s.id)} className={cn(rowCls, 'ps-press flex h-full w-full items-start gap-3 px-3 py-3 text-left hover:bg-[var(--ps-row-hover)]')}>
                  <IconBadge icon={s.status === 'open' ? LockOpen : Lock} size={40} tone="card" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[14px] font-bold">
                        {s.register?.name ?? ''} #{s.number}
                      </span>
                      <span className="num shrink-0 pr-1 text-[14px] font-bold">{money(s.total, currency, exp)}</span>
                    </span>
                    <span className="text-[12px] text-[var(--ps-muted)]">
                      Opened {dateTime(s.opened_at)} by {s.opened_by}
                    </span>
                    {s.status !== 'open' && (
                      <span className="text-[12px] text-[var(--ps-muted)]">
                        Closed {dateTime(s.closed_at)} by {s.closed_by}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {s.status === 'open' && <Badge tone="good">Open</Badge>}
                      <Badge tone="neutral" className="bg-[var(--ps-card)]">
                        {plural(s.orders, 'order')}
                      </Badge>
                      {pill !== null && <Badge tone={pill.tone}>{pill.text}</Badge>}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {list.length >= limit && (
        <div className="mt-3 flex justify-center">
          <Button onClick={() => setLimit(limit + 30)}>Show 30 more</Button>
        </div>
      )}
      {open !== null && (
        <Modal
          open
          onClose={() => setOpen(null)}
          xl
          title={shown !== null ? `${shown.shift.register?.name ?? ''} #${shown.shift.number}` : 'Shift'}
          description={shown !== null ? (shown.kind === 'z' ? 'Z report' : 'Open: X report') : undefined}
          footer={
            shown !== null ? (
              <Button variant="primary" icon={Printer} onClick={() => printShift(shown)}>
                {shown.kind === 'z' ? 'Print the Z report' : 'Print'}
              </Button>
            ) : undefined
          }
        >
          {shown === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <div className="ps-on-card rounded-[22px] bg-[var(--ps-card)] p-4 md:p-5">
              <ShiftSummary r={shown} />
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}

export function ShiftsPage(): React.JSX.Element {
  const { registers, reloadAll } = useApp();
  const { register: registerId } = useSession();
  const reg = registers.find((r) => r.id === registerId);
  const cur = useLive(() => api.currentShift(registerId), ['sales', 'shifts', 'cash_moves'], [registerId]);
  const [closing, setClosing] = useState<{ origin: Origin; report: ShiftReport } | null>(null);
  const [cash, setCash] = useState(false);
  const closed = useCallback(() => setClosing(null), []);
  const report = cur.data?.shift ?? null;
  const showExpected = can('reports');
  // Closed: the float count brings its own two cards and takes the page's width.
  const shut = reg !== undefined && cur.data !== null && report === null;
  const beside = showExpected && !shut;
  return (
    <div>
      <PageHeader title="Cash and shifts" />
      <div className={cn('grid grid-cols-1 gap-5 lg:items-start', beside && 'lg:grid-cols-12', !showExpected && !shut && 'max-w-[760px]')}>
        <div className={cn('flex min-w-0 flex-col gap-5', beside && 'lg:col-span-7')}>
          {reg === undefined || cur.data === null ? (
            <Card delay={1}>
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            </Card>
          ) : report === null ? (
            <OpenRegister register={registerId} name={reg.name} onOpened={() => reloadAll()} />
          ) : (
            <>
              <RegisterCard name={reg.name} report={report} showExpected={showExpected} onCash={() => setCash(true)} onClose={(origin) => setClosing({ origin, report })} />
              {showExpected && (
                <Card delay={2}>
                  <ShiftSummary r={report} />
                </Card>
              )}
            </>
          )}
        </div>
        {showExpected && (
          <div className={cn('min-w-0', beside && 'lg:col-span-5')}>
            <History wide={shut} />
          </div>
        )}
      </div>
      {closing !== null && reg !== undefined && <CloseRegister origin={closing.origin} register={registerId} name={reg.name} report={report ?? closing.report} onShiftClosed={reloadAll} onClosed={closed} />}
      {cash && <CashMoveDialog register={registerId} onClose={() => setCash(false)} />}
    </div>
  );
}
