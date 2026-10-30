/**
 * Adding a card from anywhere: the rail's "+", Home, the board's palette and
 * toolbar. One dialog for every kind: a note, a link or YouTube video (its
 * preview appears as the address is typed), a file (dropped, chosen or an
 * address), a quote with its source. With no board yet, the card starts the
 * first one.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, CloudUpload, LayoutGrid, Link2, Plus, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import type { CardInput } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { CONTENT_KINDS, KIND, fileSize, isWebUrl, kindForFile, kindForUrl } from '../lib/kinds.ts';
import { lastBoard, navigate, rememberBoard } from '../lib/router.ts';
import type { Card, CardColor, Kind, UrlPreview } from '../lib/types.ts';
import { AutoTextarea, CircleButton, Field, MenuList, Modal, PillButton, Popover, Swatches, TagEditor, softArea, softInput } from './ui.tsx';

export interface AddOptions {
  board?: string;
  kind?: Kind;
  /** World position on the board to place the card near. */
  at?: { x: number; y: number };
  url?: string;
  file?: File;
  origin?: HTMLElement | null;
  onAdded?: (card: Card) => void;
}

const Ctx = createContext<{ open: (o?: AddOptions) => void }>({ open: () => undefined });

export function useAdd(): { open: (o?: AddOptions) => void } {
  return useContext(Ctx);
}

export function AddProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [opts, setOpts] = useState<(AddOptions & { n: number }) | null>(null);
  const [snack, setSnack] = useState<{ card: Card; boardName: string } | null>(null);
  const n = useRef(0);
  const open = useCallback((o?: AddOptions) => {
    n.current += 1;
    setOpts({ ...(o ?? {}), n: n.current });
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {opts !== null && (
        <AddDialog
          key={opts.n}
          opts={opts}
          onClose={() => setOpts(null)}
          onAdded={(card, boardName, here) => {
            setOpts(null);
            opts.onAdded?.(card);
            if (!here) setSnack({ card, boardName });
          }}
        />
      )}
      {snack !== null && <Snack {...snack} onDone={() => setSnack(null)} />}
    </Ctx.Provider>
  );
}

function Snack({ card, boardName, onDone }: { card: Card; boardName: string; onDone: () => void }): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="rb-pop fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-[8px] bg-[var(--rb-ink)] py-1 pl-3 pr-1 text-[var(--rb-card)] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
      <Check size={15} strokeWidth={2.6} aria-hidden />
      <span className="max-w-[56vw] truncate text-[13px] font-semibold">Added to {boardName}</span>
      <button
        type="button"
        onClick={() => {
          onDone();
          navigate('board', { id: card.board, card: card.id });
        }}
        className="inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[13px] font-bold text-[var(--rb-accent)] hover:bg-[var(--rb-shell)]/10"
      >
        Open <ArrowUpRight size={14} />
      </button>
      <button type="button" onClick={onDone} aria-label="Dismiss" className="flex size-8 items-center justify-center rounded-[7px] hover:bg-[var(--rb-shell)]/10">
        <X size={14} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- dialog */

function useUrlPreview(url: string, enabled: boolean): { data: UrlPreview | null; loading: boolean } {
  const [state, setState] = useState<{ data: UrlPreview | null; loading: boolean }>({ data: null, loading: false });
  useEffect(() => {
    if (!enabled || !isWebUrl(url)) {
      setState({ data: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ data: s.data, loading: true }));
    const t = setTimeout(() => {
      api
        .preview(url.trim())
        .then((d) => live && setState({ data: d, loading: false }))
        .catch(() => live && setState({ data: null, loading: false }));
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, enabled]);
  return state;
}

function AddDialog({ opts, onClose, onAdded }: { opts: AddOptions; onClose: () => void; onAdded: (card: Card, boardName: string, here: boolean) => void }): React.JSX.Element {
  const { boards } = useApp();
  const initialBoard = opts.board ?? (boards.some((b) => b.id === lastBoard()) ? lastBoard() : (boards[0]?.id ?? ''));
  const [board, setBoard] = useState(initialBoard);
  const [newBoard, setNewBoard] = useState('My research');
  const [kind, setKind] = useState<Kind>(opts.kind !== undefined && opts.kind !== 'section' ? opts.kind : opts.file !== undefined ? kindForFile(opts.file.name) : opts.url !== undefined ? kindForUrl(opts.url) : 'note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState(opts.url ?? '');
  const [source, setSource] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [color, setColor] = useState<CardColor>('plain');
  const [file, setFile] = useState<File | null>(opts.file ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    void api
      .tags()
      .then((r) => setAllTags(r.tags.map((t) => t.tag)))
      .catch(() => undefined);
  }, []);

  const urlKinds: Kind[] = ['link', 'youtube'];
  const fileKinds: Kind[] = ['image', 'video', 'doc'];
  const preview = useUrlPreview(url, urlKinds.includes(kind) || (fileKinds.includes(kind) && file === null));
  const boardName = boards.find((b) => b.id === board)?.name ?? newBoard;

  // A pasted address decides the kind: a YouTube address in "Link" becomes YouTube.
  useEffect(() => {
    if (!isWebUrl(url)) return;
    const k = kindForUrl(url);
    if (urlKinds.includes(kind) && k === 'youtube' && kind !== 'youtube') setKind('youtube');
    if (kind === 'youtube' && k === 'link') setKind('link');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const ready = (): string | null => {
    if (boards.length === 0 && newBoard.trim() === '') return 'Name your first board';
    if (kind === 'note' && title.trim() === '' && body.trim() === '') return 'Write a title or some text';
    if (urlKinds.includes(kind) && !isWebUrl(url)) return 'Paste an address that starts with https://';
    if (kind === 'youtube' && kindForUrl(url) !== 'youtube') return 'That is not a YouTube video address';
    if (fileKinds.includes(kind) && file === null && !isWebUrl(url)) return 'Choose a file or paste an address';
    if (kind === 'quote' && body.trim() === '') return 'Write the passage';
    return null;
  };

  const submit = async (): Promise<void> => {
    const problem = ready();
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let target = board;
      let name = boardName;
      if (boards.length === 0 || target === '') {
        const made = await api.createBoard({ name: newBoard.trim() });
        target = made.board.id;
        name = made.board.name;
      }
      const input: CardInput = { board: target, kind, tags };
      if (title.trim() !== '') input.title = title.trim();
      if (body.trim() !== '') input.body = body;
      if (kind === 'quote' && source.trim() !== '') input.source = source.trim();
      if (kind === 'note' && color !== 'plain') input.color = color;
      if (opts.at !== undefined) {
        input.near_x = Math.round(opts.at.x);
        input.near_y = Math.round(opts.at.y);
      }
      let res: { card: Card };
      if (fileKinds.includes(kind) && file !== null) res = await api.addFile(input, file);
      else {
        if (isWebUrl(url)) input.url = url.trim();
        res = await api.addCard(input);
      }
      rememberBoard(target);
      onAdded(res.card, name, opts.board === target);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Modal open onClose={onClose} title="Add a card" description={`Add a card to ${boardName}`} width="lg" bare>
      <div className="flex flex-col" onKeyDown={onKey}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <p className="text-[15px] font-bold">Add a card</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--rb-ink-2)]">
              <span>to</span>
              {boards.length === 0 ? <span className="font-semibold text-[var(--rb-ink)]">a new board</span> : <BoardPicker value={board} onChange={setBoard} />}
            </div>
          </div>
          <CircleButton icon={X} label="Close" size={28} onClick={onClose} />
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1.5 px-5 sm:grid-cols-7" role="radiogroup" aria-label="Kind of card">
          {CONTENT_KINDS.map((k) => {
            const info = KIND[k];
            const Icon = info.icon;
            const on = k === kind;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setKind(k);
                  setError(null);
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-[8px] border px-1 py-2.5 text-[12px] font-semibold transition-colors',
                  on ? 'border-[var(--rb-ink)] text-[var(--rb-ink)] shadow-[0_0_0_1px_var(--rb-ink)]' : 'border-[var(--rb-line)] text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]',
                )}
              >
                <Icon size={18} strokeWidth={1.9} />
                {info.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex max-h-[52vh] flex-col gap-3 overflow-y-auto px-5 pb-1">
          {boards.length === 0 && (
            <Field label="Name your first board" hint="You can rename it any time.">
              <input value={newBoard} onChange={(e) => setNewBoard(e.target.value)} className={softInput} aria-label="Board name" />
            </Field>
          )}

          {kind === 'note' && (
            <>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className={cn(softInput, 'font-semibold')} />
              <AutoTextarea value={body} onChange={setBody} minRows={4} placeholder="Write the idea, finding or question" aria-label="Text" className={softArea} />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-[var(--rb-ink-2)]">Color</span>
                <Swatches value={color} onChange={setColor} />
              </div>
            </>
          )}

          {urlKinds.includes(kind) && (
            <>
              <UrlField value={url} onChange={setUrl} placeholder={kind === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://…'} />
              <PreviewCard url={url} preview={preview.data} loading={preview.loading} kind={kind} />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={preview.data?.title || 'Title (the page title when left empty)'} aria-label="Title" className={softInput} />
              <AutoTextarea value={body} onChange={setBody} minRows={2} placeholder="Why it matters (optional)" aria-label="Note" className={softArea} />
            </>
          )}

          {fileKinds.includes(kind) && (
            <>
              <FileDrop kind={kind} file={file} onFile={(f) => {
                setFile(f);
                if (f !== null) {
                  const k = kindForFile(f.name);
                  if (k !== kind) setKind(k);
                }
              }} />
              {file === null && <UrlField value={url} onChange={setUrl} placeholder={`Or paste the address of ${kind === 'doc' ? 'a document' : kind === 'image' ? 'an image' : 'a video'}`} />}
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file !== null ? file.name.replace(/\.[^.]+$/, '') : 'Title'} aria-label="Title" className={softInput} />
              <AutoTextarea value={body} onChange={setBody} minRows={2} placeholder="A note about it (optional)" aria-label="Note" className={softArea} />
            </>
          )}

          {kind === 'quote' && (
            <>
              <AutoTextarea autoFocus value={body} onChange={setBody} minRows={4} placeholder="The passage, word for word" aria-label="Passage" className={cn(softArea, 'rb-serif text-[16px] leading-[25px]')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (author, work, page)" aria-label="Source" className={softInput} />
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Address (optional)" aria-label="Address" className={softInput} />
              </div>
            </>
          )}

          <TagEditor tags={tags} onChange={setTags} suggestions={allTags} placeholder="Tags (optional)" />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--rb-line)] px-5 py-3">
          <span className={cn('min-w-0 flex-1 text-[12px]', error !== null ? 'font-semibold text-[var(--rb-red-text)]' : 'text-[var(--rb-ink-2)]')}>
            {error ?? <span className="hidden sm:inline">Ctrl + Enter adds it</span>}
          </span>
          <div className="flex items-center gap-2">
            <PillButton variant="light" onClick={onClose}>
              Cancel
            </PillButton>
            <PillButton variant="dark" icon={Plus} loading={busy} onClick={() => void submit()}>
              Add to board
            </PillButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BoardPicker({ value, onChange }: { value: string; onChange: (id: string) => void }): React.JSX.Element {
  const { boards } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const current = boards.find((b) => b.id === value);
  return (
    <span className="relative">
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--rb-line)] px-2 text-[13px] font-semibold text-[var(--rb-ink)] hover:bg-[var(--rb-row)]">
        <LayoutGrid size={13} className="text-[var(--rb-ink-2)]" />
        <span className="max-w-[16rem] truncate">{current?.name ?? 'Choose a board'}</span>
        <ChevronDown size={13} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={ref} className="max-h-72 w-64 overflow-y-auto">
        <MenuList
          onPicked={() => setOpen(false)}
          items={boards.map((b) => ({ label: b.name, icon: b.id === value ? Check : LayoutGrid, onClick: () => onChange(b.id) }))}
        />
      </Popover>
    </span>
  );
}

function UrlField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): React.JSX.Element {
  const bad = value.trim() !== '' && !isWebUrl(value);
  return (
    <div className="relative">
      <Link2 size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--rb-ink-2)]" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Address"
        inputMode="url"
        spellCheck={false}
        className={cn(softInput, 'pl-8', bad && 'border-[var(--rb-red)]')}
      />
    </div>
  );
}

function PreviewCard({ url, preview, loading, kind }: { url: string; preview: UrlPreview | null; loading: boolean; kind: Kind }): React.JSX.Element | null {
  if (!isWebUrl(url)) return null;
  if (loading && preview === null) {
    return (
      <div className="flex gap-3 rounded-[8px] border border-[var(--rb-line)] p-2.5" aria-label="Reading the page">
        <span className="rb-skeleton h-[68px] w-[110px] shrink-0 rounded-[8px]" />
        <span className="flex flex-1 flex-col gap-2 py-1">
          <span className="rb-skeleton h-3.5 w-3/4 rounded-full" />
          <span className="rb-skeleton h-3 w-1/3 rounded-full" />
          <span className="rb-skeleton h-3 w-5/6 rounded-full" />
        </span>
      </div>
    );
  }
  if (preview === null) return null;
  const hasAny = preview.title !== '' || preview.image !== '' || preview.description !== '';
  return (
    <div className="rb-pop flex gap-3 rounded-[8px] border border-[var(--rb-line)] p-2.5">
      {preview.image !== '' ? (
        <img src={preview.image} alt="" className={cn('shrink-0 rounded-[8px] object-cover', kind === 'youtube' ? 'h-[68px] w-[120px]' : 'h-[68px] w-[110px]')} referrerPolicy="no-referrer" />
      ) : (
        <span className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--rb-row)', color: 'var(--rb-ink-2)' }}>
          {(() => {
            const Icon = KIND[kind].icon;
            return <Icon size={22} />;
          })()}
        </span>
      )}
      <span className="min-w-0 flex-1 py-0.5">
        <span className="line-clamp-2 text-[14px] font-bold leading-5">{preview.title !== '' ? preview.title : hasAny ? preview.site : 'No preview for this page'}</span>
        <span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--rb-ink-2)]">{preview.author !== '' ? `${preview.author} · ${preview.site}` : preview.site}</span>
        {preview.description !== '' && <span className="mt-1 line-clamp-2 text-[12px] leading-4 text-[var(--rb-ink-2)]">{preview.description}</span>}
        {preview.previews_off === true && <span className="mt-1 block text-[12px] text-[var(--rb-ink-2)]">Link previews are off in Settings.</span>}
      </span>
    </div>
  );
}

function FileDrop({ kind, file, onFile }: { kind: Kind; file: File | null; onFile: (f: File | null) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (file === null || kindForFile(file.name) !== 'image') {
      setThumb(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setThumb(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : undefined;
  if (file !== null) {
    const k = kindForFile(file.name);
    const Icon = KIND[k].icon;
    return (
      <div className="rb-pop flex items-center gap-3 rounded-[8px] border border-[var(--rb-line)] p-2.5">
        {thumb !== null ? (
          <img src={thumb} alt="" className="size-14 shrink-0 rounded-[8px] object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--rb-row)', color: 'var(--rb-ink-2)' }}>
            <Icon size={22} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{file.name}</span>
          <span className="text-[12px] font-semibold text-[var(--rb-ink-2)]">
            {KIND[k].label} · {fileSize(file.size)}
          </span>
        </span>
        <CircleButton icon={X} label="Remove the file" variant="row" size={34} onClick={() => onFile(null)} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f !== undefined) onFile(f);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-[8px] border-[1.5px] border-dashed px-6 py-7 text-center transition-colors',
        over ? 'border-[var(--rb-ink)] bg-[var(--rb-row)]' : 'border-[var(--rb-line)] hover:border-[var(--rb-ink-2)]',
      )}
    >
      <CloudUpload size={20} className="text-[var(--rb-ink-2)]" />
      <span className="text-[13px] font-bold">Drop a file here, or choose one</span>
      <span className="text-[12px] text-[var(--rb-ink-2)]">{kind === 'image' ? 'PNG, JPG, GIF, WebP or SVG' : kind === 'video' ? 'MP4, WebM or MOV' : 'PDF, Word, slides, spreadsheets or text'} · up to 200 MB</span>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) {
            if (f.size > 200 * 1024 * 1024) toast.error('That file is over 200 MB');
            else onFile(f);
          }
          e.target.value = '';
        }}
      />
    </button>
  );
}
