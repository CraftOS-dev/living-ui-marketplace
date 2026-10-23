/**
 * The right side of the repository: what is open.
 *
 *   FileView       the file shown as what it is (text and code with line
 *                  numbers, Markdown drawn, CSV as a table, pictures, PDFs,
 *                  sound, video), Download, Edit for text files (saving makes
 *                  a new version), and its versions (look at, download or
 *                  restore an earlier one)
 *   FolderView     what is inside, with the folder's README drawn below it
 *   SelectionView  several items picked at once
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, FileArchive, FilePlus, FolderInput, FolderPlus, FolderTree, History, MoreHorizontal, Pencil, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { changed } from '../../lib/live.ts';
import { ago, num, plural, shortDate, time } from '../../lib/format.ts';
import type { Project, RepoItem, RepoVersion } from '../../lib/types.ts';
import { Button, Empty, IconButton, Popover, Segmented, Spinner, menuItem } from '../ui.tsx';
import { drawPage, openDocument, type PDFDocumentProxy } from '../reader/pdf.ts';
import { Markdown, type Resolved } from './markdown.tsx';
import { EDIT_LIMIT, extOf, fileUrl, iconOf, isTextLike, parseDelimited, saveFile, size, WHO } from './shared.tsx';
import { hasFiles } from './transfer.ts';

export interface RepoActions {
  project: Project;
  items: RepoItem[];
  open: (id: string) => void;
  upload: (folder: string, mode: 'files' | 'folder') => void;
  uploadDropped: (folder: string, dt: DataTransfer) => void;
  newItem: (parent: string, kind: 'folder' | 'file') => void;
  rename: (id: string) => void;
  move: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  zip: (roots: RepoItem[] | null, name: string) => void;
  zipping: string;
  /** Unsaved edits: leaving the file asks first. */
  setDirty: (d: boolean) => void;
  /** Phone width: the way back to the tree. */
  back: (() => void) | null;
}

const byName = (a: RepoItem, b: RepoItem): number => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

/** The text of a file, fetched while `url` is set. */
function useText(url: string | null): { text: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; text: string | null; error: string | null }>({ url: null, text: null, error: null });
  useEffect(() => {
    if (url === null) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? setState({ url, text: await r.text(), error: null }) : setState({ url, text: null, error: 'Could not read the file (' + r.status + ').' })))
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setState({ url, text: null, error: 'Could not read the file.' });
      });
    return () => ctrl.abort();
  }, [url]);
  return state.url === url ? { text: state.text, error: state.error } : { text: null, error: null };
}

/** A link or picture path in a Markdown file, from the file's folder. */
function resolver(acts: RepoActions, base: string): (href: string) => Resolved | null {
  const byPath = new Map(acts.items.map((x) => [x.path.toLowerCase(), x]));
  return (href) => {
    const clean = decodeURI(href.split('#')[0]?.split('?')[0] ?? '');
    if (clean === '') return null;
    const parts = (clean.startsWith('/') ? [] : base === '' ? [] : base.split('/')).slice();
    for (const p of clean.replace(/^\/+/, '').split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') parts.pop();
      else parts.push(p);
    }
    const it = byPath.get(parts.join('/').toLowerCase()) ?? byPath.get(parts.join('/').replace(/\/$/, '').toLowerCase());
    if (it === undefined) return null;
    return it.kind === 'file' && it.shown_as === 'image' ? { open: () => acts.open(it.id), src: fileUrl(it) } : { open: () => acts.open(it.id) };
  };
}

function Header({ icon: Icon, title, sub, actions, back }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; sub: React.ReactNode; actions: React.ReactNode; back: (() => void) | null }): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--ro-line)] px-5 py-4">
      {back !== null && <IconButton icon={ArrowLeft} label="Back to the files" variant="secondary" onClick={back} />}
      <Icon size={16} className="mt-1 shrink-0 text-[var(--ro-ink-2)]" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-bold leading-6">{title}</h2>
        <p className="truncate font-mono text-[12px] text-[var(--ro-muted)]">{sub}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
    </header>
  );
}

/* ----------------------------------------------------------------- file */

export function FileView({ item, acts, startEditing }: { item: RepoItem; acts: RepoActions; startEditing: boolean }): React.JSX.Element {
  const [version, setVersion] = useState(item.version);
  useEffect(() => setVersion(item.version), [item.id, item.version]);
  const [mode, setMode] = useState<'view' | 'edit'>(startEditing ? 'edit' : 'view');
  const [md, setMd] = useState<'preview' | 'code'>('preview');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const verBtn = useRef<HTMLButtonElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const old = version !== item.version;
  const editable = isTextLike(item) && item.bytes <= EDIT_LIMIT && !old;
  const textual = isTextLike(item) && item.bytes <= (item.shown_as === 'table' ? 5 : 2) * 1024 * 1024;
  const text = useText((textual || mode === 'edit') && item.bytes > 0 ? fileUrl(item, version) : null);
  const Icon = iconOf(item);
  const sub = (
    <>
      {item.path} · {size(item.bytes)} ·{' '}
      <button ref={verBtn} type="button" onClick={() => setVersionsOpen((o) => !o)} className="font-mono underline-offset-2 hover:text-[var(--ro-ink)] hover:underline" title="Versions">
        version {version}
        {item.version > 1 ? ' of ' + item.version : ''}
      </button>
      {item.actor === 'agent' && ' · by your AI agent'}
    </>
  );
  return (
    <div className="flex min-h-full flex-col">
      <Header
        icon={Icon}
        title={item.name}
        sub={sub}
        back={acts.back}
        actions={
          mode === 'edit' ? null : (
            <>
              {item.shown_as === 'markdown' && textual && <Segmented label="Show" size="sm" value={md} onChange={setMd} options={[{ value: 'preview', label: 'Preview' }, { value: 'code', label: 'Code' }]} />}
              {editable && (
                <Button icon={Pencil} onClick={() => setMode('edit')}>
                  Edit
                </Button>
              )}
              {item.version > 1 && <IconButton icon={History} label="Versions" variant="secondary" onClick={() => setVersionsOpen((o) => !o)} />}
              <IconButton ref={moreBtn} icon={MoreHorizontal} label="More" variant="secondary" onClick={() => setMoreOpen((o) => !o)} />
              <Button variant="primary" icon={Download} onClick={() => saveFile(item, version)}>
                Download
              </Button>
            </>
          )
        }
      />
      <Popover open={moreOpen} anchor={moreBtn} onClose={() => setMoreOpen(false)} align="right" className="w-52 p-1">
        <button type="button" className={menuItem} onClick={() => (setMoreOpen(false), acts.rename(item.id))}>
          <Pencil size={13} /> Rename
        </button>
        <button type="button" className={menuItem} onClick={() => (setMoreOpen(false), acts.move([item.id]))}>
          <FolderInput size={13} /> Move to...
        </button>
        <button type="button" className={cn(menuItem, 'text-[var(--ro-red-text)]')} onClick={() => (setMoreOpen(false), acts.remove([item.id]))}>
          <Trash2 size={13} /> Delete
        </button>
      </Popover>
      <Versions item={item} open={versionsOpen} anchor={verBtn} onClose={() => setVersionsOpen(false)} viewing={version} onView={(n) => (setVersion(n), setVersionsOpen(false), setMode('view'))} />
      {old && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ro-line)] bg-[var(--ro-row)] px-5 py-2 text-[12px]">
          <History size={13} className="text-[var(--ro-ink-2)]" />
          <span className="flex-1 font-semibold text-[var(--ro-ink-2)]">
            An earlier version: {version} of {item.version}
          </span>
          <Button size="sm" onClick={() => setVersion(item.version)}>
            Back to the current one
          </Button>
          <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => void restore(item, version).then((ok) => ok && setVersion(item.version + 1))}>
            Restore this version
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 p-5">
        {mode === 'edit' ? (
          text.text === null && text.error === null && item.bytes > 0 ? (
            <Spinner />
          ) : (
            <Editor
              key={item.id + ':' + item.version}
              item={item}
              initial={text.text ?? ''}
              onDone={() => {
                acts.setDirty(false);
                setMode('view');
              }}
              setDirty={acts.setDirty}
            />
          )
        ) : (
          <Body item={item} version={version} textual={textual} text={text} md={md} acts={acts} />
        )}
      </div>
    </div>
  );
}

async function restore(item: RepoItem, version: number): Promise<boolean> {
  try {
    await op('repo.restore', { item: item.id, version });
    changed('repo_items', 'repo_versions');
    toast.success('Restored version ' + version + ' of ' + item.name + '. The newer one is kept as a version too.');
    return true;
  } catch {
    return false;
  }
}

function Body({ item, version, textual, text, md, acts }: { item: RepoItem; version: number; textual: boolean; text: { text: string | null; error: string | null }; md: 'preview' | 'code'; acts: RepoActions }): React.JSX.Element {
  const url = fileUrl(item, version);
  const s = item.shown_as;
  if (s === 'image') return <img src={url} alt={item.name} className="mx-auto max-h-[70vh] max-w-full rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-row)] object-contain" />;
  if (s === 'pdf') return <PdfPages id={item.id + ':' + version} url={url} />;
  if (s === 'audio') return <audio controls src={url} className="w-full" />;
  if (s === 'video') return <video controls src={url} className="max-h-[70vh] w-full rounded-[var(--ro-r)] bg-black" />;
  if (isTextLike(item) && !textual)
    return (
      <Empty icon={iconOf(item)} title="Too large to show here" action={<Button variant="primary" icon={Download} onClick={() => saveFile(item, version)}>Download</Button>}>
        {size(item.bytes)}. Open it on your computer after downloading.
      </Empty>
    );
  if (textual) {
    if (item.bytes === 0) return <p className="text-[13px] text-[var(--ro-muted)]">This file is empty.</p>;
    if (text.error !== null) return <p className="text-[13px] text-[var(--ro-red-text)]">{text.error}</p>;
    if (text.text === null) return <Spinner />;
    if (s === 'svg') return <SvgImage text={text.text} name={item.name} />;
    if (s === 'markdown' && md === 'preview') {
      const base = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
      return <Markdown source={text.text} resolve={resolver(acts, base)} className="max-w-[760px]" />;
    }
    if (s === 'table') return <Table text={text.text} sep={extOf(item.name) === 'tsv' ? '\t' : ','} />;
    return <Code text={text.text} />;
  }
  return (
    <Empty icon={iconOf(item)} title={'No preview for ' + (extOf(item.name) !== '' ? '.' + extOf(item.name) + ' files' : 'this file')} action={<Button variant="primary" icon={Download} onClick={() => saveFile(item, version)}>Download</Button>}>
      {size(item.bytes)}. Open it on your computer after downloading.
    </Empty>
  );
}

/** A PDF's pages, drawn by pdf.js as they come into view (the browser's own viewer is not always allowed in the app's frame). */
function PdfPages({ id, url }: { id: string; url: string }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let live = true;
    setDoc(null);
    setError('');
    openDocument('repo:' + id, url)
      .then((d) => live && setDoc(d))
      .catch(() => live && setError('Could not open this PDF. Download it to read it.'));
    return () => {
      live = false;
    };
  }, [id, url]);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setWidth(Math.min(900, Math.floor(en[0]?.contentRect.width ?? 0))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="flex w-full flex-col items-center gap-3">
      {error !== '' ? (
        <p className="text-[13px] text-[var(--ro-red-text)]">{error}</p>
      ) : doc === null || width === 0 ? (
        <Spinner />
      ) : (
        <>
          <p className="self-start text-[12px] text-[var(--ro-muted)]">{plural(doc.numPages, 'page')}</p>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} width={width} />
          ))}
        </>
      )}
    </div>
  );
}

function PdfPage({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }): React.JSX.Element {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [seen, setSeen] = useState(n <= 2);
  const [ratio, setRatio] = useState(1.294);
  useEffect(() => {
    const el = holder.current;
    if (el === null || seen) return;
    const io = new IntersectionObserver((en) => en.some((x) => x.isIntersecting) && setSeen(true), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return;
    let live = true;
    let cancel = (): void => undefined;
    void doc.getPage(n).then((pg) => {
      const c = canvas.current;
      if (!live || c === null) return;
      const vp = pg.getViewport({ scale: 1 });
      setRatio(vp.height / vp.width);
      cancel = drawPage(pg, c, width / vp.width);
    });
    return () => {
      live = false;
      cancel();
    };
  }, [seen, width, doc, n]);
  return (
    <div ref={holder} style={{ width, height: Math.round(width * ratio) }} className="shrink-0 overflow-hidden rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-white shadow-[var(--ro-shadow-sm)]">
      <canvas ref={canvas} aria-label={'Page ' + n} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

function Code({ text }: { text: string }): React.JSX.Element {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const count = body.split('\n').length;
  return (
    <div className="flex overflow-auto rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-row)] font-mono text-[12px] leading-5">
      <pre aria-hidden className="select-none border-r border-[var(--ro-line)] px-3 py-3 text-right text-[var(--ro-ink-2)]">{Array.from({ length: count }, (_, i) => i + 1).join('\n')}</pre>
      <pre className="min-w-0 flex-1 px-3 py-3 text-[var(--ro-ink)]">{body}</pre>
    </div>
  );
}

const ROWS = 1000;

function Table({ text, sep }: { text: string; sep: string }): React.JSX.Element {
  const { rows, more } = useMemo(() => parseDelimited(text, sep, ROWS + 1), [text, sep]);
  const head = rows[0] ?? [];
  const body = rows.slice(1);
  const width = Math.max(head.length, ...body.map((r) => r.length));
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[70vh] overflow-auto rounded-[var(--ro-r)] border border-[var(--ro-line)]">
        <table className="num border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-[1] bg-[var(--ro-row)]">
            <tr>
              <th className="border-b border-r border-[var(--ro-line)] px-2 py-1 text-right font-semibold text-[var(--ro-ink-2)]">#</th>
              {Array.from({ length: width }, (_, j) => (
                <th key={j} className="whitespace-nowrap border-b border-r border-[var(--ro-line)] px-2 py-1 text-left font-semibold">
                  {head[j] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-[var(--ro-card)]">
            {body.map((r, i) => (
              <tr key={i}>
                <td className="border-b border-r border-[var(--ro-hair)] px-2 py-1 text-right text-[var(--ro-ink-2)]">{i + 1}</td>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j} className="max-w-[320px] truncate whitespace-nowrap border-b border-r border-[var(--ro-hair)] px-2 py-1">
                    {r[j] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-[var(--ro-muted)]">{more ? 'The first ' + num(ROWS) + ' rows. Download the file for all of them.' : plural(body.length, 'row')}</p>
    </div>
  );
}

/** An SVG drawn as a picture (scripts in it never run: a picture cannot run them). */
function SvgImage({ text, name }: { text: string; name: string }): React.JSX.Element {
  const url = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })), [text]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={name} className="mx-auto max-h-[70vh] max-w-full rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-row)] object-contain" />;
}

function Editor({ item, initial, onDone, setDirty }: { item: RepoItem; initial: string; onDone: () => void; setDirty: (d: boolean) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== initial;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  const save = async (): Promise<void> => {
    if (busy) return;
    if (!dirty) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ item: RepoItem }>('repo.write', { item: item.id, content: draft });
      changed('repo_items', 'repo_versions');
      toast.success('Saved ' + item.name + ' as version ' + r.item.version);
      onDone();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full min-h-[60vh] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[12px] text-[var(--ro-muted)]">{item.version > 0 && item.bytes > 0 ? 'Saving keeps version ' + item.version + ' as it is.' : ''}</span>
        <Button
          onClick={() => {
            setDraft(initial);
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget;
            const at = t.selectionStart;
            setDraft(draft.slice(0, at) + '  ' + draft.slice(t.selectionEnd));
            requestAnimationFrame(() => t.setSelectionRange(at + 2, at + 2));
          }
        }}
        spellCheck={item.shown_as === 'markdown' || extOf(item.name) === 'txt'}
        aria-label={'Text of ' + item.name}
        className="min-h-0 flex-1 resize-none rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3 font-mono text-[12px] leading-5 text-[var(--ro-ink)] outline-none focus:border-[var(--ro-ink)]"
      />
    </div>
  );
}

function Versions({ item, open, anchor, onClose, viewing, onView }: { item: RepoItem; open: boolean; anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void; viewing: number; onView: (n: number) => void }): React.JSX.Element {
  const [list, setList] = useState<RepoVersion[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setList(null);
    void op<{ versions: RepoVersion[] }>('repo.versions', { item: item.id }, { quiet: true })
      .then((r) => setList(r.versions))
      .catch(() => setList([]));
  }, [open, item.id, item.version]);
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} align="left" className="w-[340px] p-1">
      <p className="px-2 pb-1 pt-1.5 text-[12px] font-bold text-[var(--ro-ink-2)]">Versions of {item.name}</p>
      {list === null ? (
        <div className="flex justify-center p-3">
          <Spinner />
        </div>
      ) : (
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {list.map((v) => (
            <li key={v.number} className={cn('flex items-center gap-2 rounded-[var(--ro-r-sm)] px-2 py-1.5', v.number === viewing && 'bg-[var(--ro-row-hover)]')}>
              <button type="button" onClick={() => onView(v.number)} className="flex min-w-0 flex-1 flex-col text-left">
                <span className="text-[13px] font-semibold">
                  Version {v.number}
                  {v.current && <span className="font-normal text-[var(--ro-muted)]"> (current)</span>}
                </span>
                <span className="num truncate text-[12px] text-[var(--ro-muted)]">
                  {WHO[v.actor]} · {v.made_at !== '' ? shortDate(v.made_at) + ' ' + time(v.made_at) : ''} · {size(v.bytes)}
                </span>
              </button>
              <IconButton icon={Download} label={'Download version ' + v.number} size={26} onClick={() => saveFile(item, v.number)} />
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

/* --------------------------------------------------------------- folder */

export function FolderView({ folder, acts }: { folder: RepoItem | null; acts: RepoActions }): React.JSX.Element {
  const id = folder?.id ?? '';
  const inside = acts.items.filter((x) => x.parent === id).sort(byName);
  const prefix = folder === null ? '' : folder.path + '/';
  const under = folder === null ? acts.items : acts.items.filter((x) => x.path.startsWith(prefix));
  const files = under.filter((x) => x.kind === 'file');
  const readme = inside.find((x) => x.kind === 'file' && /^readme(\.md|\.markdown)?$/i.test(x.name));
  const [over, setOver] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [upOpen, setUpOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const upBtn = useRef<HTMLButtonElement | null>(null);
  const counts = plural(under.length - files.length, 'folder') + ', ' + plural(files.length, 'file') + ' · ' + size(files.reduce((n, x) => n + x.bytes, 0));
  return (
    <div
      className={cn('flex min-h-full flex-col', over && 'outline outline-2 -outline-offset-2 outline-[var(--ro-accent)]')}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setOver(false);
        acts.uploadDropped(id, e.dataTransfer);
      }}
    >
      <Header
        icon={folder === null ? FolderTree : iconOf(folder, true)}
        title={folder === null ? acts.project.name : folder.name}
        sub={(folder === null ? 'Repository' : folder.path) + ' · ' + counts}
        back={acts.back}
        actions={
          <>
            <Button icon={FolderPlus} onClick={() => acts.newItem(id, 'folder')}>
              New folder
            </Button>
            <Button icon={FileArchive} disabled={files.length === 0 || acts.zipping !== ''} title="Download everything in it as a zip" onClick={() => acts.zip(folder === null ? null : [folder], folder === null ? acts.project.name : folder.name)}>
              {acts.zipping !== '' ? acts.zipping : 'Download'}
            </Button>
            <IconButton ref={moreBtn} icon={MoreHorizontal} label="More" variant="secondary" onClick={() => setMoreOpen((o) => !o)} />
            <Button ref={upBtn} variant="primary" icon={Upload} onClick={() => setUpOpen((o) => !o)}>
              Upload
            </Button>
          </>
        }
      />
      <Popover open={upOpen} anchor={upBtn} onClose={() => setUpOpen(false)} align="right" className="w-48 p-1">
        <button type="button" className={menuItem} onClick={() => (setUpOpen(false), acts.upload(id, 'files'))}>
          <Upload size={13} /> Files
        </button>
        <button type="button" className={menuItem} onClick={() => (setUpOpen(false), acts.upload(id, 'folder'))}>
          <FolderInput size={13} /> A folder
        </button>
      </Popover>
      <Popover open={moreOpen} anchor={moreBtn} onClose={() => setMoreOpen(false)} align="right" className="w-52 p-1">
        <button type="button" className={menuItem} onClick={() => (setMoreOpen(false), acts.newItem(id, 'file'))}>
          <FilePlus size={13} /> New text file
        </button>
        {folder !== null && (
          <>
            <button type="button" className={menuItem} onClick={() => (setMoreOpen(false), acts.rename(folder.id))}>
              <Pencil size={13} /> Rename
            </button>
            <button type="button" className={menuItem} onClick={() => (setMoreOpen(false), acts.move([folder.id]))}>
              <FolderInput size={13} /> Move to...
            </button>
            <button type="button" className={cn(menuItem, 'text-[var(--ro-red-text)]')} onClick={() => (setMoreOpen(false), acts.remove([folder.id]))}>
              <Trash2 size={13} /> Delete
            </button>
          </>
        )}
      </Popover>
      <div className="flex flex-col gap-4 p-5">
        {inside.length === 0 ? (
          <div className="rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-line)] py-10">
            <Empty icon={FolderInput} title="This folder is empty" compact action={<Button icon={Upload} onClick={() => acts.upload(id, 'files')}>Upload files</Button>}>
              Drop files or folders here from your computer.
            </Empty>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)]">
            <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
              <thead className="bg-[var(--ro-row)] text-left text-[12px] text-[var(--ro-ink-2)]">
                <tr>
                  <th className="h-8 border-b border-[var(--ro-line)] px-3 font-semibold">Name</th>
                  <th className="h-8 w-24 border-b border-[var(--ro-line)] px-3 text-right font-semibold">Size</th>
                  <th className="hidden h-8 w-36 border-b border-[var(--ro-line)] px-3 font-semibold @min-[560px]:table-cell">Changed</th>
                  <th className="hidden h-8 w-32 border-b border-[var(--ro-line)] px-3 font-semibold @min-[700px]:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {inside.map((x) => {
                  const I = iconOf(x);
                  return (
                    <tr key={x.id} onClick={() => acts.open(x.id)} className="cursor-pointer hover:bg-[var(--ro-row)]">
                      <td className="h-9 border-b border-[var(--ro-hair)] px-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <I size={14} className={cn('shrink-0', x.kind === 'folder' ? 'text-[var(--ro-amber)]' : 'text-[var(--ro-ink-2)]')} />
                          <span className="truncate">{x.name}</span>
                        </span>
                      </td>
                      <td className="num h-9 border-b border-[var(--ro-hair)] px-3 text-right text-[12px] text-[var(--ro-ink-2)]">{x.kind === 'file' ? size(x.bytes) : ''}</td>
                      <td className="hidden h-9 border-b border-[var(--ro-hair)] px-3 text-[12px] text-[var(--ro-ink-2)] @min-[560px]:table-cell">{ago(x.updated)}</td>
                      <td className="hidden h-9 border-b border-[var(--ro-hair)] px-3 text-[12px] text-[var(--ro-ink-2)] @min-[700px]:table-cell">{WHO[x.actor]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {readme !== undefined && <Readme item={readme} acts={acts} />}
      </div>
    </div>
  );
}

function Readme({ item, acts }: { item: RepoItem; acts: RepoActions }): React.JSX.Element {
  const text = useText(item.bytes <= EDIT_LIMIT ? fileUrl(item) : null);
  const base = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
  return (
    <section className="overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)]">
      <header className="flex items-center gap-2 border-b border-[var(--ro-line)] bg-[var(--ro-row)] px-3 py-1.5">
        <span className="flex-1 text-[12px] font-bold text-[var(--ro-ink-2)]">{item.name}</span>
        <IconButton icon={Pencil} label={'Open ' + item.name} size={24} onClick={() => acts.open(item.id)} />
      </header>
      <div className="px-5 py-4">{text.text === null ? text.error !== null ? <p className="text-[12px] text-[var(--ro-red-text)]">{text.error}</p> : <Spinner /> : <Markdown source={text.text} resolve={resolver(acts, base)} className="max-w-[760px]" />}</div>
    </section>
  );
}

/* ------------------------------------------------------------ selection */

export function SelectionView({ ids, acts, onClear }: { ids: string[]; acts: RepoActions; onClear: () => void }): React.JSX.Element {
  const picked = ids.map((id) => acts.items.find((x) => x.id === id)).filter((x): x is RepoItem => x !== undefined);
  return (
    <div className="flex min-h-full flex-col">
      <Header
        icon={FolderTree}
        title={plural(picked.length, 'item') + ' selected'}
        sub={picked.map((x) => x.path).join(', ')}
        back={acts.back}
        actions={
          <>
            <Button icon={FileArchive} disabled={acts.zipping !== ''} onClick={() => acts.zip(picked, acts.project.name + ' selection')}>
              {acts.zipping !== '' ? acts.zipping : 'Download as a zip'}
            </Button>
            <Button icon={FolderInput} onClick={() => acts.move(picked.map((x) => x.id))}>
              Move to...
            </Button>
            <Button icon={Trash2} onClick={() => acts.remove(picked.map((x) => x.id))}>
              Delete
            </Button>
            <IconButton icon={X} label="Clear the selection" variant="secondary" onClick={onClear} />
          </>
        }
      />
      <ul className="flex flex-col p-5">
        {picked.map((x) => {
          const I = iconOf(x);
          return (
            <li key={x.id} className="flex h-8 items-center gap-2 border-b border-[var(--ro-hair)] text-[13px]">
              <I size={14} className={cn('shrink-0', x.kind === 'folder' ? 'text-[var(--ro-amber)]' : 'text-[var(--ro-ink-2)]')} />
              <span className="min-w-0 flex-1 truncate">{x.path}</span>
              <span className="num text-[12px] text-[var(--ro-ink-2)]">{x.kind === 'file' ? size(x.bytes) : ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
