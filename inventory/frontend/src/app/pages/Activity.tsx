/**
 * Activity: every stock change, newest first, grouped by day and by the
 * action that made it. Filter by kind, who, place, item and dates; undo a
 * change or delete it from the history; export what is shown as CSV.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, History, X } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { Chips, SearchBox } from '../components/controls.tsx';
import { LocationSelect } from '../components/pickers.tsx';
import { BatchCard, groupBatches } from '../components/rows.tsx';
import { Card, Empty, Field, PageHeader, PillButton, PillSelect, TextLink } from '../components/ui.tsx';
import { api, download } from '../lib/api.ts';
import { addDays, dayLabel, today, toDay } from '../lib/dates.ts';
import { useLive } from '../lib/live.ts';
import { replaceQuery } from '../lib/router.ts';
import type { Movement } from '../lib/types.ts';
import { DateField } from './Orders.tsx';

type Kind = '' | 'in' | 'out' | 'move' | 'adjust' | 'count';
const PAGE = 100;

export function ActivityPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>((query.get('kind') as Kind | null) ?? '');
  const [actor, setActor] = useState(query.get('actor') ?? '');
  const [location, setLocation] = useState(query.get('location') ?? '');
  const [from, setFrom] = useState(query.get('from') ?? '');
  const [to, setTo] = useState(query.get('to') ?? '');
  const [item, setItem] = useState(query.get('item') ?? '');
  const [batch, setBatch] = useState(query.get('batch') ?? '');
  const [pages, setPages] = useState(1);
  const [exporting, setExporting] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    setPages(1);
    replaceQuery('activity', { kind, actor, location, from, to, item, batch });
  }, [q, kind, actor, location, from, to, item, batch]);

  const list = useLive(
    () => api.movements({ q, kind, actor, location, from, to, item, batch, limit: pages * PAGE }),
    ['movements', 'items', 'locations'],
    [q, kind, actor, location, from, to, item, batch, pages],
  );
  const itemInfo = useLive(() => (item !== '' ? api.item(item) : Promise.resolve(null)), [], [item]);
  const rows = list.data?.movements ?? [];
  const more = list.data?.more === true;

  useEffect(() => {
    const el = sentinel.current;
    if (el === null || !more) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !list.loading) setPages((p) => p + 1);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, list.loading]);

  const days = useMemo(() => {
    const out: { day: string; batches: Movement[][] }[] = [];
    for (const b of groupBatches(rows)) {
      const first = b[0];
      if (first === undefined) continue;
      const d = toDay(new Date(Date.parse(first.created.replace(' ', 'T'))));
      const last = out[out.length - 1];
      if (last !== undefined && last.day === d) last.batches.push(b);
      else out.push({ day: d, batches: [b] });
    }
    return out;
  }, [rows]);

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      const end = to !== '' ? to : today();
      const start = from !== '' ? from : addDays(end, -30);
      const f = await api.exportMovements(start, end);
      download(f.filename, f.content);
      toast.success(`Exported ${f.rows ?? 0} entries`);
    } catch {
      /* toasted */
    } finally {
      setExporting(false);
    }
  };

  const filtered = q !== '' || kind !== '' || actor !== '' || location !== '' || from !== '' || to !== '' || item !== '' || batch !== '';

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Every stock change, with who made it and an Undo"
        actions={
          <PillButton variant="light" icon={Download} loading={exporting} onClick={() => void exportCsv()}>
            Export CSV
          </PillButton>
        }
      />

      <div className="iv-rise iv-d1 mb-4 flex flex-wrap items-center gap-3">
        <SearchBox value={text} onChange={setText} placeholder="Search item, SKU or note" ariaLabel="Search history" className="min-w-[14rem] flex-1" />
        <PillSelect
          ariaLabel="Who"
          value={actor}
          onChange={setActor}
          options={[
            { value: '', label: 'Anyone' },
            { value: 'you', label: 'You' },
            { value: 'agent', label: 'Your AI agent' },
            { value: 'system', label: 'The app' },
          ]}
          className="w-full sm:w-44"
        />
        <LocationSelect value={location} onChange={setLocation} allowNone noneLabel="All places" ariaLabel="Place" className="w-full sm:w-56" />
      </div>
      <div className="iv-rise iv-d2 mb-5 flex flex-wrap items-end justify-between gap-3">
        <Chips
          ariaLabel="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: '', label: 'All' },
            { value: 'in', label: 'In' },
            { value: 'out', label: 'Out' },
            { value: 'move', label: 'Moves' },
            { value: 'adjust', label: 'Corrections' },
            { value: 'count', label: 'Counts' },
          ]}
        />
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From">
            <div className="w-48">
              <DateField value={from} onChange={setFrom} label="From" placeholder="Any day" />
            </div>
          </Field>
          <Field label="To">
            <div className="w-48">
              <DateField value={to} onChange={setTo} label="To" placeholder="Today" />
            </div>
          </Field>
        </div>
      </div>

      {(item !== '' || batch !== '') && (
        <div className="mb-4 flex flex-wrap gap-2">
          {item !== '' && (
            <button type="button" onClick={() => setItem('')} className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--iv-ink)] pl-4 pr-2 text-[13px] font-semibold text-[var(--iv-shell)]">
              Item: {itemInfo.data?.name ?? '...'}
              <X size={14} aria-label="Clear item filter" />
            </button>
          )}
          {batch !== '' && (
            <button type="button" onClick={() => setBatch('')} className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--iv-ink)] pl-4 pr-2 text-[13px] font-semibold text-[var(--iv-shell)]">
              One change
              <X size={14} aria-label="Clear change filter" />
            </button>
          )}
        </div>
      )}

      {list.data !== null && rows.length === 0 ? (
        <Card>
          <Empty
            icon={History}
            title={filtered ? 'Nothing matches' : 'Nothing recorded yet'}
            action={
              filtered ? (
                <TextLink
                  onClick={() => {
                    setText('');
                    setKind('');
                    setActor('');
                    setLocation('');
                    setFrom('');
                    setTo('');
                    setItem('');
                    setBatch('');
                  }}
                >
                  Clear the filters
                </TextLink>
              ) : undefined
            }
          >
            {filtered ? 'Try fewer filters or other dates.' : 'Stock coming in, going out and moving between places shows up here.'}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((d, i) => (
            <Card key={d.day} className="!p-4" delay={Math.min(5, i + 1)}>
              <p className="mb-3 px-1 text-[14px] font-bold">{dayLabel(d.day)}</p>
              <div className="flex flex-col gap-2">
                {d.batches.map((b) => (
                  <BatchCard key={b[0]?.batch} rows={b} />
                ))}
              </div>
            </Card>
          ))}
          {list.data === null && <span className="h-64 animate-pulse rounded-[24px] bg-[var(--iv-card)]" />}
        </div>
      )}
      <div ref={sentinel} className="h-10" />
      {more && <p className="text-center text-[12px] text-[var(--iv-muted)]">Loading more</p>}
    </div>
  );
}
