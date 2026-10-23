/**
 * Journal entries: every posting in the books, from documents, payments,
 * the bank, payroll, depreciation, and the entries made by hand. Filter by
 * kind and day, find by number or memo; each opens its entry and source.
 * "New journal entry" (?new=1) opens the full-screen editor.
 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Undo2 } from 'lucide-react';
import { JournalEditor } from '../../components/books/JournalEditor.tsx';
import { Chips, SearchBox, useDebounced } from '../../components/controls.tsx';
import { useFullScreen } from '../../components/FullScreen.tsx';
import { journalKind, openSource } from '../../components/money/labels.ts';
import { DateField } from '../../components/pickers.tsx';
import { DataTable, Pager } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { ActorPill, Card, Empty, LoadError, PageHeader, PillButton, StatusPill, TextLink, Toggle } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Journal, JournalList } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 50;
const KINDS = ['', 'manual', 'invoice', 'bill', 'payment_in', 'payment_out', 'bank_entry', 'transfer', 'depreciation', 'payroll', 'claim', 'stock_change', 'opening', 'reversal'];

export function JournalsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const kindQ = query.get('kind') ?? '';
  const kind = KINDS.includes(kindQ) ? kindQ : '';
  const [q, setQ] = useState(query.get('q') ?? '');
  const dq = useDebounced(q, 250);
  const [from, setFrom] = useState(query.get('from') ?? '');
  const [to, setTo] = useState(query.get('to') ?? '');
  const [agent, setAgent] = useState(query.get('agent') === '1');
  const [offset, setOffset] = useState(0);
  const canPost = can(me, 'accounting', 'full');

  const fs = useFullScreen(() => {
    if (query.get('new') !== null && window.location.hash.startsWith('#/journals')) replaceQuery('journals', { kind: kind === '' ? undefined : kind });
  });
  const opened = useRef(false);
  const newQ = query.get('new');
  useEffect(() => {
    if (newQ !== null && canPost && !opened.current) {
      opened.current = true;
      fs.open(null);
    }
    if (newQ === null) opened.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newQ]);

  useEffect(() => setOffset(0), [kind, dq, from, to, agent]);
  const data = useLive(
    () => op<JournalList>('journals.list', { kind: kind === '' ? undefined : kind, q: dq === '' ? undefined : dq, from: from === '' ? undefined : from, to: to === '' ? undefined : to, agent: agent ? true : undefined, limit: LIMIT, offset }, { quiet: true }),
    READS.books,
    [kind, dq, from, to, agent, offset],
  );

  const columns: Column<Journal>[] = [
    {
      key: 'number',
      label: 'Entry',
      width: '120px',
      render: (j) => (
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="num font-bold">{j.number}</span>
          {j.state === 'reversed' ? (
            <StatusPill tone="neutral" size="sm">
              Reversed
            </StatusPill>
          ) : j.kind === 'reversal' ? (
            <StatusPill tone="warn" size="sm">
              Reversal
            </StatusPill>
          ) : j.actor === 'agent' ? (
            <ActorPill actor="agent" />
          ) : null}
        </span>
      ),
    },
    { key: 'date', label: 'Date', width: '110px', render: (j) => <span className="text-[13px] text-[var(--erp-ink-2)]">{dayLabel(j.date)}</span> },
    { key: 'kind', label: 'Kind', width: '120px', hide: 'lg', render: (j) => <span className="text-[13px] font-semibold text-[var(--erp-ink-2)]">{journalKind(j.kind)}</span> },
    {
      key: 'what',
      label: 'What',
      width: 'minmax(220px, 3fr)',
      render: (j) => {
        const go = openSource(j.source.entity, j.source.id);
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-semibold">{j.memo !== '' ? j.memo : journalKind(j.kind)}</span>
            {j.source.label !== '' && go !== null ? (
              <TextLink tone="muted" onClick={go} className="max-w-full text-[12px]">
                <span className="truncate">{j.source.label}</span>
              </TextLink>
            ) : null}
          </span>
        );
      },
    },
    { key: 'total', label: 'Amount', align: 'right', width: '120px', render: (j) => <span className="font-bold">{money(j.total, base)}</span> },
    { key: 'who', label: 'By', width: '120px', hide: 'xl', render: (j) => (j.actor === 'agent' ? <span className="text-[13px] text-[var(--erp-ink-2)]">Your AI agent</span> : <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{j.who !== '' ? j.who : 'The app'}</span>) },
  ];

  const list = data.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Journal entries"
        subtitle="Every posting in the books: documents, payments, the bank, and entries made by hand"
        actions={
          canPost ? (
            <PillButton icon={Plus} dot onClick={(e) => fs.open(e.currentTarget)}>
              New journal entry
            </PillButton>
          ) : undefined
        }
      />

      <Chips
        ariaLabel="Kind"
        value={kind}
        onChange={(k) => replaceQuery('journals', { kind: k === '' ? undefined : k })}
        options={KINDS.map((k) => ({ value: k, label: k === '' ? 'All' : journalKind(k), icon: k === 'reversal' ? Undo2 : undefined }))}
      />
      <div className="flex flex-col gap-3 @min-[900px]:flex-row @min-[900px]:items-center @min-[900px]:justify-between">
        <SearchBox value={q} onChange={setQ} placeholder="Search number, memo, source" ariaLabel="Search journal entries" className="w-full @min-[900px]:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <DateField value={from} onChange={setFrom} ariaLabel="From" optional placeholder="From any day" max={to !== '' ? to : undefined} className="w-44 [&>button]:bg-[var(--erp-card)]" />
          <DateField value={to} onChange={setTo} ariaLabel="To" optional placeholder="To today" min={from !== '' ? from : undefined} className="w-44 [&>button]:bg-[var(--erp-card)]" align="right" />
          <span className="flex items-center gap-2 pl-1">
            <span className="text-[13px] font-semibold text-[var(--erp-ink-2)]">By your AI agent</span>
            <Toggle checked={agent} onChange={setAgent} label="Only entries by your AI agent" />
          </span>
        </div>
      </div>

      {data.error !== null && list === null ? (
        <LoadError message={data.error} onRetry={data.reload} />
      ) : (
        <Card delay={1}>
          <DataTable
            ariaLabel="Journal entries"
            rows={list?.journals ?? []}
            columns={columns}
            rowKey={(j) => j.id}
            loading={data.loading}
            onOpen={(j) => navigate('journal', { id: j.id })}
            rowTone={(j) => (j.state === 'reversed' ? 'muted' : undefined)}
            mobile={(j) => ({
              title: j.memo !== '' ? j.memo : journalKind(j.kind),
              sub: `${j.number} · ${dayLabel(j.date)} · ${journalKind(j.kind)}`,
              right: money(j.total, base),
              rightSub: j.state === 'reversed' ? 'Reversed' : j.actor === 'agent' ? 'Your AI agent' : undefined,
            })}
            empty={
              <Empty icon={BookOpen} title="No entries match" action={canPost && kind === 'manual' ? <PillButton icon={Plus} dot onClick={(e) => fs.open(e.currentTarget)}>New journal entry</PillButton> : undefined}>
                Try another kind, day or search.
              </Empty>
            }
          />
          {list !== null && <Pager offset={offset} limit={LIMIT} total={list.total} onChange={setOffset} />}
        </Card>
      )}

      {fs.node(<JournalEditor onClose={fs.close} />, { title: 'New journal entry' })}
    </div>
  );
}
