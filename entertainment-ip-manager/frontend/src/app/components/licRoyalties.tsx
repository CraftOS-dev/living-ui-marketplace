/**
 * Royalty statements: the statement drawer (lines priced by the server
 * from the licence, totals, minimum-guarantee credit, late interest and
 * payment), the dialogs that add lines, record a payment or expect a new
 * statement, the minimum-guarantee table and a product's royalty lines.
 * Line royalties and rates are never typed: the server prices every line.
 */
import { useMemo, useState } from 'react';
import { Calculator, FileText, HandCoins, Plus, Receipt, Trash2 } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, cn, toast, useRecord } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { createRecord, errText, fileUrl, getRecord, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, fmtMoney, fmtNumber, fmtPct, fmtShort, relLabel, toPb } from '../lib/format.ts';
import { enumLabel, t, tn } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { AgreementRec, DocumentRec, PartyRec, ProductRec, RoyaltyLineRec, RoyaltyReportRec } from '../lib/records.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { DocumentsPanel } from './documents.tsx';
import { RecordPicker } from './pickers.tsx';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, Loading, Notice, Prose, Ref, Section, Segmented, TONE_TEXT } from './ui.tsx';
import { DeleteButton, canDelete } from './deleteRecord.tsx';
import { DateField, NumberField, RowDelete, SubHead, agreementLabel, expandOne, money, newest, numOf, numStr } from './licShared.tsx';
import { AGREEMENT_SEARCH, OUT_LICENCE_FILTER } from './licProductForm.tsx';

/** royalties/mg-status response. */
export interface MgStatus {
  minimum_guarantee: number;
  recoupable: boolean;
  earned: number;
  recouped: number;
  remaining: number;
  overage: number;
  paid: number;
  currency: string;
}

/** What the licensee owes on a statement: royalty, less the MG credit, plus late interest. */
export function payable(r: Pick<RoyaltyReportRec, 'royalty_due' | 'mg_credit' | 'late_interest'>): number {
  return Math.round((r.royalty_due + r.late_interest - r.mg_credit) * 100) / 100;
}

export function statementLate(r: Pick<RoyaltyReportRec, 'status' | 'due_date'>): boolean {
  const due = d10(r.due_date);
  return r.status === 'expected' && due !== '' && daysUntil(due) < 0;
}

export function periodText(r: Pick<RoyaltyReportRec, 'period_start' | 'period_end'>): string {
  return t('{from} to {to}', { from: fmtShort(r.period_start), to: fmtShort(r.period_end) });
}

/** The rate as the licence's basis reads it: a percentage, or an amount per unit. */
export function rateText(rate: number, basis: string, currency: string): string {
  if (!rate) return '';
  if (basis === 'per_unit' || basis === 'per_seal') return t('{amount} per unit', { amount: fmtMoney(rate, currency) });
  return fmtPct(rate);
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

interface LineDraft {
  key: number;
  product: string;
  description: string;
  territory: string;
  manufactured: string;
  sold: string;
  retail: string;
  wholesale: string;
  notes: string;
}

let draftKey = 0;
function emptyLine(): LineDraft {
  draftKey += 1;
  return { key: draftKey, product: '', description: '', territory: '', manufactured: '', sold: '', retail: '', wholesale: '', notes: '' };
}
function lineFrom(l: RoyaltyLineRec): LineDraft {
  draftKey += 1;
  return {
    key: draftKey,
    product: l.product,
    description: l.description,
    territory: l.territory,
    manufactured: numStr(l.manufactured_qty),
    sold: numStr(l.sold_qty),
    retail: numStr(l.retail_price),
    wholesale: numStr(l.wholesale_price),
    notes: l.notes,
  };
}

function AddLinesDialog({
  report,
  current,
  onClose,
  onDone,
}: {
  report: RoyaltyReportRec;
  current: RoyaltyLineRec[];
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const products = useCollection<ProductRec>('products', { filter: `agreement = ${q(report.agreement)}`, sort: 'name' });
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [rows, setRows] = useState<LineDraft[]>(() => [emptyLine()]);
  const [busy, setBusy] = useState(false);
  const productOptions = products.records.map((p) => ({ value: p.id, label: `${p.ref} ${p.name}`.trim() }));

  const switchMode = (m: 'add' | 'replace'): void => {
    setMode(m);
    setRows(m === 'replace' && current.length > 0 ? current.map(lineFrom) : [emptyLine()]);
  };
  const patch = (key: number, p: Partial<LineDraft>): void => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const pickProduct = (row: LineDraft, id: string): void => {
    const p = products.records.find((x) => x.id === id);
    patch(row.key, {
      product: id,
      ...(p !== undefined && row.description === '' ? { description: p.name } : {}),
      ...(p !== undefined && row.retail === '' && p.retail_price > 0 ? { retail: String(p.retail_price) } : {}),
    });
  };
  const filled = rows.filter((r) => r.product !== '' || r.description.trim() !== '' || numOf(r.manufactured) > 0 || numOf(r.sold) > 0);

  const submit = async (): Promise<void> => {
    if (filled.length === 0 && mode === 'add') {
      toast.error(t('Fill in at least one line.'));
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ added: number; gross_sales: number; royalty_due: number; mg_credit: number; late_interest: number }>('royalties/add-lines', {
        report_id: report.id,
        replace: mode === 'replace',
        lines: filled.map((l) => ({
          product_id: l.product,
          description: l.description.trim(),
          territory: l.territory.trim(),
          manufactured_qty: numOf(l.manufactured),
          sold_qty: numOf(l.sold),
          retail_price: numOf(l.retail),
          wholesale_price: numOf(l.wholesale),
          notes: l.notes.trim(),
        })),
      });
      toast.success(tn(r.added, '{n} line saved. Royalty due {amount}.', '{n} lines saved. Royalty due {amount}.', { amount: fmtMoney(r.royalty_due, report.currency) }));
      onDone();
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Statement lines')}
      description={t('Copy quantities and prices from the licensee\'s report. The royalty of each line is priced from the licence.')}
      className="w-[min(94vw,52rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {mode === 'replace' ? t('Replace lines') : t('Add lines')}
          </Button>
        </>
      }
    >
      <div className="-mx-1 flex max-h-[66vh] flex-col gap-3 overflow-y-auto px-1">
        {current.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Segmented<'add' | 'replace'>
              value={mode}
              onChange={switchMode}
              ariaLabel={t('How to save')}
              options={[
                { value: 'add', label: t('Add to the current lines') },
                { value: 'replace', label: t('Replace all lines') },
              ]}
            />
            {mode === 'replace' && <p className="text-xs text-[var(--agent-app-muted)]">{t('The current lines are loaded below. Saving replaces them all.')}</p>}
          </div>
        )}
        {rows.map((row, i) => (
          <div key={row.key} className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--agent-app-muted)]">{t('Line {n}', { n: i + 1 })}</span>
              <button
                type="button"
                aria-label={t('Remove line {n}', { n: i + 1 })}
                className="text-[var(--agent-app-muted)] hover:text-red-600"
                onClick={() => setRows((list) => (list.length === 1 ? [emptyLine()] : list.filter((r) => r.key !== row.key)))}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select label={t('Product')} value={row.product} placeholder={t('Not matched to a product')} options={productOptions} onChange={(e) => pickProduct(row, e.target.value)} />
              <Input label={t('Description')} value={row.description} onChange={(e) => patch(row.key, { description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Input label={t('Territory')} value={row.territory} placeholder="JP" className="font-mono" onChange={(e) => patch(row.key, { territory: e.target.value })} />
              <Input label={t('Manufactured')} type="number" inputMode="numeric" value={row.manufactured} onChange={(e) => patch(row.key, { manufactured: e.target.value })} />
              <Input label={t('Sold')} type="number" inputMode="numeric" value={row.sold} onChange={(e) => patch(row.key, { sold: e.target.value })} />
              <Input label={t('Retail price')} type="number" inputMode="decimal" value={row.retail} onChange={(e) => patch(row.key, { retail: e.target.value })} />
              <Input label={t('Wholesale price')} type="number" inputMode="decimal" value={row.wholesale} onChange={(e) => patch(row.key, { wholesale: e.target.value })} />
            </div>
            <Input label={t('Notes')} value={row.notes} onChange={(e) => patch(row.key, { notes: e.target.value })} />
          </div>
        ))}
        <div>
          <Button size="sm" variant="outline" onClick={() => setRows((list) => [...list, emptyLine()])}>
            <Plus size={13} aria-hidden /> {t('Add a line')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PaymentDialog({ report, onClose, onDone }: { report: RoyaltyReportRec; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const owed = payable(report);
  const [amount, setAmount] = useState(numStr(report.paid_amount || owed));
  const [dispute, setDispute] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const short = Math.round((owed - numOf(amount)) * 100) / 100;
  const submit = async (): Promise<void> => {
    if (amount.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ id: string; status: string; owed: number; shortfall: number }>('royalties/record-payment', { report_id: report.id, amount: numOf(amount), dispute: dispute && short > 0.5, note: note.trim() });
      toast.success(
        r.status === 'disputed'
          ? t('Payment recorded. {amount} short; the statement is marked disputed.', { amount: fmtMoney(r.shortfall, report.currency) })
          : t('Payment recorded. The statement is marked paid.'),
      );
      onDone();
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Record payment')}
      description={t('Payable on this statement: {amount} (royalty, less the minimum guarantee credit, plus late interest).', { amount: fmtMoney(owed, report.currency) })}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={amount.trim() === ''}>
            {t('Record payment')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <NumberField label={t('Amount received')} value={amount} onChange={setAmount} suffix={report.currency} min={0} />
        {short > 0.5 && (
          <div className="flex flex-col gap-1.5">
            <p className={cn('text-xs', TONE_TEXT.warn)}>{t('{amount} less than payable.', { amount: fmtMoney(short, report.currency) })}</p>
            <Checkbox checked={dispute} onChange={setDispute} label={t('Mark the statement as disputed (short payment)')} />
          </div>
        )}
        <Textarea label={t('Note')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('For example: bank transfer of 30 Sep, fee deducted')} />
      </div>
    </Dialog>
  );
}

export function NewStatementDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: ((id: string) => void) | undefined }): React.JSX.Element {
  const { homeCurrency } = useApp();
  const [agreement, setAgreement] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [due, setDue] = useState('');
  const [currency, setCurrency] = useState(homeCurrency);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (agreement === '') {
      setError(t('Choose the licence.'));
      return;
    }
    if (from === '' || to === '' || to < from) {
      setError(t('Enter the period the statement covers.'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const rec = await createRecord<RoyaltyReportRec>('royalty_reports', {
        agreement,
        period_start: toPb(from),
        period_end: toPb(to),
        due_date: toPb(due),
        currency,
        status: 'expected',
        notes: notes.trim(),
      });
      toast.success(t('Statement added'));
      onCreated?.(rec.id);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Expect a statement')}
      description={t('Regular statements are created from each licence\'s reporting terms. Add one by hand for a final accounting or an extra period.')}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Add statement')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RecordPicker<AgreementRec>
          collection="agreements"
          label={t('Licence')}
          value={agreement}
          onChange={(id, rec) => {
            setAgreement(id);
            if (rec !== null && rec.currency !== '') setCurrency(rec.currency.toUpperCase());
          }}
          labelOf={agreementLabel}
          searchFields={AGREEMENT_SEARCH}
          filter={OUT_LICENCE_FILTER}
          placeholder={t('Search licences we grant')}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <DateField label={t('Period from')} value={from} onChange={setFrom} required />
          <DateField label={t('Period to')} value={to} onChange={setTo} required />
          <DateField label={t('Due date')} value={due} onChange={setDue} />
        </div>
        <Select label={t('Currency')} value={currency} options={(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => ({ value: c, label: c }))} onChange={(e) => setCurrency(e.target.value)} />
        <Textarea label={t('Notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error !== '' && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Minimum guarantee                                                   */
/* ------------------------------------------------------------------ */

export function MgBar({ mg }: { mg: MgStatus }): React.JSX.Element | null {
  if (mg.minimum_guarantee <= 0) return null;
  const pct = Math.min(100, (mg.earned / mg.minimum_guarantee) * 100);
  const done = mg.earned >= mg.minimum_guarantee;
  return (
    <div className="min-w-[8rem]">
      <div className="h-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/30" role="img" aria-label={t('{pct} of the guarantee earned', { pct: fmtPct(Math.round(pct)) })}>
        <div className={cn('h-full', done ? 'bg-emerald-500' : 'bg-[var(--agent-app-accent)]/75')} style={{ width: `${pct}%` }} />
      </div>
      <div className={cn('mt-0.5 text-[11px] tabular-nums', done ? TONE_TEXT.good : 'text-[var(--agent-app-muted)]')}>{done ? t('Recouped') : fmtPct(Math.round(pct))}</div>
    </div>
  );
}

function MgFacts({ mg }: { mg: MgStatus }): React.JSX.Element {
  const cur = mg.currency;
  return (
    <div className="flex flex-col gap-3">
      <FactGrid cols={4}>
        <Fact label={t('Guaranteed')} value={fmtMoney(mg.minimum_guarantee, cur)} />
        <Fact label={t('Earned')} value={fmtMoney(mg.earned, cur)} />
        <Fact label={t('Recouped')} value={fmtMoney(mg.recouped, cur)} />
        <Fact label={t('Remaining')} value={fmtMoney(mg.remaining, cur)} />
        <Fact label={t('Overage')} value={fmtMoney(mg.overage, cur)} />
        <Fact label={t('Paid')} value={fmtMoney(mg.paid, cur)} />
        <Fact label={t('Recoupable')} value={mg.recoupable ? t('Yes') : t('No')} />
      </FactGrid>
      <MgBar mg={mg} />
    </div>
  );
}

/** One row per active licence with a minimum guarantee. */
export function MgTable(): React.JSX.Element {
  const agreements = useCollection<AgreementRec>('agreements', {
    filter: 'minimum_guarantee > 0 && (status = "active" || status = "renewed")',
    sort: 'term_end',
    expand: 'counterparty',
  });
  const ids = agreements.records.map((a) => a.id).join(',');
  const status = useLiveAsync(
    async () => {
      const out: Record<string, MgStatus> = {};
      await Promise.all(
        ids
          .split(',')
          .filter((x) => x !== '')
          .map(async (id) => {
            try {
              out[id] = await op<MgStatus>('royalties/mg-status', { agreement_id: id });
            } catch {
              /* shown as empty */
            }
          }),
      );
      return out;
    },
    [ids],
    ['royalty_reports'],
  );
  const mgOf = (a: AgreementRec): MgStatus | undefined => status.data?.[a.id];
  const partyOf = (a: AgreementRec): string => expandOne<PartyRec>(a, 'counterparty')?.name ?? '';
  const cur = (a: AgreementRec): string => mgOf(a)?.currency || a.currency;
  const columns: Col<AgreementRec>[] = [
    {
      key: 'ref',
      label: t('Licence'),
      value: (a) => a.ref,
      render: (a) => (
        <a className="block max-w-[16rem] truncate hover:underline" href={href('agreement', a.id)}>
          <Ref className="mr-1.5">{a.ref}</Ref>
          {a.title}
        </a>
      ),
    },
    { key: 'licensee', label: t('Licensee'), value: partyOf, render: (a) => <span className="block max-w-[12rem] truncate">{partyOf(a)}</span> },
    { key: 'term_end', label: t('Term ends'), value: (a) => d10(a.term_end), render: (a) => <span className="whitespace-nowrap">{fmtDate(a.term_end)}</span> },
    { key: 'guaranteed', label: t('Guaranteed'), align: 'right', value: (a) => mgOf(a)?.minimum_guarantee ?? 0, render: (a) => <span className="whitespace-nowrap">{fmtMoney(mgOf(a)?.minimum_guarantee ?? a.minimum_guarantee, cur(a))}</span> },
    { key: 'earned', label: t('Earned'), align: 'right', value: (a) => mgOf(a)?.earned ?? 0, render: (a) => <span className="whitespace-nowrap">{fmtMoney(mgOf(a)?.earned, cur(a))}</span> },
    { key: 'recouped', label: t('Recouped'), align: 'right', value: (a) => mgOf(a)?.recouped ?? 0, render: (a) => <span className="whitespace-nowrap">{fmtMoney(mgOf(a)?.recouped, cur(a))}</span> },
    {
      key: 'remaining',
      label: t('Remaining'),
      align: 'right',
      value: (a) => mgOf(a)?.remaining ?? 0,
      render: (a) => <span className={cn('whitespace-nowrap', (mgOf(a)?.remaining ?? 0) > 0 && TONE_TEXT.warn)}>{fmtMoney(mgOf(a)?.remaining, cur(a))}</span>,
    },
    {
      key: 'overage',
      label: t('Overage'),
      align: 'right',
      value: (a) => mgOf(a)?.overage ?? 0,
      render: (a) => <span className={cn('whitespace-nowrap', (mgOf(a)?.overage ?? 0) > 0 && TONE_TEXT.good)}>{fmtMoney(mgOf(a)?.overage, cur(a))}</span>,
    },
    { key: 'paid', label: t('Paid'), align: 'right', value: (a) => mgOf(a)?.paid ?? 0, render: (a) => <span className="whitespace-nowrap">{fmtMoney(mgOf(a)?.paid, cur(a))}</span>, optional: true },
    {
      key: 'progress',
      label: t('Progress'),
      sortable: false,
      value: (a) => (mgOf(a) !== undefined ? Math.round(((mgOf(a)?.earned ?? 0) / Math.max(1, mgOf(a)?.minimum_guarantee ?? 1)) * 100) : 0),
      render: (a) => {
        const m = mgOf(a);
        return m !== undefined ? <MgBar mg={m} /> : '';
      },
    },
  ];
  if (agreements.loading) return <Loading />;
  if (agreements.error !== null && agreements.records.length === 0) return <ErrorBox message={agreements.error} onRetry={agreements.refresh} />;
  return (
    <Section title={t('Minimum guarantees')} meta={agreements.records.length > 0 ? String(agreements.records.length) : undefined} flush>
      <p className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
        {t('Active licences with a minimum guarantee. Royalties earned count against the guarantee (and any advance); a recoupable guarantee is credited on statements first.')}
      </p>
      <DataTable<AgreementRec>
        tableId="mg-status"
        exportName="minimum-guarantees"
        rows={agreements.records}
        columns={columns}
        dense
        onRowClick={(a) => navigate('agreement', a.id)}
        empty={<EmptyHint compact icon={HandCoins} title={t('No active licence has a minimum guarantee')} message={t('Set a minimum guarantee on a licence and its recoupment shows here.')} />}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Statement drawer                                                    */
/* ------------------------------------------------------------------ */

type StatementDialog = 'lines' | 'payment' | null;

export function StatementDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { can } = useApp();
  const live = useRecord<RoyaltyReportRec>('royalty_reports', id);
  const [saved, setSaved] = useState<RoyaltyReportRec | null>(null);
  const r = newest(live.record, saved !== null && saved.id === id ? saved : null);
  const agreementId = r?.agreement ?? '';
  const agreement = useRecord<AgreementRec>('agreements', agreementId !== '' ? agreementId : null);
  const counterparty = agreement.record?.counterparty ?? '';
  const licensee = useRecord<PartyRec>('parties', counterparty !== '' ? counterparty : null);
  const doc = useRecord<DocumentRec>('documents', r !== null && r.document !== '' ? r.document : null);
  const lines = useCollection<RoyaltyLineRec>('royalty_lines', { filter: `report = ${q(id)}`, sort: 'created', expand: 'product' });
  const mg = useLiveAsync(() => (agreementId !== '' ? op<MgStatus>('royalties/mg-status', { agreement_id: agreementId }) : Promise.resolve(null)), [agreementId], ['royalty_reports']);
  const [dialog, setDialog] = useState<StatementDialog>(null);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const lineDelete = canDelete(can, 'royalty_lines') && r !== null && r.status !== 'paid';

  const reload = async (): Promise<void> => {
    try {
      setSaved(await getRecord<RoyaltyReportRec>('royalty_reports', id));
    } catch {
      /* deleted meanwhile */
    }
    lines.refresh();
  };

  const recalc = async (): Promise<void> => {
    setRecalcBusy(true);
    try {
      await op('royalties/recalc', { report_id: id });
      toast.success(t('Statement recalculated'));
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setRecalcBusy(false);
    }
  };

  const basis = agreement.record?.royalty_basis ?? '';
  const cur = r?.currency || agreement.record?.currency || '';
  const totals = useMemo(() => {
    let made = 0;
    let sold = 0;
    let royalty = 0;
    for (const l of lines.records) {
      made += l.manufactured_qty;
      sold += l.sold_qty;
      royalty += l.royalty;
    }
    return { made, sold, royalty: Math.round(royalty * 100) / 100 };
  }, [lines.records]);

  const title = agreement.record !== null && r !== null ? `${agreement.record.ref} · ${periodText(r)}` : t('Royalty statement');

  return (
    <Drawer open onClose={onClose} title={title} width={760}>
      {r === null ? (
        <p className="text-sm text-[var(--agent-app-muted)]">{live.loading ? t('Loading') : t('This statement no longer exists or is not visible to you.')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <EnumPill field="royalty_reports.status" value={r.status} />
            <span className="text-[13px] font-medium">{periodText(r)}</span>
            {d10(r.due_date) !== '' && (
              <span className={cn('text-xs tabular-nums', statementLate(r) ? TONE_TEXT.bad : 'text-[var(--agent-app-muted)]')}>
                {t('Due {date}', { date: fmtShort(r.due_date) })}
                {statementLate(r) ? ` · ${relLabel(r.due_date)}` : ''}
              </span>
            )}
          </div>

          {(can.licensing || canDelete(can, 'royalty_reports')) && (
            <div className="flex flex-wrap gap-2">
              {can.licensing && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setDialog('lines')} disabled={r.status === 'paid'} title={r.status === 'paid' ? t('A paid statement cannot change.') : undefined}>
                    <Plus size={13} aria-hidden /> {t('Add lines')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void recalc()} loading={recalcBusy}>
                    <Calculator size={13} aria-hidden /> {t('Recalculate')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDialog('payment')}>
                    <HandCoins size={13} aria-hidden /> {t('Record payment')}
                  </Button>
                </>
              )}
              <DeleteButton collection="royalty_reports" id={r.id} onDeleted={onClose} label={t('Delete statement')} className="sm:ml-auto" />
            </div>
          )}

          <FactGrid cols={2}>
            <Fact
              label={t('Licence')}
              value={
                agreement.record !== null ? (
                  <a className="hover:underline" href={href('agreement', agreement.record.id)}>
                    <Ref>{agreement.record.ref}</Ref> {agreement.record.title}
                  </a>
                ) : (
                  ''
                )
              }
            />
            <Fact label={t('Licensee')} value={licensee.record?.name ?? ''} />
            <Fact
              label={t('Royalty basis')}
              value={agreement.record !== null && basis !== '' ? `${enumLabel('agreements.royalty_basis', basis)}${agreement.record.royalty_rate ? `, ${rateText(agreement.record.royalty_rate, basis, cur)}` : ''}` : ''}
            />
            <Fact label={t('Received')} value={fmtDate(r.received_date)} />
          </FactGrid>

          <div className="grid grid-cols-2 gap-px border border-[var(--agent-app-border)] bg-[var(--agent-app-border)] sm:grid-cols-3">
            {[
              { label: t('Gross sales'), value: fmtMoney(r.gross_sales, cur) },
              { label: t('Royalty due'), value: fmtMoney(r.royalty_due, cur) },
              { label: t('Minimum guarantee credit'), value: r.mg_credit ? `- ${fmtMoney(r.mg_credit, cur)}` : fmtMoney(0, cur) },
              { label: t('Late interest'), value: r.late_interest ? `+ ${fmtMoney(r.late_interest, cur)}` : fmtMoney(0, cur), tone: r.late_interest > 0 },
              { label: t('Payable'), value: fmtMoney(payable(r), cur), strong: true },
              { label: t('Paid'), value: fmtMoney(r.paid_amount, cur) },
            ].map((x) => (
              <div key={x.label} className="min-w-0 bg-[var(--agent-app-surface)] px-3 py-2">
                <div className="truncate text-[11px] text-[var(--agent-app-muted)]">{x.label}</div>
                <div className={cn('truncate text-[14px] tabular-nums', x.strong === true && 'font-semibold', x.tone === true && TONE_TEXT.bad)}>{x.value}</div>
              </div>
            ))}
          </div>
          {r.notes !== '' && <Prose className="border-l-2 border-[var(--agent-app-border)] pl-3 text-[var(--agent-app-text)]/85">{r.notes}</Prose>}
          {doc.record !== null && (
            <a href={fileUrl(doc.record, doc.record.file)} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 text-xs text-[var(--agent-app-accent)] hover:underline">
              <FileText size={13} aria-hidden /> {doc.record.title}
            </a>
          )}

          <section>
            <SubHead>{t('Lines')}</SubHead>
            {lines.loading ? (
              <Loading />
            ) : lines.records.length === 0 ? (
              <EmptyHint
                compact
                icon={Receipt}
                title={t('No lines yet')}
                message={t('Add the lines from the licensee\'s sales report, or upload the report below and let CraftBot read it into a proposal for the Inbox.')}
                action={
                  can.licensing && r.status !== 'paid' ? (
                    <Button size="sm" onClick={() => setDialog('lines')}>
                      {t('Add lines')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-x-auto border border-[var(--agent-app-border)]">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-[10.5px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                      <th className="px-2.5 py-2 text-left font-semibold">{t('Product')}</th>
                      <th className="px-2.5 py-2 text-left font-semibold">{t('Territory')}</th>
                      <th className="px-2.5 py-2 text-right font-semibold">{t('Manufactured')}</th>
                      <th className="px-2.5 py-2 text-right font-semibold">{t('Sold')}</th>
                      <th className="px-2.5 py-2 text-right font-semibold">{t('Retail price')}</th>
                      <th className="px-2.5 py-2 text-right font-semibold">{t('Rate')}</th>
                      <th className="px-2.5 py-2 text-right font-semibold">{t('Royalty')}</th>
                      <th className="px-2.5 py-2 text-left font-semibold">{t('Notes')}</th>
                      {lineDelete && (
                        <th className="px-1 py-2">
                          <span className="sr-only">{t('Actions')}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.records.map((l) => {
                      const p = expandOne<ProductRec>(l, 'product');
                      const lc = l.currency || cur;
                      return (
                        <tr key={l.id} className="border-b border-[var(--agent-app-border)]/60 align-top last:border-0">
                          <td className="px-2.5 py-2">
                            {p !== null ? (
                              <a className="block max-w-[14rem] truncate font-medium hover:underline" href={href('product', p.id, { tab: 'royalties' })}>
                                {p.name}
                              </a>
                            ) : (
                              <span className={cn('text-xs', TONE_TEXT.warn)}>{t('Not matched to a product')}</span>
                            )}
                            {l.description !== '' && (p === null || l.description !== p.name) && <div className="max-w-[14rem] truncate text-xs text-[var(--agent-app-muted)]">{l.description}</div>}
                          </td>
                          <td className="px-2.5 py-2 font-mono text-xs">{l.territory}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{fmtNumber(l.manufactured_qty)}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{fmtNumber(l.sold_qty)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(l.retail_price, lc) || money(l.wholesale_price, lc)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{rateText(l.rate, basis, lc)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums">{fmtMoney(l.royalty, lc)}</td>
                          <td className="min-w-[10rem] px-2.5 py-2 text-xs">
                            {l.notes !== '' ? <span className={cn('whitespace-pre-wrap break-words', TONE_TEXT.warn)}>{l.notes}</span> : ''}
                          </td>
                          {lineDelete && (
                            <td className="px-1 py-1.5 text-right">
                              <RowDelete collection="royalty_lines" id={l.id} onDeleted={() => void reload()} label={t('Delete this line')} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/10 font-semibold">
                      <td className="px-2.5 py-2" colSpan={2}>
                        {t('Total')}
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums">{fmtNumber(totals.made)}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums">{fmtNumber(totals.sold)}</td>
                      <td />
                      <td />
                      <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{fmtMoney(totals.royalty, cur)}</td>
                      <td />
                      {lineDelete && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {lines.records.length > 0 && <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">{t('Rates and royalties are priced by the server from the licence. Notes show where the licensee reported a different amount.')}</p>}
          </section>

          {mg.data !== null && mg.data.minimum_guarantee > 0 && (
            <section>
              <SubHead>{t('Minimum guarantee of this licence')}</SubHead>
              <MgFacts mg={mg.data} />
            </section>
          )}

          {agreementId !== '' && (
            <DocumentsPanel relation="agreement" relationId={agreementId} statementFor={agreementId} defaultType="statement" title={t('Sales reports and statements')} />
          )}
          {agreementId !== '' && <Notice>{t('Read the statement: CraftBot reads a sales report into a proposed statement in the Inbox. You review and accept it there; nothing changes on its own.')}</Notice>}
        </div>
      )}
      {r !== null && dialog === 'lines' && <AddLinesDialog report={r} current={lines.records} onClose={() => setDialog(null)} onDone={() => void reload()} />}
      {r !== null && dialog === 'payment' && <PaymentDialog report={r} onClose={() => setDialog(null)} onDone={() => void reload()} />}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* A product's lines across statements                                 */
/* ------------------------------------------------------------------ */

export function ProductRoyaltyLines({ productId }: { productId: string }): React.JSX.Element {
  const lines = useCollection<RoyaltyLineRec>('royalty_lines', { filter: `product = ${q(productId)}`, sort: '-created', expand: 'report,report.agreement' });
  const reportOf = (l: RoyaltyLineRec): RoyaltyReportRec | null => expandOne<RoyaltyReportRec>(l, 'report');
  const basisOf = (l: RoyaltyLineRec): string => {
    const rep = reportOf(l);
    return rep !== null ? (expandOne<AgreementRec>(rep, 'agreement')?.royalty_basis ?? '') : '';
  };
  const currencies = new Set(lines.records.map((l) => l.currency));
  const oneCurrency = currencies.size === 1 ? ([...currencies][0] ?? '') : '';
  const columns: Col<RoyaltyLineRec>[] = [
    {
      key: 'period',
      label: t('Period'),
      value: (l) => d10(reportOf(l)?.period_end),
      render: (l) => {
        const rep = reportOf(l);
        return rep !== null ? <span className="whitespace-nowrap">{periodText(rep)}</span> : '';
      },
    },
    { key: 'status', label: t('Statement'), value: (l) => reportOf(l)?.status ?? '', render: (l) => <EnumPill field="royalty_reports.status" value={reportOf(l)?.status} /> },
    { key: 'territory', label: t('Territory'), render: (l) => <span className="font-mono text-xs">{l.territory}</span> },
    { key: 'manufactured_qty', label: t('Manufactured'), align: 'right', value: (l) => l.manufactured_qty, render: (l) => fmtNumber(l.manufactured_qty) },
    { key: 'sold_qty', label: t('Sold'), align: 'right', value: (l) => l.sold_qty, render: (l) => fmtNumber(l.sold_qty) },
    { key: 'retail_price', label: t('Retail price'), align: 'right', value: (l) => l.retail_price, render: (l) => <span className="whitespace-nowrap">{money(l.retail_price, l.currency)}</span> },
    { key: 'rate', label: t('Rate'), align: 'right', value: (l) => l.rate, render: (l) => <span className="whitespace-nowrap">{rateText(l.rate, basisOf(l), l.currency)}</span> },
    { key: 'royalty', label: t('Royalty'), align: 'right', value: (l) => l.royalty, render: (l) => <span className="whitespace-nowrap font-medium">{fmtMoney(l.royalty, l.currency)}</span> },
    { key: 'notes', label: t('Notes'), render: (l) => <span className={cn('line-clamp-2 max-w-[16rem] text-xs', l.notes !== '' && TONE_TEXT.warn)}>{l.notes}</span> },
  ];
  const made = lines.records.reduce((s, l) => s + l.manufactured_qty, 0);
  const sold = lines.records.reduce((s, l) => s + l.sold_qty, 0);
  const royalty = lines.records.reduce((s, l) => s + l.royalty, 0);
  return (
    <Section title={t('Royalty lines')} meta={lines.records.length > 0 ? String(lines.records.length) : undefined} flush>
      {lines.loading ? (
        <Loading />
      ) : lines.error !== null && lines.records.length === 0 ? (
        <div className="p-4">
          <ErrorBox message={lines.error} onRetry={lines.refresh} />
        </div>
      ) : (
        <>
          <DataTable<RoyaltyLineRec>
            tableId="product-royalty-lines"
            exportName="product-royalty-lines"
            rows={lines.records}
            columns={columns}
            dense
            onRowClick={(l) => navigate('royalties', l.report)}
            empty={<EmptyHint compact icon={Receipt} title={t('No royalty lines for this product yet')} message={t('Lines appear here when a statement of its licence lists this product.')} />}
          />
          {lines.records.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--agent-app-border)] px-4 py-2 text-xs tabular-nums text-[var(--agent-app-muted)]">
              <span>{t('Manufactured {n}', { n: fmtNumber(made) })}</span>
              <span>{t('Sold {n}', { n: fmtNumber(sold) })}</span>
              {oneCurrency !== '' && <span>{t('Royalty {amount}', { amount: fmtMoney(royalty, oneCurrency) })}</span>}
            </p>
          )}
        </>
      )}
    </Section>
  );
}
