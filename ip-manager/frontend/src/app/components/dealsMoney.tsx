/**
 * An agreement's money: the financial terms, the payment schedule, the
 * royalty reports (expected ones are created from the reporting terms,
 * people record what arrives), and minimum guarantee recoupment.
 */
import { useState } from 'react';
import { FileText, Plus, Receipt } from 'lucide-react';
import { Button, Dialog, Select, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, fmtMoney, fmtShort, relLabel, toPb, today } from '../lib/format.ts';
import type { AgreementRec, DocumentRec, RoyaltyReportRec } from '../lib/types.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { RecordPicker } from './pickers.tsx';
import { EmptyHint, Fact, FactGrid, Pill, Section, TONE_TEXT } from './ui.tsx';
import {
  DateField,
  NumberField,
  REPORTING_LABEL,
  ROYALTY_STATUS_LABEL,
  ROYALTY_STATUS_TONE,
  num,
  numStr,
} from './dealsShared.tsx';

const STATUS_OPTIONS = (Object.keys(ROYALTY_STATUS_LABEL) as RoyaltyReportRec['status'][]).map((s) => ({ value: s, label: ROYALTY_STATUS_LABEL[s] }));
const DOC_SEARCH = ['title'];
const docLabel = (d: DocumentRec): string => `${d.title}${d.doc_date ? ` (${fmtDate(d.doc_date)})` : ''}`;

function money(n: number, currency: string): string {
  return n ? fmtMoney(n, currency) : '';
}

/* ------------------------------------------------------------------ */
/* Royalty report dialog                                               */
/* ------------------------------------------------------------------ */

function RoyaltyReportDialog({
  agreement,
  report,
  onClose,
  onSaved,
}: {
  agreement: AgreementRec;
  report: RoyaltyReportRec | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { can } = useApp();
  const currency = (report?.currency || agreement.currency || '').toUpperCase();
  const recording = report !== null && report.status === 'expected' && d10(report.received_date) === '';
  const [periodStart, setPeriodStart] = useState(d10(report?.period_start));
  const [periodEnd, setPeriodEnd] = useState(d10(report?.period_end));
  const [due, setDue] = useState(d10(report?.due_date));
  const [received, setReceived] = useState(recording || report === null ? today() : d10(report.received_date));
  const [gross, setGross] = useState(numStr(report?.gross_sales));
  const [royalty, setRoyalty] = useState(numStr(report?.royalty_due));
  const [paid, setPaid] = useState(numStr(report?.paid_amount));
  const [status, setStatus] = useState<RoyaltyReportRec['status']>(recording || report === null ? 'received' : report.status);
  const [doc, setDoc] = useState(report?.document ?? '');
  const [notes, setNotes] = useState(report?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  const suggested = agreement.royalty_rate > 0 && num(gross) > 0 ? Math.round(num(gross) * agreement.royalty_rate) / 100 : 0;

  const save = async (): Promise<void> => {
    const errs: Record<string, string> = {};
    if (periodStart === '' || periodEnd === '') errs['period'] = 'Enter the period the report covers.';
    else if (periodEnd < periodStart) errs['period'] = 'The period must end after it starts.';
    if ((status === 'received' || status === 'paid') && received === '') errs['received'] = 'Enter the date the report arrived.';
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first !== undefined) {
      toast.error(first);
      return;
    }
    const payload: Record<string, unknown> = {
      agreement: agreement.id,
      period_start: toPb(periodStart),
      period_end: toPb(periodEnd),
      due_date: toPb(due),
      received_date: status === 'expected' ? '' : toPb(received),
      gross_sales: num(gross),
      royalty_due: num(royalty),
      paid_amount: num(paid),
      currency,
      status,
      document: doc,
      notes: notes.trim(),
    };
    setBusy(true);
    try {
      if (report !== null) await updateRecord<RoyaltyReportRec>('royalty_reports', report.id, payload);
      else await createRecord<RoyaltyReportRec>('royalty_reports', payload);
      toast.success(status === 'expected' ? 'Report saved' : `Report recorded as ${ROYALTY_STATUS_LABEL[status].toLowerCase()}`);
      onSaved();
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (report === null) return;
    if (!(await confirm('Delete this royalty report? If the agreement still expects a report for this period, the next sync creates it again.', 'Delete report'))) return;
    try {
      await deleteRecord('royalty_reports', report.id);
      toast.success('Report deleted');
      onSaved();
      onClose();
    } catch {
      /* toast shown by the client */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={report === null ? 'Add a royalty report' : recording ? 'Record the royalty report' : 'Royalty report'}
      description={
        report === null
          ? 'For a period outside the regular schedule, such as a final accounting or an audit adjustment.'
          : `Period ${fmtDate(report.period_start)} to ${fmtDate(report.period_end)}${report.due_date ? `, due ${fmtDate(report.due_date)}` : ''}.`
      }
      className="w-[min(94vw,38rem)]"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {report !== null && can.manage && (
              <Button variant="ghost" className="text-red-600" onClick={() => void remove()}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      {confirmEl}
      <div className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <DateField label="Period from" value={periodStart} required error={errors['period']} onChange={setPeriodStart} />
          <DateField label="Period to" value={periodEnd} required onChange={setPeriodEnd} />
          <DateField label="Due" value={due} onChange={setDue} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Status" value={status} options={STATUS_OPTIONS} onChange={(e) => setStatus(e.target.value as RoyaltyReportRec['status'])} />
          <DateField label="Received on" value={received} error={errors['received']} onChange={setReceived} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Gross sales" value={gross} suffix={currency} onChange={setGross} />
          <NumberField
            label="Royalty due"
            value={royalty}
            suffix={currency}
            onChange={setRoyalty}
            help={
              suggested > 0 && num(royalty) !== suggested ? (
                <button type="button" className="text-[var(--agent-app-accent)] hover:underline" onClick={() => setRoyalty(String(suggested))}>
                  Use {fmtMoney(suggested, currency)} ({agreement.royalty_rate}% of gross)
                </button>
              ) : undefined
            }
          />
          <NumberField label="Paid" value={paid} suffix={currency} onChange={setPaid} />
        </div>
        <RecordPicker<DocumentRec>
          collection="documents"
          label="Report document"
          value={doc}
          onChange={(id) => setDoc(id)}
          labelOf={docLabel}
          searchFields={DOC_SEARCH}
          filter={`agreement = "${agreement.id}"`}
          placeholder="Search this agreement's documents"
        />
        <p className="-mt-1.5 text-xs text-[var(--agent-app-muted)]">Upload the statement on the Documents tab first, then pick it here.</p>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For example: sales in two SKUs missing, asked for a corrected statement" />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Recoupment                                                          */
/* ------------------------------------------------------------------ */

function Recoupment({ agreement, earned }: { agreement: AgreementRec; earned: number }): React.JSX.Element | null {
  const mg = agreement.minimum_guarantee;
  const adv = agreement.advance;
  const cur = agreement.currency;
  if (mg <= 0 && adv <= 0) return null;
  const target = mg > 0 ? mg : adv;
  const scale = Math.max(target, adv, earned, 1);
  const pct = Math.min(100, (earned / scale) * 100);
  const advPos = Math.min(100, (adv / scale) * 100);
  const targetPos = Math.min(100, (target / scale) * 100);
  const done = earned >= target;
  const remaining = Math.max(0, target - earned);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
        <span>
          <b className="tabular-nums">{fmtMoney(earned, cur)}</b> earned of the {mg > 0 ? 'minimum guarantee' : 'advance'}{' '}
          <span className="tabular-nums">{fmtMoney(target, cur)}</span>
        </span>
        <span className={cn('text-xs tabular-nums', done ? TONE_TEXT.good : 'text-[var(--agent-app-muted)]')}>
          {done ? 'Recouped' : `${fmtMoney(remaining, cur)} to go (${Math.round((earned / target) * 100)}%)`}
        </span>
      </div>
      <div className="relative mt-2 h-3 border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/30">
        <div className={cn('absolute inset-y-0 left-0', done ? 'bg-emerald-500' : 'bg-[var(--agent-app-accent)]/75')} style={{ width: `${pct}%` }} />
        {mg > 0 && targetPos < 100 && <span className="absolute -inset-y-1 w-px bg-[var(--agent-app-text)]" style={{ left: `${targetPos}%` }} title="Minimum guarantee" />}
        {adv > 0 && (
          <span className="absolute -inset-y-1.5 w-0.5 bg-[var(--agent-app-text)]/70" style={{ left: `calc(${advPos}% - 1px)` }} title={`Advance ${fmtMoney(adv, cur)}`} />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-[var(--agent-app-muted)]">
        {adv > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-[var(--agent-app-text)]/70" aria-hidden /> Advance {fmtMoney(adv, cur)}
          </span>
        )}
        <span>Royalties from every report except waived ones count as earned.</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money tab                                                           */
/* ------------------------------------------------------------------ */

export function MoneyPanel({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const { can } = useApp();
  const cur = agreement.currency;
  const reports = useCollection<RoyaltyReportRec>('royalty_reports', { filter: `agreement = "${agreement.id}"`, sort: 'period_end' });
  const docs = useCollection<DocumentRec>('documents', { filter: `agreement = "${agreement.id}"` });
  const docById = new Map(docs.records.map((d) => [d.id, d]));
  const [dialog, setDialog] = useState<RoyaltyReportRec | null | 'new'>(null);
  const schedule = (agreement.payment_schedule ?? []).slice().sort((a, b) => d10(a.date).localeCompare(d10(b.date)));
  const earned = reports.records.filter((r) => r.status !== 'waived').reduce((s, r) => s + (r.royalty_due || 0), 0);
  const paidTotal = reports.records.reduce((s, r) => s + (r.paid_amount || 0), 0);
  const reporting = agreement.reporting_frequency !== '' && agreement.reporting_frequency !== 'none';

  const columns: Col<RoyaltyReportRec>[] = [
    {
      key: 'period',
      label: 'Period',
      value: (r) => d10(r.period_end),
      render: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {fmtShort(r.period_start)} to {fmtShort(r.period_end)}
        </span>
      ),
    },
    {
      key: 'due_date',
      label: 'Due',
      value: (r) => d10(r.due_date),
      render: (r) => {
        const late = r.status === 'expected' && d10(r.due_date) !== '' && daysUntil(r.due_date) < 0;
        return (
          <span className={cn('whitespace-nowrap tabular-nums', late && TONE_TEXT.bad)} title={late ? relLabel(r.due_date) : undefined}>
            {fmtDate(r.due_date)}
            {late && <span className="ml-1 text-xs">late</span>}
          </span>
        );
      },
    },
    { key: 'received_date', label: 'Received', value: (r) => d10(r.received_date), render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.received_date)}</span> },
    { key: 'gross_sales', label: 'Gross sales', align: 'right', value: (r) => r.gross_sales, render: (r) => money(r.gross_sales, r.currency || cur) },
    { key: 'royalty_due', label: 'Royalty due', align: 'right', value: (r) => r.royalty_due, render: (r) => money(r.royalty_due, r.currency || cur) },
    { key: 'paid_amount', label: 'Paid', align: 'right', value: (r) => r.paid_amount, render: (r) => money(r.paid_amount, r.currency || cur) },
    { key: 'status', label: 'Status', value: (r) => ROYALTY_STATUS_LABEL[r.status], render: (r) => <Pill tone={ROYALTY_STATUS_TONE[r.status]}>{ROYALTY_STATUS_LABEL[r.status]}</Pill> },
    {
      key: 'document',
      label: 'Statement',
      sortable: false,
      value: (r) => (r.document !== '' ? 'Yes' : ''),
      render: (r) => {
        const d = docById.get(r.document);
        return d !== undefined ? <DocLink doc={d} /> : '';
      },
    },
    { key: 'notes', label: 'Notes', render: (r) => <span className="line-clamp-2 max-w-[18rem] text-xs text-[var(--agent-app-muted)]">{r.notes}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Financial terms">
        <FactGrid cols={4}>
          <Fact label="Currency" value={cur} mono />
          <Fact label="Royalty rate" value={agreement.royalty_rate ? `${agreement.royalty_rate}%` : ''} />
          <Fact label="Royalty basis" value={agreement.royalty_basis} />
          <Fact label="Flat fee" value={money(agreement.flat_fee, cur)} />
          <Fact label="Advance" value={money(agreement.advance, cur)} />
          <Fact label="Minimum guarantee" value={money(agreement.minimum_guarantee, cur)} />
          <Fact
            label="Royalty reporting"
            value={reporting ? `${REPORTING_LABEL[agreement.reporting_frequency] ?? agreement.reporting_frequency}, due ${agreement.report_due_days || 30} days after each period` : ''}
          />
          <Fact label="Option extension fee" value={money(agreement.option_extension_fee, cur)} />
        </FactGrid>
        {(agreement.minimum_guarantee > 0 || agreement.advance > 0) && (
          <div className="mt-5 border-t border-[var(--agent-app-border)] pt-4">
            <Recoupment agreement={agreement} earned={earned} />
          </div>
        )}
      </Section>

      <Section title="Payment schedule" meta={schedule.length ? String(schedule.length) : undefined} flush>
        {schedule.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">No scheduled payments. Add them when editing the agreement; each one becomes a deadline.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">For</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((p, i) => {
                  const day = d10(p.date);
                  const upcoming = day !== '' && daysUntil(day) >= 0;
                  return (
                    <tr key={`${day}-${i}`} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                        {fmtDate(day)}
                        {upcoming && <span className="ml-2 text-xs text-[var(--agent-app-muted)]">{relLabel(day)}</span>}
                      </td>
                      <td className="px-4 py-2">{p.label || <span className="text-[var(--agent-app-muted)]">Payment</span>}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{fmtMoney(p.amount, p.currency || cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Royalty reports"
        meta={reports.records.length ? String(reports.records.length) : undefined}
        flush
        actions={
          can.edit ? (
            <Button size="sm" variant="outline" onClick={() => setDialog('new')}>
              <Plus size={13} aria-hidden /> Add report
            </Button>
          ) : undefined
        }
      >
        <DataTable<RoyaltyReportRec>
          tableId="agreement-royalty-reports"
          exportName={`${agreement.ref || 'agreement'}-royalty-reports`}
          rows={reports.records}
          columns={columns}
          dense
          initialSort={{ key: 'period', dir: 'asc' }}
          onRowClick={can.edit ? (r) => setDialog(r) : undefined}
          empty={
            <EmptyHint
              compact
              icon={Receipt}
              title="No royalty reports"
              message={
                reporting
                  ? 'Expected reports appear here from the reporting terms. Use Sync obligations on the Obligations tab if they are missing.'
                  : 'Set a reporting frequency on the agreement and the expected reports appear here.'
              }
              action={
                can.edit ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog('new')}>
                    Add a report
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {reports.records.length > 0 && (
          <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
            <span className="tabular-nums">
              Royalty due {fmtMoney(earned, cur)} · paid {fmtMoney(paidTotal, cur)}
            </span>
            {can.edit && <span>Click a report to record what arrived.</span>}
          </p>
        )}
      </Section>

      {dialog !== null && (
        <RoyaltyReportDialog agreement={agreement} report={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSaved={reports.refresh} />
      )}
    </div>
  );
}

function DocLink({ doc: d }: { doc: DocumentRec }): React.JSX.Element {
  return (
    <a
      href={fileUrl(d, d.file)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-[12rem] items-center gap-1 truncate text-xs text-[var(--agent-app-accent)] hover:underline"
    >
      <FileText size={12} aria-hidden />
      {d.title}
    </a>
  );
}
