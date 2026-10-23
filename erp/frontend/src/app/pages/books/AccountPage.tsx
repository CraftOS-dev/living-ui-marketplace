/**
 * One account: its balance today and 12 months of movement, then its
 * ledger for a period, every line with a running balance, each opening the
 * entry and the document it came from. CSV export of the period.
 */
import { useState } from 'react';
import { ArrowUpRight, Download, Landmark, Lock, PenLine } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { AccountModal } from '../../components/books/AccountModal.tsx';
import { PeriodBar } from '../../components/books/PeriodBar.tsx';
import { monthShort, rangeLabel } from '../../components/books/period.ts';
import { csvAmount, toCsv } from '../../components/books/util.ts';
import { Bars } from '../../components/charts.tsx';
import { Menu } from '../../components/controls.tsx';
import { TYPE_WORDS, journalKind, openSource, subtypeLabel } from '../../components/money/labels.ts';
import { DataTable, Pager } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, CardHeader, Empty, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { addMonths, dayLabel, monthLabel, today } from '../../lib/dates.ts';
import { decimalsOf, money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import { back, navigate, replaceQuery } from '../../lib/router.ts';
import type { AccountDetail, AccountList, LedgerLine } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 100;

export function AccountPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const base = baseCurrency(me);
  const fiscal = me.company.fiscal_start_month;
  const t = today();
  const from = query.get('from') ?? `${addMonths(t.slice(0, 7), -2)}-01`;
  const to = query.get('to') ?? t;
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [chart, setChart] = useState<AccountList | null>(null);
  const [exporting, setExporting] = useState(false);
  const data = useLive(() => op<AccountDetail>('accounts.get', { account: id, from, to, limit: LIMIT, offset }, { quiet: true }), READS.books, [id, from, to, offset]);
  const a = data.data;

  if (data.error !== null && a === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (a === null) return <PageSkeleton />;

  const debitUp = a.type === 'asset' || a.type === 'expense';
  const words = TYPE_WORDS[a.type];
  const cur = a.currency;
  const setRange = (f: string, tt: string): void => {
    setOffset(0);
    replaceQuery('account', { id, from: f, to: tt });
  };

  const openEdit = (): void => {
    if (chart === null) {
      op<AccountList>('accounts.list', { balances: false, archived: true }, { quiet: true })
        .then((r) => {
          setChart(r);
          setEditing(true);
        })
        .catch(() => undefined);
    } else setEditing(true);
  };

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      const all = await op<AccountDetail>('accounts.get', { account: id, from, to, limit: 1000, offset: 0 }, { quiet: true });
      const d = decimalsOf(cur);
      const rows: (string | number)[][] = [['Date', 'Entry', 'Kind', 'Source', 'Party', 'Memo', 'Debit', 'Credit', 'Balance']];
      rows.push([from, '', '', 'Opening balance', '', '', '', '', csvAmount(all.opening, d)]);
      for (const l of all.lines) rows.push([l.date, l.journal, journalKind(l.kind), l.label, l.party, l.memo, csvAmount(l.debit, d), csvAmount(l.credit, d), csvAmount(l.balance, d)]);
      saveText(toCsv(rows), `${a.code}-${a.name.replace(/[^a-z0-9]+/gi, '-')}-${from}-to-${to}.csv`);
    } catch {
      /* shown */
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<LedgerLine>[] = [
    { key: 'date', label: 'Date', width: '120px', render: (l) => <span className="text-[13px] text-[var(--erp-ink-2)]">{dayLabel(l.date)}</span> },
    {
      key: 'entry',
      label: 'Entry',
      width: '110px',
      render: (l) => (
        <TextLink onClick={() => navigate('journal', { id: l.journal_id })}>
          <span className="num">{l.journal}</span>
        </TextLink>
      ),
    },
    {
      key: 'what',
      label: 'What',
      width: 'minmax(180px, 2fr)',
      render: (l) => {
        const go = openSource(l.entity, l.source);
        return (
          <span className="flex min-w-0 flex-col">
            {go !== null && l.label !== '' ? (
              <TextLink onClick={go} className="max-w-full">
                <span className="truncate">{l.label}</span>
              </TextLink>
            ) : (
              <span className="truncate text-[13px] font-semibold">{l.label !== '' ? l.label : journalKind(l.kind)}</span>
            )}
            <span className="truncate text-[12px] text-[var(--erp-muted)]">{[l.party, l.memo].filter((x) => x !== '').join(' · ') || journalKind(l.kind)}</span>
          </span>
        );
      },
    },
    { key: 'debit', label: debitUp ? 'Up (debit)' : 'Down (debit)', align: 'right', width: '120px', render: (l) => (l.debit !== 0 ? money(l.debit, cur) : '') },
    { key: 'credit', label: debitUp ? 'Down (credit)' : 'Up (credit)', align: 'right', width: '120px', render: (l) => (l.credit !== 0 ? money(l.credit, cur) : '') },
    { key: 'balance', label: 'Balance', align: 'right', width: '130px', hide: 'md', render: (l) => <span className={cn('font-bold', l.balance < 0 && 'text-[var(--erp-red-text)]')}>{money(l.balance, cur)}</span> },
  ];

  const up = debitUp ? a.debits : a.credits;
  const down = debitUp ? a.credits : a.debits;
  const last = a.months[a.months.length - 1]?.month ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={() => back('accounts')}
        eyebrow={
          <>
            <span>
              {words?.plain} ({words?.term})
            </span>
            <span>{subtypeLabel(a.subtype)}</span>
            {a.control && (
              <StatusPill tone="neutral" size="sm">
                <Lock size={11} aria-hidden /> Moved by documents only
              </StatusPill>
            )}
            {a.archived && (
              <StatusPill tone="neutral" size="sm">
                Archived
              </StatusPill>
            )}
          </>
        }
        title={
          <>
            <span className="num text-[var(--erp-muted)]">{a.code}</span> {a.name}
          </>
        }
        subtitle={a.description !== '' ? a.description : undefined}
        actions={
          <>
            <PillButton variant="light" icon={Download} loading={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </PillButton>
            <Menu
              items={[
                { label: 'Change the account', icon: PenLine, onClick: openEdit, hidden: !a.can.edit },
                { label: 'Open the bank account', icon: Landmark, onClick: () => navigate('bank', { id: a.bank }), hidden: a.bank === '' },
              ]}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="dark" className="@min-[900px]:col-span-8" delay={1}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Balance today</p>
              <p className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.02em]', a.balance < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(a.balance, cur)}</p>
            </div>
            <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Movement per month, the last 12 months</p>
          </div>
          <div className="erp-on-card mt-5 rounded-[20px] bg-[var(--erp-card)] p-4 text-[var(--erp-ink)]">
            <Bars
              height={140}
              points={a.months.map((m) => ({
                key: m.month,
                label: monthLabel(m.month),
                axis: monthShort(m.month),
                value: m.net / 10 ** decimalsOf(cur),
                text: money(m.net, cur),
                current: m.month === last,
              }))}
              onPick={(m) => {
                const end = addMonths(m, 1);
                const lastDay = new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, 0).getDate();
                setRange(`${m}-01`, m === t.slice(0, 7) ? t : `${m}-${String(lastDay).padStart(2, '0')}`);
              }}
            />
          </div>
        </Card>
        <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
          <CardHeader title={rangeLabel(from, to)} subtitle="This period" />
          <dl className="flex flex-col gap-2">
            <Row label="At the start" value={money(a.opening, cur)} />
            <Row label="Went up" term={debitUp ? 'debits' : 'credits'} value={`+${money(up, cur)}`} />
            <Row label="Went down" term={debitUp ? 'credits' : 'debits'} value={`−${money(down, cur)}`} />
            <div className="my-1 border-t border-[var(--erp-line)]" />
            <Row label="At the end" value={money(a.closing, cur)} strong />
          </dl>
        </Card>
      </div>

      <PeriodBar from={from} to={to} fiscalStart={fiscal} onChange={setRange} />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <Card className="@min-[900px]:col-span-12" delay={2}>
          <CardHeader title="Ledger" subtitle={`${a.total} ${a.total === 1 ? 'line' : 'lines'} with the running balance`} />
          <DataTable
            ariaLabel="Ledger"
            rows={a.lines}
            columns={columns}
            rowKey={(l) => l.id}
            dense
            onOpen={(l) => navigate('journal', { id: l.journal_id })}
            mobile={(l) => ({
              title: l.label !== '' ? l.label : journalKind(l.kind),
              sub: `${dayLabel(l.date)} · ${l.journal}${l.memo !== '' ? ` · ${l.memo}` : ''}`,
              right: l.debit !== 0 ? `${debitUp ? '+' : '−'}${money(l.debit, cur)}` : `${debitUp ? '−' : '+'}${money(l.credit, cur)}`,
              rightSub: money(l.balance, cur),
            })}
            empty={
              <Empty icon={ArrowUpRight} title="Nothing posted in this period" compact />
            }
          />
          <Pager offset={offset} limit={LIMIT} total={a.total} onChange={setOffset} />
        </Card>
        <div className="@min-[900px]:col-span-6">
          <RecordActivity entity="accounts" refId={a.id} />
        </div>
      </div>

      {chart !== null && <AccountModal open={editing} onClose={() => setEditing(false)} account={a} accounts={chart.accounts} subtypes={chart.subtypes} onDone={() => data.reload()} />}
    </div>
  );
}

function Row({ label, value, term, strong = false }: { label: string; value: string; term?: string | undefined; strong?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[13px] text-[var(--erp-ink-2)]">
        {label}
        {term !== undefined && <span className="ml-1.5 text-[12px] text-[var(--erp-muted)]">{term}</span>}
      </dt>
      <dd className={cn('num text-[14px]', strong ? 'text-[15px] font-extrabold' : 'font-bold')}>{value}</dd>
    </div>
  );
}
