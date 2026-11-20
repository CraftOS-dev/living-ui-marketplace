/**
 * My expenses: one "Add expense" (the camera on a phone), the open draft
 * with its lines and what your AI agent read, recent claims with their
 * status, what is awaiting reimbursement, advances and trips.
 */
import { useState } from 'react';
import { HandCoins, Plane, Receipt, Send } from 'lucide-react';
import { Money, Button, DataTable, Empty, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Segmented, StatTile, Tag } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { AddExpense } from '../../components/expenses/AddExpense.tsx';
import { AdvanceStatus, CategoryIcon, ClaimStatus, Flags, ReceiptDialog, ReceiptThumb, TripStatus, readingState, AdvanceAmount, LineAmount, ReadingMark, lineTitle, tripName, ClaimName, AsideLink } from '../../components/expenses/parts.tsx';
import { op } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange, fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { AdvanceDialog } from './Advances.tsx';
import type { Advance, Claim, Line, Mine, Trip } from './types.ts';
import { READS } from './types.ts';

function DraftPanel({ d, index }: { d: Claim & { lines: Line[] }; index: string }): React.JSX.Element {
  const [viewing, setViewing] = useState<Line | null>(null);
  const blocked = d.lines.filter((l) => l.flags.some((f) => f.severity === 'blocker')).length;
  const waiting = d.lines.filter((l) => l.flags.some((f) => f.severity === 'wait')).length;
  const submit = (): void => void act([patch(d.id, { status: 'submitted' })], () => op('claims.submit', { claim: d.id }), READS);
  return (
    <Panel
      index={index}
      label={d.title !== '' ? d.title : t('exp.mine.draft', { n: d.number })}
      flush
      aside={
        <Button size="sm" icon={Send} disabled={blocked > 0 || waiting > 0 || d.lines.length === 0} onClick={submit}>
          {t('exp.claim.submit')}
        </Button>
      }
    >
      <ul>
        {d.lines.map((l) => {
          const state = readingState(l);
          return (
            <li key={l.id}>
              <div
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/expenses/claims/${d.number}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/expenses/claims/${d.number}`)}
                className="hr-focus flex cursor-pointer items-center gap-3 border-b border-[var(--hr-hair)] px-3.5 py-2.5 last:border-b-0 hover:bg-[var(--hr-hover)]"
              >
                <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                  <ReceiptThumb line={l} size={36} onOpen={l.receipt ? () => setViewing(l) : undefined} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <CategoryIcon name={l.category_icon} size={13} className="shrink-0 text-[var(--hr-muted)]" />
                    <span className="hr-wrap min-w-0 text-[13px] font-medium">{lineTitle(l)}</span>
                    <ReadingMark l={l} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--hr-muted)]">
                    <span className="hr-mono">{fmtDay(l.day)}</span>
                    <Flags flags={l.flags} max={2} />
                  </div>
                </div>
                <LineAmount l={l} currency={d.currency} className="text-[13px]" />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-[var(--hr-line)] bg-[var(--hr-sunk)] px-3.5 py-2">
        <span className="text-[12px] text-[var(--hr-muted)]">{blocked > 0 ? tn('exp.claim.blocked', blocked) : waiting > 0 ? tn('exp.claim.waiting_short', waiting) : tn('exp.n_expenses', d.lines.length)}</span>
        <Money minor={d.total_minor} currency={d.currency} className="text-[14px] font-medium" />
      </div>
      <ReceiptDialog line={viewing} onClose={() => setViewing(null)} />
    </Panel>
  );
}

export function MinePage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<Mine>('expenses.me', {}, READS, { name: 'expenses.me' });
  const [asking, setAsking] = useState(false);
  const m = live.data;
  const admin = can(me, 'expenses', 'view') || isManager(me);
  if (m === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const emp = m.employments.find((e) => e.primary) ?? m.employments[0];

  const claimCols: Column<Claim>[] = [
    { key: 'claim', label: t('exp.col.claim'), width: 'minmax(220px,2fr)', phone: 'title', render: (c) => <ClaimName c={c} /> },
    { key: 'submitted', label: t('exp.col.submitted'), width: '110px', mono: true, hideBelow: 'lg', render: (c) => fmtStampDay(c.submitted_at, { entity: c.entity }) },
    { key: 'status', label: t('exp.col.status'), width: '120px', render: (c) => <ClaimStatus c={c} /> },
    { key: 'amount', label: t('exp.col.amount'), width: '130px', align: 'right', mono: true, phone: 'end', render: (c) => <Money minor={c.status === 'approved' || c.status === 'paid' ? c.approved_minor : c.total_minor} currency={c.currency} /> },
  ];
  const advCols: Column<Advance>[] = [
    { key: 'purpose', label: t('exp.col.purpose'), width: 'minmax(160px,2fr)', phone: 'title', render: (a) => <span className="truncate">{a.purpose}</span> },
    { key: 'status', label: t('exp.col.status'), width: '120px', render: (a) => <AdvanceStatus a={a} /> },
    { key: 'amount', label: t('exp.col.amount'), width: '150px', align: 'right', mono: true, phone: 'end', render: (a) => <AdvanceAmount a={a} /> },
  ];
  const tripCols: Column<Trip>[] = [
    { key: 'trip', label: t('exp.col.trip'), width: 'minmax(160px,2fr)', phone: 'title', render: (x) => <span className="truncate">{tripName(x)}</span> },
    { key: 'days', label: t('exp.col.days'), width: '150px', mono: true, render: (x) => fmtRange(x.from_day, x.to_day) },
    { key: 'status', label: t('exp.col.status'), width: '110px', phone: 'end', render: (x) => <TripStatus trip={x} /> },
  ];
  const awaiting = m.awaiting.filter((a) => a.amount_minor > 0);
  const advanceBalance = m.advances.filter((a) => a.status === 'paid');
  const empty = m.drafts.length === 0 && m.recent.length === 0 && m.advances.length === 0 && m.trips.length === 0;
  const drafts = m.drafts.filter((d) => d.lines.length > 0);
  const idx = (n: number): string => String(drafts.length + n + 1).padStart(2, '0');

  return (
    <>
      <PageHeader title={t('exp.mine.title')} meta={emp !== undefined ? `${emp.entity_name} · ${emp.currency}` : ''}>
        {admin && (
          <Segmented
            value="mine"
            onChange={(v) => v === 'team' && navigate('/expenses')}
            label={t('exp.view')}
            options={[
              { value: 'team', label: can(me, 'expenses', 'view') ? t('exp.view.all') : t('exp.view.team') },
              { value: 'mine', label: t('exp.view.mine') },
            ]}
            className="hidden sm:inline-flex"
          />
        )}
        {emp !== undefined && !empty && (
          <span className="hidden items-center gap-2 md:flex">
            <AddExpense categories={emp.categories} currency={emp.currency} entity={emp.entity} employment={emp.id} />
          </span>
        )}
      </PageHeader>
      <PageBody>
        {emp !== undefined && !empty && (
          <div className="mb-3 flex items-center gap-3 md:hidden">
            <AddExpense categories={emp.categories} currency={emp.currency} entity={emp.entity} employment={emp.id} size="lg" className="flex-1" />
          </div>
        )}
        {m.employee === null ? (
          <Empty icon={Receipt} title={t('exp.mine.not_linked')}>
            {t('exp.mine.not_linked_text')}
          </Empty>
        ) : empty ? (
          <Empty
            icon={Receipt}
            title={t('exp.mine.empty')}
            action={
              emp !== undefined ? (
                <>
                  <AddExpense categories={emp.categories} currency={emp.currency} entity={emp.entity} employment={emp.id} label={t('exp.mine.first')} />
                  <Button icon={HandCoins} onClick={() => setAsking(true)}>
                    {t('exp.adv.ask')}
                  </Button>
                  <Button icon={Plane} onClick={() => navigate('/expenses/travel/new')}>
                    {t('exp.trip.plan')}
                  </Button>
                </>
              ) : undefined
            }
          >
            {t('exp.mine.empty_text')}
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <Panel label={t('exp.mine.summary')} className="md:hidden">
              <dl className="flex flex-col">
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--hr-hair)] py-2">
                  <dt className="text-[13px] text-[var(--hr-ink-2)]">{t('exp.mine.awaiting')}</dt>
                  <dd className="text-[15px]">
                    <Money minor={awaiting[0]?.amount_minor ?? 0} currency={awaiting[0]?.currency ?? emp?.currency ?? ''} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--hr-hair)] py-2">
                  <dt className="text-[13px] text-[var(--hr-ink-2)]">{t('exp.mine.waiting')}</dt>
                  <dd className="hr-mono hr-num text-[15px]">{m.waiting_approval}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-[13px] text-[var(--hr-ink-2)]">{t('exp.mine.advance')}</dt>
                  <dd className="text-[15px]">
                    <Money minor={advanceBalance.reduce((s, a) => s + a.balance_minor, 0)} currency={advanceBalance[0]?.currency ?? emp?.currency ?? ''} />
                  </dd>
                </div>
              </dl>
            </Panel>
            <div className="hidden gap-3 md:grid md:grid-cols-3">
              <StatTile index="01" label={t('exp.mine.awaiting')} value={awaiting.length > 0 ? <Money minor={awaiting[0]?.amount_minor ?? 0} currency={awaiting[0]?.currency ?? ''} /> : <Money minor={0} currency={emp?.currency ?? ''} />} sub={awaiting.length > 0 ? tn('exp.n_claims', awaiting[0]?.claims ?? 0) : t('exp.mine.nothing_owed')} tone="rh" />
              <StatTile index="02" label={t('exp.mine.waiting')} value={m.waiting_approval} />
              <StatTile index="03" label={t('exp.mine.advance')} value={<Money minor={advanceBalance.reduce((s, a) => s + a.balance_minor, 0)} currency={advanceBalance[0]?.currency ?? emp?.currency ?? ''} format={{ compact: true }} />} sub={advanceBalance.length > 0 ? tn('exp.n_advances', advanceBalance.length) : t('exp.mine.nothing_to_settle')} />
            </div>
            {m.drafts.some((d) => d.lines.some((l) => readingState(l) === 'suggested')) && <Notice tone="agent">{t('exp.mine.check_readings')}</Notice>}
            {drafts.map((d, i) => (
              <DraftPanel key={d.id} d={d} index={String(i + 1).padStart(2, '0')} />
            ))}
            <Panel index={idx(0)} label={t('exp.mine.recent')} flush>
              <DataTable label={t('exp.mine.recent')} columns={claimCols} rows={m.recent} rowKey={(c) => c.id} rowHref={(c) => `#/expenses/claims/${c.number}`} empty={<div className="px-3.5 py-4 text-[12px] text-[var(--hr-muted)]">{t('exp.mine.no_recent')}</div>} />
            </Panel>
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              <Panel
                index={idx(1)}
                label={t('exp.adv.title')}
                flush
                aside={
                  <Button size="sm" variant="ghost" icon={HandCoins} onClick={() => setAsking(true)}>
                    {t('exp.adv.ask')}
                  </Button>
                }
              >
                <DataTable label={t('exp.adv.title')} columns={advCols} rows={m.advances} rowKey={(a) => a.id} rowHref={(a) => `#/expenses/advances/${a.number}`} empty={<div className="px-3.5 py-4 text-[12px] text-[var(--hr-muted)]">{t('exp.adv.none_mine')}</div>} />
              </Panel>
              <Panel
                index={idx(2)}
                label={t('exp.trip.title')}
                flush
                aside={
                  <AsideLink href="#/expenses/travel/new">{t('exp.trip.plan')}</AsideLink>
                }
              >
                <DataTable label={t('exp.trip.title')} columns={tripCols} rows={m.trips} rowKey={(x) => x.id} rowHref={(x) => `#/expenses/travel/${x.number}`} empty={<div className="px-3.5 py-4 text-[12px] text-[var(--hr-muted)]">{t('exp.trip.none_mine')}</div>} />
              </Panel>
            </div>
          </div>
        )}
      </PageBody>
      {asking && emp !== undefined && <AdvanceDialog currency={emp.currency} employment={emp.id} trips={m.trips.filter((x) => x.status === 'approved' || x.status === 'requested')} onClose={() => setAsking(false)} />}
    </>
  );
}
