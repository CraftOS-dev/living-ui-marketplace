/**
 * Banks and cash: every bank account, cash box and company card. The main
 * account is the dark card with its last 90 days; the others are white
 * cards with their balance, the lines left to reconcile and the last
 * statement day. Totals are in the company's currency. Add an account, or
 * move money between two (?transfer=1).
 */
import { useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, CheckCircle2, Landmark, Plus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AreaLine, SplitBar } from '../../components/charts.tsx';
import { AddBankModal, TransferModal } from '../../components/money/BankForms.tsx';
import { bankKind } from '../../components/money/labels.ts';
import { segmentColor } from '../../lib/palette.ts';
import { Card, CardHeader, CircleButton, Empty, Figure, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, Toggle } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, shortDay } from '../../lib/dates.ts';
import { compact, decimalsOf, money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Bank, BankDetail, BankList, Currency } from '../../lib/types/money.ts';
import type { PageProps } from '../../routes.tsx';

/** Minor units of `cur` in minor units of `base` at the rate on file. */
export function toBase(minor: number, cur: string, base: string, rates: Currency[]): number | null {
  if (cur === base) return minor;
  const r = rates.find((c) => c.code === cur);
  if (r === undefined || r.rate_e8 <= 0) return null;
  return Math.round(((minor / 10 ** decimalsOf(cur)) * (r.rate_e8 / 1e8)) * 10 ** decimalsOf(base));
}

export function BanksPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const transferQ = query.get('transfer') === '1';
  const [transfer, setTransfer] = useState(transferQ);
  useEffect(() => {
    if (transferQ) setTransfer(true);
  }, [transferQ]);
  const canFull = can(me, 'banking', 'full');

  const data = useLive(
    async () => {
      const [list, cur] = await Promise.all([op<BankList>('banks.list', { archived }, { quiet: true }), op<{ currencies: Currency[] }>('currencies.list', {}, { quiet: true })]);
      return { list, rates: cur.currencies };
    },
    [...READS.money, 'currencies'],
    [archived],
  );
  const banks = data.data?.list.banks ?? [];
  const rates = data.data?.rates ?? [];
  const active = banks.filter((b) => !b.archived);
  const main = active.find((b) => b.kind === 'bank' && b.currency === base) ?? active[0] ?? null;
  const mainId = main?.id ?? '';
  const detail = useLive(() => (mainId === '' ? Promise.resolve(null) : op<BankDetail>('banks.get', { bank: mainId }, { quiet: true })), READS.money, [mainId]);

  if (data.error !== null && data.data === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null) return <PageSkeleton />;

  const cashLike = active.filter((b) => b.kind !== 'card');
  const cards = active.filter((b) => b.kind === 'card');
  const cash = cashLike.reduce((s, b) => s + (toBase(b.balance ?? 0, b.currency, base, rates) ?? 0), 0);
  const owed = cards.reduce((s, b) => s + (toBase(b.balance ?? 0, b.currency, base, rates) ?? 0), 0);
  const toReconcile = active.reduce((s, b) => s + (b.unmatched ?? 0), 0);
  const others = banks.filter((b) => b.id !== mainId);
  const d = detail.data;

  const closeTransfer = (): void => {
    setTransfer(false);
    if (transferQ) replaceQuery('banks', {});
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Banks and cash"
        subtitle="Every account, what the books say is in it, and what is left to reconcile"
        actions={
          <>
            {can(me, 'banking', 'full') && active.length > 1 && (
              <PillButton variant="light" icon={ArrowLeftRight} onClick={() => setTransfer(true)}>
                Move money
              </PillButton>
            )}
            {canFull && (
              <PillButton icon={Plus} dot onClick={() => setAdding(true)}>
                Add account
              </PillButton>
            )}
          </>
        }
      />

      {banks.length === 0 ? (
        <Card>
          <Empty icon={Landmark} title="No accounts yet" action={canFull ? <PillButton icon={Plus} dot onClick={() => setAdding(true)}>Add account</PillButton> : undefined}>
            Add the bank accounts, cash boxes and cards the business uses. Payments and statements go through them.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
            {main !== null && (
              <Card tone="dark" className="@min-[900px]:col-span-8" delay={1}>
                <div className="flex items-start justify-between gap-4">
                  <button type="button" onClick={() => navigate('bank', { id: main.id })} className="flex min-w-0 items-center gap-3 text-left">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--erp-dark-2)] text-[var(--erp-accent)]">
                      <Landmark size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-bold hover:underline">{main.name}</span>
                      <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">
                        {[main.bank_name, main.account_number !== '' ? `ending ${main.account_number.slice(-4)}` : '', main.currency].filter((x) => x !== '').join(' · ')}
                      </span>
                    </span>
                  </button>
                  <CircleButton icon={ArrowUpRight} label={`Open ${main.name}`} variant="onDark" size={40} onClick={() => navigate('bank', { id: main.id })} />
                </div>
                <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">In the books today</p>
                    <p className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.02em]', (main.balance ?? 0) < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(main.balance ?? 0, main.currency)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(main.unmatched ?? 0) > 0 ? (
                      <button type="button" onClick={() => navigate('bank', { id: main.id })}>
                        <StatusPill tone="dark">{main.unmatched} to reconcile</StatusPill>
                      </button>
                    ) : main.last_statement_date === undefined || main.last_statement_date === '' ? (
                      <StatusPill tone="dark">No statement yet</StatusPill>
                    ) : (
                      <StatusPill tone="dark">Reconciled</StatusPill>
                    )}
                    {main.last_statement_date !== undefined && main.last_statement_date !== '' && <span className="text-[12px] text-[var(--erp-on-dark-muted)]">Statement to {shortDay(main.last_statement_date)}</span>}
                  </div>
                </div>
                <div className="mt-5">
                  {d !== null && d !== undefined ? (
                    <AreaLine dark height={150} format={(n) => (Math.abs(n) <= 1 ? '0' : compact(n))} points={d.history.map((h) => ({ key: h.date, label: dayLabel(h.date), value: h.balance / 10 ** decimalsOf(main.currency), text: money(h.balance, main.currency) }))} />
                  ) : (
                    <span className="block h-[150px] rounded-[18px] bg-[var(--erp-dark-2)]" />
                  )}
                  <p className="mt-2 text-[12px] text-[var(--erp-on-dark-muted)]">The last 90 days</p>
                </div>
              </Card>
            )}
            <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
              <Figure label={`Cash across ${cashLike.length === 1 ? 'the account' : `${cashLike.length} accounts`}`} value={money(cash, base)} sub={`In ${base}${rates.length > 0 && cashLike.some((b) => b.currency !== base) ? ' at the rates on file' : ''}`} />
              <div className="mt-5">
                <SplitBar
                  parts={cashLike.map((b, i) => ({
                    key: b.id,
                    label: b.name,
                    value: Math.max(0, toBase(b.balance ?? 0, b.currency, base, rates) ?? 0),
                    valueText: money(b.balance ?? 0, b.currency),
                    fill: segmentColor(i, false).fill,
                    onClick: () => navigate('bank', { id: b.id }),
                  }))}
                />
              </div>
              {cards.length > 0 && (
                <div className="mt-5 rounded-[18px] bg-[var(--erp-card)] p-3">
                  <span className="block text-[12px] text-[var(--erp-muted)]">Owed on cards</span>
                  <span className="num block text-[15px] font-bold">{money(owed, base)}</span>
                </div>
              )}
              <div className="mt-3 rounded-[18px] bg-[var(--erp-card)] p-3">
                <span className="block text-[12px] text-[var(--erp-muted)]">Statement lines to reconcile</span>
                <span className="num block text-[15px] font-bold">{toReconcile === 0 ? 'None' : toReconcile}</span>
              </div>
            </Card>
          </div>

          {others.length > 0 && (
            <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2 @min-[1100px]:grid-cols-3">
              {others.map((b, i) => (
                <BankCard key={b.id} bank={b} base={base} rates={rates} delay={Math.min(5, i + 2)} />
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <span className="text-[13px] font-semibold text-[var(--erp-ink-2)]">Show archived accounts</span>
            <Toggle checked={archived} onChange={setArchived} label="Show archived accounts" />
          </div>
        </>
      )}

      <AddBankModal open={adding} onClose={() => setAdding(false)} onDone={(b) => navigate('bank', { id: b.id })} />
      <TransferModal open={transfer} onClose={closeTransfer} onDone={data.reload} />
    </div>
  );
}

function BankCard({ bank, base, rates, delay }: { bank: Bank; base: string; rates: Currency[]; delay: number }): React.JSX.Element {
  const k = bankKind(bank.kind);
  const Icon = k.icon;
  const inBase = bank.currency !== base ? toBase(bank.balance ?? 0, bank.currency, base, rates) : null;
  const unmatched = bank.unmatched ?? 0;
  return (
    <Card delay={delay} className={cn(bank.archived && 'bg-[var(--erp-row)]')}>
      <button type="button" onClick={() => navigate('bank', { id: bank.id })} className="flex w-full flex-col text-left">
        <CardHeader
          icon={Icon}
          title={bank.name}
          subtitle={[k.label, bank.bank_name, bank.account_number !== '' ? `ending ${bank.account_number.slice(-4)}` : '', bank.currency].filter((x) => x !== '').join(' · ')}
          action={bank.archived ? <StatusPill tone="neutral" size="sm">Archived</StatusPill> : undefined}
        />
        <span className="block text-[12px] font-semibold text-[var(--erp-muted)]">{bank.kind === 'card' ? 'Owed on the card' : 'In the books'}</span>
        <span className={cn('num block text-[26px] font-extrabold leading-8 tracking-[-0.02em]', (bank.balance ?? 0) < 0 && bank.kind !== 'card' && 'text-[var(--erp-red-text)]')}>{money(bank.balance ?? 0, bank.currency)}</span>
        <span className="mt-0.5 block h-5 text-[12px] text-[var(--erp-muted)]">{inBase !== null ? `About ${money(inBase, base)}` : ''}</span>
        <span className="mt-4 flex flex-wrap items-center gap-2">
          {unmatched > 0 ? (
            <StatusPill tone="warn" size="sm">
              {unmatched} to reconcile
            </StatusPill>
          ) : bank.last_statement_date === undefined || bank.last_statement_date === '' ? null : (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--erp-green-text)]">
              <CheckCircle2 size={14} aria-hidden /> Nothing to reconcile
            </span>
          )}
          <span className="text-[12px] text-[var(--erp-muted)]">{bank.last_statement_date !== undefined && bank.last_statement_date !== '' ? `Statement to ${shortDay(bank.last_statement_date)}` : 'No statement imported yet'}</span>
        </span>
      </button>
    </Card>
  );
}
