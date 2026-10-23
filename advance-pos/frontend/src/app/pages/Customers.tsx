/**
 * Customers: who buys, how often and how much, their loyalty points and
 * store credit, and their sales. A customer's page adjusts their balances
 * (with history), links their gift cards and starts a sale for them.
 * Customers import from and export to CSV.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Coins, Download, Pencil, Plus, ShoppingBag, Upload, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { shortDate, toMinor, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { download } from '../lib/print.ts';
import { back, href, navigate } from '../lib/router.ts';
import type { Customer } from '../lib/types.ts';
import { Avatar, Kpi, LoadMore, MoneyField, OrderBadge, SearchField, useDebounced } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { handToSell } from '../components/sell/intent.ts';
import { Badge, Button, Empty, Field, Modal, PageHeader, Panel, Segmented, Select, Stat, Toggle, inputCls, textareaCls } from '../components/ui.tsx';

const CUSTOMER_COLUMNS = ['name', 'phone', 'email', 'notes', 'tags', 'tax_exempt', 'marketing', 'birthday', 'points', 'credit'];

const MOVE_REASONS: Record<string, string> = {
  earn: 'Earned',
  redeem: 'Spent',
  refund: 'Refund',
  adjust: 'Adjusted',
  issue: 'Issued',
  reload: 'Topped up',
  void: 'Voided',
};

export function CustomerForm({ customer, open, onClose, onSaved }: { customer: Customer | null; open: boolean; onClose: () => void; onSaved?: (c: Customer) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [birthday, setBirthday] = useState('');
  const [taxExempt, setTaxExempt] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
    setEmail(customer?.email ?? '');
    setNotes(customer?.notes ?? '');
    setTags((customer?.tags ?? []).join(', '));
    setBirthday(customer?.birthday ?? '');
    setTaxExempt(customer?.tax_exempt ?? false);
    setMarketing(customer?.marketing ?? false);
  }, [open, customer]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.saveCustomer({
        id: customer?.id,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        notes: notes.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
        birthday: birthday.trim(),
        tax_exempt: taxExempt,
        marketing,
      });
      toast.success('Saved ' + r.customer.name);
      onSaved?.(r.customer);
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer === null ? 'New customer' : 'Edit ' + customer.name}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() !== '') void save();
        }}
      >
        <div className="sm:col-span-2">
          <Field label="Name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <Field label="Phone">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} inputMode="email" />
        </Field>
        <Field label="Birthday" hint="Like 1990-04-12, or 04-12 without the year" error={birthday.trim() !== '' && !/^(\d{4}-)?\d{2}-\d{2}$/.test(birthday.trim()) ? 'Like 1990-04-12 or 04-12' : null}>
          <input className={inputCls} value={birthday} onChange={(e) => setBirthday(e.target.value)} maxLength={10} placeholder="1990-04-12" />
        </Field>
        <Field label="Tags" hint="Separated by commas">
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} maxLength={400} placeholder="Regular, Wholesale" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea className={textareaCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2">
          <span className="text-[13px] font-semibold">Tax exempt</span>
          <Toggle checked={taxExempt} onChange={setTaxExempt} label="Tax exempt" />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2">
          <span className="text-[13px] font-semibold">Agreed to marketing</span>
          <Toggle checked={marketing} onChange={setMarketing} label="Agreed to marketing" />
        </label>
      </form>
    </Modal>
  );
}

export function CustomersPage(): React.JSX.Element {
  const { money, settings } = useStore();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const [pages, setPages] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const term = useDebounced(q, 250);
  useEffect(() => setPages(1), [term, sort]);
  const list = useLive(() => api.customers({ q: term.trim() || undefined, sort, limit: 100 * pages }), ['customers'], [term, sort, pages]);
  const rows = list.data?.customers ?? [];
  const exportAll = async (): Promise<void> => {
    setExporting(true);
    try {
      download(await api.exportCustomers());
    } catch {
      // Shown by the transport.
    } finally {
      setExporting(false);
    }
  };
  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={list.data !== null ? list.data.total + ' customers' : undefined}
        actions={
          <>
            <Button icon={Upload} onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button icon={Download} loading={exporting} onClick={() => void exportAll()}>
              Export
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              New customer
            </Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Name, phone or email" className="w-full sm:w-72" />
        <Select
          ariaLabel="Sort"
          value={sort}
          onChange={setSort}
          className="w-44"
          options={[
            { value: 'name', label: 'By name' },
            { value: 'recent', label: 'Last visit' },
            { value: 'spent', label: 'Spent the most' },
            { value: 'points', label: 'Most points' },
          ]}
        />
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={Users} title={term !== '' ? 'Nobody matches' : 'No customers yet'} compact>
            {term === '' ? 'Add customers at the register when you ring them up, or import a list.' : undefined}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="hidden md:table-cell">Contact</th>
                  <th className="text-right">Visits</th>
                  <th className="text-right">Spent</th>
                  {settings?.loyalty_enabled === true && <th className="hidden text-right sm:table-cell">Points</th>}
                  <th className="hidden text-right lg:table-cell">Credit</th>
                  <th className="hidden lg:table-cell">Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => navigate('customer', { id: c.id })}>
                    <td>
                      <span className="flex items-center gap-2">
                        <Avatar name={c.name} size={26} color="accent" />
                        <a href={href('customer', { id: c.id })} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline">
                          {c.name}
                        </a>
                        {c.tags.slice(0, 2).map((t) => (
                          <Badge key={t} tone="neutral">
                            {t}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="hidden text-[var(--ps-ink-2)] md:table-cell">{[c.phone, c.email].filter((x) => x !== '').join(' · ')}</td>
                    <td className="num text-right">{c.visits}</td>
                    <td className="num text-right font-semibold">{money.fmt(c.spent)}</td>
                    {settings?.loyalty_enabled === true && <td className="num hidden text-right sm:table-cell">{c.points}</td>}
                    <td className="num hidden text-right lg:table-cell">{c.credit !== 0 ? money.fmt(c.credit) : ''}</td>
                    <td className="hidden text-[var(--ps-ink-2)] lg:table-cell">{c.last_visit !== '' ? shortDate(c.last_visit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore more={list.data?.more === true} loading={list.loading} onMore={() => setPages((n) => n + 1)} />
      </Panel>
      <CustomerForm customer={null} open={adding} onClose={() => setAdding(false)} onSaved={(c) => navigate('customer', { id: c.id })} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} title="Import customers" columns={CUSTOMER_COLUMNS} required={['name']} run={(csv, dry) => api.importCustomers(csv, dry)} />
    </div>
  );
}

function AdjustDialog({ customer, open, onClose }: { customer: Customer; open: boolean; onClose: () => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const [account, setAccount] = useState<'points' | 'credit'>(settings?.loyalty_enabled === true ? 'points' : 'credit');
  const [dir, setDir] = useState<'add' | 'take'>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setAmount('');
      setNote('');
      setDir('add');
    }
  }, [open]);
  const n = account === 'points' ? (/^\d+$/.test(amount.trim()) ? Number(amount.trim()) : null) : toMinor(amount, money.digits);
  const ok = n !== null && n > 0 && note.trim() !== '';
  const delta = n === null ? '' : account === 'points' ? String(dir === 'add' ? n : -n) : money.plain(dir === 'add' ? n : -n);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.adjustCustomer(customer.id, account, delta, note.trim());
      toast.success('Balance changed');
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'Adjust ' + customer.name + "'s balance"}
      description="Kept in their history with your note."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Coins} loading={busy} disabled={!ok} onClick={() => void save()}>
            {dir === 'add' ? 'Add' : 'Take off'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Balance"
            value={account}
            onChange={(a) => {
              setAccount(a);
              setAmount('');
            }}
            options={[
              { value: 'points', label: 'Points (' + customer.points + ')' },
              { value: 'credit', label: 'Store credit (' + money.fmt(customer.credit) + ')' },
            ]}
          />
          <Segmented
            label="Direction"
            value={dir}
            onChange={setDir}
            options={[
              { value: 'add', label: 'Add' },
              { value: 'take', label: 'Take off' },
            ]}
          />
        </div>
        {account === 'points' ? (
          <Field label="Points">
            <input autoFocus className={inputCls + ' num w-32 text-right'} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          </Field>
        ) : (
          <Field label="Amount">
            <MoneyField value={amount} onChange={setAmount} money={money} label="Amount" autoFocus className="w-36" />
          </Field>
        )}
        <Field label="Why">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Goodwill for a late order" />
        </Field>
      </div>
    </Modal>
  );
}

export function CustomerPage({ id }: { id: string }): React.JSX.Element {
  const { money, settings } = useStore();
  const d = useLive(() => api.customer(id), ['customers', 'orders', 'account_moves', 'gift_cards'], [id]);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  if (d.data === null) return <div className="py-16 text-center text-[13px] text-[var(--ps-muted)]">{d.error ?? ''}</div>;
  const { customer: c, orders, moves, gift_cards: cards } = d.data;
  const avg = c.visits > 0 ? Math.round(c.spent / c.visits) : 0;
  return (
    <div>
      <div className="mb-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => back('customers')}>
          Customers
        </Button>
      </div>
      <PageHeader
        title={c.name}
        subtitle={[c.phone, c.email, c.last_visit !== '' ? 'last visit ' + when(c.last_visit) : 'no visits yet'].filter((x) => x !== '').join(' · ')}
        actions={
          <>
            <DeleteButton collection="customers" id={c.id} name={c.name} variant="button" onDeleted={() => navigate('customers')} />
            <Button icon={Coins} onClick={() => setAdjusting(true)}>
              Adjust balance
            </Button>
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="primary" icon={ShoppingBag} onClick={() => handToSell({ kind: 'customer', customer: c.id })}>
              New sale
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Spent" value={money.fmt(c.spent)} note={c.visits + (c.visits === 1 ? ' visit' : ' visits')} tone="dark" />
        <Kpi label="Average sale" value={money.fmt(avg)} />
        {settings?.loyalty_enabled === true ? <Kpi label="Points" value={c.points} note={'Worth ' + money.fmt(c.points * (settings.point_value ?? 0))} tone="sand" /> : <Kpi label="Visits" value={c.visits} tone="sand" />}
        <Kpi label="Store credit" value={money.fmt(c.credit)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Sales" padded={false} actions={orders.length > 0 ? <a className="text-[12px] font-semibold hover:underline" href={href('orders', { q: c.name })}>All sales</a> : undefined}>
            {orders.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-[var(--ps-muted)]">No sales yet</p>
            ) : (
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>When</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => navigate('order', { id: o.id })}>
                      <td className="num font-semibold">{o.number}</td>
                      <td className="text-[var(--ps-ink-2)]">{when(o.paid_at)}</td>
                      <td className="num text-right">{o.items}</td>
                      <td className={cn('num text-right font-semibold', o.total < 0 && 'text-[var(--ps-red-text)]')}>{money.fmt(o.total)}</td>
                      <td>{o.return_status !== 'none' && <OrderBadge status="paid" returnStatus={o.return_status} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Balance history" padded={false}>
            {moves.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-[var(--ps-muted)]">No points or credit yet</p>
            ) : (
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th className="text-right">Change</th>
                    <th className="text-right">After</th>
                    <th className="hidden md:table-cell">By</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => {
                    const isPoints = m.account === 'points';
                    return (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap text-[var(--ps-ink-2)]">{when(m.created)}</td>
                        <td>
                          {(MOVE_REASONS[m.reason] ?? m.reason) + (isPoints ? ' points' : ' credit')}
                          {m.note !== '' && <span className="block text-[12px] text-[var(--ps-muted)]">{m.order !== '' ? <a href={href('order', { id: m.order })} className="hover:underline">{m.note}</a> : m.note}</span>}
                        </td>
                        <td className={cn('num text-right font-semibold', m.delta > 0 ? 'text-[var(--ps-green-text)]' : 'text-[var(--ps-red-text)]')}>{isPoints ? (m.delta > 0 ? '+' : '') + m.delta : money.signed(m.delta)}</td>
                        <td className="num text-right">{isPoints ? m.after : money.fmt(m.after)}</td>
                        <td className="hidden text-[var(--ps-ink-2)] md:table-cell">{m.by}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Details">
            <Stat label="Phone" value={c.phone || 'None'} />
            <Stat label="Email" value={c.email || 'None'} />
            <Stat label="Birthday" value={c.birthday !== '' ? c.birthday : 'None'} />
            <Stat label="Tax exempt" value={c.tax_exempt ? 'Yes' : 'No'} />
            <Stat label="Marketing" value={c.marketing ? 'Agreed' : 'No'} />
            <Stat label="Customer since" value={shortDate(c.created)} />
            {c.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {c.notes !== '' && <p className="mt-2 whitespace-pre-wrap rounded-[var(--ps-r)] bg-[var(--ps-row)] px-2 py-1.5 text-[12px]">{c.notes}</p>}
          </Panel>
          <Panel title="Gift cards" padded={false}>
            {cards.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-[var(--ps-muted)]">None linked</p>
            ) : (
              <ul className="divide-y divide-[var(--ps-hair)]">
                {cards.map((g) => (
                  <li key={g.id} className="flex items-center justify-between px-3 py-2">
                    <a href={href('promotions', { tab: 'gift_cards', q: g.code })} className="mono hover:underline">
                      {g.masked}
                    </a>
                    <span className="num text-[13px] font-semibold">{money.fmt(g.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <CustomerForm customer={c} open={editing} onClose={() => setEditing(false)} />
      <AdjustDialog customer={c} open={adjusting} onClose={() => setAdjusting(false)} />
    </div>
  );
}
