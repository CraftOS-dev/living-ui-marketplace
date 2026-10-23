/**
 * Parts: every part as a dense table (or a grid of tiles), searchable, with
 * filters for pinned, failing and archived parts, and the actions each part
 * has (open, duplicate, pin, archive, delete).
 */
import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, Boxes, Copy, Ellipsis, LayoutGrid, Pin, PinOff, Plus, Rows3, Search } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { useNewPart } from '../components/NewPart.tsx';
import { PartCard } from '../components/PartCard.tsx';
import { PartsTable } from '../components/PartsTable.tsx';
import { Button, Empty, PageHeader, Panel, Popover, Segmented, Select, Spinner, errMessage, inputCls, menuItem } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { Part } from '../lib/types.ts';

type View = 'all' | 'pinned' | 'failed' | 'archived';
type Layout = 'table' | 'grid';

function PartMenu({ p, floating = false }: { p: Part; floating?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const act = (fn: () => Promise<unknown>, done: string): void => {
    setOpen(false);
    fn()
      .then(() => toast.success(done))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className={cn('relative inline-block', floating && 'absolute right-2.5 top-2.5')}>
      <button
        ref={btn}
        type="button"
        aria-label={'Actions for ' + p.name}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex size-6 items-center justify-center rounded-[var(--cw-r)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row-hover)] hover:text-[var(--cw-ink)]', floating && 'border border-[var(--cw-line)] bg-[var(--cw-card)] shadow-[var(--cw-shadow-sm)]')}
      >
        <Ellipsis size={14} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" keep={btn} className="w-48 text-left">
        <button type="button" className={menuItem} onClick={() => act(() => api.updatePart(p.id, { pinned: !p.pinned }), p.pinned ? 'Unpinned' : 'Pinned')}>
          {p.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />} {p.pinned ? 'Unpin' : 'Pin to the top'}
        </button>
        <button
          type="button"
          className={menuItem}
          onClick={() => {
            setOpen(false);
            api
              .duplicatePart(p.id)
              .then((r) => {
                toast.success('Copied to ' + r.part.name);
                navigate('part', { id: r.part.id });
              })
              .catch((err: unknown) => toast.error(errMessage(err)));
          }}
        >
          <Copy size={14} aria-hidden /> Duplicate
        </button>
        <button type="button" className={menuItem} onClick={() => act(() => api.updatePart(p.id, { archived: !p.archived }), p.archived ? 'Restored ' + p.name : 'Archived ' + p.name)}>
          {p.archived ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />} {p.archived ? 'Restore' : 'Archive'}
        </button>
        <div className="my-1 border-t border-[var(--cw-hair)]" />
        <DeleteButton variant="menu" collection="parts" id={p.id} name={p.name} label="Delete" />
      </Popover>
    </div>
  );
}

export function PartsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { unit } = useApp();
  const np = useNewPart();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [view, setView] = useState<View>(((): View => {
    const s = query.get('status');
    if (s === 'failed') return 'failed';
    const v = query.get('view');
    return v === 'pinned' || v === 'archived' ? v : 'all';
  })());
  const [sort, setSort] = useState(query.get('sort') ?? 'updated');
  const [layout, setLayout] = useState<Layout>(query.get('layout') === 'grid' ? 'grid' : 'table');
  const list = useLive(
    () =>
      api.parts({
        q: q.trim() === '' ? undefined : q.trim(),
        pinned: view === 'pinned' ? true : undefined,
        archived: view === 'archived' ? true : undefined,
        status: view === 'failed' ? 'failed' : undefined,
        sort,
        limit: 300,
      }),
    ['parts', 'builds'],
    [q, view, sort],
    200,
  );
  const update = (next: { q?: string; view?: View; sort?: string; layout?: Layout }): void => {
    const nq = next.q ?? q;
    const nv = next.view ?? view;
    const ns = next.sort ?? sort;
    const nl = next.layout ?? layout;
    replaceQuery('parts', { q: nq, view: nv === 'all' || nv === 'failed' ? '' : nv, status: nv === 'failed' ? 'failed' : '', sort: ns === 'updated' ? '' : ns, layout: nl === 'grid' ? 'grid' : '' });
  };
  const parts = list.data?.parts ?? [];
  return (
    <div>
      <PageHeader
        title="Parts"
        subtitle={list.data !== null ? list.data.total + ' in all' : undefined}
        actions={
          <Button variant="primary" icon={Plus} onClick={(e) => np.open(e.currentTarget)}>
            New part
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--cw-muted)]" />
          <input
            aria-label="Search parts"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              update({ q: e.target.value });
            }}
            placeholder="Search parts"
            className={cn(inputCls, 'pl-7')}
          />
        </div>
        <Segmented<View>
          label="Show"
          value={view}
          onChange={(v) => {
            setView(v);
            update({ view: v });
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'pinned', label: 'Pinned' },
            { value: 'failed', label: 'Not building' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <Select
          ariaLabel="Sort"
          value={sort}
          onChange={(v) => {
            setSort(v);
            update({ sort: v });
          }}
          options={[
            { value: 'updated', label: 'Recently changed' },
            { value: 'name', label: 'Name' },
            { value: 'created', label: 'Newest' },
          ]}
          className="w-44"
        />
        <span className="flex-1" />
        <Segmented<Layout>
          label="Layout"
          value={layout}
          onChange={(l) => {
            setLayout(l);
            update({ layout: l });
          }}
          options={[
            { value: 'table', label: 'Table', icon: Rows3 },
            { value: 'grid', label: 'Grid', icon: LayoutGrid },
          ]}
        />
      </div>
      {list.loading && list.data === null ? (
        <div className="flex justify-center py-16">
          <Spinner size={20} />
        </div>
      ) : parts.length === 0 ? (
        <Panel padded={false}>
          <Empty
            icon={Boxes}
            title={q !== '' || view !== 'all' ? 'No parts match' : 'No parts yet'}
            action={
              view === 'all' && q === '' ? (
                <Button variant="primary" icon={Plus} onClick={(e) => np.open(e.currentTarget)}>
                  New part
                </Button>
              ) : undefined
            }
          >
            {q !== '' || view !== 'all' ? 'Try another search or filter.' : 'Start from a block, a mounting plate, an open box, or nothing.'}
          </Empty>
        </Panel>
      ) : layout === 'table' ? (
        <Panel padded={false}>
          <PartsTable parts={parts} unit={unit} actions={(p) => <PartMenu p={p} />} />
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {parts.map((p) => (
            <div key={p.id} className="relative">
              <PartCard p={p} unit={unit} />
              <PartMenu p={p} floating />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
