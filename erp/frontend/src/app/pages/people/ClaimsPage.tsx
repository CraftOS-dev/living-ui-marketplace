/**
 * Expense claims: my claims (New claim opens the editor full screen, and
 * ?new=1 does too), my team's claims to approve, approved claims to post and
 * posted claims to pay (several at once from one bank account), and every
 * claim for those who see them all.
 */
import { useEffect, useState } from 'react';
import { BookCheck, Check, Inbox, Paperclip, Plus, Receipt, Wallet, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { ConfirmPosting } from '../../components/Books.tsx';
import { Chips, SearchBox, Tabs, useDebounced } from '../../components/controls.tsx';
import { useFullScreen } from '../../components/FullScreen.tsx';
import { ClaimEditor } from '../../components/people/ClaimEditor.tsx';
import { CLAIM_STATE, PersonAvatar } from '../../components/people/common.tsx';
import { BankPicker } from '../../components/pickers.tsx';
import type { Option } from '../../components/pickers.tsx';
import { DataTable, Pager, SelectionBar } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, CardHeader, Empty, Field, Figure, LoadError, PageHeader, PillButton, Skeleton, StatusPill, softArea } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { money, plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Claim, ClaimList, ClaimStatus } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'mine' | 'team' | 'pay' | 'all';
const READS = ['expense_claims', 'claim_lines', 'journals'] as const;
const LIMIT = 50;

function StatusCell({ c }: { c: Claim }): React.JSX.Element {
  const st = CLAIM_STATE[c.status];
  return (
    <StatusPill tone={st.tone} size="sm">
      {st.label}
    </StatusPill>
  );
}

function ReceiptsCell({ c }: { c: Claim }): React.JSX.Element {
  const all = c.lines_count > 0 && c.receipts === c.lines_count;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[13px]', all ? 'text-[var(--erp-ink-2)]' : 'text-[var(--erp-muted)]')} title={`${c.receipts} of ${c.lines_count} lines have a receipt`}>
      <Paperclip size={13} aria-hidden />
      <span className="num">
        {c.receipts}/{c.lines_count}
      </span>
    </span>
  );
}

function columns(person: boolean): Column<Claim>[] {
  return [
    { key: 'n', label: 'Claim', width: '112px', render: (c) => <span className="num font-semibold">{c.number}</span>, sort: (c) => c.number },
    ...(person
      ? [
          {
            key: 'p',
            label: 'Person',
            width: 'minmax(0, 1.4fr)',
            render: (c: Claim) => (
              <span className="flex min-w-0 items-center gap-2">
                <PersonAvatar name={c.employee?.name ?? '?'} photo={c.employee?.photo} size={26} />
                <span className="truncate">{c.employee?.name ?? ''}</span>
              </span>
            ),
            sort: (c: Claim) => c.employee?.name ?? '',
          },
        ]
      : []),
    { key: 't', label: 'For', width: 'minmax(0, 2fr)', render: (c) => <span className="truncate">{c.title}</span> },
    { key: 'd', label: 'Date', width: '120px', hide: 'md', render: (c) => <span className="text-[var(--erp-ink-2)]">{dayLabel(c.date)}</span>, sort: (c) => c.date },
    { key: 'r', label: 'Receipts', width: '84px', hide: 'lg', render: (c) => <ReceiptsCell c={c} /> },
    { key: 's', label: 'Status', width: '110px', render: (c) => <StatusCell c={c} /> },
    { key: 'a', label: 'Amount', width: '120px', align: 'right', render: (c) => <span className="font-semibold">{money(c.total, c.currency)}</span>, sort: (c) => c.total },
  ];
}

function mobileRow(person: boolean): (c: Claim) => { title: string; sub: string; right: string; rightSub: string; lead?: React.ReactNode } {
  return (c) => ({
    title: c.title,
    sub: `${person && c.employee !== null ? `${c.employee.name} · ` : ''}${c.number} · ${dayLabel(c.date)}`,
    right: money(c.total, c.currency),
    rightSub: CLAIM_STATE[c.status].label,
    ...(person ? { lead: <PersonAvatar name={c.employee?.name ?? '?'} photo={c.employee?.photo} size={34} /> } : {}),
  });
}

/* --------------------------------------------------------------- mine */

function MyClaims({ onNew, shortcuts }: { onNew: (el: Element | null) => void; shortcuts: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<'all' | ClaimStatus>('all');
  const live = useLive(() => op<ClaimList>('claims.list', { scope: 'mine', status: status === 'all' ? undefined : status, limit: 100 }, { quiet: true }), [...READS], [status]);
  const d = live.data;
  const k = d?.counts;
  const all = k !== undefined ? Object.values(k).reduce((s, x) => s + x.count, 0) : 0;
  const cur = d?.currency ?? 'USD';
  return (
    <div className="flex flex-col gap-5">
      {k !== undefined && all > 0 && (
        <Card tone="sand">
          <div className="grid grid-cols-2 gap-4 @min-[640px]:grid-cols-4">
            <Figure label="Waiting for approval" value={money(k.submitted.total, cur)} sub={plural(k.submitted.count, 'claim')} />
            <Figure label="Approved, to be paid" value={money(k.approved.total + k.posted.total, cur)} sub={plural(k.approved.count + k.posted.count, 'claim')} />
            <Figure label="Paid back" value={money(k.paid.total, cur)} sub={plural(k.paid.count, 'claim')} size="md" />
            <Figure label="Drafts" value={String(k.draft.count)} sub={k.rejected.count > 0 ? `${k.rejected.count} rejected` : 'not sent yet'} size="md" tone={k.rejected.count > 0 ? 'red' : 'ink'} />
          </div>
        </Card>
      )}
      <Card delay={2}>
        {k !== undefined && all > 0 && (
          <Chips
            ariaLabel="Status"
            onCard
            className="mb-4"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All', count: all },
              { value: 'draft', label: 'Drafts', count: k.draft.count },
              { value: 'submitted', label: 'Waiting', count: k.submitted.count },
              { value: 'rejected', label: 'Rejected', count: k.rejected.count, alert: true },
              { value: 'approved', label: 'Approved', count: k.approved.count },
              { value: 'posted', label: 'To pay', count: k.posted.count },
              { value: 'paid', label: 'Paid', count: k.paid.count },
            ]}
          />
        )}
        {live.error !== null && d === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <DataTable
            ariaLabel="Your claims"
            rows={d?.claims ?? []}
            loading={d === null}
            rowKey={(c) => c.id}
            onOpen={(c) => navigate('claim', { id: c.id })}
            rowTone={(c) => (c.status === 'rejected' ? 'alert' : undefined)}
            columns={columns(false)}
            mobile={mobileRow(false)}
            empty={
              <Empty
                icon={Receipt}
                title={status === 'all' ? 'No claims yet' : 'None here'}
                action={
                  status === 'all' ? (
                    <>
                      <PillButton icon={Plus} dot onClick={(e) => onNew(e.currentTarget)}>
                        New claim
                      </PillButton>
                      {shortcuts}
                    </>
                  ) : undefined
                }
              >
                {status === 'all' ? 'Paid for something for work? Claim it back with a photo of the receipt.' : undefined}
              </Empty>
            }
          />
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- team */

function DecideRow({ c, onDone }: { c: Claim; onDone: () => void }): React.JSX.Element {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (approve: boolean): Promise<void> => {
    setBusy(approve ? 'a' : 'r');
    try {
      await op('claims.decide', { claim: c.id, approve, note: note.trim() === '' ? undefined : note.trim() });
      toast.success(approve ? 'Approved' : 'Rejected');
      onDone();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="rounded-[20px] bg-[var(--erp-row)] p-3 @min-[640px]:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('claim', { id: c.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <PersonAvatar name={c.employee?.name ?? '?'} photo={c.employee?.photo} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{c.title}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">
              {c.employee?.name} · {c.number} · {dayLabel(c.date)}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="num block text-[15px] font-extrabold">{money(c.total, c.currency)}</span>
            <ReceiptsCell c={c} />
          </span>
        </button>
        {!rejecting && (
          <div className="flex w-full justify-end gap-2 @min-[480px]:w-auto">
            <PillButton size="sm" variant="light" icon={X} onClick={() => setRejecting(true)}>
              Reject
            </PillButton>
            <PillButton size="sm" icon={Check} loading={busy === 'a'} onClick={() => void decide(true)}>
              Approve
            </PillButton>
          </div>
        )}
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus aria-label="Why not" placeholder={`Why not (${(c.employee?.name ?? '').split(' ')[0] ?? ''} reads this)`} className={cn(softArea, 'min-h-[56px] bg-[var(--erp-card)]')} />
          <div className="flex justify-end gap-2">
            <PillButton size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Keep it
            </PillButton>
            <PillButton size="sm" variant="danger" loading={busy === 'r'} onClick={() => void decide(false)}>
              Reject
            </PillButton>
          </div>
        </div>
      )}
    </li>
  );
}

function TeamClaims({ scope }: { scope: 'team' | 'all' }): React.JSX.Element {
  const live = useLive(() => op<ClaimList>('claims.list', { scope, status: 'submitted', limit: 200 }, { quiet: true }), [...READS], [scope]);
  const d = live.data;
  return (
    <Card>
      <CardHeader title="Waiting for your decision" subtitle={d !== null ? `${plural(d.total, 'claim')} · ${money(d.totals.total, d.currency)}` : undefined} icon={Inbox} />
      {live.error !== null && d === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : d === null ? (
        <Skeleton className="h-20" />
      ) : d.claims.length === 0 ? (
        <Empty icon={Inbox} title="Nothing waiting" compact>
          Claims {scope === 'team' ? 'your team submits' : 'people submit'} show here.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {d.claims.map((c) => (
            <DecideRow key={c.id} c={c} onDone={live.reload} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------- post and pay */

function PostAndPay({ canPost, canPay, currency }: { canPost: boolean; canPay: boolean; currency: string }): React.JSX.Element {
  const toPost = useLive(() => (canPost ? op<ClaimList>('claims.list', { scope: 'all', status: 'approved', limit: 200 }, { quiet: true }) : Promise.resolve(null)), [...READS], [canPost]);
  const toPay = useLive(() => op<ClaimList>('claims.list', { scope: 'all', status: 'posted', limit: 500 }, { quiet: true }), [...READS], []);
  const [posting, setPosting] = useState<Claim | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [bank, setBank] = useState<Option | null>(null);
  const picked = (toPay.data?.claims ?? []).filter((c) => selected.has(c.id));
  const pickedTotal = picked.reduce((s, c) => s + c.total, 0);
  const people = new Set(picked.map((c) => c.employee?.id ?? '')).size;

  return (
    <div className="flex flex-col gap-5">
      {canPost && (
        <Card>
          <CardHeader title="Approved, to post" subtitle={toPost.data !== null && toPost.data.total > 0 ? `${plural(toPost.data.total, 'claim')} · ${money(toPost.data.totals.total, currency)}` : undefined} icon={BookCheck} />
          {toPost.data === null ? (
            <Skeleton className="h-16" />
          ) : toPost.data.claims.length === 0 ? (
            <p className="text-[13px] text-[var(--erp-muted)]">Nothing approved is waiting to be posted.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {toPost.data.claims.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
                  <button type="button" onClick={() => navigate('claim', { id: c.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <PersonAvatar name={c.employee?.name ?? '?'} photo={c.employee?.photo} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{c.title}</span>
                      <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                        {c.employee?.name} · {c.number} · {dayLabel(c.date)}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[14px] font-bold">{money(c.total, c.currency)}</span>
                  </button>
                  <PillButton size="sm" icon={BookCheck} onClick={() => setPosting(c)}>
                    Post
                  </PillButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card delay={2}>
        <CardHeader
          title="Posted, to pay back"
          subtitle={toPay.data !== null && toPay.data.total > 0 ? `${plural(toPay.data.total, 'claim')} · ${money(toPay.data.totals.total, currency)} owed to people` : undefined}
          icon={Wallet}
          action={
            canPay && (toPay.data?.claims.length ?? 0) > 0 ? (
              <PillButton size="sm" variant="soft" onClick={() => setSelected(selected.size === (toPay.data?.claims.length ?? 0) ? new Set() : new Set((toPay.data?.claims ?? []).map((c) => c.id)))}>
                {selected.size === (toPay.data?.claims.length ?? 0) ? 'Clear' : 'Select all'}
              </PillButton>
            ) : undefined
          }
        />
        {toPay.error !== null && toPay.data === null ? (
          <LoadError message={toPay.error} onRetry={toPay.reload} />
        ) : (
          <DataTable
            ariaLabel="Claims to pay"
            rows={toPay.data?.claims ?? []}
            loading={toPay.data === null}
            rowKey={(c) => c.id}
            onOpen={(c) => navigate('claim', { id: c.id })}
            selected={canPay ? selected : undefined}
            onSelect={canPay ? setSelected : undefined}
            columns={columns(true).filter((c) => c.key !== 's')}
            mobile={mobileRow(true)}
            empty={<Empty icon={Wallet} title="Nobody is waiting to be paid back" compact />}
          />
        )}
      </Card>
      {canPay && (
        <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <span className="num text-[13px] font-semibold">{money(pickedTotal, currency)}</span>
          <PillButton size="sm" variant="accent" icon={Wallet} onClick={() => setPaying(true)}>
            Pay {plural(people, 'person', 'people')}
          </PillButton>
        </SelectionBar>
      )}
      {posting !== null && (
        <ConfirmPosting
          open
          onClose={() => setPosting(null)}
          title={`Post ${posting.number}`}
          verb="Post to the books"
          previewOp="claims.preview-post"
          runOp="claims.post"
          params={{ claim: posting.id }}
          onDone={() => toast.success('Posted. It is now waiting to be paid back.')}
        />
      )}
      {paying && (
        <ConfirmPosting
          open
          onClose={() => setPaying(false)}
          title={`Pay back ${plural(picked.length, 'claim')}`}
          verb={`Pay ${money(pickedTotal, currency)}`}
          previewOp="claims.preview-pay"
          runOp="claims.pay"
          params={{ claims: picked.map((c) => c.id), bank: bank?.id ?? undefined }}
          withDate
          defaultDate={today()}
          intro={
            <Field label="Pay from">
              <BankPicker value={bank} onChange={setBank} currency={currency} placeholder="The default bank account" clearable />
            </Field>
          }
          onDone={() => {
            toast.success('Paid');
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- all */

function AllClaims(): React.JSX.Element {
  const [status, setStatus] = useState<'all' | ClaimStatus>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [status, dq]);
  const live = useLive(() => op<ClaimList>('claims.list', { scope: 'all', status: status === 'all' ? undefined : status, q: dq === '' ? undefined : dq, limit: LIMIT, offset }, { quiet: true }), [...READS], [status, dq, offset]);
  const d = live.data;
  const k = d?.counts;
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 @min-[900px]:flex-row @min-[900px]:items-center">
        <SearchBox value={q} onChange={setQ} placeholder="Search title or number" ariaLabel="Search claims" className="@min-[900px]:w-80" />
        {k !== undefined && (
          <Chips
            ariaLabel="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All', count: Object.values(k).reduce((s, x) => s + x.count, 0) },
              { value: 'submitted', label: 'Waiting', count: k.submitted.count },
              { value: 'approved', label: 'Approved', count: k.approved.count },
              { value: 'posted', label: 'To pay', count: k.posted.count },
              { value: 'paid', label: 'Paid', count: k.paid.count },
              { value: 'rejected', label: 'Rejected', count: k.rejected.count },
              { value: 'draft', label: 'Drafts', count: k.draft.count },
            ]}
          />
        )}
      </div>
      <Card>
        {live.error !== null && d === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <DataTable
            ariaLabel="Expense claims"
            rows={d?.claims ?? []}
            loading={d === null}
            rowKey={(c) => c.id}
            onOpen={(c) => navigate('claim', { id: c.id })}
            columns={columns(true)}
            mobile={mobileRow(true)}
            empty={<Empty icon={Receipt} title={dq !== '' ? 'No claims match' : 'No claims here'} compact />}
          />
        )}
        {d !== null && <Pager offset={offset} limit={LIMIT} total={d.total} onChange={setOffset} />}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export function ClaimsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const self = me.employee !== null;
  const peopleFull = can(me, 'people', 'full');
  const canPost = can(me, 'accounting', 'full') || peopleFull;
  const canPay = can(me, 'banking', 'full');
  const seesAll = can(me, 'people') || can(me, 'accounting');
  const showTeam = me.manages > 0 || peopleFull;
  const waiting = useLive(() => (showTeam ? op<ClaimList>('claims.list', { scope: peopleFull ? 'all' : 'team', status: 'submitted', limit: 1 }, { quiet: true }) : Promise.resolve(null)), [...READS], [showTeam, peopleFull]);
  const toSettle = useLive(
    () =>
      canPost || canPay
        ? Promise.all([canPost ? op<ClaimList>('claims.list', { scope: 'all', status: 'approved', limit: 1 }, { quiet: true }) : Promise.resolve(null), op<ClaimList>('claims.list', { scope: 'all', status: 'posted', limit: 1 }, { quiet: true })]).then(([a, b]) => (a?.total ?? 0) + (b?.total ?? 0))
        : Promise.resolve(0),
    [...READS],
    [canPost, canPay],
  );
  const tabs: { value: Tab; label: string; count?: number | undefined }[] = [];
  if (self) tabs.push({ value: 'mine', label: 'My claims' });
  if (showTeam) tabs.push({ value: 'team', label: peopleFull && me.manages === 0 ? 'To approve' : 'Team approvals', count: waiting.data?.total });
  if (canPost || canPay) tabs.push({ value: 'pay', label: 'To post and pay' });
  if (seesAll) tabs.push({ value: 'all', label: 'All claims' });
  const asked = query.get('tab') as Tab | null;
  const tab: Tab = asked !== null && tabs.some((t) => t.value === asked) ? asked : (tabs[0]?.value ?? 'mine');
  const fs = useFullScreen(() => {
    if (query.get('new') !== null) replaceQuery('claims', { tab: tab === tabs[0]?.value ? undefined : tab });
  });

  useEffect(() => {
    if (self && query.get('new') !== null && !fs.isOpen) fs.open(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, self]);

  return (
    <div>
      <PageHeader
        title="Expense claims"
        actions={
          self ? (
            <PillButton icon={Plus} dot onClick={(e) => fs.open(e.currentTarget)}>
              New claim
            </PillButton>
          ) : undefined
        }
      />
      {tabs.length > 1 && <Tabs ariaLabel="Claims" value={tab} onChange={(t) => replaceQuery('claims', { tab: t === tabs[0]?.value ? undefined : t })} tabs={tabs} />}
      {tab === 'mine' && (
        <MyClaims
          onNew={(el) => fs.open(el)}
          shortcuts={
            <>
              {showTeam && (waiting.data?.total ?? 0) > 0 && (
                <PillButton variant="soft" icon={Inbox} onClick={() => replaceQuery('claims', { tab: 'team' })}>
                  {plural(waiting.data?.total ?? 0, 'claim')} to approve
                </PillButton>
              )}
              {(toSettle.data ?? 0) > 0 && (
                <PillButton variant="soft" icon={Wallet} onClick={() => replaceQuery('claims', { tab: 'pay' })}>
                  {plural(toSettle.data ?? 0, 'claim')} to post or pay
                </PillButton>
              )}
            </>
          }
        />
      )}
      {tab === 'team' && <TeamClaims scope={peopleFull ? 'all' : 'team'} />}
      {tab === 'pay' && <PostAndPay canPost={canPost} canPay={canPay} currency={baseCurrency(me)} />}
      {tab === 'all' && <AllClaims />}
      {fs.node(<ClaimEditor claim={null} currency={baseCurrency(me)} onClose={fs.close} onSaved={(id) => navigate('claim', { id })} />, { title: 'New expense claim' })}
    </div>
  );
}
