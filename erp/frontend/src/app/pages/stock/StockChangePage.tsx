/**
 * One stock change: what moved (per item; a transfer reads from one
 * warehouse to the other), its value, the journal entry it posted, who made
 * it, and Void, which previews the reversing entry first.
 */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, BookOpen, Ban, ClipboardCheck, SlidersHorizontal } from 'lucide-react';
import { RecordActivity } from '../../components/Activity.tsx';
import { BooksDetail, ConfirmPosting } from '../../components/Books.tsx';
import { Menu } from '../../components/controls.tsx';
import { CHANGE_KIND, REASON_LABEL } from '../../components/stock/parts.tsx';
import { RecordProposals } from '../../components/stock/RecordProposals.tsx';
import { DataTable, TotalsRow } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { ActorPill, Card, CardHeader, LoadError, Notice, PageHeader, PageSkeleton, PillButton, Skeleton, StatusPill, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { ago, dayLabel } from '../../lib/dates.ts';
import { money, plural, qty, signed } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';
import type { StockChangeDetail } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

interface Row {
  key: string;
  item: string;
  name: string;
  sku: string;
  unit: string;
  qty: number;
  value: number;
  from: string;
  to: string;
}

interface JournalOut {
  number: string;
  currency: string;
  lines: { account: { id: string; code: string; name: string }; debit: number; credit: number; memo: string; party: { name?: string | undefined } | null }[];
}

const KIND_ICON = { adjust: SlidersHorizontal, count: ClipboardCheck, transfer: ArrowLeftRight } as const;

export function StockChangePage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  useSection('stock-change', 'stock-changes');
  const live = useLive(() => op<StockChangeDetail>('stock.change-get', { change: id }, { quiet: true }), [...READS.stock], [id]);
  const ch = live.data;
  const seeBooks = can(me, 'accounting', 'view');
  const journalId = ch?.journal?.id ?? '';
  const journal = useLive(
    async () => (journalId !== '' && seeBooks ? op<JournalOut>('journals.get', { journal: journalId }, { quiet: true }) : null),
    READS.books,
    [journalId, seeBooks],
  );
  const [voiding, setVoiding] = useState(false);

  const rows = useMemo<Row[]>(() => {
    if (ch === null) return [];
    if (ch.kind !== 'transfer') {
      return ch.moves.map((m) => ({ key: m.id, item: m.item, name: m.name, sku: m.sku, unit: m.unit, qty: m.qty, value: m.value, from: m.warehouse, to: '' }));
    }
    // A transfer is an out and an in per item: one row from one warehouse to the other.
    const byItem = new Map<string, Row>();
    for (const m of ch.moves) {
      const r = byItem.get(m.item) ?? { key: m.item, item: m.item, name: m.name, sku: m.sku, unit: m.unit, qty: 0, value: 0, from: '', to: '' };
      if (m.kind === 'transfer_out') {
        r.from = m.warehouse;
        r.qty = Math.abs(m.qty);
        r.value = Math.abs(m.value);
      } else r.to = m.warehouse;
      byItem.set(m.item, r);
    }
    return [...byItem.values()];
  }, [ch]);

  if (ch === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Stock change" back={() => back('stock-changes')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton />
    );
  }

  const isVoid = ch.state === 'void';
  const Icon = KIND_ICON[ch.kind] ?? SlidersHorizontal;
  const transfer = ch.kind === 'transfer';
  const units = rows.reduce((s, r) => s + Math.abs(r.qty), 0);
  const lines: JournalPreviewLine[] = (journal.data?.lines ?? []).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, memo: l.memo, party: l.party?.name ?? '' }));

  const columns: Column<Row>[] = [
    {
      key: 'item',
      label: 'Item',
      width: 'minmax(200px, 2fr)',
      render: (r) => (
        <button type="button" onClick={() => navigate('item', { id: r.item })} className="min-w-0 text-left">
          <span className="block truncate font-bold hover:underline">{r.name}</span>
          <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{r.sku}</span>
        </button>
      ),
    },
    ...(transfer ? [] : [{ key: 'wh', label: 'Warehouse', hide: 'md' as const, render: (r: Row) => <span className="truncate text-[13px]">{r.from}</span> }]),
    {
      key: 'qty',
      label: transfer ? 'Moved' : 'Change',
      align: 'right',
      width: '120px',
      render: (r) => (
        <span>
          <span className="font-bold">{transfer ? qty(r.qty) : signed(r.qty)}</span> <span className="text-[12px] text-[var(--erp-muted)]">{r.unit}</span>
        </span>
      ),
    },
    { key: 'value', label: transfer ? 'Value moved' : 'Value', align: 'right', width: '120px', render: (r) => money(r.value, ch.currency) },
  ];

  return (
    <div>
      <PageHeader
        back={() => back('stock-changes')}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Icon size={13} aria-hidden /> {CHANGE_KIND[ch.kind] ?? ch.kind}
            </span>
            <StatusPill tone={isVoid ? 'neutral' : 'good'} size="sm">
              {isVoid ? 'Void' : 'Posted'}
            </StatusPill>
            {ch.actor === 'agent' && <ActorPill actor="agent" />}
          </>
        }
        title={<span className="num">{ch.number}</span>}
        subtitle={`${dayLabel(ch.date)} · ${transfer ? `${ch.warehouse?.name ?? ''} to ${ch.to_warehouse?.name ?? ''}` : (ch.warehouse?.name ?? '')}${transfer ? '' : ` · ${REASON_LABEL[ch.reason] ?? ch.reason}`}`}
        actions={
          <>
            <Menu
              items={[
                { label: `Journal ${ch.journal?.number ?? ''}`, icon: BookOpen, hidden: ch.journal === null || !seeBooks, onClick: () => navigate('journal', { id: ch.journal?.id ?? '' }) },
              ]}
            />
            {ch.can.void && (
              <PillButton variant="danger" icon={Ban} onClick={() => setVoiding(true)}>
                Void
              </PillButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          <RecordProposals match={(p) => p.target.entity === 'stock_changes' && p.target.id === ch.id} watch={['stock_changes']} />
          {isVoid && (
            <Notice tone="neutral" icon={Ban}>
              Voided. Its stock moves and its entry in the books were reversed.
            </Notice>
          )}
          <Card delay={1} className="!p-3 @min-[640px]:!p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 px-2 pb-3 pt-1 @min-[640px]:px-1">
              <div>
                <h2 className="text-[15px] font-bold">{transfer ? 'What moved' : ch.kind === 'count' ? 'What the count changed' : 'What changed'}</h2>
                <p className="text-[13px] text-[var(--erp-muted)]">{plural(rows.length, 'item')}</p>
              </div>
              {transfer && (
                <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                  <span className="truncate rounded-full bg-[var(--erp-row)] px-3 py-1.5">{ch.warehouse?.name}</span>
                  <ArrowRight size={15} className="shrink-0" aria-hidden />
                  <span className="erp-on-ink truncate rounded-full bg-[var(--erp-ink)] px-3 py-1.5 text-[var(--erp-shell)]">{ch.to_warehouse?.name}</span>
                </div>
              )}
            </div>
            <DataTable
              ariaLabel="Lines"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.key}
              onOpen={(r) => navigate('item', { id: r.item })}
              mobile={(r) => ({
                title: r.name,
                sub: transfer ? `${r.from} to ${r.to}` : `${r.sku} · ${r.from}`,
                right: `${transfer ? qty(r.qty) : signed(r.qty)} ${r.unit}`,
                rightSub: money(r.value, ch.currency),
              })}
              empty={<p className="px-3 py-4 text-[13px] text-[var(--erp-muted)]">No stock moved (the count matched).</p>}
              footer={!transfer && rows.length > 1 ? <TotalsRow cells={[{ label: 'Total value', value: money(ch.value, ch.currency) }]} /> : undefined}
            />
          </Card>

          {seeBooks && ch.journal !== null && (
            <Card delay={2}>
              <CardHeader
                title="In the books"
                subtitle={
                  <>
                    Journal{' '}
                    <TextLink onClick={() => navigate('journal', { id: ch.journal?.id ?? '' })}>
                      <span className="num">{ch.journal.number}</span>
                    </TextLink>
                  </>
                }
                icon={BookOpen}
              />
              {journal.data === null ? <Skeleton className="h-24" /> : <BooksDetail lines={lines} currency={ch.currency} open label="The entry it posted" />}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="dark" delay={1}>
            <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{transfer ? 'Stock value moved' : 'Value change'}</p>
            <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{transfer ? money(rows.reduce((s, r) => s + r.value, 0), ch.currency) : money(ch.value, ch.currency)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Items</span>
                <span className="num block text-[15px] font-bold">{rows.length}</span>
              </div>
              <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Units</span>
                <span className="num block text-[15px] font-bold">{qty(Math.round(units * 1000) / 1000)}</span>
              </div>
            </div>
            <dl className="mt-4 flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--erp-on-dark-muted)]">By</dt>
                <dd className="font-semibold">{ch.who}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--erp-on-dark-muted)]">Recorded</dt>
                <dd className="font-semibold">{ago(ch.created)}</dd>
              </div>
            </dl>
            {ch.note !== '' && <p className="mt-4 rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2.5 text-[13px] leading-5">{ch.note}</p>}
          </Card>
          <RecordActivity entity="stock_changes" refId={ch.id} />
        </div>
      </div>

      <ConfirmPosting
        open={voiding}
        onClose={() => setVoiding(false)}
        title={`Void ${ch.number}?`}
        verb="Void change"
        danger
        previewOp="stock.preview-void"
        runOp="stock.void-change"
        params={{ change: ch.id }}
        intro={<p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">The stock goes back to what it was before this change, and a reversing entry is posted. The change stays on record as void.</p>}
        onDone={() => live.reload()}
      />
    </div>
  );
}
