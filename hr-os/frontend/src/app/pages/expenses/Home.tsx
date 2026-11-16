/**
 * Expenses home for HR, finance and managers: it opens on what needs them
 * (claims waiting for their decision, then everything waiting, what is
 * flagged, what is approved and not yet paid), advances to pay and settle,
 * receipts with your AI agent, and this month's spend by category and
 * department as quiet bars. Employees see their own view at the same place.
 */
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Inbox, Receipt, Settings2 } from 'lucide-react';
import { Money, AgentMark, Button, DataTable, Empty, IconButton, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Segmented, StatTile, Tag } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { SpendBars, SpendLegend } from '../../components/expenses/SpendBars.tsx';
import { AsideLink, ClaimStatus, Totals } from '../../components/expenses/parts.tsx';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, monthName } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { href, navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { MinePage } from './Mine.tsx';
import type { Claim, Home } from './types.ts';
import { READS } from './types.ts';

function monthOf(day: string, add: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + add;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function totalsText(list: { currency: string; amount_minor: number }[]): React.JSX.Element {
  if (list.length === 0) return <span className="text-[var(--hr-muted)]">{t('ui.none')}</span>;
  return (
    <span className="flex flex-wrap gap-x-3">
      {list.map((x) => (
        <Money key={x.currency} minor={x.amount_minor} currency={x.currency} />
      ))}
    </span>
  );
}

function ClaimRows({ rows, label, empty }: { rows: Claim[]; label: string; empty: string }): React.JSX.Element {
  const cols: Column<Claim>[] = [
    { key: 'person', label: t('exp.col.person'), width: 'minmax(140px,1.4fr)', phone: 'title', render: (c) => <span className="truncate">{c.employee_name}</span> },
    {
      key: 'claim',
      label: t('exp.col.claim'),
      width: 'minmax(140px,1.6fr)',
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="hr-mono shrink-0 text-[12px] text-[var(--hr-muted)]">{c.number}</span>
          <span className="truncate">{c.title}</span>
          {c.flag_count > 0 && <Tag tone="warn" className="md:hidden">{tn('exp.n_flags', c.flag_count)}</Tag>}
        </span>
      ),
    },
    { key: 'when', label: t('exp.col.since'), width: '96px', hideBelow: 'lg', phone: 'hide', render: (c) => <span className="text-[12px] text-[var(--hr-muted)]">{c.status === 'approved' ? fmtDay(c.approved_day) : ago(c.submitted_at)}</span> },
    { key: 'flags', label: t('exp.col.flags'), width: '92px', phone: 'hide', render: (c) => (c.flag_count > 0 ? <Tag tone="warn">{tn('exp.n_flags', c.flag_count)}</Tag> : c.status === 'approved' ? <ClaimStatus c={c} /> : '') },
    { key: 'amount', label: t('exp.col.amount'), width: '118px', align: 'right', mono: true, phone: 'end', render: (c) => <Money minor={c.status === 'approved' ? c.payable_minor : c.total_minor} currency={c.currency} /> },
  ];
  return <DataTable label={label} columns={cols} rows={rows} rowKey={(c) => c.id} rowHref={(c) => `#/expenses/claims/${c.number}`} empty={<div className="px-3.5 py-4 text-[12px] text-[var(--hr-muted)]">{empty}</div>} />;
}

function AdminHome(): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const [month, setMonth] = useState(() => me.today.slice(0, 7));
  const live = useOp<Home>('expenses.home', { entity: entity === '' ? undefined : entity, month }, READS, { name: 'expenses.home' });
  const h = live.data;
  if (h === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const ent = h.entities.find((e) => e.id === entity);
  const nothing = h.waiting.total === 0 && h.approved_unpaid.total === 0 && h.spend_by_category.groups.length === 0 && h.advances.requested === 0 && h.receipts_waiting === 0;
  const spendCur = h.spend_by_category.currency;
  const mLabel = `${monthName(Number(month.slice(5, 7)))} ${month.slice(0, 4)}`;
  const toPay = [...h.approved_unpaid.payroll, ...h.approved_unpaid.bank];
  return (
    <>
      <PageHeader title={t('exp.title')} meta={h.scope === 'team' ? t('exp.home.team_meta') : (ent?.name ?? t('shell.all_entities_short'))}>
        {me.employee !== null && (
          <Segmented
            value="team"
            onChange={(v) => v === 'mine' && navigate('/expenses/mine')}
            label={t('exp.view')}
            options={[
              { value: 'team', label: h.scope === 'admin' ? t('exp.view.all') : t('exp.view.team') },
              { value: 'mine', label: t('exp.view.mine') },
            ]}
            className="hidden sm:inline-flex"
          />
        )}
        {h.can.settings && <IconButton icon={Settings2} label={t('exp.settings.title')} onClick={() => navigate('/expenses/settings')} className="hidden sm:inline-flex" />}
        <Button variant={nothing ? 'default' : 'primary'} icon={Receipt} className="hidden sm:inline-flex" onClick={() => navigate('/expenses/claims', h.waiting.total > 0 ? { status: 'submitted' } : undefined)}>
          {t('exp.claims.title')}
        </Button>
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-3">
          {h.for_you.total > 0 && (
            <Notice
              tone="warn"
              action={
                <Button size="sm" icon={Inbox} onClick={() => navigate('/inbox')}>
                  {t('exp.home.decide')}
                </Button>
              }
            >
              {tn('exp.home.for_you', h.for_you.total)}
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile index="01" label={t('exp.home.waiting')} value={h.waiting.total} sub={<span className="hidden sm:inline">{<Totals list={h.waiting.totals} />}</span>} onClick={() => navigate('/expenses/claims', { status: 'submitted' })} />
            <StatTile index="02" label={t('exp.home.flagged')} value={h.flagged.total} tone={h.flagged.total > 0 ? 'warn' : undefined} sub={t('exp.home.flagged_sub')} onClick={() => navigate('/expenses/claims', { status: 'submitted', flagged: 'true' })} />
            <StatTile index="03" label={t('exp.home.to_pay')} value={h.approved_unpaid.total} sub={<span className="hidden sm:inline">{<Totals list={toPay} />}</span>} tone="rh" onClick={() => navigate('/expenses/claims', { status: 'approved' })} />
            <StatTile index="04" label={t('exp.home.advances')} value={h.advances.requested + h.advances.to_pay} sub={<span className="hidden sm:inline">{h.advances.outstanding.length > 0 ? <Totals list={h.advances.outstanding} /> : t('exp.home.advances_sub')}</span>} onClick={() => navigate('/expenses/advances')} />
          </div>
          {h.receipts_waiting > 0 && (
            <div className="flex items-center gap-3 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-3 py-2">
              <AgentMark size={22} working />
              <span className="text-[12px]">{tn('exp.home.receipts_waiting', h.receipts_waiting)}</span>
            </div>
          )}
          {nothing ? (
            <div className="hr-panel hr-in">
              <Empty
                icon={Receipt}
                title={t('exp.home.empty')}
                action={
                  <>
                    {me.employee !== null && (
                      <Button variant="primary" onClick={() => navigate('/expenses/mine')}>
                        {t('exp.home.add_own')}
                      </Button>
                    )}
                    {h.can.settings && (
                      <Button icon={Settings2} onClick={() => navigate('/expenses/settings')}>
                        {t('exp.home.check_settings')}
                      </Button>
                    )}
                  </>
                }
              >
                {t('exp.home.empty_text')}
              </Empty>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
                <Panel index="01" label={t('exp.home.waiting')} flush aside={h.waiting.total > h.waiting.claims.length ? <AsideLink href={href('/expenses/claims', { status: 'submitted' })}>{t('exp.home.all_n', { n: h.waiting.total })}</AsideLink> : undefined}>
                  <ClaimRows rows={h.waiting.claims} label={t('exp.home.waiting')} empty={t('exp.home.none_waiting')} />
                </Panel>
                {h.flagged.total > 0 && (
                  <Panel index="02" label={t('exp.home.flagged')} flush>
                    <ClaimRows rows={h.flagged.claims} label={t('exp.home.flagged')} empty="" />
                  </Panel>
                )}
                <Panel
                  index="03"
                  label={t('exp.home.to_pay')}
                  flush
                  aside={
                    h.can.pay && h.approved_unpaid.bank.length > 0 ? (
                      <AsideLink href={href('/expenses/claims', { status: 'approved', pay_via: 'bank' })}>{t('exp.home.pay_bank')}</AsideLink>
                    ) : undefined
                  }
                >
                  <ClaimRows rows={h.approved_unpaid.claims} label={t('exp.home.to_pay')} empty={t('exp.home.none_to_pay')} />
                  {h.approved_unpaid.payroll.length > 0 && <div className="border-t border-[var(--hr-hair)] px-3.5 py-2 text-[12px] text-[var(--hr-muted)]">{t('exp.home.with_payroll')}</div>}
                </Panel>
              </div>
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
                <Panel
                  index="04"
                  label={t('exp.home.spend', { month: mLabel })}
                  aside={
                    <span className="flex items-center gap-0.5">
                      <IconButton icon={ChevronLeft} label={t('exp.home.prev_month')} size={26} onClick={() => setMonth((m) => monthOf(m + '-01', -1))} />
                      <IconButton icon={ChevronRight} label={t('exp.home.next_month')} size={26} disabled={month >= me.today.slice(0, 7)} onClick={() => setMonth((m) => monthOf(m + '-01', 1))} />
                    </span>
                  }
                >
                  {h.spend_by_category.groups.length === 0 ? (
                    <p className="py-3 text-[12px] text-[var(--hr-muted)]">{t('exp.home.no_spend')}</p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <Money minor={h.spend_by_category.total_minor} currency={spendCur} className="text-[26px] font-light" />
                        <SpendLegend />
                      </div>
                      <div>
                        <div className="hr-label mb-1.5">{t('exp.home.by_category')}</div>
                        <SpendBars groups={h.spend_by_category.groups} currency={spendCur} icons label={t('exp.home.by_category')} />
                      </div>
                      <div>
                        <div className="hr-label mb-1.5">{t('exp.home.by_department')}</div>
                        <SpendBars groups={h.spend_by_department.groups} currency={h.spend_by_department.currency} label={t('exp.home.by_department')} />
                      </div>
                      {h.spend_by_category.unconverted.length > 0 && <p className="text-[12px] text-[var(--hr-muted)]">{t('exp.home.unconverted', { list: h.spend_by_category.unconverted.map((u) => u.currency).join(', ') })}</p>}
                    </div>
                  )}
                </Panel>
                {h.scope === 'admin' && (h.advances.requested > 0 || h.advances.to_pay > 0 || h.advances.outstanding.length > 0) && (
                  <Panel index="05" label={t('exp.adv.title')} aside={<AsideLink href="#/expenses/advances">{t('exp.adv.all')}</AsideLink>}>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className="hr-label">{t('exp.adv.status.requested')}</div>
                        <div className="hr-mono hr-num text-[15px]">{h.advances.requested}</div>
                      </div>
                      <div>
                        <div className="hr-label">{t('exp.adv.f.to_pay')}</div>
                        <div className="hr-mono hr-num text-[15px]">{h.advances.to_pay}</div>
                      </div>
                      <div>
                        <div className="hr-label">{t('exp.adv.f.to_settle')}</div>
                        <div className="text-[13px]">{totalsText(h.advances.outstanding)}</div>
                      </div>
                    </div>
                  </Panel>
                )}
              </div>
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}

/** /expenses: HR, finance and managers get the home; everyone else their own expenses. */
export function ExpensesRoot(props: PageProps): React.JSX.Element {
  const me = useMe();
  if (can(me, 'expenses', 'view') || isManager(me)) return <AdminHome />;
  return <MinePage {...props} />;
}
