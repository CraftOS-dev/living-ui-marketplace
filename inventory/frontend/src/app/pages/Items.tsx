/**
 * Every item: search (a typed or scanned code opens its item), filter by
 * status, category and place, sort, and switch between photo cards and a
 * list. Select turns on bulk changes (category, labels, archive, delete).
 * More items load as the page scrolls.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, CheckSquare, LayoutGrid, List, PackagePlus, PackageSearch, QrCode, Trash2 } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { Chips, SearchBox, Segmented } from '../components/controls.tsx';
import { useItemEditor } from '../components/ItemEditor.tsx';
import { LocationSelect } from '../components/pickers.tsx';
import { ItemCard, ItemRow } from '../components/rows.tsx';
import { Card, Empty, PageHeader, PillButton, PillSelect, TextLink, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { money, plural } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';

const PAGE = 60;
type View = 'grid' | 'list';
type StatusFilter = '' | 'ok' | 'low' | 'out' | 'over' | 'reorder';

function savedView(): View {
  try {
    return window.localStorage.getItem('inventory.items.view') === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function saveView(v: View): void {
  try {
    window.localStorage.setItem('inventory.items.view', v);
  } catch {
    /* per-viewer convenience only */
  }
}

export function ItemsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { categories, currency } = useApp();
  const editor = useItemEditor();
  const [text, setText] = useState(query.get('q') ?? '');
  const [q, setQ] = useState(query.get('q') ?? '');
  const [status, setStatus] = useState<StatusFilter>((query.get('status') as StatusFilter | null) ?? '');
  const [category, setCategory] = useState(query.get('category') ?? '');
  const [location, setLocation] = useState(query.get('location') ?? '');
  const [archived, setArchived] = useState(query.get('archived') ?? 'active');
  const [sort, setSort] = useState(query.get('sort') ?? 'name');
  const [view, setView] = useState<View>(savedView);
  const [pages, setPages] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmEl, confirm] = useConfirm();
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    setPages(1);
    replaceQuery('items', { q, status, category, location, archived: archived === 'active' ? '' : archived, sort: sort === 'name' ? '' : sort });
  }, [q, status, category, location, archived, sort]);

  const desc = sort === 'qty_desc' || sort === 'value' || sort === 'updated';
  const sortKey = sort === 'qty_desc' ? 'qty' : sort;
  const list = useLive(
    () =>
      api.items({
        q,
        status,
        category,
        location,
        archived,
        sort: sortKey,
        desc,
        limit: pages * PAGE,
      }),
    ['items', 'stock', 'order_lines', 'orders', 'categories', 'codes', 'suppliers'],
    [q, status, category, location, archived, sortKey, desc, pages],
  );
  const data = list.data;
  const items = data?.items ?? [];
  const more = data !== null && items.length < data.total;

  useEffect(() => {
    const el = sentinel.current;
    if (el === null || !more) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !list.loading) setPages((p) => p + 1);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, list.loading]);

  const chips = useMemo(() => {
    const c = data?.counts;
    return [
      { value: '' as StatusFilter, label: 'All', ...(c !== undefined ? { count: c.all } : {}) },
      { value: 'ok' as StatusFilter, label: 'In stock', ...(c !== undefined ? { count: c.ok } : {}) },
      { value: 'low' as StatusFilter, label: 'Low', ...(c !== undefined ? { count: c.low } : {}) },
      { value: 'out' as StatusFilter, label: 'Out', ...(c !== undefined ? { count: c.out } : {}) },
      { value: 'over' as StatusFilter, label: 'Over', ...(c !== undefined ? { count: c.over } : {}) },
      { value: 'reorder' as StatusFilter, label: 'To reorder', ...(c !== undefined ? { count: c.reorder } : {}) },
    ];
  }, [data?.counts]);

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const stop = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };
  const ids = [...selected];
  const bulkCategory = async (cat: string): Promise<void> => {
    try {
      await api.setCategory(ids, cat === 'none' ? '' : cat);
      toast.success(`${plural(ids.length, 'item')} moved`);
      stop();
    } catch {
      /* toasted */
    }
  };
  const bulkArchive = async (value: boolean): Promise<void> => {
    try {
      await api.setArchived(ids, value);
      toast.success(value ? `${plural(ids.length, 'item')} archived` : `${plural(ids.length, 'item')} restored`);
      stop();
    } catch {
      /* toasted */
    }
  };
  const bulkDelete = async (): Promise<void> => {
    const ok = await confirm(
      `${plural(ids.length, 'item')} ${ids.length === 1 ? 'is' : 'are'} deleted with their stock, history and barcodes. Archiving keeps the history instead.`,
      'Delete selected items?',
    );
    if (!ok) return;
    try {
      await api.deleteItems(ids);
      toast.success(`${plural(ids.length, 'item')} deleted`);
      stop();
    } catch {
      /* toasted */
    }
  };

  const open = (v: string): void => {
    if (v === '') return;
    api
      .lookup(v)
      .then((hit) => {
        if (hit.type === 'item') navigate('item', { id: hit.item.id });
        else if (hit.type === 'location') {
          setText('');
          setLocation(hit.location.id);
        }
      })
      .catch(() => undefined);
  };

  const filtered = q !== '' || status !== '' || category !== '' || location !== '' || archived !== 'active';
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <div>
      <PageHeader
        title="Items"
        subtitle={data !== null ? <span className="num">{plural(data.total, 'item')} · {money(data.value, currency)}</span> : ' '}
        actions={
          <>
            {items.length > 0 && !selecting && (
              <PillButton variant="light" icon={CheckSquare} onClick={() => setSelecting(true)}>
                Select
              </PillButton>
            )}
            <PillButton variant="dark" icon={PackagePlus} dot onClick={(e) => editor.create(e.currentTarget)}>
              New item
            </PillButton>
          </>
        }
      />

      <div className="iv-rise iv-d1 mb-4 flex flex-wrap items-center gap-3">
        <SearchBox value={text} onChange={setText} onEnter={open} placeholder="Search, or scan a barcode" ariaLabel="Search items" className="min-w-[14rem] flex-1" />
        <PillSelect
          ariaLabel="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: 'All categories' }, { value: 'none', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          className="w-full sm:w-48"
        />
        <LocationSelect value={location} onChange={setLocation} allowNone noneLabel="All places" ariaLabel="Place" className="w-full sm:w-56" />
        <PillSelect
          ariaLabel="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Name' },
            { value: 'status', label: 'Status' },
            { value: 'qty', label: 'Fewest on hand' },
            { value: 'qty_desc', label: 'Most on hand' },
            { value: 'days_left', label: 'Runs out soonest' },
            { value: 'value', label: 'Highest value' },
            { value: 'updated', label: 'Recently changed' },
          ]}
          className="w-full sm:w-48"
        />
      </div>

      <div className="iv-rise iv-d2 mb-5 flex flex-wrap items-center justify-between gap-3">
        <Chips ariaLabel="Status" value={status} onChange={setStatus} options={chips} />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <PillSelect
            ariaLabel="Archived items"
            value={archived}
            onChange={setArchived}
            options={[
              { value: 'active', label: 'Active items' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'Active and archived' },
            ]}
            className="min-w-0 flex-1 sm:w-48 sm:flex-none"
          />
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={(v) => {
              setView(v);
              saveView(v);
            }}
            options={[
              { value: 'grid', label: 'Cards', icon: LayoutGrid },
              { value: 'list', label: 'List', icon: List },
            ]}
          />
        </div>
      </div>

      {data !== null && items.length === 0 ? (
        <Card>
          <Empty
            icon={PackageSearch}
            title={filtered ? 'Nothing matches' : 'No items yet'}
            action={
              filtered ? (
                <TextLink
                  onClick={() => {
                    setText('');
                    setStatus('');
                    setCategory('');
                    setLocation('');
                    setArchived('active');
                  }}
                >
                  Clear the filters
                </TextLink>
              ) : (
                <PillButton variant="dark" icon={PackagePlus} dot onClick={(e) => editor.create(e.currentTarget)}>
                  Add your first item
                </PillButton>
              )
            }
          >
            {filtered ? 'Try another search or filter.' : 'Add items one by one, import a spreadsheet, or ask your AI agent to set them up.'}
          </Empty>
        </Card>
      ) : data === null ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-64 animate-pulse rounded-[24px] bg-[var(--iv-card)]" />
          ))}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {items.map((it, i) => (
            <div key={it.id} className={i < 12 ? `iv-rise iv-d${Math.min(5, Math.floor(i / 3) + 1)}` : ''}>
              <ItemCard item={it} selectable={selecting} selected={selected.has(it.id)} onToggle={toggle} />
            </div>
          ))}
        </div>
      ) : (
        <Card className="!p-3 md:!p-4">
          <div className="flex flex-col gap-2">
            {items.map((it) => (
              <ItemRow key={it.id} item={it} selectable={selecting} selected={selected.has(it.id)} onToggle={toggle} />
            ))}
          </div>
        </Card>
      )}
      <div ref={sentinel} className="h-10" />
      {more && <p className="text-center text-[12px] text-[var(--iv-muted)]">Loading more</p>}

      {selecting && (
        <div className="iv-pop iv-on-ink fixed bottom-24 left-1/2 z-40 flex w-[min(94vw,46rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[28px] bg-[var(--iv-ink)] p-2 pl-5 text-[var(--iv-shell)] shadow-2xl md:bottom-8">
          <span className="mr-auto flex items-center gap-3 text-[14px] font-bold">
            {selected.size} selected
            <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} className="rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--iv-accent)] hover:bg-[var(--iv-shell)]/10">
              {allSelected ? 'Clear' : 'Select all shown'}
            </button>
          </span>
          <PillSelect
            ariaLabel="Move selected to category"
            value=""
            onChange={(v) => v !== '' && selected.size > 0 && void bulkCategory(v)}
            options={[{ value: '', label: 'Category' }, { value: 'none', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            className="w-36"
          />
          <PillButton variant="light" icon={QrCode} disabled={selected.size === 0} onClick={() => navigate('labels', { items: ids.join(',') })}>
            Labels
          </PillButton>
          {archived === 'archived' ? (
            <PillButton variant="light" icon={ArchiveRestore} disabled={selected.size === 0} onClick={() => void bulkArchive(false)}>
              Restore
            </PillButton>
          ) : (
            <PillButton variant="light" icon={Archive} disabled={selected.size === 0} onClick={() => void bulkArchive(true)}>
              Archive
            </PillButton>
          )}
          <PillButton variant="danger" icon={Trash2} disabled={selected.size === 0} onClick={() => void bulkDelete()}>
            Delete
          </PillButton>
          <PillButton variant="accent" onClick={stop}>
            Done
          </PillButton>
        </div>
      )}
      {confirmEl}
    </div>
  );
}
