/**
 * A project's research repository: its folders and files as a tree on the
 * left, what is open on the right (the reference: the company OS "Repo" page).
 *
 *   Tree       folders open and close with the box; click opens an item,
 *              Ctrl or Cmd click and Shift click pick several; drag items onto
 *              a folder to move them, drop files or folders from the computer
 *              onto a folder to upload them there; right click for the rest.
 *              Keys: arrows move and open, F2 renames, Delete deletes.
 *   Uploads    one panel with each file's progress; files go in batches.
 *   New        folders and text files are named in place in the tree.
 *
 * A project made before repositories existed gets its starter the first
 * time this opens (repo.init).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Download, FileArchive, FilePlus, FolderInput, FolderPlus, FolderTree, Pencil, Search, SquareMinus, SquarePlus, Trash2, Upload, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { download, errMessage, op } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { plural } from '../../lib/format.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { Project, RepoItem, RepoList } from '../../lib/types.ts';
import { Button, IconButton, LoadError, Modal, Skeleton, useConfirm, useContextMenu, type MenuEntry } from '../ui.tsx';
import { FileView, FolderView, SelectionView, type RepoActions } from './Preview.tsx';
import { iconOf, saveFile, size } from './shared.tsx';
import { batches, dropped, hasFiles, picked, upload, zipEntries, zipFiles, ZIP_LIMIT, type Outgoing, type UploadError } from './transfer.ts';

const DRAG = 'application/x-research-repo';
const EMPTY: RepoItem[] = [];

const byName = (a: RepoItem, b: RepoItem): number => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

interface Job {
  key: number;
  name: string;
  dir: string;
  folder: string;
  file: File;
  state: 'waiting' | 'sending' | 'done' | 'version' | 'failed';
  progress: number;
  note: string;
}

type Row = { kind: 'item'; item: RepoItem; depth: number } | { kind: 'new'; parent: string; what: 'folder' | 'file'; depth: number };

export function RepositoryView({ project, itemId }: { project: Project; itemId: string }): React.JSX.Element {
  const list = useLive((signal) => op<RepoList>('repo.list', { project: project.id }, { quiet: true, signal }), ['repo_items', 'repo_versions'], [project.id], 150);
  const items = list.data?.items ?? EMPTY;
  const by = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);
  const kids = useMemo(() => {
    const m = new Map<string, RepoItem[]>();
    for (const x of items) m.set(x.parent, [...(m.get(x.parent) ?? []), x]);
    for (const v of m.values()) v.sort(byName);
    return m;
  }, [items]);

  // A project from before repositories: make its starter once, the first time it is opened.
  const initing = useRef(false);
  useEffect(() => {
    if (list.data === null || list.data.ready || initing.current) return;
    initing.current = true;
    void op('repo.init', { project: project.id }, { quiet: true })
      .then(() => changed('repo_items'))
      .catch(() => undefined);
  }, [list.data, project.id]);

  const current = itemId !== '' ? (by.get(itemId) ?? null) : null;
  // An address naming something that is gone opens the top; one just made waits for the list to catch up.
  const justMade = useRef('');
  useEffect(() => {
    if (list.data === null || itemId === '') return;
    if (by.has(itemId)) {
      if (justMade.current === itemId) justMade.current = '';
    } else if (justMade.current !== itemId) replaceQuery({ item: undefined });
  }, [list.data, itemId, by]);

  const [sel, setSel] = useState<string[]>([]);
  const anchor = useRef('');
  const openKey = 'ro_repo_open_' + project.id;
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(openKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(openKey, JSON.stringify([...open]));
    } catch {
      /* a convenience */
    }
  }, [open, openKey]);
  const expand = useCallback((ids: string[]) => setOpen((o) => (ids.every((id) => o.has(id)) ? o : new Set([...o, ...ids]))), []);
  // Opening an item opens the folders above it (and the folder itself).
  useEffect(() => {
    if (current === null) return;
    const up: string[] = current.kind === 'folder' ? [current.id] : [];
    for (let p = by.get(current.parent); p !== undefined; p = by.get(p.parent)) up.push(p.id);
    expand(up);
  }, [current, by, expand]);

  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState('');
  const [adding, setAdding] = useState<{ parent: string; what: 'folder' | 'file' } | null>(null);
  const [editOnOpen, setEditOnOpen] = useState('');
  const [moving, setMoving] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [zipping, setZipping] = useState('');
  const [confirmNode, confirm] = useConfirm();
  const menu = useContextMenu();
  const dirty = useRef(false);
  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  // Phone width: the tree or what is open, one at a time.
  const root = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [showTree, setShowTree] = useState(true);
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setNarrow((en[0]?.contentRect.width ?? 1000) < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const openItem = useCallback(
    async (id: string): Promise<void> => {
      if (dirty.current && id !== itemId && !(await confirm('Your changes to the open file are not saved.', 'Leave without saving?', 'Leave'))) return;
      dirty.current = false;
      replaceQuery({ item: id || undefined });
      setSel(id ? [id] : []);
      anchor.current = id;
      setShowTree(false);
    },
    [confirm, itemId],
  );

  /* -------------------------------------------------------------- uploads */

  const jobs = useRef<Job[]>([]);
  const [, bump] = useState(0);
  const render = (): void => bump((n) => n + 1);
  const busy = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const target = useRef('');
  const filesIn = useRef<HTMLInputElement | null>(null);
  const folderIn = useRef<HTMLInputElement | null>(null);

  const pump = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (;;) {
        const waiting = jobs.current.filter((j) => j.state === 'waiting');
        const head = waiting[0];
        if (head === undefined) break;
        const same = waiting.filter((j) => j.folder === head.folder);
        const batch = batches(same.map((j) => ({ file: j.file, dir: j.dir })))[0] ?? [];
        const group = same.slice(0, batch.length);
        for (const j of group) j.state = 'sending';
        render();
        ctrl.current = new AbortController();
        try {
          const r = await upload(project.id, head.folder, batch, (f) => {
            for (const j of group) j.progress = f;
            render();
          }, ctrl.current.signal);
          group.forEach((j, i) => {
            const u = r.uploaded[i];
            j.state = u?.new_version ? 'version' : 'done';
            j.progress = 1;
            j.note = u?.new_version ? 'version ' + u.item.version : '';
          });
          changed('repo_items');
        } catch (e) {
          const err = e as UploadError;
          if (err.code === 'aborted') {
            for (const j of jobs.current)
              if (j.state === 'waiting' || j.state === 'sending') {
                j.state = 'failed';
                j.note = 'Cancelled';
              }
            break;
          }
          for (const j of group) {
            j.state = 'failed';
            j.note = err.message;
          }
        }
        render();
      }
    } finally {
      busy.current = false;
      ctrl.current = null;
      render();
    }
  };

  const enqueue = (folder: string, files: Outgoing[]): void => {
    if (files.length === 0) return;
    jobs.current = [...jobs.current, ...files.map((f) => ({ key: ++seq.current, name: f.file.name, dir: f.dir, folder, file: f.file, state: 'waiting' as const, progress: 0, note: '' }))];
    if (folder !== '') expand([folder]);
    render();
    void pump();
  };

  const pick = (folder: string, mode: 'files' | 'folder'): void => {
    target.current = folder;
    (mode === 'files' ? filesIn : folderIn).current?.click();
  };
  const uploadDropped = (folder: string, dt: DataTransfer): void => {
    void dropped(dt)
      .then((files) => enqueue(folder, files))
      .catch(() => toast.error('Could not read what was dropped.'));
  };

  /* --------------------------------------------------------------- writes */

  const create = async (parent: string, what: 'folder' | 'file', name: string): Promise<void> => {
    setAdding(null);
    const n = name.trim();
    if (n === '') return;
    try {
      if (what === 'folder') {
        const r = await op<{ folder: RepoItem }>('repo.mkdir', { project: project.id, folder: parent, name: n });
        justMade.current = r.folder.id;
        changed('repo_items');
        void openItem(r.folder.id);
      } else {
        const r = await op<{ item: RepoItem }>('repo.write', { project: project.id, folder: parent, name: n, content: '' });
        justMade.current = r.item.id;
        changed('repo_items');
        setEditOnOpen(r.item.id);
        void openItem(r.item.id);
      }
    } catch {
      /* toasted */
    }
  };
  const doRename = async (it: RepoItem, name: string): Promise<void> => {
    setRenaming('');
    const n = name.trim();
    if (n === '' || n === it.name) return;
    try {
      await op('repo.rename', { item: it.id, name: n });
      changed('repo_items');
    } catch {
      /* toasted */
    }
  };
  const doMove = async (ids: string[], to: string): Promise<void> => {
    const moving = ids.filter((id) => by.get(id)?.parent !== to);
    if (moving.length === 0) return;
    try {
      await op('repo.move', { items: moving, to });
      changed('repo_items');
      if (to !== '') expand([to]);
    } catch {
      /* toasted */
    }
  };
  const remove = async (ids: string[]): Promise<void> => {
    const pre = await op<{ takes: { files: number; folders: number } }>('repo.delete', { items: ids, preview: true }).catch(() => null);
    if (pre === null) return;
    const first = by.get(ids[0] ?? '');
    const what = ids.length === 1 && first !== undefined ? '"' + first.path + '"' : plural(ids.length, 'item');
    const one = ids.length === 1 && first?.kind === 'file';
    const all = one ? '' : ' (' + plural(pre.takes.files, 'file') + (pre.takes.folders > 0 ? ' and ' + plural(pre.takes.folders, 'folder') : '') + ' in all)';
    if (!(await confirm('Delete ' + what + all + '? Every earlier version goes too. This cannot be undone.', 'Delete from the repository', 'Delete'))) return;
    try {
      await op('repo.delete', { items: ids });
      changed('repo_items');
      setSel([]);
      const gone = (x: RepoItem | null): boolean => {
        for (let p: RepoItem | undefined = x ?? undefined; p !== undefined; p = by.get(p.parent)) if (ids.includes(p.id)) return true;
        return false;
      };
      if (gone(current)) replaceQuery({ item: first !== undefined && first.parent !== '' && !ids.includes(first.parent) ? first.parent : undefined });
    } catch {
      /* toasted */
    }
  };
  const zipNow = async (roots: RepoItem[] | null, name: string): Promise<void> => {
    const entries = roots === null ? items.filter((x) => x.kind === 'file').map((x) => ({ item: x, name: x.path })) : zipEntries(items, roots);
    if (entries.length === 0) {
      toast.error('There are no files in it to download.');
      return;
    }
    if (entries.reduce((n, e) => n + e.item.bytes, 0) > ZIP_LIMIT) {
      toast.error('Over 2 GB: too large to zip here. Download smaller folders or the files themselves.');
      return;
    }
    setZipping('Zipping...');
    try {
      const blob = await zipFiles(entries, (d, t) => setZipping('Zipping ' + d + ' of ' + t), new AbortController().signal);
      download(name.replace(/[\\/:*?"<>|]/g, '_') + '.zip', blob, 'application/zip');
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setZipping('');
    }
  };

  const acts: RepoActions = {
    project,
    items,
    open: (id) => void openItem(id),
    upload: pick,
    uploadDropped,
    newItem: (parent, what) => {
      setAdding({ parent, what });
      if (parent !== '') expand([parent]);
      setShowTree(true);
    },
    rename: (id) => {
      setRenaming(id);
      setShowTree(true);
    },
    move: (ids) => setMoving(ids),
    remove: (ids) => void remove(ids),
    zip: (roots, name) => void zipNow(roots, name),
    zipping,
    setDirty,
    back: narrow ? () => setShowTree(true) : null,
  };

  /* ----------------------------------------------------------------- tree */

  const needle = q.trim().toLowerCase();
  const rows: Row[] = [];
  if (needle !== '') {
    for (const x of items.filter((y) => y.name.toLowerCase().includes(needle)).sort((a, b) => a.path.localeCompare(b.path))) rows.push({ kind: 'item', item: x, depth: 1 });
  } else {
    const walk = (parent: string, depth: number): void => {
      if (adding !== null && adding.parent === parent) rows.push({ kind: 'new', parent, what: adding.what, depth });
      for (const x of kids.get(parent) ?? []) {
        rows.push({ kind: 'item', item: x, depth });
        if (x.kind === 'folder' && open.has(x.id)) walk(x.id, depth + 1);
      }
    };
    walk('', 1);
  }
  const visible = rows.flatMap((r) => (r.kind === 'item' ? [r.item] : []));
  const chosen = sel.length > 0 ? sel : current !== null ? [current.id] : [];

  const toggle = (id: string): void =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const clickRow = (e: React.MouseEvent, it: RepoItem): void => {
    if (e.metaKey || e.ctrlKey) {
      setSel((s) => {
        const base = s.length > 0 ? s : current !== null ? [current.id] : [];
        return base.includes(it.id) ? base.filter((x) => x !== it.id) : [...base, it.id];
      });
      anchor.current = it.id;
      return;
    }
    if (e.shiftKey && anchor.current !== '') {
      const a = visible.findIndex((x) => x.id === anchor.current);
      const b = visible.findIndex((x) => x.id === it.id);
      if (a >= 0 && b >= 0) {
        setSel(visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id));
        return;
      }
    }
    void openItem(it.id);
  };

  const menuFor = (it: RepoItem | null): MenuEntry[] => {
    if (it !== null && sel.length > 1 && sel.includes(it.id)) {
      const many = sel.map((id) => by.get(id)).filter((x): x is RepoItem => x !== undefined);
      return [
        { label: 'Download as a zip', icon: FileArchive, onClick: () => void zipNow(many, project.name + ' selection') },
        { label: 'Move to...', icon: FolderInput, onClick: () => setMoving(sel) },
        { divider: true, label: '' },
        { label: 'Delete ' + plural(sel.length, 'item'), icon: Trash2, danger: true, hint: 'Del', onClick: () => void remove(sel) },
      ];
    }
    const folder = it === null ? '' : it.kind === 'folder' ? it.id : null;
    const out: MenuEntry[] = [];
    if (folder !== null) {
      out.push(
        { label: 'Upload files here', icon: Upload, onClick: () => pick(folder, 'files') },
        { label: 'Upload a folder here', icon: FolderInput, onClick: () => pick(folder, 'folder') },
        { label: 'New folder', icon: FolderPlus, onClick: () => acts.newItem(folder, 'folder') },
        { label: 'New text file', icon: FilePlus, onClick: () => acts.newItem(folder, 'file') },
        { divider: true, label: '' },
        { label: it === null ? 'Download everything as a zip' : 'Download as a zip', icon: FileArchive, onClick: () => void zipNow(it === null ? null : [it], it === null ? project.name : it.name) },
      );
    } else if (it !== null) out.push({ label: 'Download', icon: Download, onClick: () => saveFile(it) });
    if (it !== null)
      out.push(
        { label: 'Rename', icon: Pencil, hint: 'F2', onClick: () => setRenaming(it.id) },
        { label: 'Move to...', icon: FolderInput, onClick: () => setMoving([it.id]) },
        { divider: true, label: '' },
        { label: 'Delete', icon: Trash2, danger: true, hint: 'Del', onClick: () => void remove([it.id]) },
      );
    return out;
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const at = current !== null ? visible.findIndex((x) => x.id === current.id) : -1;
    const go = (x: RepoItem | undefined): void => {
      if (x === undefined) return;
      e.preventDefault();
      void openItem(x.id);
    };
    if (e.key === 'ArrowDown') go(visible[at + 1]);
    else if (e.key === 'ArrowUp') at > 0 ? go(visible[at - 1]) : (e.preventDefault(), void openItem(''));
    else if (e.key === 'ArrowRight' && current?.kind === 'folder') {
      e.preventDefault();
      if (!open.has(current.id)) toggle(current.id);
      else go(kids.get(current.id)?.[0]);
    } else if (e.key === 'ArrowLeft' && current !== null) {
      e.preventDefault();
      if (current.kind === 'folder' && open.has(current.id)) toggle(current.id);
      else void openItem(current.parent);
    } else if (e.key === 'F2' && current !== null) {
      e.preventDefault();
      setRenaming(current.id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.length > 0) {
      e.preventDefault();
      void remove(chosen);
    } else if (e.key === 'Escape' && sel.length > 1) setSel(current !== null ? [current.id] : []);
  };

  const dropOn = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer) && !e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      e.stopPropagation();
      setDrop(folder);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop((d) => (d === folder ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDrop(null);
      if (hasFiles(e.dataTransfer)) uploadDropped(folder, e.dataTransfer);
      else {
        try {
          void doMove(JSON.parse(e.dataTransfer.getData(DRAG) || '[]') as string[], folder);
        } catch {
          /* not ours */
        }
      }
    },
  });

  const tree = (
    <div
      role="tree"
      aria-label="Repository"
      aria-multiselectable
      tabIndex={0}
      onKeyDown={onKey}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 outline-none"
      {...dropOn('')}
      onContextMenu={(e) => menu(e, menuFor(null))}
    >
      <div
        role="treeitem"
        aria-selected={current === null && sel.length === 0}
        aria-expanded
        onClick={() => void openItem('')}
        onContextMenu={(e) => {
          e.stopPropagation();
          menu(e, menuFor(null));
        }}
        {...dropOn('')}
        className={cn('flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] font-semibold', current === null && sel.length === 0 ? 'bg-[var(--ro-primary)] text-white' : 'hover:bg-[var(--ro-row)]', drop === '' && !(current === null && sel.length === 0) && 'bg-[var(--ro-accent-soft)]')}
      >
        <SquareMinus size={13} className="shrink-0 opacity-70" aria-hidden />
        <FolderTree size={14} className={cn('shrink-0', current === null && sel.length === 0 ? 'text-white' : 'text-[var(--ro-accent)]')} />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
      </div>
      {rows.map((r) =>
        r.kind === 'new' ? (
          <NewRow key={'new' + r.parent} depth={r.depth} what={r.what} onDone={(name) => void create(r.parent, r.what, name)} onCancel={() => setAdding(null)} />
        ) : (
          <TreeRow
            key={r.item.id}
            item={r.item}
            depth={r.depth}
            path={needle !== '' ? r.item.path : ''}
            open={open.has(r.item.id)}
            selected={chosen.includes(r.item.id)}
            dropHere={drop === r.item.id && r.item.kind === 'folder'}
            renaming={renaming === r.item.id}
            onToggle={() => toggle(r.item.id)}
            onClick={(e) => clickRow(e, r.item)}
            onMenu={(e) => {
              e.stopPropagation();
              menu(e, menuFor(r.item));
            }}
            onDragStart={(e) => {
              const ids = sel.length > 1 && sel.includes(r.item.id) ? sel : [r.item.id];
              e.dataTransfer.setData(DRAG, JSON.stringify(ids));
              e.dataTransfer.effectAllowed = 'move';
            }}
            drop={dropOn(r.item.kind === 'folder' ? r.item.id : r.item.parent)}
            onRename={(name) => void doRename(r.item, name)}
            onRenameCancel={() => setRenaming('')}
          />
        ),
      )}
      {needle !== '' && rows.length === 0 && <p className="px-3 py-4 text-[12px] text-[var(--ro-muted)]">Nothing is called that.</p>}
    </div>
  );

  const showing = sel.length > 1 ? <SelectionView ids={sel} acts={acts} onClear={() => setSel(current !== null ? [current.id] : [])} /> : current === null ? <FolderView folder={null} acts={acts} /> : current.kind === 'folder' ? <FolderView key={current.id} folder={current} acts={acts} /> : <FileView key={current.id} item={current} acts={acts} startEditing={editOnOpen === current.id} />;

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col @container">
      <header className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
        <FolderTree size={16} className="text-[var(--ro-muted)]" />
        <h1 className="text-[15px] font-bold">Repository</h1>
        {list.data !== null && (
          <span className="num text-[12px] text-[var(--ro-muted)]">
            {plural(list.data.files, 'file')} · {size(list.data.bytes)}
          </span>
        )}
        <span className="flex-1" />
        <label className="flex h-8 w-56 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2 focus-within:border-[var(--ro-ink)]">
          <Search size={13} className="shrink-0 text-[var(--ro-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a file" aria-label="Find a file" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          {q !== '' && <IconButton icon={X} label="Clear" size={20} onClick={() => setQ('')} />}
        </label>
      </header>
      {list.error !== null ? (
        <div className="px-4">
          <LoadError message={list.error} onRetry={list.reload} />
        </div>
      ) : list.data === null || !list.data.ready ? (
        <div className="mx-4 mb-4 flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      ) : (
        <div className="mx-4 mb-4 flex min-h-0 flex-1 overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          {(!narrow || showTree) && <aside className={cn('flex min-h-0 flex-col border-[var(--ro-line)]', narrow ? 'w-full' : 'w-[320px] shrink-0 border-r')}>{tree}</aside>}
          {(!narrow || !showTree) && (
            <section data-scroll aria-label="Open item" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {showing}
            </section>
          )}
        </div>
      )}
      <Uploads jobs={jobs.current} onCancel={() => ctrl.current?.abort()} onClear={() => ((jobs.current = jobs.current.filter((j) => j.state === 'waiting' || j.state === 'sending')), render())} />
      <input
        ref={filesIn}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).map((file) => ({ file, dir: '' }));
          e.target.value = '';
          enqueue(target.current, files);
        }}
      />
      <input
        ref={folderIn}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(e) => {
          const files = e.target.files !== null ? picked(e.target.files) : [];
          e.target.value = '';
          enqueue(target.current, files);
        }}
      />
      {moving !== null && <MoveDialog ids={moving} items={items} kids={kids} project={project} onClose={() => setMoving(null)} onMove={(to) => (setMoving(null), void doMove(moving, to))} />}
      {confirmNode}
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

function Guides({ depth, hidden }: { depth: number; hidden: boolean }): React.JSX.Element | null {
  if (hidden || depth <= 1) return null;
  return (
    <>
      {Array.from({ length: depth - 1 }, (_, l) => (
        <span key={l} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-[var(--ro-line)]" style={{ left: 14 + (l + 1) * 16 }} />
      ))}
    </>
  );
}

function TreeRow({
  item,
  depth,
  path,
  open,
  selected,
  dropHere,
  renaming,
  onToggle,
  onClick,
  onMenu,
  onDragStart,
  drop,
  onRename,
  onRenameCancel,
}: {
  item: RepoItem;
  depth: number;
  path: string;
  open: boolean;
  selected: boolean;
  dropHere: boolean;
  renaming: boolean;
  onToggle: () => void;
  onClick: (e: React.MouseEvent) => void;
  onMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  drop: { onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void } | undefined;
  onRename: (name: string) => void;
  onRenameCancel: () => void;
}): React.JSX.Element {
  const folder = item.kind === 'folder';
  const Icon = iconOf(item, folder && open);
  const Box = open ? SquareMinus : SquarePlus;
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={folder ? open : undefined}
      draggable={!renaming}
      onDragStart={onDragStart}
      onClick={onClick}
      onContextMenu={onMenu}
      {...(drop ?? {})}
      title={item.path}
      className={cn('relative flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 pr-2 text-[13px]', selected ? 'bg-[var(--ro-primary)] text-white' : dropHere ? 'bg-[var(--ro-accent-soft)]' : 'hover:bg-[var(--ro-row)]')}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <Guides depth={depth} hidden={selected || path !== ''} />
      {folder && path === '' ? (
        <button
          type="button"
          aria-label={open ? 'Close ' + item.name : 'Open ' + item.name}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex size-4 shrink-0 items-center justify-center"
        >
          <Box size={13} className={selected ? 'text-white' : 'text-[var(--ro-ink-2)]'} />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <Icon size={14} className={cn('shrink-0', selected ? 'text-white' : folder ? 'text-[var(--ro-amber)]' : 'text-[var(--ro-ink-2)]')} />
      {renaming ? (
        <NameInput initial={item.name} onDone={onRename} onCancel={onRenameCancel} label={'New name for ' + item.name} />
      ) : (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate">{item.name}</span>
          {path !== '' && <span className={cn('truncate text-[12px]', selected ? 'text-white' : 'text-[var(--ro-muted)]')}>{path.slice(0, -item.name.length - 1)}</span>}
        </span>
      )}
      {!folder && !renaming && <span className={cn('num shrink-0 text-[12px]', selected ? 'text-white' : 'text-[var(--ro-muted)]')}>{size(item.bytes)}</span>}
    </div>
  );
}

function NameInput({ initial, onDone, onCancel, label, placeholder }: { initial: string; onDone: (name: string) => void; onCancel: () => void; label: string; placeholder?: string }): React.JSX.Element {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (ok: boolean): void => {
    if (done.current) return;
    done.current = true;
    if (ok) onDone(v);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => {
        // Select the name without its extension, as file managers do.
        const dot = initial.lastIndexOf('.');
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(v.trim() !== '')}
      aria-label={label}
      placeholder={placeholder}
      className="h-6 min-w-0 flex-1 rounded-[var(--ro-r-sm)] border border-[var(--ro-ink)] bg-[var(--ro-card)] px-1.5 text-[13px] text-[var(--ro-ink)] outline-none"
    />
  );
}

function NewRow({ depth, what, onDone, onCancel }: { depth: number; what: 'folder' | 'file'; onDone: (name: string) => void; onCancel: () => void }): React.JSX.Element {
  const Icon = what === 'folder' ? FolderPlus : FilePlus;
  return (
    <div className="relative flex h-8 shrink-0 items-center gap-1.5 pr-2" style={{ paddingLeft: 8 + depth * 16 }}>
      <Guides depth={depth} hidden={false} />
      <span className="w-4 shrink-0" />
      <Icon size={14} className="shrink-0 text-[var(--ro-ink-2)]" />
      <NameInput initial="" onDone={onDone} onCancel={onCancel} label={what === 'folder' ? 'Name of the new folder' : 'Name of the new text file'} placeholder={what === 'folder' ? 'Folder name' : 'notes.md'} />
    </div>
  );
}

/* --------------------------------------------------------------- uploads */

function Uploads({ jobs, onCancel, onClear }: { jobs: Job[]; onCancel: () => void; onClear: () => void }): React.JSX.Element | null {
  if (jobs.length === 0) return null;
  const left = jobs.filter((j) => j.state === 'waiting' || j.state === 'sending').length;
  const failed = jobs.filter((j) => j.state === 'failed').length;
  const done = jobs.length - left - failed;
  return (
    <section aria-label="Uploads" className="fixed bottom-4 right-4 z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] shadow-[var(--ro-shadow)]">
      <header className="flex items-center gap-2 border-b border-[var(--ro-line)] px-3 py-2">
        <span className="flex-1 text-[13px] font-bold">{left > 0 ? 'Uploading ' + (done + failed + 1) + ' of ' + jobs.length : 'Uploaded ' + plural(done, 'file') + (failed > 0 ? ', ' + failed + ' failed' : '')}</span>
        {left > 0 ? (
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <IconButton icon={X} label="Close" size={24} onClick={onClear} />
        )}
      </header>
      <ul className="flex max-h-60 flex-col overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.key} className="flex flex-col gap-1 border-b border-[var(--ro-hair)] px-3 py-1.5 last:border-0">
            <span className="flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-semibold" title={(j.dir !== '' ? j.dir + '/' : '') + j.name}>
                {j.name}
              </span>
              {j.state === 'done' && <Check size={13} className="text-[var(--ro-green-text)]" aria-label="Uploaded" />}
              {j.state === 'version' && <span className="text-[var(--ro-ink-2)]">new {j.note}</span>}
              {j.state === 'failed' && <CircleAlert size={13} className="text-[var(--ro-red-text)]" aria-label="Failed" />}
              {j.state === 'waiting' && <span className="text-[var(--ro-muted)]">waiting</span>}
              {j.state === 'sending' && <span className="num text-[var(--ro-ink-2)]">{Math.round(j.progress * 100)}%</span>}
            </span>
            {j.state === 'sending' && (
              <span className="h-1 overflow-hidden rounded-full bg-[var(--ro-row-hover)]">
                <span className="block h-full bg-[var(--ro-accent)]" style={{ width: Math.round(j.progress * 100) + '%' }} />
              </span>
            )}
            {j.state === 'failed' && <span className="text-[12px] text-[var(--ro-red-text)]">{j.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ move */

function MoveDialog({ ids, items, kids, project, onClose, onMove }: { ids: string[]; items: RepoItem[]; kids: Map<string, RepoItem[]>; project: Project; onClose: () => void; onMove: (to: string) => void }): React.JSX.Element {
  const moving = items.filter((x) => ids.includes(x.id));
  // A folder cannot go into itself or a folder inside it.
  const blocked = (f: RepoItem): boolean => moving.some((m) => m.kind === 'folder' && (f.id === m.id || f.path.startsWith(m.path + '/')));
  const [to, setTo] = useState<string | null>(null);
  const rows: { f: RepoItem; depth: number }[] = [];
  const walk = (parent: string, depth: number): void => {
    for (const f of (kids.get(parent) ?? []).filter((x) => x.kind === 'folder')) {
      rows.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk('', 1);
  const option = (id: string, label: string, depth: number, disabled: boolean): React.JSX.Element => (
    <button key={id || 'top'} type="button" role="radio" aria-checked={to === id} disabled={disabled} onClick={() => setTo(id)} className={cn('flex h-8 w-full items-center gap-2 pr-2 text-left text-[13px] disabled:opacity-40', to === id ? 'bg-[var(--ro-primary)] text-white' : 'enabled:hover:bg-[var(--ro-row)]')} style={{ paddingLeft: 8 + depth * 16 }}>
      {id === '' ? <FolderTree size={14} className={to === id ? 'text-white' : 'text-[var(--ro-accent)]'} /> : <FolderInput size={14} className={to === id ? 'text-white' : 'text-[var(--ro-amber)]'} />}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={'Move ' + (moving.length === 1 && moving[0] !== undefined ? moving[0].name : plural(moving.length, 'item'))}
      icon={FolderInput}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={to === null} onClick={() => to !== null && onMove(to)}>
            Move here
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Into which folder" className="flex max-h-[50vh] flex-col overflow-y-auto rounded-[var(--ro-r)] border border-[var(--ro-line)] py-1">
        {option('', project.name, 0, false)}
        {rows.map((r) => option(r.f.id, r.f.name, r.depth, blocked(r.f)))}
      </div>
    </Modal>
  );
}
