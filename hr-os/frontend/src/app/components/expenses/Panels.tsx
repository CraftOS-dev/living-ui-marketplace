/**
 * Expenses outside its own pages: the profile tab (a person's claims and
 * advances), the Home widgets (your own expenses; what waits for HR and
 * finance) and the Inbox section (your own drafts to check, fix or send).
 */
import { useMemo } from 'react';
import { Receipt } from 'lucide-react';
import { Button, DataTable, Empty, LoadError, Loading, Money, Panel, RowCue, Skeleton } from '../ui.tsx';
import type { Column } from '../ui.tsx';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { HomeWidgetProps, InboxItem, ProfileTabProps } from '../../lib/contract.ts';
import { fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Advance, Claim, ClaimList, Home, Mine } from '../../pages/expenses/types.ts';
import { READS } from '../../pages/expenses/types.ts';
import { AddExpense } from './AddExpense.tsx';
import { AdvanceStatus, AsideLink, ClaimStatus, readingState, AdvanceAmount, ClaimName } from './parts.tsx';

export function ExpensesProfileTab({ employee, self }: ProfileTabProps): React.JSX.Element {
  const me = useMe();
  const view = can(me, 'expenses', 'view') ? 'all' : self ? 'mine' : 'team';
  const claims = useOp<ClaimList>('claims.list', { employee, view, status: 'any', limit: 50 }, READS, { name: 'claims.list.profile' });
  const advances = useOp<{ advances: Advance[] }>('advances.list', { employee, view, status: 'any', limit: 20 }, READS, { name: 'advances.list.profile' });
  const cols: Column<Claim>[] = [
    { key: 'claim', label: t('exp.col.claim'), width: 'minmax(200px,2fr)', phone: 'title', render: (c) => <ClaimName c={c} /> },
    { key: 'submitted', label: t('exp.col.submitted'), width: '110px', mono: true, hideBelow: 'lg', render: (c) => fmtStampDay(c.submitted_at, { entity: c.entity }) },
    { key: 'status', label: t('exp.col.status'), width: '120px', render: (c) => <ClaimStatus c={c} /> },
    { key: 'amount', label: t('exp.col.amount'), width: '128px', align: 'right', mono: true, phone: 'end', render: (c) => <Money minor={c.status === 'approved' || c.status === 'paid' ? c.approved_minor : c.total_minor} currency={c.currency} /> },
  ];
  const advCols: Column<Advance>[] = [
    { key: 'purpose', label: t('exp.col.purpose'), width: 'minmax(160px,2fr)', phone: 'title', render: (a) => <span className="truncate">{a.purpose}</span> },
    { key: 'status', label: t('exp.col.status'), width: '120px', render: (a) => <AdvanceStatus a={a} /> },
    { key: 'amount', label: t('exp.col.amount'), width: '150px', align: 'right', mono: true, phone: 'end', render: (a) => <AdvanceAmount a={a} /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('exp.claims.title')} flush aside={self ? <AsideLink href="#/expenses/mine">{t('exp.mine.title')}</AsideLink> : undefined}>
        {claims.data === null ? (
          claims.error !== null ? (
            <LoadError message={claims.error} onRetry={claims.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <DataTable label={t('exp.claims.title')} columns={cols} rows={claims.data.claims} rowKey={(c) => c.id} rowHref={(c) => `#/expenses/claims/${c.number}`} empty={<div className="px-3.5 py-4 text-[12px] text-[var(--hr-muted)]">{t('exp.profile.no_claims')}</div>} />
        )}
      </Panel>
      {(advances.data?.advances.length ?? 0) > 0 && (
        <Panel index="02" label={t('exp.adv.title')} flush>
          <DataTable label={t('exp.adv.title')} columns={advCols} rows={advances.data?.advances ?? []} rowKey={(a) => a.id} rowHref={(a) => `#/expenses/advances/${a.number}`} />
        </Panel>
      )}
    </div>
  );
}

/** While a widget's read is out: a quiet skeleton, never its empty state. */
function WidgetLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 py-1" role="status" aria-label={t('ui.loading')}>
      <Skeleton className="w-3/5" />
      <Skeleton className="w-2/5" />
    </div>
  );
}

/** Home (employee): what you are owed and the one action. */
export function MyExpensesWidget({ index }: HomeWidgetProps): React.JSX.Element | null {
  const me = useMe();
  const live = useOp<Mine>('expenses.me', {}, READS, { name: 'expenses.me', skip: me.employee === null });
  const m = live.data;
  if (me.employee === null) return null;
  if (m === null)
    return (
      <Panel index={index} label={t('exp.mine.title')}>
        {live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <WidgetLoading />}
      </Panel>
    );
  if (m.employee === null) return null;
  const emp = m.employments.find((e) => e.primary) ?? m.employments[0];
  const owed = m.awaiting[0];
  const drafts = m.drafts.filter((d) => d.lines.length > 0);
  return (
    <Panel index={index} label={t('exp.mine.title')} aside={<AsideLink href="#/expenses/mine">{t('exp.all_mine')}</AsideLink>}>
      <div className="flex flex-col gap-3">
        <div>
          <div className="hr-label">{t('exp.mine.awaiting')}</div>
          <Money minor={owed?.amount_minor ?? 0} currency={owed?.currency ?? emp?.currency ?? ''} className="text-[26px] font-light leading-none" />
          {drafts.length === 0 && <div className="mt-1.5 text-[12px] text-[var(--hr-muted)]">{m.waiting_approval > 0 ? tn('exp.widget.waiting', m.waiting_approval) : t('exp.mine.nothing_owed')}</div>}
        </div>
        {drafts.length > 0 && (
          <ul className="flex flex-col border-t border-[var(--hr-hair)]">
            {drafts.slice(0, 2).map((d) => (
              <li key={d.id}>
                <a href={`#/expenses/claims/${d.number}`} className="group hr-focus flex min-h-10 items-center gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0 hover:bg-[var(--hr-hover)]">
                  <span className="min-w-0 flex-1 truncate">{d.title !== '' ? d.title : t('exp.mine.draft', { n: d.number })}</span>
                  <span className="shrink-0 text-[12px] text-[var(--hr-muted)]">{tn('exp.n_expenses', d.lines.length)}</span>
                  <Money minor={d.total_minor} currency={d.currency} className="shrink-0" />
                  <RowCue />
                </a>
              </li>
            ))}
          </ul>
        )}
        {emp !== undefined && (
          <div className="flex flex-wrap items-center gap-3">
            <AddExpense categories={emp.categories} currency={emp.currency} entity={emp.entity} employment={emp.id} variant="default" />
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Home (HR, finance, managers): claims waiting, flagged, to pay. */
export function ExpensesWaitingWidget({ index }: HomeWidgetProps): React.JSX.Element | null {
  const me = useMe();
  const allowed = can(me, 'expenses', 'view') || isManager(me);
  const live = useOp<Home>('expenses.home', {}, READS, { name: 'expenses.home.widget', skip: !allowed });
  const h = live.data;
  if (!allowed) return null;
  const aside = <AsideLink href="#/expenses">{t('exp.title')}</AsideLink>;
  if (h === null)
    return (
      <Panel index={index} label={t('exp.title')} aside={aside}>
        {live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <WidgetLoading />}
      </Panel>
    );
  if (h.waiting.total === 0 && h.flagged.total === 0 && h.approved_unpaid.total === 0)
    return (
      <Panel index={index} label={t('exp.title')} aside={aside}>
        <Empty icon={Receipt} title={t('exp.home.none_waiting')} className="py-5" action={h.can.settings ? <Button onClick={() => navigate('/expenses/settings')}>{t('exp.home.check_settings')}</Button> : undefined} />
      </Panel>
    );
  return (
    <Panel index={index} label={t('exp.title')} aside={aside}>
      <div className="grid grid-cols-3 gap-3">
        <button type="button" className="hr-focus cursor-pointer rounded-[3px] text-left hover:bg-[var(--hr-hover)]" onClick={() => navigate('/expenses/claims', { status: 'submitted' })}>
          <div className="hr-label">{t('exp.home.waiting')}</div>
          <div className="hr-mono hr-num text-[15px]">{h.waiting.total}</div>
        </button>
        <button type="button" className="hr-focus cursor-pointer rounded-[3px] text-left hover:bg-[var(--hr-hover)]" onClick={() => navigate('/expenses/claims', { status: 'submitted', flagged: 'true' })}>
          <div className="hr-label">{t('exp.home.flagged')}</div>
          <div className={`hr-mono hr-num text-[15px] ${h.flagged.total > 0 ? 'text-[var(--hr-warn)]' : ''}`}>{h.flagged.total}</div>
        </button>
        <button type="button" className="hr-focus cursor-pointer rounded-[3px] text-left hover:bg-[var(--hr-hover)]" onClick={() => navigate('/expenses/claims', { status: 'approved' })}>
          <div className="hr-label">{t('exp.home.to_pay')}</div>
          <div className="hr-mono hr-num text-[15px]">{h.approved_unpaid.total}</div>
        </button>
      </div>
    </Panel>
  );
}

/** Inbox "For you": your drafts with a reading to check, claims sent back to fix, drafts left a week. */
export function useMyExpenseItems(): InboxItem[] | null {
  const me = useMe();
  const live = useOp<Mine>('expenses.me', {}, READS, { name: 'expenses.me', skip: me.employee === null });
  const m = live.data;
  return useMemo(() => {
    if (me.employee === null) return [];
    if (m === null) return null;
    const out: InboxItem[] = [];
    for (const d of m.drafts) {
      const toCheck = d.lines.filter((l) => readingState(l) === 'suggested').length;
      if (toCheck > 0) out.push({ id: 'exp-check-' + d.id, title: tn('exp.inbox.check', toCheck, { claim: d.number }), sub: d.title, link: `#/expenses/claims/${d.number}` });
      else if (d.lines.length > 0 && Date.now() - Date.parse(d.updated.replace(' ', 'T')) > 7 * 86400000) out.push({ id: 'exp-send-' + d.id, title: t('exp.inbox.send', { n: d.number }), sub: tn('exp.n_expenses', d.lines.length), link: `#/expenses/claims/${d.number}` });
    }
    for (const c of m.recent) if (c.status === 'rejected') out.push({ id: 'exp-fix-' + c.id, title: t('exp.inbox.fix', { n: c.number }), sub: c.decided_note, link: `#/expenses/claims/${c.number}` });
    return out;
  }, [m, me.employee]);
}
