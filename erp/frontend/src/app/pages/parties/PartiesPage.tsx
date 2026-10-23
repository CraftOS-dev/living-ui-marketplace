/**
 * Customers or suppliers: what they owe (or are owed) and how much of it is
 * late, filter chips, search, and the directory itself. "New customer" opens
 * a short form (the sidebar and the Create sheet link here with ?new=1).
 */
import { useEffect, useState } from 'react';
import { Building2, Plus, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Chips, ProgressBar, SearchBox, useDebounced } from '../../components/controls.tsx';
import { PartyForm } from '../../components/sales/partyform.tsx';
import { DataTable, Pager } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Avatar, Card, Empty, Figure, LoadError, PageHeader, PillButton } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money, plural, qty } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { PartyList, PartyRow } from '../../lib/types/sales.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 50;
type Show = '' | 'owing' | 'overdue' | 'archived';

export function PartiesPage({ query, role }: PageProps & { role: 'customer' | 'supplier' }): React.JSX.Element {
  const me = useMe();
  const page = role === 'customer' ? 'customers' : 'suppliers';
  const customer = role === 'customer';
  const show = (['', 'owing', 'overdue', 'archived'].includes(query.get('show') ?? '') ? query.get('show') ?? '' : '') as Show;
  const q = query.get('q') ?? '';
  const offset = Math.max(0, Number(query.get('offset') ?? '0') || 0);
  const creating = query.get('new') !== null;
  const [text, setText] = useState(q);
  const dq = useDebounced(text, 300);
  const canEdit = can(me, customer ? 'sales' : 'purchasing', 'edit');

  const setQuery = (patch: Record<string, string | undefined>): void => replaceQuery(page, { show, q, ...patch });
  // The address may change under the box (Back, a chip, a link); keep what is being typed when it says the same.
  useEffect(() => setText((t) => (t.trim() === q ? t : q)), [q]);
  useEffect(() => {
    if (dq.trim() !== q) setQuery({ q: dq.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const list = useLive(
    () =>
      op<PartyList>(
        'parties.list',
        {
          role,
          q: q !== '' ? q : undefined,
          archived: show === 'archived' ? 'archived' : 'active',
          owing: show === 'owing' ? (customer ? 'receivable' : 'payable') : show === 'overdue' ? 'overdue' : undefined,
          sort: show === 'owing' || show === 'overdue' ? (customer ? 'receivable' : 'payable') : 'name',
          limit: LIMIT,
          offset,
        },
        { quiet: true },
      ),
    ['parties', 'journal_lines', 'documents', 'payments'],
    [role, q, show, offset],
  );
  const data = list.data;
  const cur = data?.currency ?? me.company.currency;
  const owed = (r: PartyRow): number => (customer ? r.receivable : r.payable);
  const late = (r: PartyRow): number => (customer ? r.overdue_receivable : r.overdue_payable);
  const totalOwed = data !== null ? (customer ? data.totals.receivable : data.totals.payable) : 0;
  const totalLate = data !== null ? (customer ? data.totals.overdue_receivable : data.totals.overdue_payable) : 0;
  const count = data !== null ? (customer ? data.counts.customers : data.counts.suppliers) : 0;

  const columns: Column<PartyRow>[] = [
    {
      key: 'name',
      label: customer ? 'Customer' : 'Supplier',
      width: 'minmax(0, 2fr)',
      sort: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={r.name} size={36} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{r.name}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">
              {r.code}
              {r.is_customer && r.is_supplier ? (customer ? ' · also a supplier' : ' · also a customer') : ''}
              {r.currency !== '' ? ` · ${r.currency}` : ''}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'contact',
      label: 'Contact',
      width: 'minmax(0, 1.2fr)',
      hide: 'lg',
      render: (r) => (
        <span className="min-w-0">
          <span className="block truncate">{r.contact_name !== '' ? r.contact_name : <span className="text-[var(--erp-muted)]">No contact</span>}</span>
          {r.phone !== '' && <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{r.phone}</span>}
        </span>
      ),
    },
    { key: 'email', label: 'Email', width: 'minmax(0, 1.3fr)', hide: 'xl', render: (r) => (r.email !== '' ? <span className="truncate text-[var(--erp-ink-2)]">{r.email}</span> : <span className="text-[var(--erp-muted)]">None</span>) },
    { key: 'owed', label: customer ? 'Owes you' : 'You owe', align: 'right', width: '128px', sort: owed, render: (r) => <span className={cn('font-semibold', owed(r) <= 0 && 'font-normal text-[var(--erp-muted)]')}>{money(owed(r), cur)}</span> },
    { key: 'late', label: 'Overdue', align: 'right', width: '120px', sort: late, render: (r) => (late(r) > 0 ? <span className="font-semibold text-[var(--erp-red-text)]">{money(late(r), cur)}</span> : <span className="text-[var(--erp-muted)]">None</span>) },
    { key: 'last', label: 'Last activity', width: '128px', hide: 'md', sort: (r) => r.last_activity, render: (r) => <span className="text-[var(--erp-ink-2)]">{r.last_activity !== '' ? dayLabel(r.last_activity) : 'None yet'}</span> },
  ];

  const filtered = q !== '' || show !== '';
  const Icon = customer ? Users : Building2;

  return (
    <>
      <PageHeader
        title={customer ? 'Customers' : 'Suppliers'}
        subtitle={data !== null ? `${plural(count, customer ? 'customer' : 'supplier')}` : undefined}
        actions={
          canEdit ? (
            <PillButton icon={Plus} dot onClick={() => setQuery({ new: '1' })}>
              New {role}
            </PillButton>
          ) : undefined
        }
      />

      {/* When the list fails, the error below says so; the summary does not wait for it. */}
      {!(data === null && list.error !== null) && (
      <Card tone="sand" className="mb-5" delay={1}>
        {data === null ? (
          <span className="erp-skeleton block h-[72px] rounded-[18px]" />
        ) : (
          <div className="grid grid-cols-2 items-start gap-5 @min-[640px]:grid-cols-[1.2fr_1fr_1fr]">
            <div className="col-span-2 @min-[640px]:col-span-1">
              <Figure label={customer ? 'Owed to you' : 'You owe'} value={money(totalOwed, cur)} sub={plural(data.counts.owing, customer ? 'customer owes' : 'supplier is owed', customer ? 'customers owe' : 'suppliers are owed')} onClick={() => setQuery({ show: 'owing' })} />
              {totalOwed > 0 && <ProgressBar value={totalLate / totalOwed} tone="red" className="mt-3 max-w-xs" />}
            </div>
            <Figure label="Overdue" value={money(totalLate, cur)} tone={totalLate > 0 ? 'red' : 'ink'} sub={totalOwed > 0 ? `${Math.round((totalLate / totalOwed) * 100)}% of it, ${plural(data.counts.overdue, role)}` : 'Nothing is late'} onClick={() => setQuery({ show: 'overdue' })} />
            <Figure label={customer ? 'Customers' : 'Suppliers'} value={qty(count)} sub={data.counts.archived > 0 ? `${data.counts.archived} archived` : 'Active'} />
          </div>
        )}
      </Card>
      )}

      <Chips
        ariaLabel={`Filter ${page}`}
        value={show}
        onChange={(v) => setQuery({ show: v })}
        className="mb-3"
        options={[
          { value: '', label: 'All', count: data !== null ? count : undefined },
          { value: 'owing', label: customer ? 'Owing' : 'To pay', count: data?.counts.owing },
          { value: 'overdue', label: 'Overdue', count: data?.counts.overdue, alert: true },
          { value: 'archived', label: 'Archived', count: data?.counts.archived },
        ]}
      />
      <SearchBox value={text} onChange={setText} placeholder="Name, code, email, contact or phone" ariaLabel={`Search ${page}`} className="mb-5" />

      {list.error !== null && data === null ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : (
        <Card delay={2} className="!p-3 @min-[640px]:!p-4">
          <DataTable<PartyRow>
            ariaLabel={customer ? 'Customers' : 'Suppliers'}
            rows={data?.parties ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.loading}
            onOpen={(r) => navigate('party', { id: r.id, role })}
            rowTone={(r) => (r.archived ? 'muted' : undefined)}
            mobile={(r) => ({
              lead: <Avatar name={r.name} size={36} tone="card" />,
              title: r.name,
              sub: r.contact_name !== '' ? r.contact_name : r.email !== '' ? r.email : r.code,
              right: owed(r) > 0 ? money(owed(r), cur) : undefined,
              rightSub: late(r) > 0 ? <span className="font-semibold text-[var(--erp-red-text)]">{money(late(r), cur, 'short')} late</span> : r.last_activity !== '' ? dayLabel(r.last_activity) : undefined,
            })}
            empty={
              <Empty
                icon={Icon}
                title={filtered ? 'Nobody matches' : customer ? 'No customers yet' : 'No suppliers yet'}
                action={
                  filtered ? (
                    <PillButton variant="soft" onClick={() => replaceQuery(page, {})}>
                      Show all
                    </PillButton>
                  ) : canEdit ? (
                    <PillButton icon={Plus} dot onClick={() => setQuery({ new: '1' })}>
                      New {role}
                    </PillButton>
                  ) : undefined
                }
              >
                {filtered ? 'Try another filter or search.' : customer ? 'The people and companies you sell to.' : 'The companies you buy from.'}
              </Empty>
            }
          />
          {data !== null && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={(o) => setQuery({ offset: o > 0 ? String(o) : undefined })} />}
        </Card>
      )}

      <PartyForm
        open={creating && canEdit}
        onClose={() => setQuery({ new: undefined })}
        party={null}
        role={role}
        base={me.company.currency}
        onSaved={(p) => navigate('party', { id: p.id, role })}
      />
    </>
  );
}
