/**
 * The library's left tree: built-in views, collections (a tree with
 * chevrons, counts and an inline "+"; drop papers on a row to add them;
 * double click to rename) and tags.
 */
import { useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, ChevronDown, ChevronRight, CircleAlert, Clock, Copy, FileQuestion, FileX, Folder, FolderOpen, Library, Pencil, Plus, Sparkles, Star, Tag, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { changed } from '../../lib/live.ts';
import { num } from '../../lib/format.ts';
import type { CollectionRow, Counts, TagRow } from '../../lib/types.ts';
import { hueOfSlot } from '../paper.tsx';
import { useConfirm, useContextMenu } from '../ui.tsx';

export interface TreeSel {
  view: string;
  collection: string;
  tag: string;
}

export const DRAG_WORKS = 'application/x-research-works';

const VIEWS: { key: string; label: string; icon: LucideIcon; count?: keyof Counts }[] = [
  { key: 'all', label: 'All papers', icon: Library, count: 'total' },
  { key: 'unread', label: 'Unread', icon: BookOpen, count: 'unread' },
  { key: 'recent', label: 'Recently added', icon: Clock, count: 'recent' },
  { key: 'opened', label: 'Recently read', icon: BookOpen },
  { key: 'starred', label: 'Starred', icon: Star, count: 'starred' },
  { key: 'to_identify', label: 'To identify', icon: FileQuestion, count: 'to_identify' },
  { key: 'integrity', label: 'Integrity alerts', icon: CircleAlert, count: 'integrity' },
  { key: 'no_pdf', label: 'Without a PDF', icon: FileX },
  { key: 'agent_added', label: 'Added by your AI agent', icon: Sparkles },
  { key: 'duplicates', label: 'Duplicates', icon: Copy },
  { key: 'trash', label: 'Trash', icon: Trash2, count: 'trash' },
];

export function Row({
  icon: Icon,
  label,
  count,
  active,
  depth = 0,
  chevron,
  onChevron,
  onClick,
  onPlus,
  plusLabel,
  onDropWorks,
  onContextMenu,
  onDoubleClick,
  dot,
  editing,
  onRename,
}: {
  icon: LucideIcon;
  label: string;
  count?: number | undefined;
  active: boolean;
  depth?: number;
  chevron?: 'open' | 'closed' | 'none';
  onChevron?: () => void;
  onClick: () => void;
  onPlus?: () => void;
  plusLabel?: string;
  onDropWorks?: (ids: string[]) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  dot?: string;
  editing?: boolean;
  onRename?: (name: string | null) => void;
}): React.JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <div
      role="treeitem"
      aria-selected={active}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (onDropWorks && e.dataTransfer.types.includes(DRAG_WORKS)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_WORKS);
        if (onDropWorks && raw !== '') {
          e.preventDefault();
          onDropWorks(JSON.parse(raw) as string[]);
        }
      }}
      data-hover
      className={cn('group flex h-7 items-center gap-1.5 rounded-[var(--ro-r-sm)] pr-1 text-[13px] transition-colors', active ? 'bg-[var(--ro-row-hover)] font-semibold text-[var(--ro-ink)]' : 'text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]', over && 'bg-[var(--ro-accent-soft)] outline outline-1 outline-[var(--ro-accent)]')}
      style={{ paddingLeft: 4 + depth * 12 }}
    >
      {chevron !== undefined ? (
        <button
          type="button"
          aria-label={chevron === 'open' ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onChevron?.();
          }}
          className={cn('flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[var(--ro-muted)] hover:text-[var(--ro-ink)]', chevron === 'none' && 'invisible')}
        >
          {chevron === 'open' ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : null}
      {dot !== undefined ? <span className="ml-1 mr-0.5 size-2 shrink-0 rounded-full" style={{ background: dot }} /> : <Icon size={14} className="shrink-0" />}
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename?.((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') onRename?.(null);
          }}
          onBlur={(e) => onRename?.(e.target.value)}
          className="h-5 min-w-0 flex-1 rounded-[3px] border border-[var(--ro-ink)] bg-[var(--ro-card)] px-1 text-[13px] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {onPlus !== undefined && (
        <button
          type="button"
          aria-label={plusLabel ?? 'Add'}
          title={plusLabel ?? 'Add'}
          onClick={(e) => {
            e.stopPropagation();
            onPlus();
          }}
          className="hidden size-5 shrink-0 items-center justify-center rounded-[3px] text-[var(--ro-muted)] hover:bg-[var(--ro-row-hover)] hover:text-[var(--ro-ink)] group-hover:flex"
        >
          <Plus size={13} />
        </button>
      )}
      {count !== undefined && count > 0 && <span className="num shrink-0 text-[12px] text-[var(--ro-muted)]">{num(count)}</span>}
    </div>
  );
}

export function LibraryTree({ sel, counts, onSelect }: { sel: TreeSel; counts: Counts | null; onSelect: (s: Partial<TreeSel>) => void }): React.JSX.Element {
  const { collections, tags } = useApp();
  const menu = useContextMenu();
  const [confirmEl, confirm] = useConfirm();
  const [open, setOpen] = useState<Record<string, boolean>>({ __cols: true, __tags: true });
  const [editing, setEditing] = useState<string | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const tree = useMemo(() => {
    const kids: Record<string, CollectionRow[]> = {};
    for (const c of collections) (kids[c.parent] = kids[c.parent] ?? []).push(c);
    return kids;
  }, [collections]);
  const addTo = async (collection: CollectionRow, ids: string[]): Promise<void> => {
    await op('collections.add', { collection: collection.id, works: ids });
    changed('collection_items', 'collections');
    toast.success('Added to ' + collection.name);
  };
  const tagWorks = async (tag: TagRow, ids: string[]): Promise<void> => {
    await op('tags.apply', { tag: tag.id, works: ids });
    changed('work_tags', 'tags');
    toast.success('Tagged ' + tag.name);
  };
  const create = async (parent: string, name: string): Promise<void> => {
    if (name.trim() === '') return;
    const r = await op<{ collection: { id: string } }>('collections.create', { name: name.trim(), parent });
    changed('collections');
    onSelect({ view: '', collection: r.collection.id, tag: '' });
  };
  const rename = async (c: CollectionRow, name: string | null): Promise<void> => {
    setEditing(null);
    if (name === null || name.trim() === '' || name.trim() === c.name) return;
    await op('collections.update', { collection: c.id, name: name.trim() });
    changed('collections');
  };
  const remove = async (c: CollectionRow): Promise<void> => {
    if (!(await confirm('The papers stay in your library; only this collection' + ((tree[c.id] ?? []).length > 0 ? ' and the collections inside it' : '') + ' go.', 'Remove "' + c.name + '"?', 'Remove'))) return;
    await op('collections.delete', { collection: c.id });
    changed('collections', 'collection_items');
    if (sel.collection === c.id) onSelect({ view: 'all', collection: '', tag: '' });
  };
  const draw = (parent: string, depth: number): React.JSX.Element[] => {
    const out: React.JSX.Element[] = [];
    for (const c of tree[parent] ?? []) {
      const has = (tree[c.id] ?? []).length > 0;
      const isOpen = open[c.id] === true;
      out.push(
        <Row
          key={c.id}
          icon={sel.collection === c.id ? FolderOpen : Folder}
          label={c.name}
          count={c.n}
          depth={depth}
          active={sel.collection === c.id}
          chevron={has || making === c.id ? (isOpen || making === c.id ? 'open' : 'closed') : 'none'}
          onChevron={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))}
          onClick={() => onSelect({ view: '', collection: c.id, tag: '' })}
          onDoubleClick={() => setEditing(c.id)}
          editing={editing === c.id}
          onRename={(n) => void rename(c, n)}
          onPlus={() => {
            setOpen((o) => ({ ...o, [c.id]: true }));
            setMaking(c.id);
          }}
          plusLabel="New collection inside"
          onDropWorks={(ids) => void addTo(c, ids)}
          onContextMenu={(e) =>
            menu(e, [
              { label: 'Rename', icon: Pencil, onClick: () => setEditing(c.id) },
              { label: 'New collection inside', icon: Plus, onClick: () => setMaking(c.id) },
              { divider: true, label: '' },
              { label: 'Remove collection', icon: Trash2, danger: true, onClick: () => void remove(c) },
            ])
          }
        />,
      );
      if (making === c.id) out.push(<NewRow key={'new' + c.id} depth={depth + 1} onDone={(n) => { setMaking(null); if (n !== null) void create(c.id, n); }} />);
      if (has && isOpen) out.push(...draw(c.id, depth + 1));
    }
    return out;
  };
  return (
    <nav aria-label="Library" role="tree" className="flex flex-col gap-0.5 p-2">
      {confirmEl}
      {VIEWS.map((v) => (
        <Row key={v.key} icon={v.icon} label={v.label} count={v.count && counts ? (counts[v.count] as number) : undefined} active={sel.view === v.key && sel.collection === '' && sel.tag === ''} onClick={() => onSelect({ view: v.key, collection: '', tag: '' })} />
      ))}
      <div className="mt-2 border-t border-[var(--ro-hair)] pt-2">
        <Row icon={Folder} label="Collections" active={false} chevron={open.__cols ? 'open' : 'closed'} onChevron={() => setOpen((o) => ({ ...o, __cols: !o.__cols }))} onClick={() => setOpen((o) => ({ ...o, __cols: !o.__cols }))} onPlus={() => { setOpen((o) => ({ ...o, __cols: true })); setMaking(''); }} plusLabel="New collection" />
        {open.__cols && (
          <>
            {making === '' && <NewRow depth={1} onDone={(n) => { setMaking(null); if (n !== null) void create('', n); }} />}
            {draw('', 1)}
          </>
        )}
      </div>
      <div className="mt-2 border-t border-[var(--ro-hair)] pt-2">
        <Row icon={Tag} label="Tags" active={false} chevron={open.__tags ? 'open' : 'closed'} onChevron={() => setOpen((o) => ({ ...o, __tags: !o.__tags }))} onClick={() => setOpen((o) => ({ ...o, __tags: !o.__tags }))} />
        {open.__tags &&
          tags.map((t) => (
            <Row
              key={t.id}
              icon={Tag}
              dot={t.color_slot > 0 ? `var(--ro-hl-${hueOfSlot(t.color_slot)})` : 'var(--ro-track)'}
              label={t.name}
              count={t.n}
              depth={1}
              active={sel.tag === t.id}
              onClick={() => onSelect({ view: '', collection: '', tag: t.id })}
              onDropWorks={(ids) => void tagWorks(t, ids)}
              onContextMenu={(e) =>
                menu(e, [
                  ...[1, 2, 3, 4, 5, 6, 7, 8, 0].map((slot) => ({ label: slot === 0 ? 'No color' : hueOfSlot(slot).charAt(0).toUpperCase() + hueOfSlot(slot).slice(1), onClick: () => void op('tags.update', { tag: t.id, color_slot: slot }).then(() => changed('tags')) })),
                  { divider: true, label: '' },
                  { label: 'Remove tag', icon: Trash2, danger: true, onClick: () => void confirm('It comes off every paper.', 'Remove the tag "' + t.name + '"?', 'Remove').then(async (ok) => { if (ok) { await op('tags.delete', { tag: t.id }); changed('tags', 'work_tags'); } }) },
                ])
              }
            />
          ))}
        {open.__tags && tags.length === 0 && <p className="px-6 py-1 text-[12px] text-[var(--ro-muted)]">No tags yet</p>}
      </div>
    </nav>
  );
}

function NewRow({ depth, onDone }: { depth: number; onDone: (name: string | null) => void }): React.JSX.Element {
  const done = useRef(false);
  const finish = (v: string | null): void => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <div className="flex h-7 items-center gap-1.5 pr-1" style={{ paddingLeft: 4 + depth * 12 + 20 }}>
      <Folder size={14} className="shrink-0 text-[var(--ro-muted)]" />
      <input
        autoFocus
        placeholder="Collection name"
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') finish(null);
        }}
        onBlur={(e) => finish(e.target.value.trim() === '' ? null : e.target.value)}
        className="h-5 min-w-0 flex-1 rounded-[3px] border border-[var(--ro-ink)] bg-[var(--ro-card)] px-1 text-[13px] outline-none"
      />
    </div>
  );
}
