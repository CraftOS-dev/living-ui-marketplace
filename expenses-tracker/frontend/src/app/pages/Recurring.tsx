/** Rent, subscriptions and other regular payments that record themselves on their dates. */
import { useEffect, useState } from 'react';
import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Card, CircleButton, Empty, Field, Modal, PageHeader, PillButton, PillSelect, Toggle, softInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, dayLabel, today } from '../lib/dates.ts';
import { CategoryBadge } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { fieldAmount, money, normalizeAmount, symbolOf } from '../lib/money.ts';
import type { Recurring } from '../lib/types.ts';

const CADENCE: Record<string, string> = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

function pastCount(start: string, cadence: string): number {
  const t = today();
  let n = 0;
  let d = start;
  while (d <= t && n < 500) {
    n++;
    if (cadence === 'weekly') d = addDays(start, 7 * n);
    else {
      const y = Number(start.slice(0, 4));
      const m = Number(start.slice(5, 7)) - 1 + (cadence === 'monthly' ? n : 12 * n);
      const yy = y + Math.floor(m / 12);
      const mm = (m % 12) + 1;
      const dim = new Date(yy, mm, 0).getDate();
      d = `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(Number(start.slice(8, 10)), dim)).padStart(2, '0')}`;
    }
  }
  return n;
}

function RecurringForm({ open, onClose, item, onDelete }: { open: boolean; onClose: () => void; item: Recurring | null; onDelete: (r: Recurring) => void }): React.JSX.Element {
  const { currency, decimals, categories } = useApp();
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState('monthly');
  const [start, setStart] = useState(today());
  const [cat, setCat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNote(item?.note ?? '');
    setAmount(item !== null ? fieldAmount(item.amount_minor, currency) : '');
    setCadence(item?.cadence ?? 'monthly');
    setStart(item?.next_date ?? today());
    setCat(item?.category_id ?? '');
  }, [open, item, currency]);

  const changed = item === null || item.next_date !== start || item.cadence !== cadence;
  const past = changed && start <= today() ? pastCount(start, cadence) : 0;

  const save = async (): Promise<void> => {
    const n = normalizeAmount(amount, decimals);
    if (note.trim() === '') return setError('Give it a name, like Rent or Netflix');
    if (n === null) return setError('Enter the amount, like 15.49 or 1,250');
    setBusy(true);
    try {
      const r =
        item === null
          ? await api.addRecurring({ note: note.trim(), amount: n, cadence, start_date: start, category: cat })
          : await api.updateRecurring(item.id, { note: note.trim(), amount: n, category: cat, ...(changed ? { cadence, start_date: start } : {}) });
      toast.success(r.added_now > 0 ? `Saved. ${r.added_now} ${r.added_now === 1 ? 'payment' : 'payments'} recorded.` : 'Saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item === null ? 'New recurring expense' : 'Edit recurring expense'}
      footer={
        <>
          {item !== null && (
            <PillButton variant="danger" icon={Trash2} className="mr-auto" onClick={() => onDelete(item)}>
              Delete
            </PillButton>
          )}
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" loading={busy} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What is it?" error={error}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rent, Netflix, gym" maxLength={200} className={softInput} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[var(--et-muted)]">{symbolOf(currency)}</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={cn(softInput, 'num pl-9')} />
            </div>
          </Field>
          <PillSelect
            label="How often"
            soft
            value={cadence}
            onChange={setCadence}
            options={[
              { value: 'weekly', label: 'Every week' },
              { value: 'monthly', label: 'Every month' },
              { value: 'yearly', label: 'Every year' },
            ]}
          />
        </div>
        <Field label={item === null ? 'First payment on' : 'Next payment on'} hint={past > 0 ? `${past} ${past === 1 ? 'payment' : 'payments'} up to today will be recorded now.` : 'Recorded automatically on each date.'}>
          <input type="date" value={start} onChange={(e) => e.target.value !== '' && setStart(e.target.value)} className={softInput} />
        </Field>
        <PillSelect
          label="Category"
          soft
          value={cat}
          onChange={setCat}
          options={[{ value: '', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>
    </Modal>
  );
}

export function RecurringPage(): React.JSX.Element {
  const { currency } = useApp();
  const list = useLive(() => api.recurring(), ['recurring', 'categories'], []);
  const [form, setForm] = useState<{ item: Recurring | null } | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const items = list.data?.recurring ?? [];
  const perMonth = items
    .filter((r) => r.active)
    .reduce((sum, r) => sum + (r.cadence === 'monthly' ? r.amount_minor : r.cadence === 'weekly' ? Math.round((r.amount_minor * 52) / 12) : Math.round(r.amount_minor / 12)), 0);

  const setActive = async (r: Recurring, active: boolean): Promise<void> => {
    try {
      await api.updateRecurring(r.id, { active });
      toast.success(active ? 'Resumed' : 'Paused');
    } catch {
      /* toasted */
    }
  };
  const remove = async (r: Recurring): Promise<void> => {
    if (!(await confirm(`"${r.note}" stops recording itself. What it already recorded stays.`, 'Delete this recurring expense?'))) return;
    try {
      await api.deleteRecurring(r.id);
      toast.success('Deleted');
    } catch {
      /* toasted */
    }
  };

  return (
    <div>
      <PageHeader
        title="Recurring"
        subtitle={items.length > 0 ? <span className="num">About {money(perMonth, currency)} a month</span> : 'Regular payments that record themselves.'}
        actions={
          <PillButton variant="dark" icon={Plus} dot onClick={() => setForm({ item: null })}>
            Add recurring
          </PillButton>
        }
      />
      <Card delay={1}>
        {list.data !== null && items.length === 0 ? (
          <Empty
            icon={Repeat}
            title="No recurring expenses"
            action={
              <PillButton variant="dark" icon={Plus} dot onClick={() => setForm({ item: null })}>
                Add recurring
              </PillButton>
            }
          >
            Add rent, your phone or a streaming service once and it is recorded every week, month or year.
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((r) => (
              <div key={r.id} className={cn('flex items-center gap-3 rounded-[18px] bg-[var(--et-row)] px-3 py-2.5', !r.active && 'opacity-60')}>
                <CategoryBadge icon={r.category_icon} size={40} />
                <button type="button" onClick={() => setForm({ item: r })} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[14px] font-bold">{r.note}</span>
                  <span className="block truncate text-[12px] text-[var(--et-muted)]">
                    {CADENCE[r.cadence]} · {r.active ? `next ${dayLabel(r.next_date)}` : 'paused'}
                    {r.category !== null ? ` · ${r.category}` : ''}
                  </span>
                </button>
                <span className="num text-right text-[14px] font-bold sm:w-24">{money(r.amount_minor, currency)}</span>
                <Toggle checked={r.active} onChange={(v) => void setActive(r, v)} label={r.active ? `Pause ${r.note}` : `Resume ${r.note}`} />
                <CircleButton icon={Pencil} label={`Edit ${r.note}`} size={36} className="hidden sm:inline-flex" onClick={() => setForm({ item: r })} />
                <CircleButton icon={Trash2} label={`Delete ${r.note}`} size={36} className="hidden sm:inline-flex" onClick={() => void remove(r)} />
              </div>
            ))}
          </div>
        )}
      </Card>
      <RecurringForm
        open={form !== null}
        item={form?.item ?? null}
        onClose={() => setForm(null)}
        onDelete={(r) => {
          setForm(null);
          void remove(r);
        }}
      />
      {confirmEl}
    </div>
  );
}
