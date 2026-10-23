/**
 * Proposals from your AI agent: what it would post, void or move money for,
 * waiting for a person with the rights. Waiting ones can be approved or
 * rejected right here; decided ones are compact rows that open in full.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { proposalKind, PROPOSAL_KINDS, stamp } from '../../components/agent/words.ts';
import { Chips } from '../../components/controls.tsx';
import { ProposalCard } from '../../components/Proposal.tsx';
import { PROPOSAL_STATUS, statusOf } from '../../components/status.ts';
import { DataTable, Pager } from '../../components/table.tsx';
import { Card, CardHeader, Empty, LoadError, PageHeader, PageSkeleton, PillButton, PillSelect, StatusPill, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/dates.ts';
import { money, plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { ProposalList } from '../../lib/types/agent.ts';
import type { CompanySettings } from '../../lib/types/settings.ts';
import type { Proposal, ProposalStatus } from '../../lib/types.ts';

const STATUSES: ProposalStatus[] = ['waiting', 'approved', 'rejected', 'failed'];
const WINDOW = 200;
const PAGE = 50;

function isStatus(v: string | null): v is ProposalStatus {
  return v !== null && (STATUSES as string[]).includes(v);
}

/** Sum of amounts per currency ("SGD 2,746.42 · USD 120.00"). */
function totals(list: Proposal[]): { currency: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const p of list) by.set(p.preview.currency, (by.get(p.preview.currency) ?? 0) + Math.abs(p.amount));
  return [...by.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
}

export function ProposalsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const status: ProposalStatus = isStatus(query.get('status')) ? (query.get('status') as ProposalStatus) : 'waiting';
  const kind = query.get('kind') ?? '';
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setOffset(0);
    setPage(0);
  }, [status, kind]);

  const list = useLive(() => op<ProposalList>('proposals.list', { status, limit: WINDOW, offset }, { quiet: true }), ['proposals'], [status, offset]);
  const seesAutonomy = me.admin || me.levels.accounting !== 'none';
  const settings = useLive(() => (seesAutonomy ? op<CompanySettings>('settings.get', {}, { quiet: true }) : Promise.resolve(null)), ['settings'], [seesAutonomy]);

  const setFilter = (next: { status?: ProposalStatus | undefined; kind?: string | undefined }): void => {
    const s = next.status ?? status;
    const k = next.kind ?? kind;
    replaceQuery('proposals', { status: s === 'waiting' ? undefined : s, kind: k === '' ? undefined : k });
  };

  const all = list.data?.proposals ?? [];
  const shown = useMemo(() => (kind === '' ? all : all.filter((p) => p.kind === kind)), [all, kind]);
  const kindCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of all) c[p.kind] = (c[p.kind] ?? 0) + 1;
    return c;
  }, [all]);
  const counts = list.data?.counts ?? {};

  if (list.data === null && list.error !== null) return <LoadError message={list.error} onRetry={list.reload} />;
  if (list.data === null) return <PageSkeleton rows={4} />;

  const kindOptions = [
    { value: '', label: 'Every kind' },
    ...PROPOSAL_KINDS.filter((k) => (kindCounts[k.value] ?? 0) > 0 || k.value === kind).map((k) => ({ value: k.value, label: `${k.label} (${kindCounts[k.value] ?? 0})` })),
  ];

  const empty = (
    <Empty icon={Sparkles} title={status === 'waiting' ? 'Nothing is waiting for you' : `Nothing ${statusOf(PROPOSAL_STATUS, status).label.toLowerCase()} yet`}>
      <p>Before your AI agent posts, voids or moves money, it asks here first.</p>
      {me.admin && (
        <TextLink className="mt-2" onClick={() => navigate('settings', { tab: 'agent' })}>
          Settings, Your AI agent <ArrowUpRight size={13} aria-hidden />
        </TextLink>
      )}
    </Empty>
  );

  return (
    <div>
      <PageHeader
        title="Proposals"
        subtitle="Work your AI agent prepared. Nothing is posted until someone with the rights approves it."
        actions={
          me.admin ? (
            <PillButton variant="light" icon={SlidersHorizontal} onClick={() => navigate('settings', { tab: 'agent' })}>
              What it may do alone
            </PillButton>
          ) : undefined
        }
      />

      <div className="erp-rise erp-d1 mb-5 flex flex-wrap items-center gap-3">
        <Chips
          ariaLabel="Status"
          value={status}
          onChange={(s) => setFilter({ status: s })}
          className="min-w-0 flex-1"
          options={STATUSES.map((s) => ({
            value: s,
            label: s === 'waiting' ? 'Waiting' : statusOf(PROPOSAL_STATUS, s).label,
            count: s === 'waiting' || s === 'failed' ? (counts[s] ?? 0) : undefined,
            alert: s === 'failed',
          }))}
        />
        {all.length > 0 && <PillSelect ariaLabel="Kind" value={kind} onChange={(k) => setFilter({ kind: k })} options={kindOptions} className="w-full @min-[480px]:w-56" />}
      </div>

      {status === 'waiting' ? (
        shown.length === 0 ? (
          <Card>{empty}</Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
            <div className="flex flex-col gap-4 @min-[900px]:col-span-8">
              {shown.map((p, i) => (
                <WaitingProposal key={p.id} p={p} delay={Math.min(4, i + 1)} onDecided={list.reload} />
              ))}
            </div>
            <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
              <WaitingSummary list={all} />
              {settings.data !== null && settings.data.agent !== undefined && <AutonomyCard settings={settings.data} admin={me.admin} />}
            </div>
          </div>
        )
      ) : (
        <Card delay={1}>
          <DataTable
            ariaLabel="Proposals"
            rows={shown.slice(page * PAGE, page * PAGE + PAGE)}
            rowKey={(p) => p.id}
            onOpen={(p) => navigate('proposal', { id: p.id })}
            empty={empty}
            columns={[
              {
                key: 'title',
                label: 'Proposal',
                width: 'minmax(0, 2.4fr)',
                render: (p) => <ProposalTitle p={p} />,
              },
              { key: 'kind', label: 'Kind', width: 'minmax(0, 1fr)', hide: 'lg', render: (p) => <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{proposalKind(p.kind).one}</span> },
              { key: 'amount', label: 'Amount', align: 'right', width: '140px', sort: (p) => Math.abs(p.amount), render: (p) => (p.amount !== 0 ? money(Math.abs(p.amount), p.preview.currency) : '') },
              {
                key: 'by',
                label: 'Decided',
                width: 'minmax(0, 1.2fr)',
                hide: 'md',
                sort: (p) => p.decided_at,
                render: (p) => (
                  <span className="min-w-0 truncate text-[13px] text-[var(--erp-ink-2)]">
                    {p.decided_by !== '' ? p.decided_by : p.decision_note !== '' && p.status === 'rejected' ? 'Withdrawn' : ''}
                    {p.decided_at !== '' ? <span className="text-[var(--erp-muted)]"> · {stamp(p.decided_at)}</span> : null}
                  </span>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                width: '150px',
                align: 'right',
                render: (p) => {
                  const st = statusOf(PROPOSAL_STATUS, p.status);
                  return (
                    <StatusPill tone={st.tone} size="sm">
                      {st.label}
                    </StatusPill>
                  );
                },
              },
            ]}
            rowTone={(p) => (p.status === 'failed' ? 'alert' : undefined)}
            mobile={(p) => ({
              lead: <KindDot kind={p.kind} />,
              title: p.title,
              sub: p.status === 'failed' && p.error !== '' ? p.error : [p.decided_by, p.decided_at !== '' ? ago(p.decided_at) : ''].filter((x) => x !== '').join(' · '),
              right: p.amount !== 0 ? money(Math.abs(p.amount), p.preview.currency) : undefined,
              rightSub: statusOf(PROPOSAL_STATUS, p.status).label,
            })}
          />
          <Pager offset={page * PAGE} limit={PAGE} total={shown.length} onChange={(o) => setPage(Math.floor(o / PAGE))} />
          {(list.data.total ?? 0) > offset + WINDOW && (
            <div className="mt-3 flex justify-end">
              <PillButton size="sm" variant="soft" onClick={() => setOffset(offset + WINDOW)}>
                Older proposals
              </PillButton>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function KindDot({ kind }: { kind: string }): React.JSX.Element {
  const Icon = proposalKind(kind).icon;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)] text-[var(--erp-ink)] @min-[640px]:bg-[var(--erp-row)]">
      <Icon size={16} aria-hidden />
    </span>
  );
}

function ProposalTitle({ p }: { p: Proposal }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <KindDot kind={p.kind} />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{p.title}</span>
        <span className={cn('block truncate text-[12px]', p.status === 'failed' ? 'font-semibold text-[var(--erp-red-text)]' : 'text-[var(--erp-muted)]')}>
          {p.status === 'failed' && p.error !== '' ? p.error : p.decision_note !== '' ? p.decision_note : p.summary}
        </span>
      </span>
    </span>
  );
}

function WaitingProposal({ p, delay, onDecided }: { p: Proposal; delay: number; onDecided: () => void }): React.JSX.Element {
  const k = proposalKind(p.kind);
  const Icon = k.icon;
  return (
    <Card delay={delay} className="p-4 @min-[640px]:p-5">
      <div className="mb-3 flex items-center gap-2 px-1 text-[12px] font-semibold text-[var(--erp-muted)]">
        <Icon size={14} aria-hidden />
        <span className="truncate">{k.one}</span>
      </div>
      <ProposalCard p={p} onDecided={onDecided} />
    </Card>
  );
}

function WaitingSummary({ list }: { list: Proposal[] }): React.JSX.Element {
  const sums = totals(list);
  const byKind = PROPOSAL_KINDS.map((k) => ({ ...k, n: list.filter((p) => p.kind === k.value).length })).filter((k) => k.n > 0);
  const mine = list.filter((p) => p.can_decide).length;
  return (
    <Card tone="dark" delay={2}>
      <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Waiting for a decision</p>
      <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{plural(list.length, 'proposal')}</p>
      <div className="mt-1 flex flex-col text-[13px] text-[var(--erp-on-dark-muted)]">
        {sums.map((s) => (
          <span key={s.currency} className="num">
            {money(s.amount, s.currency)} in all
          </span>
        ))}
        {mine < list.length && <span>{plural(mine, 'is', 'are')} yours to decide</span>}
      </div>
      <ul className="mt-5 flex flex-col gap-2">
        {byKind.map((k) => {
          const Icon = k.icon;
          return (
            <li key={k.value} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2.5">
              <Icon size={16} aria-hidden className="shrink-0 text-[var(--erp-accent)]" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{k.label}</span>
              <span className="num text-[13px] font-bold">{k.n}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const AUTO_LABEL: Record<string, string> = {
  invoice: 'invoices',
  credit_note: 'credit notes',
  bill: 'bills',
  supplier_credit: 'supplier credits',
  delivery: 'deliveries',
  goods_receipt: 'goods receipts',
  journal: 'journal entries',
  stock_change: 'stock changes',
  build: 'builds',
};

function AutonomyCard({ settings, admin }: { settings: CompanySettings; admin: boolean }): React.JSX.Element | null {
  const a = settings.agent;
  if (a === undefined) return null;
  const on = a.kinds.filter((k) => a.auto[k] === true).map((k) => AUTO_LABEL[k] ?? k);
  const cur = settings.base_currency;
  return (
    <Card delay={3}>
      <CardHeader icon={ShieldCheck} title="What it may do alone" />
      {on.length === 0 ? (
        <p className="text-[13px] leading-5 text-[var(--erp-ink-2)]">Nothing posts on its own: every posting waits here for a person.</p>
      ) : (
        <p className="text-[13px] leading-5 text-[var(--erp-ink-2)]">
          It posts {on.join(', ')} on its own{a.limit > 0 ? `, up to ${money(a.limit, cur)} each` : ''}. Everything else waits here.
        </p>
      )}
      <p className="mt-2 text-[13px] font-semibold leading-5">Money never moves on its own.</p>
      {admin && (
        <TextLink className="mt-3" onClick={() => navigate('settings', { tab: 'agent' })}>
          Change in Settings <ArrowUpRight size={13} aria-hidden />
        </TextLink>
      )}
    </Card>
  );
}
