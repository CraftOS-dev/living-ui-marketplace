/**
 * One journal entry: what it says, the record it came from, each line
 * (account, debit, credit) with totals, and its reversal. Entries are never
 * edited: a correction reverses them.
 */
import { useState } from 'react';
import { ArrowUpRight, Undo2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { ConfirmPosting } from '../../components/Books.tsx';
import { CodeChip } from '../../components/money/bits.tsx';
import { journalKind, openSource } from '../../components/money/labels.ts';
import { ActorPill, Card, CardHeader, LoadError, Notice, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, dayPhrase, today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { back, navigate } from '../../lib/router.ts';
import type { Journal } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

/** "today", "yesterday" or "on Thu, Oct 15". */
function whenPhrase(day: string): string {
  const p = dayPhrase(day);
  return p === 'today' || p === 'yesterday' ? p : `on ${p}`;
}

export function JournalPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const data = useLive(() => op<Journal>('journals.get', { journal: id }, { quiet: true }), READS.books, [id]);
  const j = data.data;
  const otherId = j !== null ? (j.reversed_by !== '' ? j.reversed_by : j.reverses) : '';
  const other = useLive(() => (otherId === '' ? Promise.resolve(null) : op<Journal>('journals.get', { journal: otherId }, { quiet: true }).catch(() => null)), ['journals'], [otherId]);
  const [reversing, setReversing] = useState(false);

  if (data.error !== null && j === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (j === null) return <PageSkeleton />;

  const lines = j.lines ?? [];
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  const go = openSource(j.source.entity, j.source.id);
  const o = other.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={() => back('journals')}
        eyebrow={
          <>
            <span>{journalKind(j.kind)}</span>
            {j.state === 'reversed' && (
              <StatusPill tone="neutral" size="sm">
                Reversed
              </StatusPill>
            )}
            {j.actor === 'agent' && <ActorPill actor="agent" />}
          </>
        }
        title={j.number}
        subtitle={`${dayLabel(j.date)} · ${money(j.total, j.currency)}`}
        actions={
          <>
            {go !== null && j.source.label !== '' && (
              <PillButton variant="light" icon={ArrowUpRight} onClick={go}>
                Open {j.source.label}
              </PillButton>
            )}
            {j.can?.reverse === true && (
              <PillButton variant="light" icon={Undo2} onClick={() => setReversing(true)}>
                Reverse
              </PillButton>
            )}
          </>
        }
      />

      {j.state === 'reversed' && (
        <Notice tone="neutral" icon={Undo2} action={o !== null && o !== undefined ? <TextLink onClick={() => navigate('journal', { id: o.id })}>Open {o.number}</TextLink> : undefined}>
          Reversed{o !== null && o !== undefined ? ` by ${o.number} ${whenPhrase(o.date)}` : ''}. The two together leave the books as they were.
        </Notice>
      )}
      {j.reverses !== '' && (
        <Notice tone="warn" icon={Undo2} action={o !== null && o !== undefined ? <TextLink onClick={() => navigate('journal', { id: o.id })}>Open {o.number}</TextLink> : undefined}>
          This entry reverses {o !== null && o !== undefined ? o.number : 'another entry'}.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title={j.memo !== '' ? j.memo : journalKind(j.kind)} subtitle={j.source.label !== '' ? `From ${j.source.label}` : 'Made by hand'} />
          <ul className="flex flex-col gap-1.5 @min-[640px]:hidden">
            {lines.map((l, i) => (
              <li key={i}>
                <button type="button" onClick={() => navigate('account', { id: l.account?.id ?? '' })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-left">
                  <CodeChip code={l.account?.code ?? '?'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{l.account?.name ?? 'Missing account'}</span>
                    {(l.party !== null || l.memo !== '') && <span className="block truncate text-[12px] text-[var(--erp-muted)]">{[l.party?.name ?? '', l.memo].filter((x) => x !== '').join(' · ')}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[14px] font-bold">{money(l.debit !== 0 ? l.debit : l.credit, j.currency)}</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">{l.debit !== 0 ? 'Debit' : 'Credit'}</span>
                  </span>
                </button>
              </li>
            ))}
            <li className="flex items-center justify-between px-3 pt-2 text-[14px] font-bold">
              <span>Total</span>
              <span className="num">{money(dr, j.currency)}</span>
            </li>
          </ul>
          <div className="hidden @min-[640px]:block">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] font-semibold text-[var(--erp-muted)]">
                  <th className="px-3 pb-2 font-semibold">Account</th>
                  <th className="px-3 pb-2 text-right font-semibold">Debit</th>
                  <th className="px-3 pb-2 text-right font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="align-top">
                    <td className="rounded-l-[14px] px-3 py-2.5">
                      <button type="button" onClick={() => navigate('account', { id: l.account?.id ?? '' })} className={cn('flex items-center gap-2 text-left hover:underline', l.credit > 0 && '@min-[640px]:ml-8')}>
                        <CodeChip code={l.account?.code ?? '?'} />
                        <span className="font-semibold">{l.account?.name ?? 'Missing account'}</span>
                      </button>
                      {(l.party !== null || l.memo !== '') && (
                        <span className={cn('mt-0.5 block pl-1 text-[12px] text-[var(--erp-muted)]', l.credit > 0 && '@min-[640px]:ml-8')}>
                          {l.party !== null && (
                            <button type="button" onClick={() => navigate('party', { id: l.party?.id ?? '' })} className="font-semibold hover:underline">
                              {l.party.name}
                            </button>
                          )}
                          {l.party !== null && l.memo !== '' ? ' · ' : ''}
                          {l.memo}
                          {l.currency !== '' && l.currency !== j.currency && l.amount_cur !== 0 ? ` · ${money(Math.abs(l.amount_cur), l.currency)}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="num px-3 py-2.5 text-right">{l.debit !== 0 ? money(l.debit, j.currency) : ''}</td>
                    <td className="num rounded-r-[14px] px-3 py-2.5 text-right">{l.credit !== 0 ? money(l.credit, j.currency) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--erp-line)] font-bold">
                  <td className="px-3 pt-3">Total</td>
                  <td className="num px-3 pt-3 text-right">{money(dr, j.currency)}</td>
                  <td className="num px-3 pt-3 text-right">{money(cr, j.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="sand" delay={2}>
            <dl className="flex flex-col gap-3 text-[13px]">
              <Fact label="Date in the books" value={dayLabel(j.date)} />
              <Fact label="Kind" value={journalKind(j.kind)} />
              <Fact label="Amount" value={money(j.total, j.currency)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--erp-muted)]">Made by</dt>
                <dd>{j.actor === 'agent' ? <ActorPill actor="agent" /> : <span className="font-semibold">{j.who !== '' ? j.who : 'The app'}</span>}</dd>
              </div>
              {j.approved_by !== '' && <Fact label="Approved by" value={j.approved_by} />}
            </dl>
          </Card>
          <RecordActivity entity="journals" refId={j.id} />
        </div>
      </div>

      <ConfirmPosting
        open={reversing}
        onClose={() => setReversing(false)}
        title={`Reverse ${j.number}`}
        verb="Post the reversal"
        previewOp="journals.preview-reverse"
        runOp="journals.reverse"
        params={{ journal: j.id }}
        withDate
        defaultDate={today()}
        intro={<p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">A new entry with every line swapped cancels this one. Both stay in the books, so the history is kept.</p>}
        onDone={(r) => {
          const rev = r as Journal;
          toast.success(`${rev.number} posted`);
          data.reload();
        }}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--erp-muted)]">{label}</dt>
      <dd className="num text-right font-semibold">{value}</dd>
    </div>
  );
}
