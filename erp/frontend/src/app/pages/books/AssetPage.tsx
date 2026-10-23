/**
 * One fixed asset: what it is worth now, how its cost wears down month by
 * month (the schedule, posted months marked), the accounts it uses, and
 * disposing of it when it is sold or scrapped.
 */
import { useState } from 'react';
import { CalendarClock, PenLine, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { AssetModal, DepreciateModal, DisposeModal } from '../../components/books/AssetForms.tsx';
import { monthShort } from '../../components/books/period.ts';
import { Bars } from '../../components/charts.tsx';
import { Menu, ProgressBar } from '../../components/controls.tsx';
import { CodeChip } from '../../components/money/bits.tsx';
import { Card, CardHeader, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addMonths, dayLabel, monthLabel, today } from '../../lib/dates.ts';
import { decimalsOf, money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate } from '../../lib/router.ts';
import type { AccountRef, AssetDetail } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

export function AssetPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const data = useLive(() => op<AssetDetail>('assets.get', { asset: id }, { quiet: true }), ['assets', 'journals'], [id]);
  const [editing, setEditing] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [depreciating, setDepreciating] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const a = data.data;

  if (data.error !== null && a === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (a === null) return <PageSkeleton />;

  const cur = a.currency;
  const base = a.cost - a.salvage;
  const share = base > 0 ? a.depreciated / base : 0;
  const end = addMonths(a.start.slice(0, 7), a.life_months - 1);
  const thisMonth = today().slice(0, 7);
  const posted = a.schedule.filter((s) => s.posted).length;
  const canEdit = can(me, 'accounting', 'edit');
  const canFull = can(me, 'accounting', 'full');
  const active = a.status === 'active';

  const remove = async (): Promise<void> => {
    const ok = await confirm('No depreciation has posted for it, so it simply goes. Nothing changes in the books.', `Delete ${a.name}?`);
    if (!ok) return;
    try {
      await op('assets.delete', { asset: a.id });
      toast.success('Asset deleted');
      navigate('assets');
    } catch {
      /* shown */
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={() => back('assets')}
        eyebrow={
          <>
            <span className="num">{a.number}</span>
            {active ? (
              <StatusPill tone="good" size="sm">
                In use
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" size="sm">
                Disposed {a.disposed_on !== '' ? dayLabel(a.disposed_on) : ''}
              </StatusPill>
            )}
          </>
        }
        title={a.name}
        subtitle={`In use from ${dayLabel(a.start)}, over ${a.life_months % 12 === 0 ? `${a.life_months / 12} years` : `${a.life_months} months`}`}
        actions={
          <>
            {active && canFull && (
              <PillButton variant="light" icon={Trash2} onClick={() => setDisposing(true)}>
                Dispose of it
              </PillButton>
            )}
            <Menu
              items={[
                { label: 'Change details', icon: PenLine, onClick: () => setEditing(true), hidden: !canEdit || !active },
                { label: 'Post depreciation', icon: CalendarClock, onClick: () => setDepreciating(true), hidden: !canFull || !active },
                { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove(), hidden: !canEdit || a.depreciated > 0 },
              ]}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          <Card tone="dark" delay={1}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{active ? 'Worth now, in the books' : 'Worth when disposed of'}</p>
                <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(a.book_value, cur)}</p>
              </div>
              <p className="text-[13px] text-[var(--erp-on-dark-muted)]">{active ? (thisMonth > end ? 'Fully worn down' : `Worn down by ${monthLabel(end)}`) : ''}</p>
            </div>
            <ProgressBar value={share} dark tone="accent" className="mt-5 h-2.5" />
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Tile label="It cost" value={money(a.cost, cur)} />
              <Tile label="Used up so far" value={money(a.depreciated, cur)} />
              <Tile label="Each month" value={money(a.monthly, cur)} />
            </div>
          </Card>

          <Card delay={2}>
            <CardHeader title="How it wears down" subtitle={`${posted} of ${a.life_months} months posted`} />
            <div className="erp-strip -mx-1 relative overflow-x-auto px-1">
              <div style={{ minWidth: Math.max(480, a.schedule.length * 14) }}>
                <Bars
                  height={150}
                  points={a.schedule.map((s) => ({
                    key: s.month,
                    label: monthLabel(s.month),
                    axis: s.month.endsWith('-01') ? s.month.slice(0, 4) : monthShort(s.month),
                    value: s.book_value / 10 ** decimalsOf(cur),
                    text: `${money(s.book_value, cur)} left${s.posted ? '' : ' (planned)'}`,
                    muted: !s.posted,
                    current: s.month === thisMonth,
                  }))}
                />
              </div>
            </div>
            <div className="mt-5 max-h-[360px] overflow-y-auto rounded-[18px] bg-[var(--erp-row)]">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-[var(--erp-row)]">
                  <tr className="text-left text-[12px] text-[var(--erp-muted)]">
                    <th className="px-3 @min-[480px]:px-4 pb-2 pt-3 font-semibold">Month</th>
                    <th className="whitespace-nowrap px-3 @min-[480px]:px-4 pb-2 pt-3 text-right font-semibold">Depreciation</th>
                    <th className="hidden whitespace-nowrap px-3 @min-[480px]:px-4 pb-2 pt-3 text-right font-semibold @min-[480px]:table-cell">Used up so far</th>
                    <th className="whitespace-nowrap px-3 @min-[480px]:px-4 pb-2 pt-3 text-right font-semibold">Worth after</th>
                    <th className="px-3 @min-[480px]:px-4 pb-2 pt-3 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {a.schedule.map((s) => (
                    <tr key={s.month} className={cn(s.month === thisMonth && 'font-bold')}>
                      <td className="px-3 @min-[480px]:px-4 py-1.5">{monthLabel(s.month)}</td>
                      <td className="num px-3 @min-[480px]:px-4 py-1.5 text-right">{money(s.amount, cur)}</td>
                      <td className="num hidden px-3 @min-[480px]:px-4 py-1.5 text-right @min-[480px]:table-cell">{money(s.accumulated, cur)}</td>
                      <td className="num px-3 @min-[480px]:px-4 py-1.5 text-right">{money(s.book_value, cur)}</td>
                      <td className="px-3 @min-[480px]:px-4 py-1.5 text-right">
                        {s.posted ? (
                          <>
                            <StatusPill tone="good" size="sm" className="hidden @min-[480px]:inline-flex">
                              Posted
                            </StatusPill>
                            <span role="img" aria-label="Posted" title="Posted" className="inline-block size-2 rounded-full bg-[var(--erp-green)] @min-[480px]:hidden" />
                          </>
                        ) : s.month <= thisMonth && active ? (
                          <>
                            <StatusPill tone="warn" size="sm" className="hidden @min-[480px]:inline-flex">
                              Due
                            </StatusPill>
                            <span role="img" aria-label="Due" title="Due" className="inline-block size-2 rounded-full bg-[var(--erp-amber)] @min-[480px]:hidden" />
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="sand" delay={2}>
            <CardHeader title="In the books" subtitle="The accounts it posts to" />
            <ul className="flex flex-col gap-2">
              <AccountRow label="What it cost" acc={a.asset_account} />
              <AccountRow label="Used up so far" acc={a.accumulated_account} />
              <AccountRow label="Monthly cost of wear" acc={a.expense_account} />
            </ul>
            {a.salvage > 0 && <p className="mt-3 text-[12px] text-[var(--erp-muted)]">Still worth {money(a.salvage, cur)} at the end of its life.</p>}
            {a.notes !== '' && <p className="mt-3 rounded-[14px] bg-[var(--erp-card)] px-3 py-2 text-[13px] leading-5">{a.notes}</p>}
          </Card>
          <RecordActivity entity="assets" refId={a.id} />
        </div>
      </div>

      <AssetModal open={editing} onClose={() => setEditing(false)} asset={a} onDone={() => data.reload()} />
      <DisposeModal
        open={disposing}
        onClose={() => setDisposing(false)}
        asset={a}
        onDone={data.reload}
        onDepreciate={() => {
          setDisposing(false);
          setDepreciating(true);
        }}
      />
      <DepreciateModal open={depreciating} onClose={() => setDepreciating(false)} onDone={data.reload} />
      {confirmEl}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[18px] bg-[var(--erp-dark-2)] p-3">
      <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">{label}</span>
      <span className="num block truncate text-[15px] font-bold">{value}</span>
    </div>
  );
}

function AccountRow({ label, acc }: { label: string; acc: AccountRef | null }): React.JSX.Element {
  return (
    <li>
      <button type="button" disabled={acc === null} onClick={() => navigate('account', { id: acc?.id ?? '' })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-card)] px-3 py-2.5 text-left hover:bg-[var(--erp-row)] disabled:cursor-default">
        {acc !== null && <CodeChip code={acc.code} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{acc?.name ?? 'None'}</span>
          <span className="block text-[12px] text-[var(--erp-muted)]">{label}</span>
        </span>
      </button>
    </li>
  );
}
