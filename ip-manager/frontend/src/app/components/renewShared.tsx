/**
 * Renewals building blocks: the enriched renewal type, cost and date
 * helpers, and the dialogs behind every renewal decision (let lapse, renew
 * with fewer classes, instruct the provider, record the payment).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Copy, Download, FileCheck2, Mail, Paperclip, Send } from 'lucide-react';
import { Button, Dialog, Input, Textarea, cn, getPbClient, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { fileUrl, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { downloadText } from '../lib/csv.ts';
import { d10, daysUntil, fmtDate, fmtMoney, plural, relLabel, today } from '../lib/format.ts';
import { IP_TYPE_LABEL, RENEWAL_DECISION_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { DeadlineRec, GoodsServicesRec, MatterRec, RenewalRec } from '../lib/types.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { Checkbox, EmptyHint, Field, JurChip, Notice, Pill, Ref, TONE_TEXT } from './ui.tsx';

export type RenewalX = RenewalRec & { expand?: { matter?: MatterRec; deadline?: DeadlineRec } };

export type Decision = RenewalRec['decision'];

export const DECISION_TONE: Record<Decision, Tone> = {
  pending: 'info',
  renew: 'good',
  renew_partial: 'good',
  lapse: 'bad',
  defer: 'neutral',
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function feeTotal(r: RenewalRec): number {
  return (r.official_fee || 0) + (r.other_fee || 0);
}

/** Tone of a due date: red when passed, amber within 30 days, blue within 90. */
export function dueTone(due: string): Tone {
  const d = d10(due);
  if (d === '') return 'neutral';
  const n = daysUntil(d);
  if (n < 0) return 'bad';
  if (n <= 30) return 'warn';
  if (n <= 90) return 'info';
  return 'neutral';
}

/** Due date passed but the grace period has not ended yet. */
export function inGrace(r: RenewalRec): boolean {
  const due = d10(r.due_date);
  const grace = d10(r.grace_end);
  return due !== '' && grace !== '' && daysUntil(due) < 0 && daysUntil(grace) >= 0;
}

export function matterOf(r: RenewalX): MatterRec | undefined {
  return r.expand?.matter;
}

export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Copying is blocked here. Select the text and copy it by hand.');
  }
}

/** Ref + office chip linking to the matter. */
export function RenewalSubject({ r, showType = false }: { r: RenewalX; showType?: boolean | undefined }): React.JSX.Element {
  const m = matterOf(r);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {m !== undefined ? (
        <a href={href('matter', m.id)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          <Ref>{m.ref || 'No ref'}</Ref>
        </a>
      ) : (
        <Ref>Unknown matter</Ref>
      )}
      {m !== undefined && <JurChip code={m.jurisdiction} />}
      {showType && m !== undefined && <span className="text-xs text-[var(--agent-app-muted)]">{IP_TYPE_LABEL[m.ip_type]}</span>}
    </span>
  );
}

/** Estimated cost: official fee in its currency, home amount muted, or a link to add the fee. */
export function CostCell({ r, align = 'right' }: { r: RenewalRec; align?: 'left' | 'right' | undefined }): React.JSX.Element {
  if (!r.fee_known) {
    return (
      <a
        href={href('settings', undefined, { tab: 'fees' })}
        title={r.fee_note || 'No official fee is on file for this renewal.'}
        className={cn('text-xs font-medium hover:underline', TONE_TEXT.warn)}
        onClick={(e) => e.stopPropagation()}
      >
        No fee on file
      </a>
    );
  }
  const showHome = r.home_currency !== '' && r.home_currency.toUpperCase() !== r.currency.toUpperCase() && r.home_amount > 0;
  return (
    <div title={r.fee_note || undefined} className={cn('tabular-nums', align === 'right' ? 'text-right' : 'text-left')}>
      <div className="text-[13px]">{fmtMoney(feeTotal(r), r.currency)}</div>
      {showHome && <div className="text-xs text-[var(--agent-app-muted)]">{fmtMoney(r.home_amount, r.home_currency)}</div>}
    </div>
  );
}

export function DueCell({ due, grace }: { due: string; grace?: string | undefined }): React.JSX.Element {
  const tone = dueTone(due);
  return (
    <div className="tabular-nums">
      <div className="text-[13px]">{fmtDate(due) || '-'}</div>
      {d10(due) !== '' && <div className={cn('text-xs', TONE_TEXT[tone])}>{relLabel(due)}</div>}
      {grace !== undefined && d10(grace) !== '' && <div className="text-xs text-[var(--agent-app-muted)]">Grace to {fmtDate(grace)}</div>}
    </div>
  );
}

function lapseWhen(r: RenewalRec): string {
  const grace = d10(r.grace_end);
  if (grace !== '') return `Lapses when the grace period ends on ${fmtDate(grace)}`;
  const due = d10(r.due_date);
  return due !== '' ? `Lapses on ${fmtDate(due)} (no grace period on file)` : 'Lapses when the fee falls due';
}

/* ------------------------------------------------------------------ */
/* Let lapse                                                           */
/* ------------------------------------------------------------------ */

export function LapseDialog({ items, onClose, onDone }: { items: RenewalX[]; onClose: () => void; onDone?: (() => void) | undefined }): React.JSX.Element {
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (rationale.trim() === '') {
      toast.error('Give a reason for letting these rights lapse.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ updated: number; lapsing: string[] }>('renewals/decide', {
        ids: items.map((x) => x.id),
        decision: 'lapse',
        rationale: rationale.trim(),
      });
      toast.success(`${plural(r.updated, 'renewal')} set to lapse${r.lapsing.length ? `: ${r.lapsing.join(', ')}` : ''}`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={items.length === 1 ? 'Let this right lapse' : `Let ${items.length} rights lapse`}
      description="The renewal deadlines close as not needed and nobody is reminded again. The rights end unless someone pays the fee."
      className="w-[min(94vw,38rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} disabled={rationale.trim() === ''}>
            Let {items.length === 1 ? 'it' : `${items.length}`} lapse
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="max-h-60 overflow-y-auto border border-[var(--agent-app-border)]">
          {items.map((r) => {
            const m = matterOf(r);
            return (
              <div key={r.id} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <RenewalSubject r={r} />
                  <span className="truncate text-[13px] font-medium">{m?.title ?? ''}</span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">
                  {r.cycle_label}, due {fmtDate(r.due_date)}.{' '}
                  <span className={TONE_TEXT.bad}>{lapseWhen(r)}.</span>
                </div>
              </div>
            );
          })}
        </div>
        <Field label="Reason" required help="Kept in the history, for example: product discontinued, covered by a later filing, market no longer relevant.">
          <Textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why these rights are no longer worth the fee" />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Renew with fewer classes (trademarks)                               */
/* ------------------------------------------------------------------ */

export function PartialDialog({ item, onClose, onDone }: { item: RenewalX; onClose: () => void; onDone?: (() => void) | undefined }): React.JSX.Element {
  const gs = useCollection<GoodsServicesRec>('goods_services', { filter: `matter = ${q(item.matter)}`, sort: 'nice_class' });
  const classes = useMemo(() => {
    const set = new Set<number>();
    for (const g of gs.records) {
      if (g.class_status === 'deleted' || g.class_status === 'cancelled') continue;
      if (g.nice_class > 0) set.add(g.nice_class);
    }
    return [...set].sort((a, b) => a - b);
  }, [gs.records]);
  const specOf = (c: number): string =>
    gs.records
      .filter((g) => g.nice_class === c)
      .map((g) => g.spec)
      .filter((s) => s !== '')
      .join('; ');
  const [keep, setKeep] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (keep !== null || gs.loading) return;
    const prior = (item.classes_keep ?? []).filter((c) => classes.includes(c));
    setKeep(new Set(prior.length > 0 ? prior : classes));
  }, [gs.loading, classes, item.classes_keep, keep]);
  const [busy, setBusy] = useState(false);
  const kept = keep ?? new Set<number>();
  const dropped = classes.filter((c) => !kept.has(c));
  const m = matterOf(item);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('renewals/decide', { ids: [item.id], decision: 'renew_partial', classes_keep: [...kept].sort((a, b) => a - b) });
      toast.success(`Renewing ${m?.ref ?? 'the mark'} in ${plural(kept.size, 'class', 'classes')}, dropping ${dropped.join(', ')}`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Renew, drop classes"
      description={`Tick the classes to KEEP for ${m?.ref ?? 'this mark'} (${item.cycle_label}, due ${fmtDate(item.due_date)}). Unticked classes are not renewed and fall away.`}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={kept.size === 0 || dropped.length === 0}>
            Renew {plural(kept.size, 'class', 'classes')}
          </Button>
        </>
      }
    >
      {gs.loading ? (
        <p className="text-sm text-[var(--agent-app-muted)]">Loading the classes on file...</p>
      ) : classes.length === 0 ? (
        <EmptyHint
          compact
          title="No classes on file for this mark"
          message="Add the goods and services to the trademark record first, then choose which classes to keep."
          action={
            m !== undefined ? (
              <a className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline" href={href('matter', m.id)}>
                Open {m.ref}
              </a>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="max-h-72 overflow-y-auto border border-[var(--agent-app-border)]">
            {classes.map((c) => (
              <div key={c} className="flex items-start gap-3 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                <div className="pt-0.5">
                  <Checkbox
                    checked={kept.has(c)}
                    ariaLabel={`Keep class ${c}`}
                    onChange={(v) =>
                      setKeep((s) => {
                        const n = new Set(s ?? []);
                        if (v) n.add(c);
                        else n.delete(c);
                        return n;
                      })
                    }
                  />
                </div>
                <div className="min-w-0">
                  <div className={cn('text-[13px] font-medium', !kept.has(c) && 'text-[var(--agent-app-muted)] line-through')}>Class {c}</div>
                  {specOf(c) !== '' && <div className="line-clamp-2 text-xs text-[var(--agent-app-muted)]">{specOf(c)}</div>}
                </div>
              </div>
            ))}
          </div>
          {dropped.length === 0 ? (
            <Notice tone="info">Every class is ticked. Untick the classes to drop, or choose Renew instead.</Notice>
          ) : kept.size === 0 ? (
            <Notice tone="bad" icon={AlertTriangle}>
              Keep at least one class. To give up the whole mark, choose Let lapse.
            </Notice>
          ) : (
            <Notice tone="warn">
              Dropping {plural(dropped.length, 'class', 'classes')}: {dropped.join(', ')}. Fees are usually charged per class, so the renewal costs less.
            </Notice>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Instruct the provider                                               */
/* ------------------------------------------------------------------ */

interface InstructResult {
  instructed: number;
  csv: string;
  letter: string;
}

export function InstructDialog({ items, onClose, onDone }: { items: RenewalX[]; onClose: () => void; onDone?: (() => void) | undefined }): React.JSX.Element {
  const { homeCurrency } = useApp();
  const ready = items.filter((r) => r.decision === 'renew' || r.decision === 'renew_partial');
  const [provider, setProvider] = useState('');
  const [po, setPo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstructResult | null>(null);
  const [email, setEmail] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  const touched = useRef(false);

  // Suggest the provider used last time.
  useEffect(() => {
    let cancelled = false;
    getPbClient()
      .call((p) => p.collection('renewals').getList<RenewalRec>(1, 1, { filter: 'provider != ""', sort: '-instructed_at' }), { silent: true })
      .then((res) => {
        const last = res.items[0]?.provider ?? '';
        if (!cancelled && !touched.current && last !== '') setProvider(last);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const total = ready.reduce((a, r) => a + (r.fee_known ? r.home_amount : 0), 0);
  const unknown = ready.filter((r) => !r.fee_known).length;

  const submit = async (): Promise<void> => {
    if (provider.trim() === '') {
      toast.error('Name the renewal provider or agent.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<InstructResult>('renewals/instruct', { ids: ready.map((x) => x.id), provider: provider.trim(), po_number: po.trim() });
      setResult(r);
      toast.success(`${plural(r.instructed, 'renewal')} instructed with ${provider.trim()}`);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const draftEmail = async (): Promise<void> => {
    if (!email.includes('@')) {
      toast.error("Enter the provider's email address.");
      return;
    }
    setFiring(true);
    const id = await handToCraftBot('renewal_instructions_requested', {
      renewal_ids: ready.map((x) => x.id).join(','),
      provider: provider.trim(),
      provider_email: email.trim(),
      po_number: po.trim(),
    });
    setFiring(false);
    if (id !== null) setRequestId(id);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={result === null ? `Instruct ${plural(ready.length, 'renewal')}` : 'Instructions ready'}
      description={
        result === null
          ? 'Marks the renewals as instructed and prepares a letter and a spreadsheet for your provider.'
          : 'Send the letter and the spreadsheet to your provider. Record each payment when they confirm it.'
      }
      className="w-[min(94vw,42rem)]"
      footer={
        result === null ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={ready.length === 0 || provider.trim() === ''}>
              <Send size={14} aria-hidden /> Instruct {ready.length}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )
      }
    >
      {result === null ? (
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          {ready.length < items.length && (
            <Notice tone="warn">
              {plural(items.length - ready.length, 'selected renewal')} {items.length - ready.length === 1 ? 'is' : 'are'} not decided as Renew and will be left out.
            </Notice>
          )}
          {ready.length === 0 ? (
            <Notice tone="info">Decide Renew on the renewals first, then instruct them.</Notice>
          ) : (
            <div className="border border-[var(--agent-app-border)]">
              {ready.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                  <div className="min-w-0">
                    <RenewalSubject r={r} />
                    <div className="mt-0.5 truncate text-xs text-[var(--agent-app-muted)]">
                      {r.cycle_label}, due {fmtDate(r.due_date)}
                      {r.decision === 'renew_partial' && (r.classes_keep ?? []).length > 0 ? `, keep classes ${(r.classes_keep ?? []).join(', ')}` : ''}
                    </div>
                  </div>
                  <CostCell r={r} />
                </div>
              ))}
              <div className="flex justify-between gap-3 bg-[var(--agent-app-border)]/20 px-3 py-2 text-[13px]">
                <span className="font-medium">Estimated total</span>
                <span className="tabular-nums">
                  {fmtMoney(total, homeCurrency)}
                  {unknown > 0 && <span className="text-[var(--agent-app-muted)]">, plus {plural(unknown, 'renewal')} without a fee on file</span>}
                </span>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Provider"
              value={provider}
              placeholder="Renewal service or local agent"
              onChange={(e) => {
                touched.current = true;
                setProvider(e.target.value);
              }}
            />
            <Input label="Purchase order number (optional)" value={po} onChange={(e) => setPo(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          <Notice tone="good" icon={FileCheck2}>
            {plural(result.instructed, 'renewal')} marked as instructed with {provider.trim()}
            {po.trim() !== '' ? ` (PO ${po.trim()})` : ''}.
          </Notice>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">Letter</span>
              <Button size="sm" variant="outline" onClick={() => void copyText(result.letter, 'Letter')}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
            </div>
            <Textarea readOnly rows={9} value={result.letter} aria-label="Instruction letter" className="font-mono text-[12px]" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--agent-app-border)] px-3 py-2">
            <span className="text-[13px]">
              <span className="font-medium">Spreadsheet</span>
              <span className="text-[var(--agent-app-muted)]"> for the provider's system (CSV)</span>
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => downloadText(`renewal-instructions-${today()}.csv`, result.csv)}>
                <Download size={13} aria-hidden /> Download
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyText(result.csv, 'Spreadsheet')}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
            </span>
          </div>
          <div className="flex flex-col gap-2 border-t border-[var(--agent-app-border)] pt-4">
            <span className="text-[13px] font-medium">Draft the email with CraftBot</span>
            <p className="text-xs text-[var(--agent-app-muted)]">
              CraftBot writes the email and saves it as a draft in your connected mailbox. It never sends anything.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input type="email" label="Provider email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="renewals@provider.example" />
              <Button className="shrink-0" onClick={() => void draftEmail()} loading={firing} disabled={requestId !== null}>
                <Mail size={14} aria-hidden /> Draft the email
              </Button>
            </div>
            <AgentStatus requestId={requestId} workingText="CraftBot is writing the email..." doneText="CraftBot finished the draft." />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Record payment and receipts                                         */
/* ------------------------------------------------------------------ */

export function PaymentDialog({ item, onClose, onDone }: { item: RenewalX; onClose: () => void; onDone?: (() => void) | undefined }): React.JSX.Element {
  const total = feeTotal(item);
  const currency = item.currency || item.home_currency;
  const [paid, setPaid] = useState(today());
  const [amount, setAmount] = useState(total > 0 ? String(total) : '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const m = matterOf(item);

  const submit = async (): Promise<void> => {
    if (d10(paid) === '') {
      toast.error('Enter the payment date.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ ok: boolean; next: { id: string; title: string; due_date: string } | null }>('renewals/record-payment', {
        id: item.id,
        paid_date: paid,
        ...(amount.trim() !== '' ? { amount: Number(amount) } : {}),
      });
      if (file !== null) {
        const fd = new FormData();
        fd.append('receipt', file);
        try {
          await updateRecord('renewals', item.id, fd);
        } catch {
          /* toast shown by the client */
        }
      }
      toast.success(
        r.next
          ? `Payment recorded for ${m?.ref ?? item.cycle_label}. Next: ${r.next.title}, due ${fmtDate(r.next.due_date)}`
          : `Payment recorded for ${m?.ref ?? item.cycle_label}`,
      );
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record payment"
      description={`${m?.ref ?? ''} ${item.cycle_label}, due ${fmtDate(item.due_date)}. The renewal deadline closes as done and the next cycle is scheduled.`}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="date" label="Paid on" value={paid} onChange={(e) => setPaid(e.target.value)} />
          <Input
            type="number"
            min={0}
            step="0.01"
            label={`Amount paid${currency ? ` (${currency})` : ''}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={total > 0 ? String(total) : 'Amount'}
          />
        </div>
        {total > 0 && <p className="text-xs text-[var(--agent-app-muted)]">Estimated official fee: {fmtMoney(total, item.currency)}.</p>}
        <Field label="Receipt (optional)">
          <input
            type="file"
            aria-label="Receipt file"
            className="text-[13px] file:mr-3 file:border file:border-[var(--agent-app-border)] file:bg-[var(--agent-app-surface)] file:px-2 file:py-1 file:text-[13px]"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Upload or replace the official receipt on a renewal. */
export function ReceiptControl({ item, canEdit }: { item: RenewalRec; canEdit: boolean }): React.JSX.Element | null {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File | null | undefined): Promise<void> => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('receipt', f);
      await updateRecord('renewals', item.id, fd);
      toast.success('Receipt uploaded');
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  };
  if (item.receipt === '' && !canEdit) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {item.receipt !== '' && (
        <a href={fileUrl(item, item.receipt)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--agent-app-accent)] hover:underline">
          <FileCheck2 size={12} aria-hidden /> Receipt
        </a>
      )}
      {canEdit && (
        <>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" loading={busy} onClick={() => input.current?.click()} title={item.receipt ? 'Replace the receipt' : 'Upload the official receipt'}>
            <Paperclip size={13} aria-hidden /> {item.receipt ? 'Replace' : 'Receipt'}
          </Button>
          <input ref={input} type="file" className="hidden" aria-label="Receipt file" onChange={(e) => void upload(e.target.files?.[0])} />
        </>
      )}
    </span>
  );
}

export function DecisionPill({ decision }: { decision: Decision }): React.JSX.Element {
  return <Pill tone={DECISION_TONE[decision]}>{decision === 'pending' ? 'Not decided' : (RENEWAL_DECISION_LABEL[decision] ?? decision)}</Pill>;
}
