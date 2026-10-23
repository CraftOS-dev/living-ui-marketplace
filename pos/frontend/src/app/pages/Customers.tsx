/**
 * Customers: who comes back, one card each. Search by name, phone or email;
 * a card opens the customer: contact details, notes for the counter, their
 * visits, what they spent, when they last came, their favourite products
 * and recent receipts. A customer with sales is archived, never deleted.
 */
import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Plus, User, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { dateTime, dayLabel, money } from '../lib/format.ts';
import { useApp } from '../lib/context.tsx';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import { can } from '../lib/session.ts';
import type { Customer, CustomerDetail } from '../lib/types.ts';
import { Avatar, Badge, Button, Card, Chip, Empty, Field, IconBadge, Modal, PageHeader, SearchField, Spinner, TextField, Toggle, rowCls, textareaCls, useConfirm } from '../components/ui.tsx';

/** A stable color slot (1 to 8) from a name, so a person keeps their color. */
function slotOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}

/** A white group inside the dialog. */
const subCard = 'ps-on-card flex min-w-0 flex-col gap-3 rounded-[22px] bg-[var(--ps-card)] p-4';

function Tile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="ps-on-card min-w-0 rounded-[22px] bg-[var(--ps-card)] px-4 py-3">
      <p className="truncate text-[12px] text-[var(--ps-muted)]">{label}</p>
      <p className="num mt-0.5 break-words text-[15px] font-bold leading-[22px]">{value}</p>
    </div>
  );
}

function CustomerDialog({ id, onClose }: { id: string | null; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => {
    if (id === null) return;
    let live = true;
    api
      .customer(id)
      .then((c) => {
        if (!live) return;
        setDetail(c);
        setName(c.name);
        setPhone(c.phone);
        setEmail(c.email);
        setNotes(c.notes);
        setMarketing(c.marketing);
      })
      .catch(() => onClose())
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // Load once per customer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const fields = { name: name.trim(), phone: phone.trim(), email: email.trim(), notes: notes.trim(), marketing };
      if (id === null) await api.addCustomer(fields);
      else await api.updateCustomer({ customer: id, ...fields });
      toast.success(id === null ? `Added ${name.trim()}` : 'Saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const archive = async (): Promise<void> => {
    if (detail === null) return;
    if (!detail.archived) {
      const ok = await confirm('Their sales stay in reports and on their receipts.', `Archive ${detail.name}?`, 'Archive');
      if (!ok) return;
    }
    try {
      await api.archiveCustomer(detail.id, !detail.archived);
      toast.success(detail.archived ? `${detail.name} is back` : `Archived ${detail.name}`);
      onClose();
    } catch {
      /* toasted */
    }
  };
  const shownName = name.trim() !== '' ? name : (detail?.name ?? '');
  return (
    <Modal
      open
      onClose={onClose}
      title={id === null ? 'New customer' : (detail?.name ?? 'Customer')}
      wide={id === null}
      xl={id !== null}
      footer={
        <>
          {detail !== null && can('customers_admin') && (
            <Button variant="danger" icon={detail.archived ? ArchiveRestore : Archive} className="mr-auto bg-[var(--ps-card)] hover:bg-[var(--ps-row)]" onClick={() => void archive()}>
              {detail.archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          {/* Cancel and Save stay together when the row wraps on a phone. */}
          <div className="flex gap-2">
            <Button variant="light" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={name.trim() === ''} loading={busy} onClick={() => void save()}>
              {id === null ? 'Add customer' : 'Save'}
            </Button>
          </div>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className={cn('grid grid-cols-1 gap-3', detail !== null && 'md:grid-cols-2 md:items-start')}>
          <div className="flex min-w-0 flex-col gap-3">
            <div className={subCard}>
              <div className="flex items-end gap-3">
                {shownName.trim() !== '' ? <Avatar name={shownName} color={slotOf(shownName)} size={44} /> : <IconBadge icon={User} size={44} />}
                <div className="min-w-0 flex-1">
                  <TextField label="Name" value={name} onChange={setName} autoFocus={id === null} maxLength={80} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField label="Phone" value={phone} onChange={setPhone} type="tel" inputMode="tel" maxLength={40} />
                <TextField label="Email" value={email} onChange={setEmail} type="email" inputMode="email" maxLength={120} />
              </div>
            </div>
            <div className={subCard}>
              <Field label="Notes for the counter">
                <textarea value={notes} maxLength={1000} rows={3} onChange={(e) => setNotes(e.target.value)} className={textareaCls} placeholder="Allergies, usual order" />
              </Field>
            </div>
            <label className="ps-on-card flex min-h-14 items-center justify-between gap-3 rounded-[22px] bg-[var(--ps-card)] py-3 pl-5 pr-4 text-[14px] font-semibold">
              <span className="min-w-0">Agreed to hear about offers</span>
              <Toggle checked={marketing} onChange={setMarketing} label="Agreed to hear about offers" />
            </label>
          </div>
          {detail !== null && (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Tile label="Visits" value={String(detail.visits)} />
                <Tile label="Spent" value={money(detail.spent, currency, exp)} />
                <Tile label="Average" value={money(detail.visits > 0 ? Math.round(detail.spent / detail.visits) : 0, currency, exp)} />
                <Tile label="Last visit" value={detail.last_visit !== '' ? dayLabel(detail.last_visit.slice(0, 10)) : 'Not yet'} />
              </div>
              {detail.favorites.length > 0 && (
                <div className={subCard}>
                  <h3 className="text-[13px] font-bold text-[var(--ps-ink-2)]">Usually buys</h3>
                  <ul className="flex flex-wrap gap-2">
                    {detail.favorites.map((f) => (
                      <li key={f.name} className="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full bg-[var(--ps-row)] pl-4 pr-1.5 text-[13px] font-semibold">
                        <span className="truncate">{f.name}</span>
                        <span className="num flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)] px-1.5 text-[12px] font-bold text-[var(--ps-ink-2)]">{`${f.qty}×`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.recent.length > 0 && (
                <div className={subCard}>
                  <h3 className="text-[13px] font-bold text-[var(--ps-ink-2)]">Recent receipts</h3>
                  <ul className="flex flex-col gap-2">
                    {detail.recent.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => navigate('orders', { id: s.id, range: 'all' })} className={cn(rowCls, 'flex w-full items-center gap-3 py-2.5 pl-4 pr-3 text-left hover:bg-[var(--ps-row-hover)]')}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{s.number}</span>
                            <span className="num block truncate text-[12px] text-[var(--ps-muted)]">{dateTime(s.created)}</span>
                          </span>
                          <span className="num shrink-0 text-[13px] font-bold">{money(s.collected, currency, exp)}</span>
                          <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ps-muted)]" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {confirmEl}
    </Modal>
  );
}

function CustomerCard({ c, delay, onOpen }: { c: Customer; delay: number; onOpen: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  return (
    <li className={cn('ps-rise min-w-0', delay > 0 && `ps-d${delay}`)}>
      <button type="button" onClick={onOpen} className="ps-on-card flex h-full w-full min-w-0 flex-col gap-4 rounded-[24px] bg-[var(--ps-card)] p-5 text-left transition-transform hover:-translate-y-0.5">
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={c.name} color={slotOf(c.name)} size={48} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold leading-[22px]">{c.name}</span>
            {c.phone !== '' && <span className="num block truncate text-[13px] text-[var(--ps-muted)]">{c.phone}</span>}
            {c.email !== '' && <span className="block truncate text-[13px] text-[var(--ps-muted)]">{c.email}</span>}
          </span>
          {c.archived && (
            <Badge tone="neutral" className="self-start">
              Archived
            </Badge>
          )}
        </span>
        <span className="mt-auto grid grid-cols-2 gap-2">
          <span className={cn(rowCls, 'min-w-0 px-4 py-3')}>
            <span className="block text-[12px] text-[var(--ps-muted)]">Visits</span>
            <span className="num block truncate text-[15px] font-bold leading-[22px]">{c.visits}</span>
          </span>
          <span className={cn(rowCls, 'min-w-0 px-4 py-3')}>
            <span className="block text-[12px] text-[var(--ps-muted)]">Spent</span>
            <span className="num block break-words text-[15px] font-bold leading-[22px]">{money(c.spent, currency, exp)}</span>
          </span>
        </span>
        <span className="flex items-center justify-between gap-3 px-1 text-[12px]">
          <span className="text-[var(--ps-muted)]">Last visit</span>
          <span className="truncate font-semibold text-[var(--ps-ink-2)]">{c.last_visit !== '' ? dayLabel(c.last_visit.slice(0, 10)) : 'Not yet'}</span>
        </span>
      </button>
    </li>
  );
}

export function CustomersPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(100);
  const d = useLive(() => api.customers({ q, archived, limit }), ['customers', 'sales'], [q, archived, limit]);
  const open = query.get('id');
  const creating = query.get('new') === '1';
  const list = d.data?.customers ?? [];
  const first = q.trim() === '' && !archived;
  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={d.data !== null ? `${d.data.total === 1 ? '1 customer' : `${d.data.total} customers`}` : undefined}
        actions={
          can('customers') ? (
            <Button variant="primary" icon={Plus} dot onClick={() => replaceQuery('customers', { new: '1' })}>
              New customer
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5">
        <div className="ps-rise ps-d1 flex flex-wrap items-center gap-3">
          <SearchField value={q} onChange={setQ} placeholder="Name, phone or email" label="Find a customer" tone="card" className="min-w-[14rem] flex-1" />
          <Chip active={archived} onClick={() => setArchived(!archived)}>
            Archived
          </Chip>
        </div>
        {d.data === null ? (
          <Card>
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          </Card>
        ) : list.length === 0 ? (
          <Card>
            <Empty
              icon={Users}
              title={q.trim() !== '' ? `Nobody matches "${q.trim()}"` : archived ? 'Nobody archived' : 'No customers yet'}
              action={
                first && can('customers') ? (
                  <Button variant="primary" icon={Plus} dot onClick={() => replaceQuery('customers', { new: '1' })}>
                    New customer
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((c, i) => (
                <CustomerCard key={c.id} c={c} delay={Math.min(5, (i % 5) + 1)} onOpen={() => replaceQuery('customers', { id: c.id })} />
              ))}
            </ul>
            {d.data.total > list.length && (
              <div className="flex justify-center">
                <Button variant="light" onClick={() => setLimit(limit + 100)}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {(open !== null || creating) && <CustomerDialog key={open ?? 'new'} id={open} onClose={() => replaceQuery('customers', {})} />}
    </div>
  );
}
