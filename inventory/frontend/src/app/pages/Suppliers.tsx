/**
 * Suppliers: who stock is bought from. Each card shows how to reach them,
 * how long they take and what they supply; opening one edits it and lists
 * its items and latest orders.
 */
import { useEffect, useState } from 'react';
import { Clock, Globe, Mail, Phone, Plus, Store, Trash2, Truck } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { StatusBadge } from '../components/controls.tsx';
import { Card, Empty, Field, Modal, PageHeader, PillButton, TextLink, errMessage, softInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { dayLabel } from '../lib/dates.ts';
import { money, plural, qty } from '../lib/format.ts';
import { ItemThumb } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import { OrderStatusPill } from './Orders.tsx';

type Form = Record<'name' | 'contact' | 'email' | 'phone' | 'website' | 'lead_time_days' | 'notes', string>;

const EMPTY: Form = { name: '', contact: '', email: '', phone: '', website: '', lead_time_days: '', notes: '' };

function SupplierModal({ id, onClose }: { id: string | null; onClose: () => void }): React.JSX.Element {
  const { currency } = useApp();
  const detail = useLive(() => (id !== null ? api.supplier(id) : Promise.resolve(null)), ['suppliers', 'items', 'orders', 'stock'], [id]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const s = detail.data;
  useEffect(() => {
    if (s !== null)
      setForm({ name: s.name, contact: s.contact, email: s.email, phone: s.phone, website: s.website, lead_time_days: s.lead_time_days > 0 ? String(s.lead_time_days) : '', notes: s.notes });
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (): Promise<void> => {
    if (form.name.trim() === '') {
      setError('Give the supplier a name');
      return;
    }
    setBusy(true);
    try {
      const body = { ...form, name: form.name.trim(), lead_time_days: form.lead_time_days.trim() === '' ? '0' : form.lead_time_days.trim() };
      if (id !== null) await api.updateSupplier(id, body);
      else await api.addSupplier(body);
      toast.success(id !== null ? 'Saved' : `Added ${body.name}`);
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (id === null || s === null) return;
    try {
      const p = await api.deleteSupplier(id, true);
      const parts = [p.items_unlinked > 0 ? `${plural(p.items_unlinked, 'item')} lose their supplier` : null, p.orders_without_supplier > 0 ? `${plural(p.orders_without_supplier, 'order')} keep their lines without a supplier` : null].filter(
        (x) => x !== null,
      );
      const ok = await confirm(`"${s.name}" is deleted.${parts.length > 0 ? ` ${parts.join('; ')}.` : ''}`, 'Delete this supplier?');
      if (!ok) return;
      await api.deleteSupplier(id);
      toast.success('Deleted');
      onClose();
    } catch {
      /* toasted */
    }
  };
  const field = (key: keyof Form, label: string, placeholder: string, extra?: { inputMode?: 'email' | 'tel' | 'url' | 'numeric' }): React.JSX.Element => (
    <Field label={label}>
      <input
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: key === 'lead_time_days' ? e.target.value.replace(/[^\d]/g, '') : e.target.value });
          setError(null);
        }}
        placeholder={placeholder}
        aria-label={label}
        {...(extra?.inputMode !== undefined ? { inputMode: extra.inputMode } : {})}
        className={softInput}
      />
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={id === null ? 'New supplier' : (s?.name ?? 'Supplier')}
      xl={id !== null}
      wide={id === null}
      footer={
        <>
          {id !== null && (
            <PillButton variant="danger" icon={Trash2} onClick={() => void remove()} className="mr-auto">
              Delete
            </PillButton>
          )}
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" loading={busy} onClick={() => void save()}>
            {id === null ? 'Add supplier' : 'Save'}
          </PillButton>
        </>
      }
    >
      <div className={id !== null ? 'grid grid-cols-1 gap-6 md:grid-cols-2' : ''}>
        <div className="flex flex-col gap-4">
          {field('name', 'Name', 'For example: Northwind Supply')}
          <div className="grid grid-cols-2 gap-3">
            {field('contact', 'Contact person', 'Optional')}
            {field('lead_time_days', 'Days to deliver', 'e.g. 5', { inputMode: 'numeric' })}
          </div>
          {field('email', 'Email for orders', 'orders@supplier.com', { inputMode: 'email' })}
          <div className="grid grid-cols-2 gap-3">
            {field('phone', 'Phone', 'Optional', { inputMode: 'tel' })}
            {field('website', 'Website', 'Optional', { inputMode: 'url' })}
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              maxLength={1000}
              placeholder="Account number, minimum order, delivery days..."
              aria-label="Notes"
              className="w-full resize-none rounded-[20px] bg-[var(--iv-row)] px-5 py-3 text-[14px] outline-none ring-[var(--iv-ink)] focus-visible:ring-2"
            />
          </Field>
          {error !== null && <p className="text-[13px] font-semibold text-[var(--iv-red-text)]">{error}</p>}
        </div>
        {id !== null && s !== null && (
          <div className="flex flex-col gap-5">
            <section>
              <p className="mb-2 text-[13px] font-bold">Supplies {plural(s.supplied.length, 'item')}</p>
              {s.supplied.length === 0 ? (
                <p className="rounded-[16px] bg-[var(--iv-row)] px-3 py-2.5 text-[13px] text-[var(--iv-ink-2)]">Choose this supplier on an item (Edit) to reorder it from here.</p>
              ) : (
                <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                  {s.supplied.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate('item', { id: it.id });
                        }}
                        className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2 text-left hover:bg-[var(--iv-row-hover)]"
                      >
                        <ItemThumb photo={it.photo} icon={it.icon} size={32} tone="card" rounded="rounded-[10px]" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{it.name}</span>
                        <span className="num text-[12px] text-[var(--iv-muted)]">{qty(it.on_hand)}</span>
                        <StatusBadge status={it.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <p className="mb-2 text-[13px] font-bold">Latest orders</p>
              {s.orders.length === 0 ? (
                <p className="rounded-[16px] bg-[var(--iv-row)] px-3 py-2.5 text-[13px] text-[var(--iv-ink-2)]">No orders yet.</p>
              ) : (
                <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                  {s.orders.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate('order', { id: o.id });
                        }}
                        className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2 text-left hover:bg-[var(--iv-row-hover)]"
                      >
                        <Truck size={15} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{o.number}</span>
                        <span className="num text-[12px]">{money(o.value, currency)}</span>
                        <OrderStatusPill order={o} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
      {confirmEl}
    </Modal>
  );
}

export function SuppliersPage({ selected }: { selected: string }): React.JSX.Element {
  const { suppliers } = useApp();
  const [open, setOpen] = useState<string | null | undefined>(selected !== '' ? selected : undefined);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${plural(suppliers.length, 'supplier')} you buy from`}
        actions={
          <PillButton variant="dark" icon={Plus} dot onClick={() => setOpen(null)}>
            Add supplier
          </PillButton>
        }
      />
      {suppliers.length === 0 ? (
        <Card>
          <Empty icon={Store} title="No suppliers yet" action={<PillButton variant="dark" icon={Plus} dot onClick={() => setOpen(null)}>Add a supplier</PillButton>}>
            Give items a supplier and the Reorder page turns what runs low into one draft order per supplier.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpen(s.id)}
              className={`iv-rise iv-d${Math.min(5, i + 1)} flex flex-col gap-4 rounded-[24px] bg-[var(--iv-card)] p-5 text-left transition-shadow hover:shadow-[0_20px_40px_-30px_rgba(29,28,26,0.6)]`}
            >
              <span className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)]">
                  <Store size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{s.name}</span>
                  <span className="block truncate text-[13px] text-[var(--iv-muted)]">{s.contact !== '' ? s.contact : 'No contact person'}</span>
                </span>
              </span>
              <span className="flex flex-col gap-1.5 text-[13px] text-[var(--iv-ink-2)]">
                {s.email !== '' && (
                  <span className="flex items-center gap-2 truncate">
                    <Mail size={14} aria-hidden /> {s.email}
                  </span>
                )}
                {s.phone !== '' && (
                  <span className="flex items-center gap-2">
                    <Phone size={14} aria-hidden /> {s.phone}
                  </span>
                )}
                {s.website !== '' && (
                  <span className="flex items-center gap-2 truncate">
                    <Globe size={14} aria-hidden /> {s.website}
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <Clock size={14} aria-hidden /> {s.lead_time_days > 0 ? `${plural(s.lead_time_days, 'day')} to deliver` : 'Delivery time not set'}
                </span>
              </span>
              <span className="mt-auto grid grid-cols-3 gap-2">
                <span className="rounded-[16px] bg-[var(--iv-row)] p-2.5">
                  <span className="block text-[12px] text-[var(--iv-muted)]">Items</span>
                  <span className="num block text-[14px] font-bold">{s.items}</span>
                </span>
                <span className="rounded-[16px] bg-[var(--iv-row)] p-2.5">
                  <span className="block text-[12px] text-[var(--iv-muted)]">Open orders</span>
                  <span className="num block text-[14px] font-bold">{s.open_orders}</span>
                </span>
                <span className="rounded-[16px] bg-[var(--iv-row)] p-2.5">
                  <span className="block text-[12px] text-[var(--iv-muted)]">Last order</span>
                  <span className="block truncate text-[13px] font-bold">{s.last_ordered_on !== '' ? dayLabel(s.last_ordered_on) : 'Never'}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {open !== undefined && (
        <SupplierModal
          id={open}
          onClose={() => {
            setOpen(undefined);
            if (selected !== '') navigate('suppliers');
          }}
        />
      )}
      <p className="mt-6 text-center text-[12px] text-[var(--iv-muted)]">
        Tip: open the <TextLink tone="muted" onClick={() => navigate('reorder')}>Reorder</TextLink> page to turn low stock into orders for these suppliers.
      </p>
    </div>
  );
}
