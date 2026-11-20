/**
 * The Inbox (SPEC 3, 7.6): a strip of what waits (Ready to decide "4 deals",
 * Replies overdue "1 reply", Typical reply "43 days"; each label above its
 * figure, a hairline between them), then New / Waiting / Held as
 * a list on the left (company, received day, its one line, one thesis chip
 * and "+1", a StepTrack while your AI agent reads) and the selected deal's
 * card on the right, read top to bottom, with Advance / Pass / Hold in a bar
 * at its bottom (keys A, P, H; J and K move). Bulk select, then Pass. On a
 * phone the list and the card take turns.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox as InboxIcon, Plus, X } from 'lucide-react';
import { Clock } from 'lucide-react';
import { Button, Checkbox, ChipPicker, Empty, IconButton, LoadError, PageBody, PageHeader, Panel, SearchInput, Segmented, Skeleton, StatusDot, StepTrack, Tag, Tip } from '../../components/ui.tsx';
import type { Tone } from '../../components/ui.tsx';
import { CompanyLogo } from '../../components/portfolio/Logo.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { fmtDay, plural } from '../../lib/format.ts';
import { act, drop, useOp } from '../../lib/live.ts';
import { href, setQuery, useRoute } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { openAddDeal } from '../../components/intake/addDeal.tsx';
import { DeckSheet } from '../../components/intake/DeckPage.tsx';
import { ItemCard } from '../../components/intake/ItemCard.tsx';
import { INTAKE_READS } from '../../components/intake/types.ts';
import type { FitOut, ListOut, MailState, Row, Segment, Stats } from '../../components/intake/types.ts';

const PAGE = 50;

function useWide(): boolean {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = (): void => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

const MAIL: Record<MailState, { tone: 'faint' | 'neutral' | 'good' | 'bad'; label: string; pulse?: boolean }> = {
  waiting: { tone: 'faint', label: 'Drafting', pulse: true },
  draft: { tone: 'neutral', label: 'Draft' },
  approved: { tone: 'neutral', label: 'Sending', pulse: true },
  sent: { tone: 'good', label: 'Sent' },
  failed: { tone: 'bad', label: 'Not sent' },
  cancelled: { tone: 'faint', label: 'Cancelled' },
  none: { tone: 'faint', label: 'No email' },
};

const FIT_RANK: Record<string, number> = { met: 0, unknown: 1, unmet: 2 };
const FIT_TONE: Record<string, Tone> = { met: 'good', unknown: 'faint', unmet: 'bad' };
const FIT_WORD: Record<string, string> = { met: 'Fits', unknown: 'Unclear fit with', unmet: 'Does not fit' };

/** The one thesis chip of a row (the best fit) and the rest as "+n". */
function FitChip({ fit }: { fit: FitOut[] }): React.JSX.Element | null {
  if (fit.length === 0) return null;
  const list = [...fit].sort((a, b) => (FIT_RANK[a.state] ?? 1) - (FIT_RANK[b.state] ?? 1));
  const top = list[0];
  if (top === undefined) return null;
  const rest = list.slice(1);
  return (
    <span data-data="" className="flex min-w-0 items-center gap-1.5">
      <Tag tone={FIT_TONE[top.state] ?? 'faint'} title={`${FIT_WORD[top.state] ?? ''} ${top.thesis.name}: ${top.counts.met} of ${top.counts.met + top.counts.unmet + top.counts.unknown} checks met`}>
        {top.thesis.name}
      </Tag>
      {rest.length > 0 && (
        <span className="shrink-0 text-[12px] text-[var(--vo-muted)]" title={rest.map((f) => `${FIT_WORD[f.state] ?? ''} ${f.thesis.name}`).join(', ')}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}

function RowView({ r, on, checked, showCheck, onOpen, onCheck }: { r: Row; on: boolean; checked: boolean; showCheck: boolean; onOpen: () => void; onCheck: ((v: boolean) => void) | null }): React.JSX.Element {
  const temp = r.number === '';
  const reading = (r.status === 'new' || r.status === 'held') && r.steps.at < 3;
  const overdue = r.status === 'new' && r.due.state === 'overdue';
  const received = fmtDay(r.received_at, { year: 'auto' });
  return (
    <div
      role="option"
      aria-selected={on}
      tabIndex={0}
      data-row={r.number}
      onClick={temp ? undefined : onOpen}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !temp) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={
        'vo-focus vo-tap group relative flex min-w-0 cursor-pointer items-start gap-3 border-b border-[var(--vo-line)] px-4 py-3 transition-colors duration-150 last:border-b-0 ' +
        (on ? 'bg-[var(--vo-active)]' : 'hover:bg-[var(--vo-hover)]') +
        (temp ? ' vo-in opacity-80' : '')
      }
    >
      {on && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-[var(--vo-ink)]" />}
      <span className="flex size-7 shrink-0 items-center justify-center">
        {onCheck === null ? (
          <CompanyLogo name={r.name} domain={r.company?.logo_domain ?? ''} logoUrl={r.company?.logo_url ?? ''} size={28} />
        ) : showCheck || checked ? (
          <Checkbox checked={checked} onChange={onCheck} label={'Select ' + r.name} hideLabel />
        ) : (
          <>
            <span className="flex group-hover:hidden">
              <CompanyLogo name={r.name} domain={r.company?.logo_domain ?? ''} logoUrl={r.company?.logo_url ?? ''} size={28} />
            </span>
            <span className="hidden group-hover:flex">
              <Checkbox checked={false} onChange={onCheck} label={'Select ' + r.name} hideLabel />
            </span>
          </>
        )}
      </span>
      <span data-data="" className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="vo-wrap min-w-0 flex-1 text-[13px] font-medium leading-5 text-[var(--vo-ink)]">{r.name}</span>
          {received !== '' && (
            <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]" title={'Received ' + received}>
              {received}
            </span>
          )}
        </span>
        {r.one_liner !== '' && <span className="line-clamp-2 text-[12px] leading-[17px] text-[var(--vo-ink-2)]">{r.one_liner}</span>}
        {(overdue || reading || r.status === 'passed' || r.status === 'held' || r.fit.length > 0) && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            {overdue && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--vo-bad)]">
                <Clock size={12} aria-hidden />
                Reply overdue
              </span>
            )}
            {r.status === 'held' && r.hold_until !== '' && <span className="text-[12px] text-[var(--vo-muted)]">Back {fmtDay(r.hold_until, { year: 'auto' })}</span>}
            {r.status === 'passed' && r.pass !== null && <Tag tone="faint">{r.pass.reason_label}</Tag>}
            {r.status === 'passed' && r.pass !== null ? (
              <StatusDot tone={MAIL[r.pass.email_state].tone} pulse={MAIL[r.pass.email_state].pulse === true} label={MAIL[r.pass.email_state].label} />
            ) : reading ? (
              <span className="flex items-center gap-2 text-[12px] text-[var(--vo-muted)]">
                <span className="w-16">
                  <StepTrack labels={r.steps.labels} at={r.steps.at} compact />
                </span>
                {r.steps.labels[r.steps.at] ?? ''}
              </span>
            ) : (
              <FitChip fit={r.fit} />
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/** What waits: each label above its figure (with its noun), a hairline between them. */
function Waiting({ stats }: { stats: Stats }): React.JSX.Element {
  const items: { key: string; label: string; tip: string; value: string; bad?: boolean }[] = [
    { key: 'ready', label: 'Ready to decide', tip: 'Read by your AI agent and waiting for your Advance, Pass or Hold.', value: plural(stats.ready, 'deal') },
    { key: 'overdue', label: 'Replies overdue', tip: 'Past the day the founder should have had an answer.', value: plural(stats.overdue, 'reply', 'replies'), bad: stats.overdue > 0 },
  ];
  if (stats.reply_days !== null) items.push({ key: 'reply', label: 'Typical reply', tip: 'Median business days from arrival to a decision, over the last 90 days.', value: plural(Math.round(stats.reply_days), 'day') });
  return (
    <div data-data="" role="group" aria-label="What waits" className="grid w-fit max-w-full min-w-0 grid-flow-col divide-x divide-[var(--vo-line)]">
      {items.map((it) => (
        <div key={it.key} className="min-w-0 px-4 first:pl-0 sm:px-6 sm:first:pl-0">
          <div className="truncate text-[12px] leading-4 text-[var(--vo-muted)]">
            <Tip text={it.tip}>{it.label}</Tip>
          </div>
          <div className={'vo-mono vo-num mt-1 truncate text-[15px] leading-5 ' + (it.bad === true ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-ink)]')}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

export function InboxPage(): React.JSX.Element {
  const me = useMe();
  const route = useRoute();
  const wide = useWide();
  const seg = (['new', 'waiting', 'held'].includes(route.query.get('seg') ?? '') ? route.query.get('seg') : 'new') as Segment;
  const selected = route.query.get('item') ?? '';
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [checked, setChecked] = useState<string[]>([]);
  const [bulk, setBulk] = useState(false);
  const decide = allowed(me, 'intake:edit') && me.role?.own_items !== true;
  const live = useOp<ListOut>('intake.list', { segment: seg, q: q.trim(), limit }, INTAKE_READS, { name: 'inbox', keep: true });
  const list = live.data;
  const items = useMemo(() => list?.items ?? [], [list]);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLimit(PAGE);
    setChecked([]);
    setBulk(false);
  }, [seg, q]);

  // Wide screens open the first deal at once (one fewer click).
  useEffect(() => {
    if (!wide || selected !== '' || items.length === 0) return;
    const first = items.find((r) => r.number !== '');
    if (first !== undefined) setQuery({ item: first.number });
  }, [wide, selected, items]);

  // Scroll pagination (no Show more).
  useEffect(() => {
    const el = sentinel.current;
    if (el === null || list === null || list.next_offset === null) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setLimit((n) => Math.min(500, n + PAGE));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  // J / K (and the arrows) move through the list.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const tg = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || tg.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null) return;
      const k = e.key;
      if (k !== 'j' && k !== 'k' && k !== 'ArrowDown' && k !== 'ArrowUp') return;
      const real = items.filter((r) => r.number !== '');
      if (real.length === 0) return;
      e.preventDefault();
      const i = real.findIndex((r) => r.number === selected);
      const n = k === 'j' || k === 'ArrowDown' ? Math.min(real.length - 1, i + 1) : Math.max(0, i - 1);
      const next = real[i < 0 ? 0 : n];
      if (next !== undefined) {
        setQuery({ item: next.number });
        document.querySelector(`[data-row="${next.number}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [items, selected]);

  const passMany = async (reason: string): Promise<void> => {
    const ids = checked;
    const out = await act(
      ids.map((id) => drop(id)),
      () => op<{ passed: number; _activity?: string }>('intake.pass', { items: ids, reason }),
      INTAKE_READS,
    );
    setBulk(false);
    setChecked([]);
    const entry = out?._activity;
    if (out !== null && entry !== undefined && entry !== '') toast.undo(`Passed ${out.passed}`, () => void act([], () => op('activity.undo', { entry }), INTAKE_READS));
  };

  const counts = list?.counts;
  const stats = list?.stats ?? null;
  const showList = wide || selected === '';
  const showCard = wide || selected !== '';
  const reasons = useOp<{ pass_reasons: { value: string; label: string; on: boolean }[] }>('intake.settings', {}, ['settings'], { name: 'intake.settings', skip: !decide });
  const chips = (reasons.data?.pass_reasons ?? []).filter((r) => r.on).map((r) => ({ value: r.value, label: r.label }));

  return (
    <>
      <PageHeader title="Inbox" back={!wide && selected !== '' ? href('/inbox', { seg: seg === 'new' ? null : seg }) : undefined}>
        {allowed(me, 'intake:edit') && (
          <Button icon={Plus} onClick={openAddDeal}>
            Add deal
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {showList && stats !== null && <Waiting stats={stats} />}
        <div className={wide ? 'grid min-w-0 grid-cols-[380px_minmax(0,1fr)] items-start gap-3' : 'flex min-w-0 flex-col gap-3'}>
          {showList && (
            <Panel flush className={wide ? 'sticky top-[80px] max-h-[calc(100vh-104px)] overflow-hidden' : ''} bodyClass="flex min-h-0 flex-col">
              <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--vo-line)] px-3 py-2">
                {checked.length > 0 ? (
                  <>
                    <Checkbox checked indeterminate={checked.length < items.length} onChange={() => setChecked([])} label="Clear selection" hideLabel />
                    <span className="vo-mono vo-num text-[13px]">{checked.length}</span>
                    <span className="flex-1" />
                    <Button size="sm" onClick={() => setBulk((v) => !v)} aria-expanded={bulk}>
                      Pass
                    </Button>
                    <IconButton icon={X} label="Clear selection" onClick={() => setChecked([])} size={28} />
                  </>
                ) : (
                  <>
                    <Segmented
                      label="Inbox"
                      size="sm"
                      value={seg}
                      onChange={(v) => setQuery({ seg: v === 'new' ? null : v, item: null })}
                      options={[
                        { value: 'new', label: 'New', count: counts?.new ?? 0 },
                        { value: 'waiting', label: 'Waiting', count: counts?.waiting ?? 0 },
                        { value: 'held', label: 'Held', count: counts?.held ?? 0 },
                      ]}
                    />
                    <SearchInput value={q} onChange={setQ} placeholder="Search" label="Search the Inbox" className="min-w-0 flex-1" />
                  </>
                )}
              </div>
              {bulk && checked.length > 0 && (
                <div className="vo-in border-b border-[var(--vo-line)] px-3 py-3">
                  <ChipPicker label="Reason" options={chips} value="" onChange={(v) => void passMany(v)} />
                </div>
              )}
              <div role="listbox" aria-label="Deals" className={wide ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
                {list === null ? (
                  live.error !== null ? (
                    <LoadError message={live.error} onRetry={live.reload} />
                  ) : (
                    <div className="flex flex-col gap-2 p-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  )
                ) : items.length === 0 ? (
                  q.trim() !== '' ? (
                    <Empty icon={InboxIcon} title="No match" action={<Button onClick={() => setQ('')}>Clear</Button>} />
                  ) : seg === 'new' ? (
                    <Empty icon={InboxIcon} title="No new deals" action={allowed(me, 'intake:edit') ? <Button icon={Plus} onClick={openAddDeal}>Add deal</Button> : undefined} />
                  ) : (
                    <Empty icon={InboxIcon} title={seg === 'waiting' ? 'Nothing waiting' : 'Nothing held'} action={<Button onClick={() => setQuery({ seg: null })}>New</Button>} />
                  )
                ) : (
                  items.map((r) => (
                    <RowView
                      key={r.id}
                      r={r}
                      on={r.number !== '' && r.number === selected}
                      checked={checked.includes(r.id)}
                      showCheck={checked.length > 0}
                      onOpen={() => setQuery({ item: r.number })}
                      onCheck={decide && seg === 'new' && r.number !== '' ? (v) => setChecked((c) => (v ? [...c, r.id] : c.filter((x) => x !== r.id))) : null}
                    />
                  ))
                )}
                {list !== null && list.next_offset !== null && <div ref={sentinel} className="h-8" aria-hidden />}
              </div>
            </Panel>
          )}
          {showCard &&
            (selected !== '' ? (
              <ItemCard key={selected} id={selected} />
            ) : (
              <div className="hidden lg:block" aria-hidden />
            ))}
        </div>
      </PageBody>
      <DeckSheet />
    </>
  );
}
