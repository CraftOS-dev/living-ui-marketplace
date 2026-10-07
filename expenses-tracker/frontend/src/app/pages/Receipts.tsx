/**
 * Receipts handed to the AI agent: it reads each one and records the expense.
 * One it cannot read waits here to be typed in or tried again.
 */
import { useState } from 'react';
import { Camera, FileText, PenLine, RotateCw, Trash2 } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { DropZone } from '../components/DropZone.tsx';
import { useEntry } from '../components/Entry.tsx';
import { Card, CardHeader, CircleButton, PageHeader, StatusPill, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, dayLabel } from '../lib/dates.ts';
import { useLive } from '../lib/live.ts';
import { money } from '../lib/money.ts';
import type { Receipt } from '../lib/types.ts';

function Thumb({ r }: { r: Receipt }): React.JSX.Element {
  const pdf = r.file.toLowerCase().endsWith('.pdf');
  return (
    <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open the receipt" className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[var(--et-card)]">
      {pdf ? <FileText size={18} className="text-[var(--et-muted)]" /> : <img src={`${r.url}?thumb=240x320`} alt="" className="h-full w-full object-cover" loading="lazy" />}
    </a>
  );
}

export function ReceiptsPage(): React.JSX.Element {
  const { currency } = useApp();
  const entry = useEntry();
  const list = useLive(() => api.receipts(), ['receipts', 'expenses'], []);
  const linked = useLive(() => api.list({ has_receipt: true, limit: 2000 }), ['expenses', 'categories'], []);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const receipts = list.data?.receipts ?? [];
  const byReceipt = new Map((linked.data?.expenses ?? []).filter((e) => e.receipt_id !== null).map((e) => [e.receipt_id as string, e]));
  const stuck = (r: Receipt): boolean => r.status === 'reading' && Date.now() - Date.parse(r.updated.replace(' ', 'T')) > 15 * 60 * 1000;

  const upload = async (files: File[]): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.uploadReceipts(files);
      toast.success(`${r.receipts.length === 1 ? 'Receipt' : `${r.receipts.length} receipts`} sent to your AI agent`);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const retry = async (r: Receipt): Promise<void> => {
    try {
      await api.retryReceipt(r.id);
      toast.success('Sent to your AI agent again');
    } catch {
      /* toasted */
    }
  };
  const remove = async (r: Receipt): Promise<void> => {
    if (!(await confirm(r.expense_id !== null ? 'The file is deleted; the expense made from it stays.' : 'The file is deleted.', 'Delete this receipt?'))) return;
    try {
      await api.deleteReceipt(r.id);
      toast.success('Deleted');
    } catch {
      /* toasted */
    }
  };

  return (
    <div>
      <PageHeader title="Receipts" subtitle="Drop photos or PDFs. Your AI agent reads each one and records the expense for you." />
      <div className="et-rise et-d1">
        <DropZone icon={Camera} title="Add receipts" hint="Photos or PDFs, several at once" accept="image/*,application/pdf" multiple busy={busy} onFiles={(f) => void upload(f)} />
      </div>

      {receipts.length > 0 && (
        <Card className="mt-5" delay={2}>
          <CardHeader title="Your receipts" subtitle={`${receipts.length} in total`} />
          <div className="flex flex-col gap-2">
            {receipts.map((r) => {
              const e = byReceipt.get(r.id);
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--et-row)] p-2.5">
                  <Thumb r={r} />
                  <div className="min-w-0 flex-1">
                    {r.status === 'done' && e !== undefined ? (
                      <button type="button" onClick={(ev) => entry.edit(ev.currentTarget, e)} className="block max-w-full text-left">
                        <span className="block truncate text-[14px] font-bold">{e.note !== '' ? e.note : (e.category ?? 'Expense')}</span>
                        <span className="block truncate text-[12px] text-[var(--et-muted)]">
                          {e.category ?? 'Uncategorized'} · {dayLabel(e.date)}
                        </span>
                      </button>
                    ) : (
                      <>
                        <span className="block text-[14px] font-bold">
                          {r.status === 'failed' ? 'Could not be read' : r.status === 'reading' ? 'Your AI agent is reading it' : r.status === 'done' ? 'Recorded' : 'Waiting for your AI agent'}
                        </span>
                        <span className="block truncate text-[12px] text-[var(--et-muted)]">
                          {r.status === 'failed' && r.error !== '' ? r.error : `Added ${ago(r.created)}${r.status === 'waiting' ? '. Read while your AI agent is running.' : ''}`}
                        </span>
                      </>
                    )}
                  </div>
                  {r.status === 'done' && e !== undefined ? (
                    <span className="num text-[14px] font-bold">{money(e.amount_minor, currency)}</span>
                  ) : r.status === 'failed' || stuck(r) ? (
                    <span className="flex items-center gap-1.5">
                      <CircleButton icon={PenLine} label="Type it in" size={36} onClick={(ev) => entry.fromReceipt(ev.currentTarget, r)} />
                      <CircleButton icon={RotateCw} label="Try again" size={36} onClick={() => void retry(r)} />
                    </span>
                  ) : (
                    <StatusPill tone="info" pulse>
                      {r.status === 'reading' ? 'Reading' : 'Waiting'}
                    </StatusPill>
                  )}
                  <CircleButton icon={Trash2} label="Delete receipt" size={36} onClick={() => void remove(r)} />
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {confirmEl}
    </div>
  );
}
