/**
 * The note editor: typed blocks (paragraph, headings, lists, to-dos,
 * dividers, pictures, tables) and embeds that point at records: a passage
 * (quote card that opens its page), a claim or question, a citation. Type "/"
 * in an empty block to change its kind; Enter starts a new block, Backspace
 * at the start joins it to the one above. Drop a highlight or a passage in to
 * quote it. Paste or drop pictures to put them in (they upload, showing their
 * preview at once); paste a range from a spreadsheet to make a table. Saves
 * as you type.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckSquare, CircleHelp, GripVertical, Heading1, Heading2, Heading3, Image as ImageIcon, Lightbulb, List, ListOrdered, Minus, Pilcrow, Quote, Sparkles, Table2, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op, opForm } from '../../lib/api.ts';
import { changed } from '../../lib/live.ts';
import { clip } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Anchor, GNode, Note, NoteBlock, NoteImage, WorkRow } from '../../lib/types.ts';
import { Badge, Button, IconButton, Popover, menuItem } from '../ui.tsx';
import { hasFiles, picturesIn, tableIn } from './clipboard.ts';
import { ImageBlock } from './ImageBlock.tsx';
import { blankTable, TableBlock } from './TableBlock.tsx';

export const DRAG_ANCHOR = 'application/x-research-anchor';

function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

type TextType = 'paragraph' | 'heading' | 'bullet' | 'numbered' | 'todo';
const TEXT_TYPES: TextType[] = ['paragraph', 'heading', 'bullet', 'numbered', 'todo'];

const KINDS: { type: NoteBlock['type']; level?: number; label: string; icon: LucideIcon }[] = [
  { type: 'paragraph', label: 'Text', icon: Pilcrow },
  { type: 'heading', level: 1, label: 'Heading', icon: Heading1 },
  { type: 'heading', level: 2, label: 'Subheading', icon: Heading2 },
  { type: 'heading', level: 3, label: 'Small heading', icon: Heading3 },
  { type: 'bullet', label: 'Bulleted list', icon: List },
  { type: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { type: 'todo', label: 'To-do', icon: CheckSquare },
  { type: 'divider', label: 'Divider', icon: Minus },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'table', label: 'Table', icon: Table2 },
];

/** Strip resolved refs before saving (the server resolves them again); a picture still uploading is not saved yet. */
function wire(blocks: NoteBlock[]): Record<string, unknown>[] {
  return blocks.filter((b) => b.pending === undefined).map((b) => {
    const o: Record<string, unknown> = { id: b.id, type: b.type };
    if (b.text !== undefined) o.text = b.text;
    if (b.level !== undefined) o.level = b.level;
    if (b.checked !== undefined) o.checked = b.checked;
    if (b.anchor !== undefined) o.anchor = b.anchor;
    if (b.node !== undefined) o.node = b.node;
    if (b.work !== undefined) o.work = b.work;
    if (b.locator !== undefined) o.locator = b.locator;
    if (b.file !== undefined) o.file = b.file;
    if (b.caption !== undefined) o.caption = b.caption;
    if (b.width !== undefined) o.width = b.width;
    if (b.align !== undefined) o.align = b.align;
    if (b.rows !== undefined) o.rows = b.rows;
    if (b.header !== undefined) o.header = b.header;
    return o;
  });
}

export function NoteEditor({ note, onJump, compact = false }: { note: Note; onJump?: (a: Anchor) => void; compact?: boolean }): React.JSX.Element {
  const [blocks, setBlocks] = useState<NoteBlock[]>(() => (note.blocks && note.blocks.length > 0 ? note.blocks : [{ id: newId(), type: 'paragraph', text: '' }]));
  const [title, setTitle] = useState(note.title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slash, setSlash] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<{ id: string; atEnd: boolean } | null>(null);
  const latest = useRef(blocks);
  latest.current = blocks;
  const latestTitle = useRef(title);
  latestTitle.current = title;

  // A note edited elsewhere (your AI agent appended to it) reloads when nothing is unsaved here.
  useEffect(() => {
    if (!dirty && note.blocks) setBlocks(note.blocks.length > 0 ? note.blocks : [{ id: newId(), type: 'paragraph', text: '' }]);
    if (!dirty) setTitle(note.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.updated]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await op('notes.update', { note: note.id, title: latestTitle.current, blocks: wire(latest.current) }, { quiet: true });
      setDirty(false);
      changed('notes');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [note.id]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void save(), 700);
    return () => clearTimeout(t);
  }, [dirty, blocks, title, save]);

  useEffect(() => {
    const f = pendingFocus.current;
    if (f === null) return;
    pendingFocus.current = null;
    const el = refs.current.get(f.id);
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!f.atEnd ? true : false);
    if (f.atEnd) r.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  });

  const update = (next: NoteBlock[]): void => {
    setBlocks(next);
    setDirty(true);
  };
  const setText = (id: string, text: string): void => update(latest.current.map((b) => (b.id === id ? { ...b, text } : b)));
  const insertAfter = (id: string, nb: NoteBlock): void => {
    const i = latest.current.findIndex((b) => b.id === id);
    const next = [...latest.current];
    next.splice(i + 1, 0, nb);
    update(next);
    pendingFocus.current = { id: nb.id, atEnd: false };
  };
  const patch = (id: string, p: Partial<NoteBlock>): void => update(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)));
  /** Put blocks in place of an empty paragraph, or after a block, or at an index; a text line follows when they end the note. */
  const place = (nbs: NoteBlock[], where: { replace?: string; after?: string; index?: number }): void => {
    const cur = latest.current;
    let i: number;
    let drop = 0;
    if (where.replace !== undefined) {
      i = cur.findIndex((x) => x.id === where.replace);
      drop = 1;
    } else if (where.after !== undefined) i = cur.findIndex((x) => x.id === where.after) + 1;
    else i = where.index ?? cur.length;
    if (i < 0) i = cur.length;
    const next = [...cur.slice(0, i), ...nbs, ...cur.slice(i + drop)];
    if (i + nbs.length >= next.length) next.push({ id: newId(), type: 'paragraph', text: '' });
    update(next);
  };
  const isEmptyText = (id: string): boolean => {
    const x = latest.current.find((y) => y.id === id);
    return x !== undefined && x.type === 'paragraph' && (x.text ?? '').trim() === '';
  };
  /** Pictures: their previews show at once; each becomes its picture once uploaded. */
  const addPictures = async (files: File[], where: { replace?: string; after?: string; index?: number }): Promise<void> => {
    if (files.length === 0) return;
    const pics = files.slice(0, 20);
    const pending: NoteBlock[] = pics.map((f) => ({ id: newId(), type: 'image', width: 100, align: 'center', caption: '', pending: URL.createObjectURL(f) }));
    place(pending, where);
    const ids = pending.map((p) => p.id);
    try {
      const r = await opForm<{ images: NoteImage[] }>('notes.add-image', { note: note.id }, { files: pics });
      update(
        latest.current.map((x) => {
          const k = ids.indexOf(x.id);
          const img = k >= 0 ? r.images[k] : undefined;
          if (img === undefined) return x;
          const { pending: _drop, ...rest } = x;
          return { ...rest, file: img.id, ref: img };
        }),
      );
    } catch {
      update(latest.current.filter((x) => !ids.includes(x.id)));
    } finally {
      // The previews stay a moment, while the pictures themselves load.
      window.setTimeout(() => pending.forEach((p) => p.pending !== undefined && URL.revokeObjectURL(p.pending)), 30000);
    }
  };
  const addTable = (where: { replace?: string; after?: string; index?: number }, rows?: string[][]): void => {
    const t: NoteBlock = { id: newId(), type: 'table', ...blankTable() };
    if (rows !== undefined) {
      t.rows = rows;
      t.align = (rows[0] ?? []).map(() => 'left');
    }
    place([t], where);
    pendingFocus.current = { id: t.id, atEnd: false };
  };
  const pictureFor = useRef<string>('');
  const pictureIn = useRef<HTMLInputElement | null>(null);
  /** A paste into a text block: pictures, or a table from a spreadsheet; otherwise plain text. */
  const onPasteBlock = (b: NoteBlock, e: React.ClipboardEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const pics = picturesIn(e.clipboardData);
    if (pics.length > 0) {
      void addPictures(pics, isEmptyText(b.id) ? { replace: b.id } : { after: b.id });
      return;
    }
    if (hasFiles(e.clipboardData) && e.clipboardData.getData('text/plain') === '') {
      toast.error('Only pictures (PNG, JPEG, GIF, WebP) go in a note. Put other files in the project repository.');
      return;
    }
    const grid = tableIn(e.clipboardData);
    if (grid !== null && grid.length >= 2) {
      addTable(isEmptyText(b.id) ? { replace: b.id } : { after: b.id }, grid);
      return;
    }
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  const remove = (id: string): void => {
    const i = latest.current.findIndex((b) => b.id === id);
    const next = latest.current.filter((b) => b.id !== id);
    update(next.length > 0 ? next : [{ id: newId(), type: 'paragraph', text: '' }]);
    const prev = next[Math.max(0, i - 1)];
    if (prev && TEXT_TYPES.includes(prev.type as TextType)) pendingFocus.current = { id: prev.id, atEnd: true };
  };

  const onKey = (b: NoteBlock, e: React.KeyboardEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    const sel = window.getSelection();
    const caretAt = (): number => {
      if (!sel || sel.rangeCount === 0) return 0;
      const r = sel.getRangeAt(0).cloneRange();
      r.selectNodeContents(el);
      r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      return r.toString().length;
    };
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = el.innerText.replace(/\n$/, '');
      const at = caretAt();
      const keepType: NoteBlock['type'] = b.type === 'bullet' || b.type === 'numbered' || b.type === 'todo' ? (text.trim() === '' ? 'paragraph' : b.type) : 'paragraph';
      if ((b.type === 'bullet' || b.type === 'numbered' || b.type === 'todo') && text.trim() === '') {
        update(latest.current.map((x) => (x.id === b.id ? { ...x, type: 'paragraph' } : x)));
        return;
      }
      const head = text.slice(0, at);
      const tail = text.slice(at);
      el.innerText = head;
      setText(b.id, head);
      insertAfter(b.id, { id: newId(), type: keepType, text: tail, ...(keepType === 'todo' ? { checked: false } : {}) });
    } else if (e.key === 'Backspace' && caretAt() === 0 && (sel?.isCollapsed ?? true)) {
      const i = latest.current.findIndex((x) => x.id === b.id);
      const prev = latest.current[i - 1];
      if (b.type !== 'paragraph' && b.type !== 'heading') {
        e.preventDefault();
        update(latest.current.map((x) => (x.id === b.id ? { ...x, type: 'paragraph' } : x)));
      } else if (prev && TEXT_TYPES.includes(prev.type as TextType)) {
        e.preventDefault();
        const merged = (prev.text ?? '') + (el.innerText.replace(/\n$/, '') ?? '');
        const caret = (prev.text ?? '').length;
        update(latest.current.filter((x) => x.id !== b.id).map((x) => (x.id === prev.id ? { ...x, text: merged } : x)));
        setTimeout(() => {
          const pe = refs.current.get(prev.id);
          if (!pe) return;
          pe.innerText = merged;
          pe.focus();
          const tn = pe.firstChild;
          if (tn) {
            const r = document.createRange();
            r.setStart(tn, Math.min(caret, tn.textContent?.length ?? 0));
            r.collapse(true);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(r);
          }
        }, 0);
      } else if (el.innerText.trim() === '' && latest.current.length > 1) {
        e.preventDefault();
        remove(b.id);
      }
    } else if (e.key === '/' && el.innerText.trim() === '') {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setSlash({ id: b.id, at: { x: r.left, y: r.bottom + 4 } });
    } else if (e.key === 'ArrowUp' && caretAt() === 0) {
      const i = latest.current.findIndex((x) => x.id === b.id);
      const prev = latest.current.slice(0, i).reverse().find((x) => TEXT_TYPES.includes(x.type as TextType));
      if (prev) {
        e.preventDefault();
        pendingFocus.current = { id: prev.id, atEnd: true };
        setBlocks([...latest.current]);
      }
    } else if (e.key === 'ArrowDown' && caretAt() === el.innerText.replace(/\n$/, '').length) {
      const i = latest.current.findIndex((x) => x.id === b.id);
      const nx = latest.current.slice(i + 1).find((x) => TEXT_TYPES.includes(x.type as TextType));
      if (nx) {
        e.preventDefault();
        pendingFocus.current = { id: nx.id, atEnd: false };
        setBlocks([...latest.current]);
      }
    }
  };

  const dropAt = (index: number, e: React.DragEvent): void => {
    if (hasFiles(e.dataTransfer)) {
      e.preventDefault();
      const pics = picturesIn(e.dataTransfer);
      if (pics.length > 0) void addPictures(pics, { index });
      else toast.error('Only pictures (PNG, JPEG, GIF, WebP) go in a note. Put other files in the project repository.');
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_ANCHOR);
    if (raw === '') return;
    e.preventDefault();
    const a = JSON.parse(raw) as { anchor: string; quote: string; page: number; work_label: string };
    const nb: NoteBlock = { id: newId(), type: 'quote', anchor: a.anchor, ref: { id: a.anchor, quote: a.quote, page: a.page, work_label: a.work_label } as unknown as Anchor };
    const next = [...latest.current];
    next.splice(index, 0, nb);
    update(next);
  };

  let num = 0;
  return (
    <div className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1')} data-unsaved={dirty ? 'true' : undefined}>
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder="Untitled note"
          className={cn('min-w-0 flex-1 bg-transparent font-bold outline-none', compact ? 'text-[14px]' : 'text-[15px]')}
          aria-label="Note title"
        />
        {note.status === 'agent_proposed' && (
          <>
            <Badge tone="agent">Written by your AI agent</Badge>
            <Button size="sm" onClick={() => void op('notes.keep', { notes: [note.id] }).then(() => changed('notes'))}>
              Keep
            </Button>
          </>
        )}
        <span className="text-[12px] text-[var(--ro-muted)]">{saving ? 'Saving' : dirty ? 'Edited' : 'Saved'}</span>
      </div>
      <div className="ro-editor flex flex-col" onDragOver={(e) => (e.dataTransfer.types.includes(DRAG_ANCHOR) || hasFiles(e.dataTransfer)) && e.preventDefault()} onDrop={(e) => dropAt(latest.current.length, e)}>
        {blocks.map((b, i) => {
          if (b.type === 'numbered') num += 1;
          else num = 0;
          return (
            <div key={b.id} className="group relative flex items-start gap-1 rounded-[var(--ro-r-sm)]" onDragOver={(e) => (e.dataTransfer.types.includes(DRAG_ANCHOR) || hasFiles(e.dataTransfer)) && e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropAt(i + 1, e); }}>
              <span className="mt-1 flex w-5 shrink-0 justify-center opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" title="Change or remove" aria-label="Block menu" onClick={(e) => setSlash({ id: b.id, at: { x: e.clientX, y: e.clientY } })} className="rounded-[3px] text-[var(--ro-muted)] hover:bg-[var(--ro-row)]">
                  <GripVertical size={13} />
                </button>
              </span>
              <div className="min-w-0 flex-1">
                <BlockView
                  b={b}
                  n={num}
                  setRef={(el) => {
                    if (el) refs.current.set(b.id, el);
                    else refs.current.delete(b.id);
                  }}
                  onInput={(t) => setText(b.id, t)}
                  onKey={(e) => onKey(b, e)}
                  onToggle={() => update(latest.current.map((x) => (x.id === b.id ? { ...x, checked: !x.checked } : x)))}
                  onRemove={() => remove(b.id)}
                  onPatch={(p) => patch(b.id, p)}
                  onPaste={(e) => onPasteBlock(b, e)}
                  onJump={onJump}
                />
              </div>
            </div>
          );
        })}
        {blocks.length > 0 && !TEXT_TYPES.includes((blocks[blocks.length - 1] as NoteBlock).type as TextType) && (
          <button
            type="button"
            aria-label="Write below"
            onClick={() => {
              const nb: NoteBlock = { id: newId(), type: 'paragraph', text: '' };
              update([...latest.current, nb]);
              pendingFocus.current = { id: nb.id, atEnd: false };
            }}
            className="h-8 w-full cursor-text"
          />
        )}
      </div>
      <input
        ref={pictureIn}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          const id = pictureFor.current;
          void addPictures(files, isEmptyText(id) ? { replace: id } : { after: id });
        }}
      />
      <Popover open={slash !== null} onClose={() => setSlash(null)} at={slash?.at ?? null} className="w-52">
        {KINDS.map((k) => (
          <button
            key={k.label}
            type="button"
            className={menuItem}
            onClick={() => {
              const id = slash?.id ?? '';
              setSlash(null);
              if (k.type === 'divider') {
                insertAfter(id, { id: newId(), type: 'divider' });
                return;
              }
              if (k.type === 'image') {
                pictureFor.current = id;
                pictureIn.current?.click();
                return;
              }
              if (k.type === 'table') {
                addTable(isEmptyText(id) ? { replace: id } : { after: id });
                return;
              }
              update(latest.current.map((x) => (x.id === id ? { ...x, type: k.type, ...(k.level !== undefined ? { level: k.level } : {}), text: x.text ?? '', ...(k.type === 'todo' ? { checked: false } : {}) } : x)));
              pendingFocus.current = { id, atEnd: true };
            }}
          >
            <k.icon size={14} /> {k.label}
          </button>
        ))}
        <div className="my-1 h-px bg-[var(--ro-hair)]" />
        <button type="button" className={cn(menuItem, 'text-[var(--ro-red-text)] [&>svg]:text-[var(--ro-red-text)]')} onClick={() => { const id = slash?.id ?? ''; setSlash(null); remove(id); }}>
          <Trash2 size={14} /> Remove block
        </button>
      </Popover>
    </div>
  );
}

function BlockView({ b, n, setRef, onInput, onKey, onToggle, onRemove, onPatch, onPaste, onJump }: { b: NoteBlock; n: number; setRef: (el: HTMLDivElement | null) => void; onInput: (t: string) => void; onKey: (e: React.KeyboardEvent<HTMLDivElement>) => void; onToggle: () => void; onRemove: () => void; onPatch: (p: Partial<NoteBlock>) => void; onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void; onJump?: ((a: Anchor) => void) | undefined }): React.JSX.Element {
  if (b.type === 'divider') return <hr className="my-2 border-[var(--ro-line)]" />;
  if (b.type === 'image') return <ImageBlock b={b} onChange={onPatch} onRemove={onRemove} />;
  if (b.type === 'table') return <TableBlock b={b} onChange={onPatch} onRemove={onRemove} setFirstRef={setRef} />;
  if (b.type === 'quote') {
    const a = b.ref as Anchor | null | undefined;
    return (
      <div className="group/q my-1 flex gap-2 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2">
        <span className="w-0.5 shrink-0 rounded-full bg-[var(--ro-accent)]" />
        <button type="button" onClick={() => a && onJump?.(a)} className="min-w-0 flex-1 text-left" title="Open the page">
          <span className="serif block text-[13px] leading-[19px]">{a ? clip(a.quote, 800) : 'This passage was removed'}</span>
          {a && <span className="mt-0.5 block text-[12px] text-[var(--ro-muted)]">{a.work_label !== '' ? a.work_label + ', ' : ''}p. {a.page}</span>}
        </button>
        <IconButton icon={X} label="Remove quote" size={22} onClick={onRemove} className="opacity-0 group-hover/q:opacity-100" />
      </div>
    );
  }
  if (b.type === 'node') {
    const nd = b.ref as GNode | null | undefined;
    return (
      <div className="my-1 flex items-center gap-2 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2 py-1.5">
        {nd?.kind === 'question' ? <CircleHelp size={14} className="text-[var(--ro-kind-question)]" /> : <Lightbulb size={14} className="text-[var(--ro-kind-claim)]" />}
        <button type="button" onClick={() => nd && navigate('project', { id: nd.project, view: 'map', node: nd.id })} className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">
          {nd ? nd.title : 'Removed'}
        </button>
        {nd?.status === 'agent_proposed' && <Sparkles size={12} className="text-[var(--ro-accent-text)]" />}
        <IconButton icon={X} label="Remove" size={22} onClick={onRemove} />
      </div>
    );
  }
  if (b.type === 'cite') {
    const w = b.ref as WorkRow | null | undefined;
    return (
      <div className="my-1 flex items-center gap-2 text-[13px]">
        <span className="ro-cite">{w ? w.label : 'Removed paper'}</span>
        {b.locator ? <span className="text-[12px] text-[var(--ro-muted)]">{b.locator}</span> : null}
        <IconButton icon={X} label="Remove" size={22} onClick={onRemove} />
      </div>
    );
  }
  const cls =
    b.type === 'heading'
      ? b.level === 1
        ? 'text-[15px] font-bold leading-6 mt-2'
        : b.level === 2
          ? 'text-[14px] font-bold leading-5 mt-1.5'
          : 'text-[13px] font-bold leading-5 mt-1'
      : 'text-[13px] leading-[20px]';
  return (
    <div className="flex items-start gap-1.5">
      {b.type === 'bullet' && <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--ro-ink-2)]" />}
      {b.type === 'numbered' && <span className="num mt-px w-4 shrink-0 text-right text-[13px] text-[var(--ro-ink-2)]">{n}.</span>}
      {b.type === 'todo' && <input type="checkbox" checked={b.checked === true} onChange={onToggle} className="mt-1 accent-[var(--ro-ink)]" aria-label="Done" />}
      <div
        ref={(el) => {
          setRef(el);
          if (el && el.innerText !== (b.text ?? '') && document.activeElement !== el) el.innerText = b.text ?? '';
        }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Note text"
        data-placeholder={b.type === 'paragraph' ? 'Write, or / for options' : ''}
        onInput={(e) => onInput((e.currentTarget as HTMLDivElement).innerText.replace(/\n$/, ''))}
        onKeyDown={onKey}
        onPaste={onPaste}
        className={cn('min-h-[20px] min-w-0 flex-1 py-0.5', cls, b.type === 'todo' && b.checked && 'text-[var(--ro-muted)] line-through')}
      />
    </div>
  );
}
