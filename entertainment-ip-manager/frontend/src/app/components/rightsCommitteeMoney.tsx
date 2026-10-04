/**
 * Committee money and consent: the distribution calculator (window
 * receipts, deductions, window fees, the committee waterfall, the pool and
 * each member's amount), saved statements with "Mark paid", recoupment
 * against investment, and consent requests with every member's answer
 * (a refusal needs a reason, Copyright Act Art. 65(3)).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ChevronDown, ChevronRight, Handshake, Mail, Plus, Trash2, Users, Wand2 } from 'lucide-react';
import { Button, Dialog, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { useConfirm } from './confirm.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { errText, op, opToast } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { addDays, addMonths, d10, fmtDate, fmtMoney, fmtPct, relLabel, today } from '../lib/format.ts';
import { bi, enumLabel, joinList, t, tf } from '../lib/i18n.ts';
import type { Tone } from '../lib/labels.ts';
import { useRoute } from '../lib/router.ts';
import type { CommitteeRec, ConsentRequestRec, DistributionRec, GrantRec, PartyRec } from '../lib/records.ts';
import type { Bi, ConsentAnswer, DistributionMember, DistributionReceipt } from '../lib/shapes.ts';
import { EmptyHint, EnumPill, ErrorBox, Field, Loading, Notice, Pill, Section, Segmented, StatTile, TONE_BAR } from './ui.tsx';
import { CellNum, CellText, ConsentOpenDialog, DateField, EmailDraftDialog, RowsEditor, num, useDimSummary } from './rightsShared.tsx';

/* ------------------------------------------------------------------ */
/* Distribution calculator                                             */
/* ------------------------------------------------------------------ */

interface DedRow {
  label: string;
  amount: number | null;
}
interface ReceiptRow {
  window: string;
  holder: string;
  gross: number | null;
  deductions: DedRow[];
  fee_pct: number | null;
  fee_base: 'gross' | 'net';
}

interface ComputeResult {
  receipts: DistributionReceipt[];
  gross_total: number;
  deductions_total: number;
  window_fees: number;
  steps: { key: string; label: string; label_ja: string; kind: string; amount: number }[];
  lead_fee: number;
  promo_fee: number;
  success_fee: number;
  pool: number;
  members: DistributionMember[];
  shares: { ok: boolean; total: number; message: Bi };
}

interface Recoupment {
  invested: number;
  distributed: number;
  recouped_pct: number;
  members: { member: string; name: string; invested: number; received: number; recouped_pct: number }[];
  currency: string;
}

function blankReceipt(): ReceiptRow {
  return { window: '', holder: '', gross: null, deductions: [], fee_pct: null, fee_base: 'net' };
}

function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function toPayload(rows: ReceiptRow[]): Record<string, unknown>[] {
  return rows
    .filter((r) => r.gross !== null || r.window.trim() !== '')
    .map((r) => ({
      window: r.window.trim(),
      holder: r.holder.trim(),
      gross: num(r.gross),
      deductions: r.deductions.filter((d) => d.label.trim() !== '' || d.amount !== null).map((d) => ({ label: d.label.trim(), amount: num(d.amount) })),
      fee_pct: num(r.fee_pct),
      fee_base: r.fee_base,
    }));
}

function fromSaved(d: DistributionRec): ReceiptRow[] {
  return (d.receipts ?? []).map((r) => ({
    window: r.window ?? '',
    holder: r.holder ?? '',
    gross: r.gross ?? null,
    deductions: (r.deductions ?? []).map((x) => ({ label: x.label ?? '', amount: x.amount ?? null })),
    fee_pct: r.fee_pct ?? null,
    fee_base: r.fee_base === 'gross' ? 'gross' : 'net',
  }));
}

function ReceiptEditor({ row, index, currency, onChange, onRemove }: { row: ReceiptRow; index: number; currency: string; onChange: (r: ReceiptRow) => void; onRemove: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Receipt {n}', { n: index + 1 })}</span>
        <button type="button" aria-label={t('Remove receipt')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-1 lg:col-span-2">
          <span className="text-[11px] text-[var(--agent-app-muted)]">{t('Window or use')}</span>
          <CellText value={row.window} onChange={(v) => onChange({ ...row, window: v })} placeholder={t('For example: Domestic merchandise')} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] text-[var(--agent-app-muted)]">{t('Window holder')}</span>
          <CellText value={row.holder} onChange={(v) => onChange({ ...row, holder: v })} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] text-[var(--agent-app-muted)]">{t('Gross ({currency})', { currency })}</span>
          <CellNum value={row.gross} onChange={(v) => onChange({ ...row, gross: v })} />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] text-[var(--agent-app-muted)]">{t('Fee %')}</span>
            <CellNum value={row.fee_pct} onChange={(v) => onChange({ ...row, fee_pct: v })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] text-[var(--agent-app-muted)]">{t('Fee base')}</span>
            <Select
              aria-label={t('Fee base')}
              value={row.fee_base}
              options={[
                { value: 'gross', label: enumLabel('grants.fee_base', 'gross') },
                { value: 'net', label: enumLabel('grants.fee_base', 'net') },
              ]}
              onChange={(e) => onChange({ ...row, fee_base: e.target.value === 'gross' ? 'gross' : 'net' })}
            />
          </div>
        </div>
      </div>
      <RowsEditor<DedRow>
        label={t('Deductions')}
        rows={row.deductions}
        onChange={(rows) => onChange({ ...row, deductions: rows })}
        blank={() => ({ label: '', amount: null })}
        addLabel={t('Add a deduction')}
        empty={t('No deductions. Add the original-work fee, the studio royalty and expenses taken before the window fee.')}
        columns={[
          { key: 'label', label: t('Label|row'), className: 'sm:min-w-[12rem]', render: (r, s) => <CellText value={r.label} onChange={(v) => s({ label: v })} placeholder={t('For example: Original-work fee')} /> },
          { key: 'amount', label: t('Amount'), render: (r, s) => <CellNum value={r.amount} onChange={(v) => s({ amount: v })} /> },
        ]}
      />
    </div>
  );
}

function Line({ label, amount, currency, minus = false, strong = false }: { label: string; amount: number; currency: string; minus?: boolean | undefined; strong?: boolean | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-1.5 text-[13px] last:border-0', strong && 'bg-[var(--agent-app-border)]/20 font-semibold')}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">
        {minus && amount !== 0 ? '- ' : ''}
        {fmtMoney(amount, currency)}
      </span>
    </div>
  );
}

function ResultView({ res, currency }: { res: ComputeResult; currency: string }): React.JSX.Element {
  const fromWindows = res.gross_total - res.deductions_total - res.window_fees;
  return (
    <div className="flex flex-col gap-4">
      <Notice tone={res.shares.ok ? 'good' : 'warn'}>{bi(res.shares.message)}</Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Waterfall')}</h3>
          <div className="border border-[var(--agent-app-border)]">
            <Line label={t('Window receipts (gross)')} amount={res.gross_total} currency={currency} />
            <Line label={t('Deductions')} amount={res.deductions_total} currency={currency} minus />
            <Line label={t('Window fees')} amount={res.window_fees} currency={currency} minus />
            <Line label={t('From the windows')} amount={fromWindows} currency={currency} strong />
            {res.steps.map((s, i) => (
              <Line key={`${s.key}-${i}`} label={tf(s, 'label') || s.label} amount={s.amount} currency={currency} minus />
            ))}
            <Line label={t('Pool for members')} amount={res.pool} currency={currency} strong />
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Paid to members')}</h3>
          <div className="border border-[var(--agent-app-border)]">
            {res.members.length === 0 ? (
              <p className="px-3 py-2 text-[13px] text-[var(--agent-app-muted)]">{t('No members yet. Add them on the Members tab.')}</p>
            ) : (
              res.members.map((m) => <Line key={m.member} label={`${m.name} (${fmtPct(m.share_pct)})`} amount={m.amount} currency={currency} />)
            )}
          </div>
        </div>
      </div>
      {res.receipts.length > 0 && (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('By window')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-2 py-1.5">{t('Window or use')}</th>
                  <th className="px-2 py-1.5">{t('Window holder')}</th>
                  <th className="px-2 py-1.5 text-right">{t('Gross')}</th>
                  <th className="px-2 py-1.5 text-right">{t('Deductions')}</th>
                  <th className="px-2 py-1.5 text-right">{t('Window fee')}</th>
                  <th className="px-2 py-1.5 text-right">{t('Net')}</th>
                </tr>
              </thead>
              <tbody>
                {res.receipts.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                    <td className="px-2 py-1.5">{r.window}</td>
                    <td className="px-2 py-1.5">{r.holder}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.gross, currency)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.deductions.reduce((s, d) => s + d.amount, 0), currency)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtMoney(r.window_fee, currency)}
                      {r.fee_pct > 0 ? <span className="ml-1 text-[11px] text-[var(--agent-app-muted)]">({fmtPct(r.fee_pct)})</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{fmtMoney(r.net, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DistributionRow({ d, canRights, onOpen, onPaid }: { d: DistributionRec; canRights: boolean; onOpen: () => void; onPaid: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const cur = d.currency;
  return (
    <div className="border-b border-[var(--agent-app-border)]/70 last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={14} className="shrink-0 text-[var(--agent-app-muted)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--agent-app-muted)]" />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t('{start} to {end}', { start: fmtDate(d.period_start) || '-', end: fmtDate(d.period_end) })}</span>
            <span className="block truncate text-xs text-[var(--agent-app-muted)]">
              {[d10(d.due_date) !== '' ? t('Due {date}', { date: fmtDate(d.due_date) }) : '', d10(d.issued_date) !== '' ? t('Issued {date}', { date: fmtDate(d.issued_date) }) : ''].filter((x) => x !== '').join(' · ')}
            </span>
          </span>
        </button>
        <span className="text-[13px] font-medium tabular-nums">{fmtMoney(d.pool, cur)}</span>
        <EnumPill field="distributions.status" value={d.status} />
        {canRights && d.status === 'draft' && (
          <Button size="sm" variant="outline" className="h-7" onClick={onOpen}>
            {t('Open in the calculator')}
          </Button>
        )}
        {canRights && d.status === 'issued' && (
          <Button size="sm" variant="outline" className="h-7" onClick={onPaid}>
            {t('Mark paid')}
          </Button>
        )}
        <DeleteButton collection="distributions" id={d.id} iconOnly label={t('Delete this distribution statement')} />
      </div>
      {open && (
        <div className="px-4 pb-3">
          <div className="border border-[var(--agent-app-border)]">
            <Line label={t('Window receipts (gross)')} amount={d.gross_total} currency={cur} />
            <Line label={t('Deductions')} amount={d.deductions_total} currency={cur} minus />
            <Line label={t('Window fees')} amount={d.window_fees} currency={cur} minus />
            {d.lead_fee > 0 && <Line label={t('Lead company fee')} amount={d.lead_fee} currency={cur} minus />}
            {d.promo_fee > 0 && <Line label={t('Promotion lead fee')} amount={d.promo_fee} currency={cur} minus />}
            {d.success_fee > 0 && <Line label={t('Success fee')} amount={d.success_fee} currency={cur} minus />}
            <Line label={t('Pool for members')} amount={d.pool} currency={cur} strong />
            {(d.members ?? []).map((m) => (
              <Line key={m.member} label={`${m.name} (${fmtPct(m.share_pct)})`} amount={m.amount} currency={cur} />
            ))}
          </div>
          {d.notes !== '' && <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{d.notes}</p>}
        </div>
      )}
    </div>
  );
}

export function MoneyTab({ committee }: { committee: CommitteeRec }): React.JSX.Element {
  const { can } = useApp();
  const cur = committee.currency || 'JPY';
  const distributions = useCollection<DistributionRec>('distributions', { filter: `committee = "${committee.id}"`, sort: '-period_end,-created' });
  const windows = useCollection<GrantRec>('grants', {
    filter: `kind = "window" && agreement.committee = "${committee.id}" && agreement.agreement_type = "committee"`,
    sort: 'created',
    expand: 'holders',
  });
  const recoup = useLiveAsync(() => op<Recoupment>('committees/recoupment', { committee_id: committee.id }), [committee.id], ['distributions', 'committee_members']);
  const summary = useDimSummary();
  const thisMonth = firstOfMonth(today());
  const [periodStart, setPeriodStart] = useState(addMonths(thisMonth, -3));
  const [periodEnd, setPeriodEnd] = useState(addDays(thisMonth, -1));
  const [receipts, setReceipts] = useState<ReceiptRow[]>([blankReceipt()]);
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState('');
  const [res, setRes] = useState<ComputeResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'compute' | 'draft' | 'issued'>('');
  const [confirmEl, confirm] = useConfirm();
  const calcRef = useRef<HTMLDivElement | null>(null);

  const fromWindows = (): void => {
    const rows = windows.records.map((g): ReceiptRow => {
      const holders = ((g.expand ?? {}) as Record<string, unknown>)['holders'];
      const names = Array.isArray(holders) ? (holders as PartyRec[]).map((p) => p.name) : [];
      const lines = summary(g.dims, ['category', 'media', 'territory']);
      return {
        window: lines.length > 0 ? lines.map((l) => l.text).join(' / ') : t('Every use'),
        holder: joinList(names),
        gross: null,
        deductions: [],
        fee_pct: g.fee_pct > 0 ? g.fee_pct : null,
        fee_base: g.fee_base === 'gross' ? 'gross' : 'net',
      };
    });
    if (rows.length === 0) {
      toast.error(t('No windows recorded yet. Add them on the Windows tab.'));
      return;
    }
    setReceipts((r) => [...r.filter((x) => x.gross !== null || x.window.trim() !== ''), ...rows]);
    setRes(null);
  };

  const compute = async (): Promise<void> => {
    setBusy('compute');
    setError('');
    try {
      setRes(await op<ComputeResult>('committees/compute', { committee_id: committee.id, receipts: toPayload(receipts) }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  const save = async (status: 'draft' | 'issued'): Promise<void> => {
    if (d10(periodEnd) === '') {
      toast.error(t('Give the period end date.'));
      return;
    }
    if (status === 'issued' && !(await confirm(t('Issue this statement? Members who use the portal see it, and the amounts can no longer change once it is paid.'), t('Issue the statement')))) return;
    setBusy(status);
    const r = await opToast<{ id: string; status: string; calc: ComputeResult; shares: { ok: boolean } }>(
      'committees/save-distribution',
      { committee_id: committee.id, id: editingId, receipts: toPayload(receipts), period_start: periodStart, period_end: periodEnd, currency: cur, status, notes: notes.trim() },
      status === 'issued' ? t('Statement issued') : t('Saved as a draft'),
    );
    setBusy('');
    if (r === null) return;
    setRes(r.calc);
    if (status === 'issued') {
      setEditingId('');
      setReceipts([blankReceipt()]);
      setNotes('');
    } else setEditingId(r.id);
  };

  const openDraft = (d: DistributionRec): void => {
    setEditingId(d.id);
    setPeriodStart(d10(d.period_start));
    setPeriodEnd(d10(d.period_end));
    setReceipts(fromSaved(d).length > 0 ? fromSaved(d) : [blankReceipt()]);
    setNotes(d.notes);
    setRes(null);
    calcRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const markPaid = async (d: DistributionRec): Promise<void> => {
    if (!(await confirm(t('Mark the statement for {period} as paid?', { period: fmtDate(d.period_end) }), t('Mark paid')))) return;
    await opToast('committees/mark-paid', { distribution_id: d.id }, t('Marked as paid'));
  };

  const rc = recoup.data;
  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      {rc !== null && (rc.invested > 0 || rc.distributed > 0) && (
        <Section title={t('Recoupment')} meta={t('{pct} recouped', { pct: fmtPct(rc.recouped_pct) })}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label={t('Invested')} value={fmtMoney(rc.invested, rc.currency || cur)} />
            <StatTile label={t('Distributed so far')} value={fmtMoney(rc.distributed, rc.currency || cur)} />
            <StatTile label={t('Recouped|pct')} value={fmtPct(rc.recouped_pct)} tone={rc.recouped_pct >= 100 ? 'good' : 'warn'} />
          </div>
          {rc.members.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {rc.members.map((m) => {
                const pct = Math.max(0, Math.min(100, m.recouped_pct));
                const tone: Tone = m.recouped_pct >= 100 ? 'good' : 'warn';
                return (
                  <div key={m.member} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate font-medium">{m.name}</span>
                      <span className="tabular-nums text-[var(--agent-app-muted)]">
                        {fmtMoney(m.received, rc.currency || cur)} / {fmtMoney(m.invested, rc.currency || cur)} ({fmtPct(m.recouped_pct)})
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--agent-app-border)]/50">
                      <div className={cn('h-full', TONE_BAR[tone])} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      <div ref={calcRef} className="scroll-mt-4">
        <Section
          title={editingId !== '' ? t('Distribution (editing a draft)') : t('Distribution calculator')}
          actions={
            <Button size="sm" variant="outline" onClick={fromWindows}>
              <Wand2 size={13} aria-hidden /> {t('Rows from the windows')}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <DateField label={t('Period from')} value={periodStart} onChange={setPeriodStart} />
              <DateField label={t('Period to')} value={periodEnd} onChange={setPeriodEnd} />
              <Field label={t('Currency')}>
                <div className="flex h-9 items-center text-sm">{cur}</div>
              </Field>
            </div>
            {receipts.map((r, i) => (
              <ReceiptEditor
                key={i}
                row={r}
                index={i}
                currency={cur}
                onChange={(x) => {
                  setReceipts((rows) => rows.map((y, j) => (j === i ? x : y)));
                  setRes(null);
                }}
                onRemove={() => {
                  setReceipts((rows) => rows.filter((_, j) => j !== i));
                  setRes(null);
                }}
              />
            ))}
            <div>
              <Button size="sm" variant="outline" onClick={() => setReceipts((r) => [...r, blankReceipt()])}>
                <Plus size={13} aria-hidden /> {t('Add a receipt')}
              </Button>
            </div>
            <Textarea label={t('Notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)] pt-4">
              <Button onClick={() => void compute()} loading={busy === 'compute'}>
                <Calculator size={14} aria-hidden /> {t('Compute')}
              </Button>
              {can.rights && (
                <>
                  <Button variant="outline" onClick={() => void save('draft')} loading={busy === 'draft'}>
                    {t('Save as draft')}
                  </Button>
                  <Button variant="outline" onClick={() => void save('issued')} loading={busy === 'issued'}>
                    {t('Issue')}
                  </Button>
                </>
              )}
              {editingId !== '' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingId('');
                    setReceipts([blankReceipt()]);
                    setNotes('');
                    setRes(null);
                  }}
                >
                  {t('Start a new one')}
                </Button>
              )}
            </div>
            {error !== '' && <ErrorBox message={error} />}
            {res !== null && <ResultView res={res} currency={cur} />}
          </div>
        </Section>
      </div>

      <Section title={t('Statements|distribution')} meta={distributions.records.length ? String(distributions.records.length) : undefined} flush>
        {distributions.loading ? (
          <Loading />
        ) : distributions.records.length === 0 ? (
          <EmptyHint compact icon={Handshake} title={t('No distribution statements yet')} message={t('Compute a period above, then save it as a draft or issue it. Members who use the portal see issued statements there.')} />
        ) : (
          distributions.records.map((d) => <DistributionRow key={d.id} d={d} canRights={can.rights} onOpen={() => openDraft(d)} onPaid={() => void markPaid(d)} />)
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Consent requests                                                    */
/* ------------------------------------------------------------------ */

const ANSWER_TONE: Record<string, Tone> = { pending: 'info', approve: 'good', refuse: 'bad', no_answer: 'neutral' };

function answerLabel(a: string): string {
  switch (a) {
    case 'approve':
      return t('Approves');
    case 'refuse':
      return t('Refuses');
    case 'no_answer':
      return t('No answer');
    default:
      return t('Waiting|consent');
  }
}

function AnswerDialog({ request, answer, onClose }: { request: ConsentRequestRec; answer: ConsentAnswer; onClose: () => void }): React.JSX.Element {
  const [value, setValue] = useState<'approve' | 'refuse' | 'no_answer'>(answer.answer === 'refuse' ? 'refuse' : answer.answer === 'no_answer' ? 'no_answer' : 'approve');
  const [reason, setReason] = useState(answer.reason ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (value === 'refuse' && reason.trim() === '') {
      toast.error(t('A refusal needs a reason (Copyright Act Art. 65(3)).'));
      return;
    }
    setBusy(true);
    const r = await opToast('consent/answer', { request_id: request.id, member_id: answer.member, answer: value, reason: reason.trim() }, t('Answer recorded'));
    setBusy(false);
    if (r !== null) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Record the answer of {name}', { name: answer.name })}
      description={request.subject}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented<'approve' | 'refuse' | 'no_answer'>
          value={value}
          onChange={setValue}
          ariaLabel={t('Answer')}
          options={[
            { value: 'approve', label: t('Approves'), tone: 'good' },
            { value: 'refuse', label: t('Refuses'), tone: 'bad' },
            { value: 'no_answer', label: t('No answer') },
          ]}
        />
        <Textarea
          label={value === 'refuse' ? t('Reason for refusing (required)') : t('Comment (optional)')}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {value === 'refuse' && <Notice tone="warn">{t('A member may not refuse without good reason (Copyright Act Art. 65(3)). Record the reason they gave.')}</Notice>}
      </div>
    </Dialog>
  );
}

function CloseDialog({ request, onClose }: { request: ConsentRequestRec; onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState('approved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (note.trim() === '') {
      toast.error(t('Say why you are closing it.'));
      return;
    }
    setBusy(true);
    const r = await opToast('consent/close', { request_id: request.id, status, note: note.trim() }, t('Consent request closed'));
    setBusy(false);
    if (r !== null) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Close the request')}
      description={request.subject}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Close the request')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label={t('Outcome|consent')}
          value={status}
          options={['approved', 'refused', 'withdrawn', 'expired'].map((v) => ({ value: v, label: enumLabel('consent_requests.status', v) }))}
          onChange={(e) => setStatus(e.target.value)}
        />
        <Textarea label={t('Note')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('For example: agreed at the committee meeting of 12 May')} />
      </div>
    </Dialog>
  );
}

function useLines(use: unknown): string[] {
  const { dimLabel } = useApp();
  const u = use !== null && typeof use === 'object' && !Array.isArray(use) ? (use as Record<string, unknown>) : {};
  const out: string[] = [];
  for (const [k, v] of Object.entries(u)) {
    if (!Array.isArray(v) || k === 'assets') continue;
    out.push(joinList((v as unknown[]).map((c) => dimLabel(k, String(c)))));
  }
  const s = typeof u['start'] === 'string' ? u['start'] : '';
  const e = typeof u['end'] === 'string' ? u['end'] : '';
  if (s !== '' && e !== '') out.push(t('{start} to {end}', { start: fmtDate(s), end: fmtDate(e) }));
  return out;
}

function ConsentCard({ r, highlight, canRights }: { r: ConsentRequestRec; highlight: boolean; canRights: boolean }): React.JSX.Element {
  const { userName } = useApp();
  const [answering, setAnswering] = useState<ConsentAnswer | null>(null);
  const [closing, setClosing] = useState(false);
  const [email, setEmail] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const lines = useLines(r.use);
  const answers = r.answers ?? [];
  const yes = answers.filter((a) => a.answer === 'approve').length;
  const open = r.status === 'open';
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [highlight]);
  return (
    <div ref={ref} className={cn('scroll-mt-4 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]', highlight && 'ring-2 ring-[var(--agent-app-accent)]')}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--agent-app-border)] px-4 py-2.5">
        <div className="min-w-0 flex-1 basis-64">
          <div className="break-words text-sm font-medium">{r.subject}</div>
          <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">
            {[
              d10(r.requested_date) !== '' ? t('Asked {date}', { date: fmtDate(r.requested_date) }) : '',
              r.requested_by !== '' ? t('by {name}', { name: userName(r.requested_by) }) : '',
              d10(r.due_date) !== '' ? t('Answer by {date} ({rel})', { date: fmtDate(r.due_date), rel: relLabel(r.due_date) }) : '',
            ]
              .filter((x) => x !== '')
              .join(' · ')}
          </div>
          {lines.length > 0 && <div className="mt-1 break-words text-xs text-[var(--agent-app-muted)]">{lines.join(' / ')}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('{yes} of {n} approve', { yes, n: answers.length })}</span>
          <EnumPill field="consent_requests.status" value={r.status} />
          <DeleteButton collection="consent_requests" id={r.id} iconOnly label={t('Delete this consent request')} />
        </div>
      </div>
      <div>
        {answers.map((a) => (
          <div key={a.member} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/60 px-4 py-2 last:border-0">
            <span className="min-w-0 flex-1 basis-40 truncate text-[13px] font-medium">{a.name}</span>
            <Pill tone={ANSWER_TONE[a.answer] ?? 'neutral'}>{answerLabel(a.answer)}</Pill>
            {(a.date ?? '') !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(a.date)}</span>}
            {(a.reason ?? '') !== '' && <span className="basis-full break-words text-xs text-[var(--agent-app-text)]/80">{a.reason}</span>}
            {open && canRights && (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setAnswering(a)}>
                {t('Record answer')}
              </Button>
            )}
          </div>
        ))}
      </div>
      {(r.outcome_note !== '' || open) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)] px-4 py-2">
          {r.outcome_note !== '' && <span className="min-w-0 flex-1 break-words text-xs text-[var(--agent-app-muted)]">{r.outcome_note}</span>}
          {open && canRights && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEmail(true)}>
                <Mail size={13} aria-hidden /> {t('Reminder email draft')}
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setClosing(true)}>
                {t('Close the request')}
              </Button>
            </div>
          )}
        </div>
      )}
      {answering !== null && <AnswerDialog request={r} answer={answering} onClose={() => setAnswering(null)} />}
      {closing && <CloseDialog request={r} onClose={() => setClosing(false)} />}
      {email && (
        <EmailDraftDialog
          subjectType="consent_request"
          subjectId={r.id}
          suggestions={[t('Remind the members who have not answered yet'), t('Tell every member the outcome of the request')]}
          onClose={() => setEmail(false)}
        />
      )}
    </div>
  );
}

export function ConsentTab({ committee }: { committee: CommitteeRec }): React.JSX.Element {
  const { can } = useApp();
  const route = useRoute();
  const focus = route.params.get('consent') ?? '';
  const requests = useCollection<ConsentRequestRec>('consent_requests', { filter: `committee = "${committee.id}"`, sort: '-created' });
  const [opening, setOpening] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const shown = useMemo(() => (filter === 'open' ? requests.records.filter((r) => r.status === 'open' || r.id === focus) : requests.records), [requests.records, filter, focus]);
  const openCount = requests.records.filter((r) => r.status === 'open').length;
  return (
    <div className="flex flex-col gap-4">
      <Notice icon={Users}>
        {t('Uses no window covers need the members to agree, as the committee agreement sets (unanimous unless it says majority or lead decides). Members who use the portal answer there; record answers you receive by email or at meetings here.')}
      </Notice>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<'open' | 'all'>
          value={filter}
          onChange={setFilter}
          ariaLabel={t('Show|filter')}
          options={[
            { value: 'open', label: `${t('Open|consent filter')} ${openCount}` },
            { value: 'all', label: t('All') },
          ]}
        />
        {can.rights && (
          <Button size="sm" onClick={() => setOpening(true)}>
            <Plus size={13} aria-hidden /> {t('Open a request')}
          </Button>
        )}
      </div>
      {requests.loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Section title={t('Consent requests')}>
          <EmptyHint
            compact
            icon={Users}
            title={filter === 'open' ? t('No open requests') : t('No consent requests yet')}
            message={t('Open one when a use has no window, for example a pachinko licence or a collaboration outside every window. Can we? offers it too.')}
            action={can.rights ? <Button size="sm" onClick={() => setOpening(true)}>{t('Open a request')}</Button> : undefined}
          />
        </Section>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((r) => (
            <ConsentCard key={r.id} r={r} highlight={r.id === focus} canRights={can.rights} />
          ))}
        </div>
      )}
      {opening && <ConsentOpenDialog committeeId={committee.id} onClose={() => setOpening(false)} />}
    </div>
  );
}
