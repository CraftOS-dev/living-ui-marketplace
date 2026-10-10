/**
 * One stock count. Scan each item as it is counted (or type the number),
 * see what is left to count, then review the differences and complete the
 * count: every counted line sets the stock to what was counted, in one
 * change with Undo. A blind count keeps the expected numbers hidden until
 * the review.
 */
import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Ban, Check, ClipboardCheck, ClipboardX, EyeOff, History, Plus, RotateCcw, ScanBarcode, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Chips, Menu, ProgressRing, Stepper } from '../components/controls.tsx';
import { ItemSearch } from '../components/pickers.tsx';
import { Card, CardHeader, CircleButton, Empty, Modal, PillButton, StatusPill, TextLink, errMessage, pillInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { dayPhrase } from '../lib/dates.ts';
import { money, plain, plural, qty, signed } from '../lib/format.ts';
import { ItemThumb, kindIcon } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { back, navigate } from '../lib/router.ts';
import { useScanner } from '../lib/scanner.ts';
import { beep } from '../lib/sound.ts';
import type { CountLine, StockCount } from '../lib/types.ts';

type Filter = 'all' | 'todo' | 'done' | 'diff';

function LineRow({ line, editable, hidden }: { line: CountLine; editable: boolean; hidden: boolean }): React.JSX.Element {
  const set = (v: string): void => {
    api.setCountLine(line.id, { counted: v }).catch(() => undefined);
  };
  const diff = line.difference;
  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-[18px] p-3 transition-colors', line.counted_set ? 'bg-[var(--iv-row)]' : 'bg-[var(--iv-row)]/50')}>
      <button type="button" onClick={() => navigate('item', { id: line.item.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <ItemThumb photo={line.item.photo} icon={line.item.icon} size={40} tone="card" rounded="rounded-[12px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{line.item.name}</span>
          <span className="block truncate text-[12px] text-[var(--iv-muted)]">
            {line.item.sku} · {hidden ? 'expected hidden' : `expected ${qty(line.expected ?? 0)} ${line.item.unit}`}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-2">
        {!hidden && line.counted_set && diff !== null && (
          <span
            className={cn(
              'num inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-bold',
              diff === 0 ? 'bg-[var(--iv-green)]/15 text-[var(--iv-green-text)]' : diff < 0 ? 'bg-[var(--iv-red)]/15 text-[var(--iv-red-text)]' : 'bg-[var(--iv-amber)]/25 text-[var(--iv-amber-text)]',
            )}
          >
            {diff === 0 ? 'Matches' : signed(diff)}
          </span>
        )}
        {editable ? (
          <>
            <Stepper size="sm" value={line.counted_set ? plain(line.counted ?? 0) : ''} onChange={set} fractional={line.item.fractional === true} min={0} ariaLabel={`${line.item.name} counted`} />
            {line.counted_set ? (
              <CircleButton icon={X} label={`Not counted: ${line.item.name}`} variant="light" size={32} onClick={() => void api.setCountLine(line.id, { clear: true }).catch(() => undefined)} />
            ) : (
              <button type="button" onClick={() => set(plain(line.expected ?? 0))} disabled={hidden} className={cn('h-8 rounded-full bg-[var(--iv-card)] px-3 text-[12px] font-bold hover:bg-[var(--iv-row-hover)]', hidden && 'hidden')}>
                Matches
              </button>
            )}
          </>
        ) : (
          <span className="num w-20 text-right text-[14px] font-bold">{line.counted_set ? qty(line.counted ?? 0) : 'Not counted'}</span>
        )}
      </div>
    </li>
  );
}

function Review({ count, onClose }: { count: StockCount; onClose: () => void }): React.JSX.Element {
  const { currency } = useApp();
  const rev = useLive(() => api.count(count.id, true), ['count_lines', 'stock'], [count.id]);
  const [uncounted, setUncounted] = useState<'keep' | 'zero'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = rev.data;
  const diffs = (data?.lines ?? []).filter((l) => l.counted_set && l.difference !== null && l.difference !== 0);
  const notCounted = (data?.lines ?? []).filter((l) => !l.counted_set);
  const complete = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.completeCount(count.id, uncounted);
      onClose();
      toast.success(r.summary !== null && r.summary.changed > 0 ? `Count complete: ${plural(r.summary.changed, 'item')} adjusted` : 'Count complete: everything matched');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Review ${count.number}`}
      description="Completing sets each counted line's stock to what was counted. It can be undone from the history."
      xl
      footer={
        <>
          <PillButton variant="light" onClick={onClose}>
            Keep counting
          </PillButton>
          <PillButton variant="dark" icon={ClipboardCheck} loading={busy} disabled={data === null} onClick={() => void complete()}>
            Complete count
          </PillButton>
        </>
      }
    >
      {data === null ? (
        <span className="block h-40 animate-pulse rounded-[20px] bg-[var(--iv-row)]" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[18px] bg-[var(--iv-row)] p-3">
              <span className="block text-[12px] text-[var(--iv-muted)]">Counted</span>
              <span className="num block text-[15px] font-bold">
                {data.counted} of {data.line_count}
              </span>
            </div>
            <div className="rounded-[18px] bg-[var(--iv-row)] p-3">
              <span className="block text-[12px] text-[var(--iv-muted)]">Different</span>
              <span className="num block text-[15px] font-bold">{plural(diffs.length, 'item')}</span>
            </div>
            <div className="rounded-[18px] bg-[var(--iv-row)] p-3">
              <span className="block text-[12px] text-[var(--iv-muted)]">Value change</span>
              <span className="num block text-[15px] font-bold">{data.differences !== null ? money(data.differences.value, currency) : '-'}</span>
            </div>
          </div>
          {diffs.length > 0 ? (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {diffs.map((l) => (
                <li key={l.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2">
                  <ItemThumb photo={l.item.photo} icon={l.item.icon} size={34} tone="card" rounded="rounded-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{l.item.name}</span>
                    <span className="block truncate text-[12px] text-[var(--iv-muted)]">{l.location.path}</span>
                  </span>
                  <span className="num text-[13px]">
                    {qty(l.expected ?? 0)} <span className="text-[var(--iv-muted)]">to</span> <span className="font-bold">{qty(l.counted ?? 0)}</span>
                  </span>
                  <span className={cn('num w-16 text-right text-[13px] font-bold', (l.difference ?? 0) < 0 ? 'text-[var(--iv-red-text)]' : '')}>{signed(l.difference ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[18px] bg-[var(--iv-row)] px-4 py-3 text-[13px]">Everything counted matches what was expected.</p>
          )}
          {notCounted.length > 0 && (
            <div className="rounded-[20px] bg-[var(--iv-row)] p-4">
              <p className="text-[13px] font-bold">{plural(notCounted.length, 'line')} not counted</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {(
                  [
                    { v: 'keep', t: 'Leave them as they are', d: 'Their stock does not change.' },
                    { v: 'zero', t: 'Set them to zero', d: 'They were looked for and not there.' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    role="radio"
                    aria-checked={uncounted === o.v}
                    onClick={() => setUncounted(o.v)}
                    className={cn('flex-1 rounded-[16px] p-3 text-left transition-colors', uncounted === o.v ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-card)] hover:bg-[var(--iv-row-hover)]')}
                  >
                    <span className="block text-[13px] font-bold">{o.t}</span>
                    <span className={cn('block text-[12px]', uncounted === o.v ? 'opacity-80' : 'text-[var(--iv-muted)]')}>{o.d}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {error !== null && <p className="text-[13px] font-semibold text-[var(--iv-red-text)]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

export function CountPage({ id }: { id: string }): React.JSX.Element {
  const live = useLive(() => api.count(id), ['counts', 'count_lines', 'items'], [id]);
  const c = live.data;
  const [filter, setFilter] = useState<Filter>('all');
  const [at, setAt] = useState('');
  const [code, setCode] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const counting = c?.status === 'counting';

  const places = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; path: string }>();
    for (const l of c?.lines ?? []) if (!seen.has(l.location.id)) seen.set(l.location.id, l.location);
    return [...seen.values()];
  }, [c?.lines]);

  const scan = useCallback(
    async (raw: string) => {
      const v = raw.trim();
      if (v === '' || c === null || !counting) return;
      setCode('');
      try {
        const r = await api.scanCount(c.id, v, at !== '' ? at : undefined);
        beep('ok');
        setMiss(null);
        setLast(r.scanned !== undefined ? r.scanned.item.name : null);
      } catch (err) {
        beep('miss');
        setMiss(errMessage(err));
      }
    },
    [c, counting, at],
  );
  useScanner((v) => void scan(v), counting);

  if (c === null) {
    return live.error !== null ? (
      <Card>
        <Empty icon={ClipboardX} title="This count is gone" action={<PillButton variant="dark" onClick={() => navigate('counts')}>Back to counts</PillButton>}>
          It may have been deleted.
        </Empty>
      </Card>
    ) : (
      <span className="block h-72 animate-pulse rounded-[24px] bg-[var(--iv-dark)]" />
    );
  }

  const lines = c.lines.filter((l) =>
    filter === 'todo' ? !l.counted_set : filter === 'done' ? l.counted_set : filter === 'diff' ? l.counted_set && (l.difference ?? 0) !== 0 : true,
  );
  const groups = new Map<string, CountLine[]>();
  for (const l of lines) {
    const g = groups.get(l.location.id) ?? [];
    g.push(l);
    groups.set(l.location.id, g);
  }
  const act = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
    } catch {
      /* toasted */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(c.status === 'completed' ? 'The count is deleted. The stock changes it made stay in the history.' : 'The count and what was counted so far are deleted. Stock does not change.', 'Delete this count?'))) return;
    await act(() => api.deleteCount(c.id), 'Deleted');
    navigate('counts');
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="iv-rise flex flex-wrap items-center gap-4">
        <CircleButton icon={ArrowLeft} label="Back" size={44} onClick={() => back('counts')} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-3 text-[26px] font-bold leading-[34px] tracking-[-0.01em]">
            {c.number}
            <StatusPill tone={counting ? 'warn' : c.status === 'completed' ? 'good' : 'neutral'}>{counting ? 'Counting' : c.status === 'completed' ? 'Done' : 'Cancelled'}</StatusPill>
            {c.blind && counting && (
              <StatusPill tone="neutral">
                <EyeOff size={12} aria-hidden /> Blind
              </StatusPill>
            )}
          </h1>
          <p className="truncate text-[13px] text-[var(--iv-muted)]">
            {c.location?.path ?? 'Everything'}
            {c.completed_on !== '' ? ` · completed ${dayPhrase(c.completed_on)}` : ''}
            {c.note !== '' ? ` · ${c.note}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counting && (
            <PillButton variant="dark" icon={Check} dot onClick={() => setReviewing(true)}>
              Review and finish
            </PillButton>
          )}
          {!counting && (
            <PillButton variant="light" icon={RotateCcw} onClick={() => void act(() => api.reopenCount(c.id), c.status === 'completed' ? 'Reopened: its adjustments were undone' : 'Reopened')}>
              Reopen
            </PillButton>
          )}
          <Menu
            items={[
              { label: 'Its changes in the history', icon: History, hidden: c.batch === '', onClick: () => navigate('activity', { batch: c.batch }) },
              { label: 'Cancel the count', icon: Ban, hidden: !counting, onClick: () => void act(() => api.cancelCount(c.id), 'Cancelled') },
              { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove() },
            ]}
          />
        </div>
      </header>

      {c.status === 'completed' && c.summary !== null && (
        <Card tone="sand" className="flex flex-wrap items-center gap-6" delay={1}>
          <div>
            <p className="text-[12px] text-[var(--iv-muted)]">Adjusted</p>
            <p className="num text-[26px] font-extrabold leading-8">{plural(c.summary.changed, 'item')}</p>
          </div>
          <div>
            <p className="text-[12px] text-[var(--iv-muted)]">Units</p>
            <p className="num text-[15px] font-bold">{signed(c.summary.units)}</p>
          </div>
          <div>
            <p className="text-[12px] text-[var(--iv-muted)]">Value</p>
            <p className="num text-[15px] font-bold">{c.summary.value_text !== '' ? money(c.summary.value, c.currency) : '-'}</p>
          </div>
          <div>
            <p className="text-[12px] text-[var(--iv-muted)]">Counted</p>
            <p className="num text-[15px] font-bold">
              {c.summary.counted} of {c.summary.lines}
            </p>
          </div>
        </Card>
      )}

      {counting && (
        <Card tone="dark" delay={1}>
          <div className="flex flex-wrap items-center gap-5">
            <ProgressRing value={c.progress} size={72} dark>
              {c.counted}/{c.line_count}
            </ProgressRing>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <ScanBarcode size={18} aria-hidden /> Scan each item as you count it
              </p>
              <p className={cn('mt-1 text-[13px]', miss !== null ? 'iv-shake font-semibold text-[var(--iv-red-on-dark)]' : 'text-[var(--iv-on-dark-muted)]')} aria-live="polite">
                {miss ?? (last !== null ? `Counted one more ${last}` : 'Each scan adds one. Or type the number on each line.')}
              </p>
            </div>
            <div className="flex w-full gap-2 md:w-72">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void scan(code);
                  }
                }}
                placeholder="Or type a code"
                aria-label="Code"
                className={cn(pillInput, 'num iv-on-card')}
              />
            </div>
          </div>
          {places.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-[var(--iv-on-dark-muted)]">Scans count at</span>
              {[{ id: '', name: 'Where the item is listed', path: '' }, ...places].map((p) => {
                const Icon = kindIcon(undefined);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={at === p.id}
                    onClick={() => setAt(p.id)}
                    className={cn('inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold', at === p.id ? 'bg-[var(--iv-accent)] text-[var(--iv-on-accent)]' : 'bg-[var(--iv-dark-2)] text-[var(--iv-on-dark)]')}
                  >
                    {p.id !== '' && <Icon size={13} aria-hidden />}
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips
          ariaLabel="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: c.line_count },
            { value: 'todo', label: 'Not counted', count: c.line_count - c.counted },
            { value: 'done', label: 'Counted', count: c.counted },
            ...(c.hidden ? [] : [{ value: 'diff' as Filter, label: 'Different', count: c.differences?.lines ?? 0 }]),
          ]}
        />
        {counting && (
          <PillButton variant="light" icon={Plus} onClick={() => setAdding(true)}>
            Found something else
          </PillButton>
        )}
      </div>

      {c.lines.length === 0 ? (
        <Card>
          <Empty icon={ClipboardCheck} title="Nothing expected here" action={counting ? <PillButton variant="dark" icon={Plus} dot onClick={() => setAdding(true)}>Add what you find</PillButton> : undefined}>
            The app has no stock recorded in this place. Scan or add whatever is really there.
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([locId, ls], i) => {
            const loc = ls[0]?.location;
            return (
              <Card key={locId} delay={Math.min(5, i + 2)}>
                <CardHeader title={loc?.name ?? ''} subtitle={loc?.path} action={<span className="num text-[12px] text-[var(--iv-muted)]">{ls.filter((l) => l.counted_set).length}/{ls.length}</span>} />
                <ul className="flex flex-col gap-2">
                  {ls.map((l) => (
                    <LineRow key={l.id} line={l} editable={counting} hidden={c.hidden} />
                  ))}
                </ul>
              </Card>
            );
          })}
          {lines.length === 0 && <p className="text-center text-[13px] text-[var(--iv-muted)]">Nothing in this view. <TextLink tone="muted" onClick={() => setFilter('all')}>Show all</TextLink></p>}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Found something else" description={at !== '' || c.location !== null ? 'It is added to this count where scans count.' : "It is added at the item's home place."} wide>
        <ItemSearch
          autoFocus
          scanning={false}
          onPick={(it) => {
            setAdding(false);
            void act(() => api.addCountItem(c.id, it.id, at !== '' ? at : (c.location?.id ?? undefined)), `Added ${it.name}`);
          }}
        />
      </Modal>
      {reviewing && <Review count={c} onClose={() => setReviewing(false)} />}
      {confirmEl}
    </div>
  );
}
