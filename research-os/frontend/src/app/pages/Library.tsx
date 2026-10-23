/**
 * The library: a tree of views, collections and tags on the left; a dense
 * table (or covers) in the middle with search, quick filters and the filter
 * builder; the selected paper's details on the right. Rows can be dragged
 * onto collections and tags, selected many at once, opened with Enter or a
 * double click, and every row has a right-click menu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, BookOpenText, Check, Copy, Download, Filter, FolderPlus, FolderKanban, LayoutGrid, Library as LibraryIcon, ListFilter, MoreHorizontal, PanelLeft, Plus, RotateCcw, ScanText, Search, Sparkles, Star, Tag, TextSearch, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { download, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { READS, changed, useLive } from '../lib/live.ts';
import { byline, num, plural, shortDate } from '../lib/format.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { Counts, Proposal, WorkRow } from '../lib/types.ts';
import { useAddPapers } from '../components/AddPapers.tsx';
import { askAgent } from '../components/agent.tsx';
import { FilterBuilder, usable } from '../components/library/FilterBuilder.tsx';
import type { Cond } from '../components/library/FilterBuilder.tsx';
import { DRAG_WORKS, LibraryTree } from '../components/library/LibraryTree.tsx';
import { PaperPane } from '../components/library/PaperPane.tsx';
import { AgentMark, Cover, PaperState, ReadDot, TagDots, TextState, hueOfSlot, openPaper } from '../components/paper.tsx';
import { useDropTarget } from '../components/Shell.tsx';
import { Badge, Button, Drawer, Empty, IconButton, LoadError, Popover, Segmented, Select, Skeleton, inputCls, menuItem, useConfirm, useContextMenu } from '../components/ui.tsx';

interface ListResult {
  works: WorkRow[];
  total: number;
  more: boolean;
}

const PAGE = 100;

function useWide(ref: React.RefObject<HTMLElement | null>, min: number): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver((e) => setWide((e[0]?.contentRect.width ?? 0) >= min));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return wide;
}

export default function LibraryPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const add = useAddPapers();
  const { collections, tags } = useApp();
  const view = query.get('view') ?? (query.get('collection') || query.get('tag') ? '' : 'all');
  const collection = query.get('collection') ?? '';
  const tag = query.get('tag') ?? '';
  const q = query.get('q') ?? '';
  const [text, setText] = useState(q);
  const [fullText, setFullText] = useState(query.get('ft') === '1');
  const [sort, setSort] = useState(query.get('sort') ?? 'added');
  const [layout, setLayout] = useState<'table' | 'covers'>(() => (localStorage.getItem('ro_lib_layout') === 'covers' ? 'covers' : 'table'));
  const [conds, setConds] = useState<Cond[]>([]);
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<string>('');
  const [limit, setLimit] = useState(PAGE);
  const [treeOpen, setTreeOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const wide = useWide(root, 1180);
  const mid = useWide(root, 760);
  useDropTarget({ collection: collection !== '' ? collection : undefined });

  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) replaceQuery({ q: text });
    }, 250);
    return () => clearTimeout(t);
  }, [text, q]);
  useEffect(() => {
    setLimit(PAGE);
    setSelected([]);
  }, [view, collection, tag, q, fullText, sort, conds, match]);
  useEffect(() => {
    try {
      localStorage.setItem('ro_lib_layout', layout);
    } catch {
      /* a convenience */
    }
  }, [layout]);

  const live = usable(conds);
  const list = useLive(
    (signal) =>
      view === 'duplicates'
        ? Promise.resolve({ works: [], total: 0, more: false })
        : op<ListResult>(
            'works.list',
            {
              view: view !== '' ? view : 'all',
              collection: collection || undefined,
              tag: tag || undefined,
              q: q || undefined,
              full_text: q !== '' && fullText ? true : undefined,
              sort: q !== '' && sort === 'added' ? undefined : sort,
              filter: live.length > 0 ? JSON.stringify(live) : undefined,
              match: live.length > 1 ? match : undefined,
              limit: limit,
            },
            { quiet: true, signal },
          ),
    READS.library,
    [view, collection, tag, q, fullText, sort, JSON.stringify(live), match, limit],
    250,
  );
  const counts = useLive((signal) => op<Counts>('works.counts', {}, { quiet: true, signal }), ['works'], [], 400);
  const rows = list.data?.works ?? [];
  const title = collection !== '' ? (collections.find((c) => c.id === collection)?.name ?? 'Collection') : tag !== '' ? (tags.find((t) => t.id === tag)?.name ?? 'Tag') : VIEW_TITLE[view] ?? 'All papers';

  const select = (id: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): void => {
    setFocus(id);
    if (e?.shiftKey && selected.length > 0) {
      const a = rows.findIndex((r) => r.id === (selected[selected.length - 1] as string));
      const b = rows.findIndex((r) => r.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(Array.from(new Set([...selected, ...rows.slice(lo, hi + 1).map((r) => r.id)])));
    } else if (e?.ctrlKey || e?.metaKey) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    } else setSelected([id]);
  };

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const i = rows.findIndex((r) => r.id === focus);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const n = rows[Math.min(rows.length - 1, i + 1)];
        if (n) select(n.id, e.shiftKey ? { shiftKey: true } : undefined);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const n = rows[Math.max(0, i - 1)];
        if (n) select(n.id, e.shiftKey ? { shiftKey: true } : undefined);
      } else if (e.key === 'Enter') {
        const w = rows[i];
        if (w) openPaper(w);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0 && view !== 'trash') {
        void op('works.trash', { works: selected }).then(() => {
          changed('works');
          toast.success(plural(selected.length, 'paper') + ' moved to the trash');
          setSelected([]);
        });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(rows.map((r) => r.id));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, focus, selected, view],
  );

  const tree = <LibraryTree sel={{ view, collection, tag }} counts={counts.data} onSelect={(s) => { setTreeOpen(false); replaceQuery({ view: s.view !== undefined && s.view !== '' ? s.view : undefined, collection: s.collection || undefined, tag: s.tag || undefined }); }} />;
  const pane = focus !== '' && selected.length <= 1 ? <PaperPane id={focus} onClose={() => { setFocus(''); setSelected([]); }} /> : null;

  return (
    <div ref={root} className="flex h-full min-h-0">
      {mid && <aside className="w-60 shrink-0 overflow-y-auto border-r border-[var(--ro-line)] bg-[var(--ro-card)]">{tree}</aside>}
      {!mid && <Drawer open={treeOpen} onClose={() => setTreeOpen(false)} title="Library" width={300}>{tree}</Drawer>}
      <section className="flex min-w-0 flex-1 flex-col @container" onKeyDown={onKey} tabIndex={-1}>
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
          {!mid && <IconButton icon={PanelLeft} label="Library tree" onClick={() => setTreeOpen(true)} />}
          <div className="min-w-0 mr-auto">
            <h1 className="truncate text-[15px] font-bold leading-5">{title}</h1>
            <p className="text-[12px] text-[var(--ro-muted)]">{list.data !== null ? plural(list.data.total, 'paper') : ' '}</p>
          </div>
          <div className="relative w-full @min-[640px]:w-64">
            <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ro-muted)]" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search titles, authors, abstracts" className={cn(inputCls, 'pl-7 pr-8')} aria-label="Search the library" />
            <button type="button" title={fullText ? 'Also searching the PDFs' : 'Also search the text of the PDFs'} aria-pressed={fullText} onClick={() => setFullText((f) => !f)} className={cn('absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-[3px]', fullText ? 'bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)]')}>
              <TextSearch size={13} />
            </button>
          </div>
          <Button ref={filterRef} icon={ListFilter} onClick={() => setFilterOpen((o) => !o)} variant={live.length > 0 ? 'primary' : 'secondary'}>
            {live.length > 0 ? `Filters ${live.length}` : 'Filters'}
          </Button>
          <Popover open={filterOpen} onClose={() => setFilterOpen(false)} anchor={filterRef} align="right">
            <FilterBuilder conds={conds} match={match} onChange={(c, m) => { setConds(c); setMatch(m); }} />
          </Popover>
          <Select ariaLabel="Sort" className="w-36" value={sort} onChange={setSort} options={[{ value: 'added', label: 'Newest added' }, { value: 'opened', label: 'Recently read' }, { value: 'title', label: 'Title' }, { value: 'author', label: 'First author' }, { value: 'year', label: 'Year' }, { value: 'cited_by', label: 'Most cited' }]} />
          <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: 'table', label: 'Table', icon: ArrowDownUp, title: 'Table' }, { value: 'covers', label: 'Covers', icon: LayoutGrid, title: 'Covers' }]} />
          <Button variant="primary" icon={Plus} onClick={() => add.open({ collection: collection || undefined })}>
            Add
          </Button>
        </header>
        {selected.length > 1 && <BulkBar ids={selected} trash={view === 'trash'} onDone={() => setSelected([])} />}
        <div className="min-h-0 flex-1 overflow-auto">
          {view === 'duplicates' ? (
            <Duplicates />
          ) : list.error !== null ? (
            <div className="p-3"><LoadError message={list.error} onRetry={list.reload} /></div>
          ) : list.data === null ? (
            <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyView view={view} q={q} filtered={live.length > 0} onAdd={() => add.open({ collection: collection || undefined })} />
          ) : layout === 'covers' ? (
            <Covers rows={rows} selected={selected} onSelect={select} />
          ) : (
            <Table rows={rows} selected={selected} focus={focus} onSelect={select} trash={view === 'trash'} />
          )}
          {list.data !== null && list.data.more && (
            <div className="flex justify-center p-3">
              <Button onClick={() => setLimit((l) => l + PAGE)}>Show the next {Math.min(PAGE, list.data.total - rows.length)}</Button>
            </div>
          )}
          {view === 'trash' && rows.length > 0 && <TrashBar />}
        </div>
      </section>
      {wide && pane !== null && <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-[var(--ro-line)] bg-[var(--ro-card)]">{pane}</aside>}
      {!wide && <Drawer open={pane !== null && focus !== ''} onClose={() => { setFocus(''); setSelected([]); }} title="Paper">{pane}</Drawer>}
    </div>
  );
}

const VIEW_TITLE: Record<string, string> = {
  all: 'All papers',
  unread: 'Unread',
  reading: 'Reading',
  read: 'Read',
  recent: 'Recently added',
  opened: 'Recently read',
  starred: 'Starred',
  to_identify: 'To identify',
  integrity: 'Integrity alerts',
  no_pdf: 'Without a PDF',
  agent_added: 'Added by your AI agent',
  duplicates: 'Duplicates',
  trash: 'Trash',
};

function EmptyView({ view, q, filtered, onAdd }: { view: string; q: string; filtered: boolean; onAdd: () => void }): React.JSX.Element {
  if (q !== '' || filtered) return <Empty icon={Search} title="No papers match" />;
  if (view === 'trash') return <Empty icon={Trash2} title="The trash is empty" />;
  if (view === 'to_identify') return <Empty icon={Check} title="Every paper is identified" />;
  if (view === 'integrity') return <Empty icon={Check} title="No retractions or concerns" />;
  return <Empty icon={LibraryIcon} title="No papers here yet" action={<Button variant="primary" icon={Plus} onClick={onAdd}>Add papers</Button>}>Drop PDFs anywhere, or paste DOIs and arXiv IDs.</Empty>;
}

function rowMenu(w: WorkRow, open: (e: React.MouseEvent, items: { label: string; icon?: typeof Star; onClick?: () => void; danger?: boolean; divider?: boolean }[]) => void, e: React.MouseEvent, trash: boolean): void {
  if (trash) {
    open(e, [{ label: 'Restore', icon: RotateCcw, onClick: () => void op('works.restore', { works: [w.id] }).then(() => changed('works')) }]);
    return;
  }
  open(e, [
    { label: w.file ? 'Read' : 'Open its page', icon: BookOpenText, onClick: () => openPaper(w) },
    { label: w.read_state === 'read' ? 'Mark as unread' : 'Mark as read', icon: Check, onClick: () => void op('works.set-state', { works: [w.id], read_state: w.read_state === 'read' ? 'unread' : 'read' }).then(() => changed('works')) },
    { label: w.starred ? 'Unstar' : 'Star', icon: Star, onClick: () => void op('works.set-state', { works: [w.id], starred: !w.starred }).then(() => changed('works')) },
    { divider: true, label: '' },
    { label: 'Copy citation', icon: Copy, onClick: () => void op<{ in_text: { text: string }; entries: { text: string }[] }>('cite.format', { works: [w.id] }).then((r) => navigator.clipboard.writeText(r.entries[0]?.text ?? '')).then(() => toast.success('Reference copied')) },
    { label: 'Copy BibTeX', icon: Copy, onClick: () => void op<{ content: string }>('export.works', { works: [w.id], format: 'bibtex' }).then((r) => navigator.clipboard.writeText(r.content)).then(() => toast.success('BibTeX copied')) },
    ...(w.file === null ? [{ label: 'Ask your AI agent to find the full text', icon: Sparkles, onClick: () => void askAgent('access_requested', { work: w.id }) }] : []),
    { divider: true, label: '' },
    { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => void op('works.trash', { works: [w.id] }).then(() => { changed('works'); toast.success('Moved to the trash'); }) },
  ]);
}

function Table({ rows, selected, focus, onSelect, trash }: { rows: WorkRow[]; selected: string[]; focus: string; onSelect: (id: string, e?: React.MouseEvent) => void; trash: boolean }): React.JSX.Element {
  const menu = useContextMenu();
  return (
    <table className="ro-table" aria-label="Papers">
      <thead>
        <tr>
          <th className="w-8 pl-3">
            <span className="sr-only">Select</span>
          </th>
          <th>Title</th>
          <th className="hidden w-14 @min-[640px]:table-cell">Year</th>
          <th className="hidden w-20 @min-[900px]:table-cell">Added</th>
          <th className="hidden w-20 text-right @min-[760px]:table-cell">Marks</th>
          <th className="w-8">
            <span className="sr-only">State</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => {
          const sel = selected.includes(w.id);
          return (
            <tr
              key={w.id}
              aria-selected={sel || focus === w.id}
              draggable
              onDragStart={(e) => {
                const ids = sel ? selected : [w.id];
                e.dataTransfer.setData(DRAG_WORKS, JSON.stringify(ids));
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              onClick={(e) => onSelect(w.id, e)}
              onDoubleClick={() => openPaper(w)}
              onContextMenu={(e) => {
                if (!sel) onSelect(w.id);
                rowMenu(w, menu as never, e, trash);
              }}
              data-hover
            >
              <td className="pl-3">
                <input type="checkbox" checked={sel} aria-label={'Select ' + w.title} onClick={(e) => e.stopPropagation()} onChange={() => onSelect(w.id, { ctrlKey: true } as React.MouseEvent)} className="accent-[var(--ro-ink)]" />
              </td>
              <td className="max-w-0 py-1.5">
                <div className="flex items-start gap-2.5">
                  <Cover work={w} width={28} className="mt-0.5 hidden @min-[480px]:flex" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <ReadDot state={w.read_state} />
                      <span className="truncate font-semibold">{w.title}</span>
                      {w.starred && <Star size={12} className="shrink-0 fill-current text-[var(--ro-amber-text)]" />}
                      {w.added_by === 'agent' && <AgentMark />}
                    </div>
                    <div className="flex items-center gap-1.5 pl-3.5">
                      <span className="truncate text-[12px] text-[var(--ro-muted)]">{byline(w)}</span>
                      <TagDots tags={w.tags ?? []} />
                    </div>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1 @min-[480px]:flex">
                    <PaperState work={w} />
                    {w.file !== null && w.file !== undefined && <TextState state={w.file.text_state} />}
                  </span>
                </div>
              </td>
              <td className="num hidden text-[12px] @min-[640px]:table-cell">{w.year > 0 ? w.year : ''}</td>
              <td className="hidden text-[12px] text-[var(--ro-muted)] @min-[900px]:table-cell">{shortDate(w.created)}</td>
              <td className="hidden text-right @min-[760px]:table-cell">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ro-muted)]">
                  {(w.counts?.annotations ?? 0) > 0 && <span className="num" title="Highlights">{w.counts?.annotations}</span>}
                  {(w.counts?.proposed ?? 0) > 0 && <Badge tone="agent" title="Evidence your AI agent proposed">{w.counts?.proposed}</Badge>}
                </span>
              </td>
              <td className="pr-3">
                {w.file ? (
                  <button type="button" title="Read" aria-label="Read" onClick={(e) => { e.stopPropagation(); openPaper(w); }} className="flex size-6 items-center justify-center rounded-[var(--ro-r-sm)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]">
                    <BookOpenText size={14} />
                  </button>
                ) : (
                  <span title="No PDF" className="flex size-6 items-center justify-center text-[var(--ro-muted)] opacity-50">
                    <ScanText size={13} />
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Covers({ rows, selected, onSelect }: { rows: WorkRow[]; selected: string[]; onSelect: (id: string, e?: React.MouseEvent) => void }): React.JSX.Element {
  const menu = useContextMenu();
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-4 p-4">
      {rows.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_WORKS, JSON.stringify(selected.includes(w.id) ? selected : [w.id]))}
            onClick={(e) => onSelect(w.id, e)}
            onDoubleClick={() => openPaper(w)}
            onContextMenu={(e) => rowMenu(w, menu as never, e, false)}
            className={cn('group flex w-full flex-col gap-1.5 rounded-[var(--ro-r-md)] p-1.5 text-left transition-colors', selected.includes(w.id) ? 'bg-[var(--ro-row-hover)]' : 'hover:bg-[var(--ro-row)]')}
          >
            <Cover work={w} width={116} className="mx-auto" />
            <span className="line-clamp-2 text-[12px] font-semibold leading-4">{w.title}</span>
            <span className="flex items-center gap-1 text-[12px] text-[var(--ro-muted)]">
              <ReadDot state={w.read_state} />
              <span className="truncate">{[w.authors_short, w.year > 0 ? w.year : ''].filter(Boolean).join(' ')}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BulkBar({ ids, trash, onDone }: { ids: string[]; trash: boolean; onDone: () => void }): React.JSX.Element {
  const { collections, projects, tags } = useApp();
  const [menu, setMenu] = useState<'col' | 'proj' | 'tag' | 'more' | null>(null);
  const colRef = useRef<HTMLButtonElement | null>(null);
  const projRef = useRef<HTMLButtonElement | null>(null);
  const tagRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const done = (msg: string): void => {
    toast.success(msg);
    setMenu(null);
  };
  if (trash) {
    return (
      <div className="flex items-center gap-2 border-b border-[var(--ro-line)] bg-[var(--ro-row)] px-3 py-1.5">
        <span className="text-[12px] font-bold">{plural(ids.length, 'paper')} selected</span>
        <Button size="sm" icon={RotateCcw} onClick={() => void op('works.restore', { works: ids }).then(() => { changed('works'); onDone(); })}>
          Restore
        </Button>
        <span className="flex-1" />
        <IconButton icon={X} label="Clear the selection" onClick={onDone} />
      </div>
    );
  }
  return (
    <div className="ro-on-ink flex flex-wrap items-center gap-1.5 border-b border-[var(--ro-line)] bg-[var(--ro-ink)] px-3 py-1.5 text-[var(--ro-shell)]">
      <span className="mr-1 text-[12px] font-bold">{plural(ids.length, 'paper')}</span>
      <Button size="sm" variant="onDark" icon={FolderPlus} ref={colRef} onClick={() => setMenu('col')}>
        Collection
      </Button>
      <Button size="sm" variant="onDark" icon={FolderKanban} ref={projRef} onClick={() => setMenu('proj')}>
        Project
      </Button>
      <Button size="sm" variant="onDark" icon={Tag} ref={tagRef} onClick={() => setMenu('tag')}>
        Tag
      </Button>
      <Button size="sm" variant="onDark" icon={Check} onClick={() => void op('works.set-state', { works: ids, read_state: 'read' }).then(() => { changed('works'); done('Marked as read'); })}>
        Read
      </Button>
      <Button size="sm" variant="onDark" icon={MoreHorizontal} ref={moreRef} onClick={() => setMenu('more')}>
        More
      </Button>
      <span className="flex-1" />
      <IconButton icon={X} label="Clear the selection" variant="onDark" onClick={onDone} />
      <Popover open={menu === 'col'} onClose={() => setMenu(null)} anchor={colRef} className="max-h-72 w-56 overflow-y-auto">
        {collections.length === 0 && <p className="px-2 py-1 text-[12px] text-[var(--ro-muted)]">No collections yet</p>}
        {collections.map((c) => (
          <button key={c.id} type="button" className={menuItem} onClick={() => void op('collections.add', { collection: c.id, works: ids }).then(() => { changed('collection_items', 'collections'); done('Added to ' + c.name); })}>
            {c.name}
          </button>
        ))}
      </Popover>
      <Popover open={menu === 'proj'} onClose={() => setMenu(null)} anchor={projRef} className="max-h-72 w-60 overflow-y-auto">
        {projects.filter((p) => p.state === 'active').map((p) => (
          <button key={p.id} type="button" className={menuItem} onClick={() => void op('projects.add-works', { project: p.id, works: ids }).then(() => { changed('project_works', 'projects'); done('Added to ' + p.name); })}>
            <span className="size-2 rounded-full" style={{ background: `var(--ro-pc-${p.color})` }} />
            {p.name}
          </button>
        ))}
        {projects.length === 0 && <p className="px-2 py-1 text-[12px] text-[var(--ro-muted)]">No projects yet</p>}
      </Popover>
      <Popover open={menu === 'tag'} onClose={() => setMenu(null)} anchor={tagRef} className="max-h-72 w-56 overflow-y-auto">
        <TagPicker onPick={(body) => void op('tags.apply', { works: ids, ...body }).then(() => { changed('work_tags', 'tags'); done('Tagged'); })} tags={tags} />
      </Popover>
      <Popover open={menu === 'more'} onClose={() => setMenu(null)} anchor={moreRef} className="w-60">
        <button type="button" className={menuItem} onClick={() => void op('works.set-state', { works: ids, read_state: 'unread' }).then(() => { changed('works'); done('Marked as unread'); })}>
          <RotateCcw size={14} /> Mark as unread
        </button>
        <button type="button" className={menuItem} onClick={() => void op('works.set-state', { works: ids, starred: true }).then(() => { changed('works'); done('Starred'); })}>
          <Star size={14} /> Star
        </button>
        <button type="button" className={menuItem} onClick={() => void op<{ content: string; filename: string }>('export.works', { works: ids, format: 'bibtex' }).then((r) => { download('papers.bib', r.content); setMenu(null); })}>
          <Download size={14} /> Export BibTeX
        </button>
        <button type="button" className={menuItem} onClick={() => void op<{ content: string }>('export.works', { works: ids, format: 'ris' }).then((r) => { download('papers.ris', r.content); setMenu(null); })}>
          <Download size={14} /> Export RIS
        </button>
        <div className="my-1 h-px bg-[var(--ro-hair)]" />
        <button type="button" className={cn(menuItem, 'text-[var(--ro-red-text)] [&>svg]:text-[var(--ro-red-text)]')} onClick={() => void op('works.trash', { works: ids }).then(() => { changed('works'); done(plural(ids.length, 'paper') + ' moved to the trash'); onDone(); })}>
          <Trash2 size={14} /> Move to trash
        </button>
      </Popover>
    </div>
  );
}

export function TagPicker({ tags, onPick }: { tags: { id: string; name: string; color_slot: number }[]; onPick: (b: { tag?: string; name?: string }) => void }): React.JSX.Element {
  const [t, setT] = useState('');
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); if (t.trim() !== '') onPick({ name: t.trim() }); }}>
        <input autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="New or existing tag" className={cn(inputCls, 'mb-1')} />
      </form>
      {tags.filter((x) => x.name.toLowerCase().includes(t.toLowerCase())).map((x) => (
        <button key={x.id} type="button" className={menuItem} onClick={() => onPick({ tag: x.id })}>
          <span className="size-2 rounded-full" style={{ background: x.color_slot > 0 ? `var(--ro-hl-${hueOfSlot(x.color_slot)})` : 'var(--ro-track)' }} />
          {x.name}
        </button>
      ))}
    </>
  );
}

function TrashBar(): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const empty = async (): Promise<void> => {
    const pv = await op<{ works: number; takes: { files: number; annotations: number; notes: number; evidence: number } }>('works.purge', { all_trash: true, preview: true });
    if (!(await confirm(`${plural(pv.works, 'paper')} are deleted for good, with ${plural(pv.takes.files, 'PDF')}, ${plural(pv.takes.annotations, 'highlight')}, ${plural(pv.takes.notes, 'note')} and ${pv.takes.evidence} evidence. This cannot be undone.`, 'Empty the trash?', 'Delete for good'))) return;
    await op('works.purge', { all_trash: true });
    changed('works', 'files');
  };
  return (
    <div className="flex justify-center border-t border-[var(--ro-hair)] p-3">
      {confirmEl}
      <Button variant="danger" icon={Trash2} onClick={() => void empty()}>
        Empty the trash
      </Button>
    </div>
  );
}

interface DupGroup {
  kind: string;
  label: string;
  works: WorkRow[];
}

function Duplicates(): React.JSX.Element {
  const d = useLive((signal) => op<{ groups: DupGroup[]; proposals: Proposal[] }>('works.duplicates', {}, { quiet: true, signal }), ['works', 'proposals'], []);
  const [busy, setBusy] = useState<string | null>(null);
  const merge = async (g: DupGroup): Promise<void> => {
    const master = g.works.find((w) => w.resolution === 'resolved' && w.type !== 'preprint') ?? (g.works[0] as WorkRow);
    setBusy(g.label);
    try {
      await op('works.merge', { master: master.id, works: g.works.filter((w) => w.id !== master.id).map((w) => w.id) });
      changed('works', 'files');
      toast.success('Merged into "' + master.title.slice(0, 60) + '"');
    } catch {
      /* toasted */
    } finally {
      setBusy(null);
    }
  };
  if (d.data === null) return <div className="p-3"><Skeleton className="h-16" /></div>;
  const proposals = d.data.proposals;
  if (d.data.groups.length === 0 && proposals.length === 0) return <Empty icon={Copy} title="No duplicates">Papers that share an identifier, and preprints with their published version, show up here.</Empty>;
  return (
    <div className="flex flex-col gap-3 p-3">
      {proposals.map((p) => (
        <div key={p.id} className="rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)] p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles size={13} /> {p.title}</p>
          {p.why !== '' && <p className="mt-0.5 text-[12px] text-[var(--ro-ink-2)]">{p.why}</p>}
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => void op('proposals.approve', { proposal: p.id }).then(() => changed('works', 'proposals'))}>Merge</Button>
            <Button size="sm" variant="ghost" onClick={() => void op('proposals.reject', { proposal: p.id }).then(() => changed('proposals'))}>Not duplicates</Button>
          </div>
        </div>
      ))}
      {d.data.groups.map((g) => (
        <div key={g.label + g.works.map((w) => w.id).join()} className="rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--ro-hair)] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[12px] font-bold"><Filter size={13} /> {g.label}</span>
            <Button size="sm" loading={busy === g.label} onClick={() => void merge(g)}>
              Merge
            </Button>
          </div>
          <ul>
            {g.works.map((w) => (
              <li key={w.id} className="flex items-center gap-2 border-b border-[var(--ro-hair)] px-3 py-1.5 last:border-0">
                <Cover work={w} width={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{w.title}</span>
                  <span className="block truncate text-[12px] text-[var(--ro-muted)]">{byline(w)} · {w.type}</span>
                </span>
                {w.file && <Badge tone="neutral">PDF</Badge>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-center text-[12px] text-[var(--ro-muted)]">{num(d.data.groups.length)} groups</p>
    </div>
  );
}
