/**
 * The chart of accounts: every place the books post to, grouped by kind
 * (what the business owns, owes, the owners' share, money earned, money
 * spent) with the accounting word beside it, each with its balance as of a
 * day. Control accounts (moved only by their documents) and the accounts
 * the app uses are marked. Search, show archived, add or change accounts.
 */
import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Landmark, Lock, Plus, Settings2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AccountModal } from '../../components/books/AccountModal.tsx';
import { SearchBox, useDebounced } from '../../components/controls.tsx';
import { CodeChip } from '../../components/money/bits.tsx';
import { TYPE_WORDS, subtypeLabel } from '../../components/money/labels.ts';
import { DateField } from '../../components/pickers.tsx';
import { Card, Empty, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, Toggle } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Account, AccountList, AccountType } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

const ORDER: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
const ARTICLE: Record<AccountType, string> = { asset: 'an asset', liability: 'a liability', equity: 'an equity', income: 'an income', expense: 'an expense' };

export function AccountsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const [q, setQ] = useState(query.get('q') ?? '');
  const dq = useDebounced(q, 200);
  const [date, setDate] = useState(query.get('date') ?? today());
  const [archived, setArchived] = useState(false);
  const [closed, setClosed] = useState<Set<AccountType>>(new Set());
  const [adding, setAdding] = useState<AccountType | null>(query.get('new') !== null ? 'expense' : null);
  const canEdit = can(me, 'accounting', 'edit');
  const data = useLive(() => op<AccountList>('accounts.list', { archived, date }, { quiet: true }), READS.books, [archived, date]);

  const groups = useMemo(() => {
    const list = data.data?.accounts ?? [];
    const needle = dq.trim().toLowerCase();
    const match = (a: Account): boolean => needle === '' || `${a.code} ${a.name} ${subtypeLabel(a.subtype)}`.toLowerCase().includes(needle);
    return ORDER.map((t) => {
      const all = list.filter((a) => a.type === t);
      const shown = all.filter(match);
      // Children right under their parent, one level in.
      const roots = shown.filter((a) => a.parent === '' || !shown.some((p) => p.id === a.parent));
      const rows: { a: Account; depth: number }[] = [];
      const add = (a: Account, depth: number): void => {
        rows.push({ a, depth });
        for (const c of shown.filter((x) => x.parent === a.id)) add(c, depth + 1);
      };
      for (const r of roots) add(r, 0);
      return { type: t, rows, total: all.reduce((s, a) => s + (a.balance ?? 0), 0) };
    });
  }, [data.data, dq]);

  if (data.error !== null && data.data === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null) return <PageSkeleton rows={10} />;

  const toggle = (t: AccountType): void => {
    const next = new Set(closed);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setClosed(next);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Chart of accounts"
        subtitle="Every place the books post to, and what is in each"
        actions={
          canEdit ? (
            <PillButton icon={Plus} dot onClick={() => setAdding('expense')}>
              Add account
            </PillButton>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:justify-between">
        <SearchBox value={q} onChange={setQ} placeholder="Search code or name" ariaLabel="Search accounts" className="w-full @min-[640px]:w-80" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold text-[var(--erp-ink-2)]">Balances on</span>
          <DateField value={date} onChange={(d) => setDate(d === '' ? today() : d)} ariaLabel="Balances on" className="w-44 [&_button]:bg-[var(--erp-card)]" align="right" />
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--erp-ink-2)]">Archived</span>
            <Toggle checked={archived} onChange={setArchived} label="Show archived accounts" />
          </span>
        </div>
      </div>

      {groups.every((g) => g.rows.length === 0) ? (
        <Card>
          <Empty icon={BookOpen} title="No accounts match">
            Try another search.
          </Empty>
        </Card>
      ) : (
        groups.map((g, i) => {
          if (g.rows.length === 0) return null;
          const words = TYPE_WORDS[g.type];
          const open = !closed.has(g.type);
          return (
            <Card key={g.type} delay={Math.min(5, i + 1)} padded={false}>
              <button type="button" onClick={() => toggle(g.type)} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left @min-[640px]:px-6">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[15px] font-bold">{words?.plain}</span>
                    <span className="text-[13px] font-semibold text-[var(--erp-muted)]">{words?.term}</span>
                  </span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">{words?.hint}</span>
                </span>
                <span className="num shrink-0 text-[15px] font-extrabold">{money(g.total, base)}</span>
                <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-[var(--erp-muted)] transition-transform', open && 'rotate-180')} />
              </button>
              {open && (
                <ul className="flex flex-col gap-0.5 px-3 pb-3 @min-[640px]:px-4 @min-[640px]:pb-4">
                  {g.rows.map(({ a, depth }) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => navigate('account', { id: a.id })}
                        className={cn('flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors hover:bg-[var(--erp-row)] @min-[640px]:px-3', a.archived && 'text-[var(--erp-muted)]')}
                        style={{ paddingLeft: depth > 0 ? 12 + depth * 24 : undefined }}
                      >
                        <CodeChip code={a.code} />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[14px] font-semibold">{a.name}</span>
                            {a.control && (
                              <span title="Moved only by its documents (invoices, bills, stock)" className="hidden shrink-0 @min-[480px]:inline-flex">
                                <StatusPill tone="neutral" size="sm">
                                  <Lock size={11} aria-hidden /> By documents
                                </StatusPill>
                              </span>
                            )}
                            {!a.control && a.system_key !== '' && (
                              <span title="The app posts here automatically" className="hidden shrink-0 text-[var(--erp-muted)] @min-[640px]:inline-flex">
                                <Settings2 size={13} aria-label="Used by the app" />
                              </span>
                            )}
                            {a.bank !== undefined && a.bank !== '' && <Landmark size={13} aria-label="Bank account" className="shrink-0 text-[var(--erp-muted)]" />}
                            {a.archived && (
                              <StatusPill tone="neutral" size="sm">
                                Archived
                              </StatusPill>
                            )}
                          </span>
                          <span className="block truncate text-[12px] text-[var(--erp-muted)]">{subtypeLabel(a.subtype)}</span>
                        </span>
                        <span className={cn('num shrink-0 text-[14px] font-bold', (a.balance ?? 0) === 0 && 'font-semibold text-[var(--erp-muted)]', (a.balance ?? 0) < 0 && 'text-[var(--erp-red-text)]')}>{money(a.balance ?? 0, base)}</span>
                      </button>
                    </li>
                  ))}
                  {canEdit && (
                    <li>
                      <button type="button" onClick={() => setAdding(g.type)} className="mt-1 inline-flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]">
                        <Plus size={14} aria-hidden /> Add {ARTICLE[g.type]} account
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </Card>
          );
        })
      )}

      <AccountModal
        open={adding !== null}
        onClose={() => {
          setAdding(null);
          if (query.get('new') !== null) replaceQuery('accounts', {});
        }}
        accounts={data.data.accounts}
        subtypes={data.data.subtypes}
        initialType={adding ?? undefined}
        onDone={(a) => {
          data.reload();
          navigate('account', { id: a.id });
        }}
      />
    </div>
  );
}
