/**
 * The manuscript editor: one editable block per paragraph, heading, quote,
 * list item, equation, abstract paragraph, figure, table or piece of LaTeX.
 * Citations, maths and cross-references are objects, not text: chips that
 * name papers in the library, draw maths with KaTeX, or read as the number
 * LaTeX gives a figure, table, equation or section.
 *
 *   @            cite: search the library, Enter inserts (Shift+Enter adds
 *                another paper to the same citation)
 *   $            inline maths in LaTeX, drawn as you type (Esc keeps the $)
 *   #            refer to a figure, table, equation or section (Esc keeps the #)
 *   /            in an empty block: turn it into a heading, list, figure,
 *                table, equation, abstract or LaTeX...
 *   Enter        new block (splits at the caret); Backspace at the start
 *                joins the block to the one above
 *   Alt+Shift+Up/Down  move a block
 *   Drag a claim or evidence from the side panel into a sentence to cite its
 *   paper and link the claim.
 *
 * Your AI agent's edits arrive as tracked changes with Keep and Undo. After
 * a PDF build, a block LaTeX complained about shows the complaint under it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, Braces, Check, CircleAlert, Heading1, Heading2, Heading3, Hash, Image as ImageIcon, List, ListOrdered, MoreVertical, Pilcrow, Quote, ScrollText, Sigma, Sparkles, Table2, Trash2, Undo2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { changed } from '../../lib/live.ts';
import { mathProblem, paintMath, useMath } from '../../lib/math.ts';
import type { NoteBlock, WorkRow } from '../../lib/types.ts';
import { Button, IconButton, Popover, Spinner, Toggle, menuItem } from '../ui.tsx';
import { blankTable, TableBlock } from '../notes/TableBlock.tsx';
import { FigureMedia, type FigureFile } from './Figure.tsx';

export type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'quote' | 'bullet' | 'numbered' | 'equation' | 'abstract' | 'figure' | 'table' | 'latex';
export type Seg = { t: 'text'; v: string; b?: boolean; i?: boolean } | { t: 'cite'; works: string[]; locator: string } | { t: 'claim'; node: string } | { t: 'math'; v: string } | { t: 'ref'; block: string; bare?: boolean };
type Align = 'left' | 'center' | 'right';

/** What a figure, table or LaTeX block holds beyond its text. */
export interface BlockData {
  file?: string;
  width?: number;
  rows?: string[][];
  header?: boolean;
  align?: Align[];
  code?: string;
}

export interface Block {
  id: string;
  sort: number;
  type: BlockType;
  content: Seg[];
  data: BlockData | null;
  origin: string;
  typed: number;
  pasted: number;
  agent: number;
  updated: string;
}

export interface Change {
  id: string;
  block: string;
  after_block: string;
  kind: 'insert' | 'replace' | 'delete';
  before: { type: BlockType; content: Seg[]; data?: BlockData | null } | null;
  after: { type: BlockType; content: Seg[]; data?: BlockData | null } | null;
  status: string;
  actor: string;
  why: string;
  created: string;
}

export interface Rendered {
  text: string;
  html: string;
  md: string;
}

/** The number LaTeX gives a heading, equation, figure or table, and how a reference to it reads. */
export interface Num {
  kind: 'section' | 'equation' | 'figure' | 'table';
  n: string;
  label: string;
  /** What the caption itself is headed (a venue may say "Figure 1" there and "Fig. 1" in the text). */
  caption: string;
}

/** What a LaTeX build said, placed on the block its line came from. */
export interface BuildIssue {
  level: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  block?: string;
  where?: 'preamble' | 'front';
}

export const DRAG_NODE = 'application/x-research-node';

export const BLOCK_KINDS: { type: BlockType; label: string; icon: LucideIcon }[] = [
  { type: 'paragraph', label: 'Text', icon: Pilcrow },
  { type: 'h1', label: 'Heading 1', icon: Heading1 },
  { type: 'h2', label: 'Heading 2', icon: Heading2 },
  { type: 'h3', label: 'Heading 3', icon: Heading3 },
  { type: 'bullet', label: 'Bulleted list', icon: List },
  { type: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { type: 'quote', label: 'Quote', icon: Quote },
  { type: 'equation', label: 'Equation (LaTeX)', icon: Sigma },
  { type: 'figure', label: 'Figure', icon: ImageIcon },
  { type: 'table', label: 'Table', icon: Table2 },
  { type: 'abstract', label: 'Abstract', icon: ScrollText },
  { type: 'latex', label: 'LaTeX', icon: Braces },
];

const BLOCK_CLS: Record<BlockType, string> = {
  h1: 'text-[15px] font-bold leading-[22px] pt-5',
  h2: 'text-[14px] font-bold leading-[21px] pt-3',
  h3: 'text-[13px] font-bold leading-5 pt-2 text-[var(--ro-ink-2)]',
  paragraph: 'serif text-[15px] leading-[25px]',
  quote: 'serif text-[15px] italic leading-[25px] border-l-2 border-[var(--ro-line)] pl-4 text-[var(--ro-ink-2)]',
  bullet: 'serif text-[15px] leading-[25px]',
  numbered: 'serif text-[15px] leading-[25px]',
  equation: 'font-mono text-[13px] leading-5 rounded-[var(--ro-r)] bg-[var(--ro-row)] px-3 py-2',
  abstract: 'serif text-[14px] leading-[23px]',
  figure: 'serif text-[13px] leading-5',
  table: 'serif text-[13px] leading-5',
  latex: '',
};

const TEXTLESS: BlockType[] = ['latex'];
/** Blocks whose text is a caption: Backspace never joins them to the block above, and / does not turn them. */
const CAPTIONED: BlockType[] = ['figure', 'table'];

/** What a new block of a kind starts with. */
function dataFor(type: BlockType): BlockData | undefined {
  if (type === 'table') return blankTable() as BlockData;
  if (type === 'figure') return { file: '', width: 80 };
  if (type === 'latex') return { code: '' };
  return undefined;
}

/** A cross-reference as it reads: "Figure 2", or the number alone when bare. */
export function refLabel(numbers: Record<string, Num>, s: { block: string; bare?: boolean }): string {
  const t = numbers[s.block];
  if (t === undefined) return '??';
  return s.bare ? (t.kind === 'equation' ? '(' + t.n + ')' : t.n) : t.label;
}

const textOf = (content: Seg[]): string =>
  content
    .filter((s): s is Extract<Seg, { t: 'text' }> => s.t === 'text')
    .map((s) => s.v)
    .join('');

/* ------------------------------------------------------ DOM <-> segments */

function chipFor(s: Seg, label: string): HTMLElement {
  const el = document.createElement('span');
  el.contentEditable = 'false';
  if (s.t === 'cite') {
    el.className = 'ro-cite';
    el.dataset['works'] = s.works.join(',');
    el.dataset['locator'] = s.locator;
    el.textContent = label;
  } else if (s.t === 'claim') {
    el.className = 'ro-claimchip';
    el.dataset['claim'] = s.node;
    el.textContent = label;
  } else if (s.t === 'math') {
    el.className = 'ro-math';
    el.dataset['math'] = s.v;
    paintMath(el, s.v, false);
  } else if (s.t === 'ref') {
    el.className = 'ro-ref';
    el.dataset['ref'] = s.block;
    if (s.bare) el.dataset['bare'] = '1';
    el.dataset['bad'] = label === '??' ? 'true' : 'false';
    el.textContent = label;
  }
  return el;
}

function renderInto(el: HTMLElement, content: Seg[], labelOf: (s: Seg, i: number) => string): void {
  el.textContent = '';
  content.forEach((s, i) => {
    if (s.t === 'text') {
      let node: Node = document.createTextNode(s.v);
      if (s.i) {
        const e = document.createElement('i');
        e.append(node);
        node = e;
      }
      if (s.b) {
        const e = document.createElement('b');
        e.append(node);
        node = e;
      }
      el.append(node);
    } else el.append(chipFor(s, labelOf(s, i)));
  });
}

export function parseSegs(root: Node): Seg[] {
  const out: Seg[] = [];
  const push = (v: string, b: boolean, i: boolean): void => {
    if (v === '') return;
    const last = out[out.length - 1];
    if (last !== undefined && last.t === 'text' && !!last.b === b && !!last.i === i) {
      last.v += v;
      return;
    }
    out.push({ t: 'text', v, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}) });
  };
  const walk = (n: Node, b: boolean, i: boolean): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      push((n.textContent ?? '').replace(/​/g, ''), b, i);
      return;
    }
    if (!(n instanceof HTMLElement) && !(n instanceof DocumentFragment)) return;
    if (n instanceof HTMLElement) {
      if (n.dataset['works'] !== undefined) {
        out.push({ t: 'cite', works: n.dataset['works'].split(',').filter((x) => x !== ''), locator: n.dataset['locator'] ?? '' });
        return;
      }
      if (n.dataset['claim'] !== undefined) {
        out.push({ t: 'claim', node: n.dataset['claim'] });
        return;
      }
      if (n.dataset['math'] !== undefined) {
        if (n.dataset['math'].trim() !== '') out.push({ t: 'math', v: n.dataset['math'] });
        return;
      }
      if (n.dataset['ref'] !== undefined) {
        out.push({ t: 'ref', block: n.dataset['ref'], ...(n.dataset['bare'] === '1' ? { bare: true } : {}) });
        return;
      }
      if (n.tagName === 'BR') {
        push('\n', b, i);
        return;
      }
      const fw = n.style.fontWeight;
      b = b || n.tagName === 'B' || n.tagName === 'STRONG' || fw === 'bold' || Number(fw) >= 600;
      i = i || n.tagName === 'I' || n.tagName === 'EM' || n.style.fontStyle === 'italic';
      if ((n.tagName === 'DIV' || n.tagName === 'P') && out.length > 0) push('\n', b, i);
    }
    n.childNodes.forEach((c) => walk(c, b, i));
  };
  root.childNodes.forEach((c) => walk(c, false, false));
  const last = out[out.length - 1];
  if (last !== undefined && last.t === 'text') last.v = last.v.replace(/\n+$/, '');
  return out.filter((s) => s.t !== 'text' || s.v !== '');
}

function caretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString().length === 0 && !r.cloneContents().querySelector('[contenteditable="false"]');
}

function caretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return r.toString().length === 0 && !r.cloneContents().querySelector('[contenteditable="false"]');
}

export function focusBlock(id: string, where: 'start' | 'end' = 'end'): void {
  const el = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
  if (el === null) return;
  el.focus();
  if (el instanceof HTMLTextAreaElement) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(where === 'start');
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** Bring a block into view and into focus (from the outline, the checks or a build error). */
export function goToBlock(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-block="${id}"]`) ?? document.querySelector<HTMLElement>(`[data-row="${id}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  focusBlock(id);
}

function insertAtCaret(node: Node, range: Range | null): void {
  const sel = window.getSelection();
  const r = range ?? (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null);
  if (r === null) return;
  r.deleteContents();
  r.insertNode(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(after);
}

function caretAfter(node: Node): void {
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(r);
}

/* One block's saves go one after another, each reading the page when it runs, so a later save never lands first. */
const chains = new Map<string, Promise<unknown>>();
function queued<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(id, next);
  void next.finally(() => {
    if (chains.get(id) === next) chains.delete(id);
  }).catch(() => undefined);
  return next;
}

const cellChars = (d: BlockData | null | undefined): number => (d?.rows ?? []).reduce((a, r) => a + r.reduce((x, c) => x + c.length, 0), 0) + (d?.code ?? '').length;

/* ---------------------------------------------------------------- editor */

type Marked = { at: DOMRect; marker: HTMLElement; block: string };
type OnChip = { at: DOMRect; chip: HTMLElement; block: string };
type Pick = (Marked & { kind: 'math' }) | (Marked & { kind: 'ref' }) | (OnChip & { kind: 'math-edit' }) | (OnChip & { kind: 'ref-edit' });

export interface EditorProps {
  ms: string;
  project: string;
  title: string;
  blocks: Block[];
  rendered: Record<string, (Rendered | null)[]>;
  claims: Record<string, { id: string; title: string; kind: string; status: string }>;
  changes: Change[];
  labels: Map<string, WorkRow>;
  bibliography: { work: string; n: number; text: string; md: string }[];
  numbers: Record<string, Num>;
  figures: Record<string, FigureFile | null>;
  /** The latest build's errors, by block. */
  issues: Record<string, BuildIssue[]>;
  onTitle: (t: string) => void;
  onCitePick: (open: { at: DOMRect; marker: HTMLElement; block: string }) => void;
  onChip: (chip: HTMLElement, block: string) => void;
}

export function Editor(p: EditorProps): React.JSX.Element {
  const [blocks, setBlocks] = useState<Block[]>(p.blocks);
  const [slash, setSlash] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [title, setTitle] = useState(p.title);
  const [pick, setPick] = useState<Pick | null>(null);
  const [choose, setChoose] = useState('');
  useEffect(() => setBlocks(p.blocks), [p.blocks]);
  useEffect(() => setTitle(p.title), [p.title]);
  // The block to put the caret in once it is on the page (a new one is not there yet when its save answers).
  const focusNext = useRef<{ id: string; where: 'start' | 'end' } | null>(null);
  useEffect(() => {
    const f = focusNext.current;
    if (f === null || document.querySelector(`[data-block="${f.id}"]`) === null) return;
    focusNext.current = null;
    focusBlock(f.id, f.where);
  });

  const labelOf = useCallback(
    (block: string) => (s: Seg, i: number): string => {
      if (s.t === 'cite') return p.rendered[block]?.[i]?.text ?? '(' + s.works.map((w) => p.labels.get(w)?.label ?? 'source').join('; ') + ')';
      if (s.t === 'claim') return p.claims[s.node]?.title ?? 'claim';
      if (s.t === 'ref') return refLabel(p.numbers, s);
      return '';
    },
    [p.rendered, p.labels, p.claims, p.numbers],
  );

  const create = async (after: string, type: BlockType, content: Seg[], focus: 'start' | 'end' = 'start'): Promise<void> => {
    try {
      const data = dataFor(type);
      const r = await op<{ block: Block }>('ms.save-block', { manuscript: p.ms, after, type, content, ...(data ? { data } : {}) });
      setBlocks((list) => {
        const i = after === 'start' ? -1 : list.findIndex((b) => b.id === after);
        const next = [...list];
        next.splice(i + 1, 0, r.block);
        return next;
      });
      focusNext.current = { id: r.block.id, where: focus };
      changed('ms_blocks', 'manuscripts');
    } catch {
      /* toasted */
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBlocks((list) => list.filter((b) => b.id !== id));
    await op('ms.delete-block', { block: id }).catch(() => undefined);
    changed('ms_blocks', 'manuscripts');
  };

  const move = async (id: string, dir: -1 | 1): Promise<void> => {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const after = dir === -1 ? (j === 0 ? 'start' : (blocks[j - 1]?.id ?? 'start')) : (blocks[j]?.id ?? 'start');
    setBlocks((list) => {
      const next = [...list];
      const [b] = next.splice(i, 1);
      if (b) next.splice(j, 0, b);
      return next;
    });
    focusNext.current = { id, where: 'end' };
    await op('ms.move-block', { block: id, after }).catch(() => undefined);
    changed('ms_blocks');
  };

  const setType = async (id: string, type: BlockType): Promise<void> => {
    const b = blocks.find((x) => x.id === id);
    if (b === undefined) return;
    const el = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
    const content = TEXTLESS.includes(type) ? [] : el && !(el instanceof HTMLTextAreaElement) ? parseSegs(el) : b.content;
    const data = dataFor(type);
    focusNext.current = { id, where: 'end' };
    setBlocks((list) => list.map((x) => (x.id === id ? { ...x, type, content, data: data ?? null } : x)));
    await queued(id, () => op('ms.save-block', { manuscript: p.ms, block: id, type, content, ...(data ? { data } : {}) })).catch(() => undefined);
    changed('ms_blocks');
    if (type === 'figure') setChoose(id);
  };

  const merge = async (id: string, content: Seg[]): Promise<void> => {
    const i = blocks.findIndex((b) => b.id === id);
    const prev = blocks[i - 1];
    if (prev === undefined) {
      const b = blocks[i];
      if (b !== undefined && b.type !== 'paragraph') void setType(id, 'paragraph');
      return;
    }
    if (prev.type === 'equation' || CAPTIONED.includes(prev.type) || TEXTLESS.includes(prev.type)) return;
    const prevEl = document.querySelector<HTMLElement>(`[data-block="${prev.id}"]`);
    const prevContent = prevEl ? parseSegs(prevEl) : prev.content;
    const joined = [...prevContent, ...content];
    setBlocks((list) => list.filter((b) => b.id !== id).map((b) => (b.id === prev.id ? { ...b, content: joined } : b)));
    await queued(prev.id, () => op('ms.save-block', { manuscript: p.ms, block: prev.id, type: prev.type, content: joined })).catch(() => undefined);
    await op('ms.delete-block', { block: id }).catch(() => undefined);
    changed('ms_blocks', 'manuscripts');
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-block="${prev.id}"]`);
      if (el === null) return;
      el.focus();
      // Caret where the two met.
      const r = document.createRange();
      let count = prevContent.length;
      let node: ChildNode | null = el.firstChild;
      while (node !== null && count > 1) {
        node = node.nextSibling;
        count--;
      }
      if (node !== null && prevContent.length > 0) r.setStartAfter(node);
      else r.setStart(el, 0);
      r.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
    }, 30);
  };

  const onChip = (chip: HTMLElement, block: string): void => {
    if (chip.classList.contains('ro-math')) setPick({ kind: 'math-edit', at: chip.getBoundingClientRect(), chip, block });
    else if (chip.classList.contains('ro-ref')) setPick({ kind: 'ref-edit', at: chip.getBoundingClientRect(), chip, block });
    else p.onChip(chip, block);
  };

  let numbered = 0;
  const inserts = (after: string): Change[] => p.changes.filter((c) => c.kind === 'insert' && (c.after_block || 'start') === after);
  return (
    <div className="ro-editor mx-auto w-full max-w-[760px] px-6 pb-40 pt-8 @min-[900px]:px-12">
      <textarea
        value={title}
        rows={1}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() !== '' && title !== p.title && p.onTitle(title.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = blocks[0];
            if (first) focusBlock(first.id, 'start');
            else void create('start', 'paragraph', []);
          }
        }}
        aria-label="Title"
        placeholder="Untitled manuscript"
        className="serif mb-4 w-full resize-none overflow-hidden bg-transparent text-[26px] font-bold leading-[34px] outline-none [field-sizing:content]"
      />
      {inserts('start').map((c) => <ChangeCard key={c.id} c={c} labels={p.labels} numbers={p.numbers} />)}
      {blocks.map((b, i) => {
        numbered = b.type === 'numbered' ? numbered + 1 : 0;
        const replace = p.changes.find((c) => c.block === b.id && c.kind !== 'insert');
        return (
          <div key={b.id}>
            <BlockRow
              b={b}
              ms={p.ms}
              project={p.project}
              n={numbered}
              num={p.numbers[b.id]}
              firstAbstract={b.type === 'abstract' && blocks[i - 1]?.type !== 'abstract'}
              figure={b.type === 'figure' && b.data?.file ? p.figures[b.data.file] : undefined}
              issues={p.issues[b.id]}
              choose={choose === b.id}
              onChosen={() => setChoose('')}
              labelOf={labelOf(b.id)}
              numbers={p.numbers}
              rendered={p.rendered[b.id]}
              pending={replace}
              onEnter={(type, rest) => void create(b.id, type, rest)}
              onMerge={(content) => void merge(b.id, content)}
              onSlash={(at) => setSlash({ id: b.id, at })}
              onCite={(at, marker) => p.onCitePick({ at, marker, block: b.id })}
              onPick={(kind, at, marker) => setPick(kind === 'math' ? { kind: 'math', at, marker, block: b.id } : { kind: 'ref', at, marker, block: b.id })}
              onChip={(chip) => onChip(chip, b.id)}
              onMove={(dir) => void move(b.id, dir)}
              onType={(t) => void setType(b.id, t)}
              onDelete={() => void remove(b.id)}
              onArrow={(dir) => {
                const t = blocks[i + dir];
                if (t) focusBlock(t.id, dir === -1 ? 'end' : 'start');
              }}
            />
            {replace !== undefined && <ChangeCard c={replace} labels={p.labels} numbers={p.numbers} />}
            {inserts(b.id).map((c) => <ChangeCard key={c.id} c={c} labels={p.labels} numbers={p.numbers} />)}
          </div>
        );
      })}
      <button type="button" onClick={() => void create(blocks[blocks.length - 1]?.id ?? 'start', 'paragraph', [])} className="mt-2 block h-16 w-full cursor-text rounded-[var(--ro-r)] text-left text-[13px] text-transparent hover:text-[var(--ro-muted)]" aria-label="Add a paragraph at the end">
        Add a paragraph
      </button>
      {p.bibliography.length > 0 && (
        <section className="mt-6 border-t border-[var(--ro-line)] pt-4">
          <h2 className="mb-2 text-[15px] font-bold">References</h2>
          <ol className="flex flex-col gap-2">
            {p.bibliography.map((e) => (
              <li key={e.work} className="serif pl-8 -indent-8 text-[14px] leading-[22px]">
                <MdLine md={e.md} />
              </li>
            ))}
          </ol>
        </section>
      )}
      <Popover open={slash !== null} at={slash?.at ?? null} onClose={() => setSlash(null)} className="max-h-80 w-52 overflow-y-auto">
        {BLOCK_KINDS.map((k) => (
          <button
            key={k.type}
            type="button"
            className={menuItem}
            onClick={() => {
              const id = slash?.id ?? '';
              setSlash(null);
              void setType(id, k.type);
            }}
          >
            <k.icon size={14} /> {k.label}
          </button>
        ))}
      </Popover>
      {pick !== null && (pick.kind === 'math' || pick.kind === 'math-edit') && <MathPicker pick={pick} onClose={() => setPick(null)} />}
      {pick !== null && pick.kind === 'ref' && <RefPicker pick={pick} blocks={blocks} numbers={p.numbers} onClose={() => setPick(null)} />}
      {pick !== null && pick.kind === 'ref-edit' && <RefPopover pick={pick} blocks={blocks} numbers={p.numbers} onClose={() => setPick(null)} />}
    </div>
  );
}

/** Markdown emphasis of a bibliography entry (*journal*, **volume**) as text. */
export function MdLine({ md }: { md: string }): React.JSX.Element {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let k = 0;
  for (const m of md.matchAll(re)) {
    if (m.index > last) parts.push(md.slice(last, m.index));
    const s = m[0];
    parts.push(s.startsWith('**') ? <b key={k++}>{s.slice(2, -2)}</b> : <i key={k++}>{s.slice(1, -1)}</i>);
    last = m.index + s.length;
  }
  if (last < md.length) parts.push(md.slice(last));
  return <>{parts}</>;
}

interface RowProps {
  b: Block;
  ms: string;
  project: string;
  n: number;
  num: Num | undefined;
  firstAbstract: boolean;
  figure: FigureFile | null | undefined;
  issues: BuildIssue[] | undefined;
  choose: boolean;
  onChosen: () => void;
  labelOf: (s: Seg, i: number) => string;
  numbers: Record<string, Num>;
  rendered: (Rendered | null)[] | undefined;
  pending: Change | undefined;
  onEnter: (type: BlockType, rest: Seg[]) => void;
  onMerge: (content: Seg[]) => void;
  onSlash: (at: { x: number; y: number }) => void;
  onCite: (at: DOMRect, marker: HTMLElement) => void;
  onPick: (kind: 'math' | 'ref', at: DOMRect, marker: HTMLElement) => void;
  onChip: (chip: HTMLElement) => void;
  onMove: (dir: -1 | 1) => void;
  onType: (t: BlockType) => void;
  onDelete: () => void;
  onArrow: (dir: -1 | 1) => void;
}

function BlockRow({ b, ms, project, n, num, firstAbstract, figure, issues, choose, onChosen, labelOf, numbers, rendered, pending, onEnter, onMerge, onSlash, onCite, onPick, onChip, onMove, onType, onDelete, onArrow }: RowProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const last = useRef('');
  const counts = useRef({ typed: 0, pasted: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pasting = useRef(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const data = useRef<BlockData | null>(b.data);
  const [menu, setMenu] = useState(false);
  const [empty, setEmpty] = useState(b.content.length === 0);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const [eq, setEq] = useState(textOf(b.content));
  useEffect(() => {
    data.current = b.data;
  }, [b.data]);

  // Draw the stored content, unless you are typing in this block.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const json = JSON.stringify(b.content);
    // Keep the text you are typing; refresh only how citations and references read.
    const refresh = (): void => {
      const cites = (rendered ?? []).filter((r): r is Rendered => r !== null);
      el.querySelectorAll<HTMLElement>('.ro-cite').forEach((c, i) => {
        const t = cites[i]?.text;
        if (t !== undefined && c.textContent !== t) c.textContent = t;
      });
      el.querySelectorAll<HTMLElement>('.ro-ref').forEach((c) => {
        const t = refLabel(numbers, { block: c.dataset['ref'] ?? '', bare: c.dataset['bare'] === '1' });
        if (c.textContent !== t) c.textContent = t;
        c.dataset['bad'] = t === '??' ? 'true' : 'false';
      });
    };
    if ((document.activeElement === el && last.current !== '') || el.querySelector('[data-caret]') !== null || json === last.current) {
      refresh();
      return;
    }
    renderInto(el, b.content, labelOf);
    last.current = json;
    setEmpty(b.content.length === 0);
    if (b.type === 'equation') setEq(textOf(b.content));
  }, [b.content, b.type, rendered, labelOf, numbers]);

  const save = useCallback(
    (type: BlockType = b.type): Promise<void> => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return queued(b.id, async () => {
        const el = ref.current;
        if (el === null) return;
        const segs = parseSegs(el);
        const json = JSON.stringify(segs);
        if (json === last.current && type === b.type) return;
        last.current = json;
        const c = counts.current;
        counts.current = { typed: 0, pasted: 0 };
        setSaving(true);
        try {
          await op('ms.save-block', { manuscript: ms, block: b.id, type, content: segs, typed: c.typed, pasted: c.pasted }, { quiet: false });
          changed('ms_blocks', 'manuscripts');
        } catch {
          last.current = '';
        } finally {
          setSaving(false);
        }
      });
    },
    [b.id, b.type, ms],
  );

  /** Save a figure's, table's or LaTeX block's data, with its caption as the page shows it. */
  const saveData = useCallback(
    (next: BlockData): Promise<void> => {
      const typed = Math.max(0, cellChars(next) - cellChars(data.current));
      data.current = next;
      return queued(b.id, async () => {
        const el = ref.current;
        const segs = el === null ? (TEXTLESS.includes(b.type) ? [] : b.content) : parseSegs(el);
        if (el !== null) last.current = JSON.stringify(segs);
        setSaving(true);
        try {
          await op('ms.save-block', { manuscript: ms, block: b.id, type: b.type, content: segs, data: next, typed });
          changed('ms_blocks', 'manuscripts');
        } catch {
          /* toasted */
        } finally {
          setSaving(false);
        }
      });
    },
    [b.id, b.type, b.content, ms],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) void save();
    },
    [save],
  );

  // What you type is counted for the disclosure statement (the browser's own
  // beforeinput: React's onBeforeInput is a stand-in without the input type).
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onBefore = (ev: InputEvent): void => {
      if (!pasting.current && (ev.inputType === 'insertText' || ev.inputType === 'insertReplacementText') && ev.data) counts.current.typed += ev.data.length;
    };
    el.addEventListener('beforeinput', onBefore);
    return () => el.removeEventListener('beforeinput', onBefore);
  }, [b.type]);

  const schedule = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  };

  const marked = (open: (at: DOMRect, marker: HTMLElement) => void): void => {
    const el = ref.current;
    if (el === null) return;
    if (timer.current !== null) clearTimeout(timer.current);
    const marker = document.createElement('span');
    marker.dataset['caret'] = '1';
    insertAtCaret(marker, null);
    const rect = marker.getBoundingClientRect();
    open(rect.height > 0 ? rect : el.getBoundingClientRect(), marker);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (el === null) return;
    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      void save().then(() => onMove(e.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && b.type !== 'equation') {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel === null || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      r.deleteContents();
      const tail = document.createRange();
      tail.setStart(r.endContainer, r.endOffset);
      tail.setEnd(el, el.childNodes.length);
      const rest = parseSegs(tail.extractContents());
      const isListEmpty = (b.type === 'bullet' || b.type === 'numbered') && parseSegs(el).length === 0 && rest.length === 0;
      if (isListEmpty) {
        void save('paragraph').then(() => onType('paragraph'));
        return;
      }
      void save();
      onEnter(b.type === 'bullet' || b.type === 'numbered' || b.type === 'abstract' ? b.type : 'paragraph', rest);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
    if (e.key === 'Backspace' && caretAtStart(el)) {
      e.preventDefault();
      // A caption stays with its figure or table.
      if (CAPTIONED.includes(b.type)) return;
      if (timer.current !== null) clearTimeout(timer.current);
      onMerge(parseSegs(el));
      return;
    }
    if (e.key === 'ArrowUp' && caretAtStart(el)) {
      e.preventDefault();
      onArrow(-1);
      return;
    }
    if (e.key === 'ArrowDown' && caretAtEnd(el)) {
      e.preventDefault();
      onArrow(1);
      return;
    }
    if (e.key === '/' && !CAPTIONED.includes(b.type) && (el.textContent ?? '') === '' && el.querySelector('[contenteditable="false"]') === null) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      onSlash({ x: r.left, y: r.bottom + 4 });
      return;
    }
    if (b.type === 'equation') return;
    if (e.key === '@') {
      e.preventDefault();
      marked(onCite);
    } else if (e.key === '$') {
      e.preventDefault();
      marked((at, marker) => onPick('math', at, marker));
    } else if (e.key === '#') {
      e.preventDefault();
      marked((at, marker) => onPick('ref', at, marker));
    }
  };

  const onDrop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData(DRAG_NODE);
    if (raw === '') return;
    e.preventDefault();
    const nd = JSON.parse(raw) as { node: string; kind: string; work: string; citable: boolean };
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    ref.current?.focus();
    if (range !== null) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    const frag = document.createDocumentFragment();
    frag.append(chipFor({ t: 'claim', node: nd.node }, labelOf({ t: 'claim', node: nd.node }, -1)));
    if (nd.work !== '' && nd.citable) frag.append(chipFor({ t: 'cite', works: [nd.work], locator: '' }, '(citing)'));
    const lastNode = frag.lastChild;
    insertAtCaret(frag, range);
    if (lastNode) caretAfter(lastNode);
    setEmpty(false);
    void save();
  };

  const kind = BLOCK_KINDS.find((k) => k.type === b.type);
  const Kind = kind?.icon ?? Pilcrow;
  const placeholder = b.type === 'paragraph' ? 'Write, @ to cite, $ for maths, # to refer, / for blocks' : b.type === 'figure' ? 'Caption' : b.type === 'table' ? 'Caption' : b.type === 'equation' ? 'LaTeX, e.g. E = mc^2' : kind?.label;
  const editable = TEXTLESS.includes(b.type) ? null : (
    <div
      ref={ref}
      data-block={b.id}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={CAPTIONED.includes(b.type) ? (num?.label ?? kind?.label ?? '') + ' caption' : kind?.label}
      data-placeholder={empty ? placeholder : undefined}
      spellCheck={b.type !== 'equation'}
      onInput={() => {
        setEmpty((ref.current?.textContent ?? '') === '' && ref.current?.querySelector('[contenteditable="false"]') === null);
        if (b.type === 'equation') setEq(ref.current?.textContent ?? '');
        schedule();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
        counts.current.pasted += text.length;
        pasting.current = true;
        document.execCommand('insertText', false, text);
        pasting.current = false;
      }}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        void save();
      }}
      onClick={(e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('.ro-cite, .ro-claimchip, .ro-math, .ro-ref');
        if (chip) onChip(chip);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_NODE)) e.preventDefault();
      }}
      onDrop={onDrop}
      className={cn('min-h-[1.6em] min-w-0 flex-1 py-1', BLOCK_CLS[b.type])}
    />
  );

  let body: React.ReactNode;
  if (b.type === 'figure') {
    body = (
      <div className="flex min-w-0 flex-1 flex-col">
        <FigureMedia project={project} fileId={b.data?.file ?? ''} file={figure} width={b.data?.width ?? 80} choose={choose} onChosen={onChosen} onFile={(id) => void saveData({ ...(data.current ?? {}), file: id })} onWidth={(w) => void saveData({ ...(data.current ?? {}), width: w })} />
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 select-none text-[13px] font-bold leading-5">{num?.caption ?? 'Figure'}</span>
          {editable}
        </div>
      </div>
    );
  } else if (b.type === 'table') {
    body = (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 select-none text-[13px] font-bold leading-5">{num?.caption ?? 'Table'}</span>
          {editable}
        </div>
        <TableMedia data={b.data} onData={(d) => void saveData(d)} onRemove={onDelete} />
      </div>
    );
  } else if (b.type === 'latex') {
    body = <LatexCode id={b.id} code={b.data?.code ?? ''} onCode={(code) => void saveData({ code })} onArrow={onArrow} />;
  } else if (b.type === 'equation') {
    const hidden = !focused && eq.trim() !== '';
    body = (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className={cn(hidden && 'max-h-0 overflow-hidden')}>{editable}</div>
        {eq.trim() !== '' && <MathBlock src={eq} n={num?.n} editing={focused} onClick={() => focusBlock(b.id)} />}
      </div>
    );
  } else {
    const marker = b.type === 'bullet' ? '•' : b.type === 'numbered' ? n + '.' : null;
    body = (
      <>
        {marker !== null && <span className="serif w-6 shrink-0 select-none pt-0 text-[15px] leading-[25px] text-[var(--ro-ink-2)]">{marker}</span>}
        {num !== undefined && num.kind === 'section' && <span className={cn('num shrink-0 select-none py-1 pr-2 text-[var(--ro-muted)]', BLOCK_CLS[b.type])}>{num.n}</span>}
        {editable}
      </>
    );
  }
  const errors = (issues ?? []).filter((x) => x.level === 'error');
  return (
    <div data-row={b.id}>
      {firstAbstract && <p className="mt-2 select-none text-[12px] font-bold text-[var(--ro-muted)]">Abstract</p>}
      <div className={cn('group relative flex items-start', CAPTIONED.includes(b.type) && 'my-2', pending?.kind === 'delete' && 'opacity-60 line-through', pending?.kind === 'replace' && 'rounded-[var(--ro-r)] bg-[var(--ro-red)]/5')}>
        <div className="absolute -left-10 top-1 flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton ref={menuBtn} icon={MoreVertical} label="Block" size={24} onClick={() => setMenu((m) => !m)} />
        </div>
        {errors.length > 0 && <span aria-hidden className="absolute -left-3 bottom-1 top-1 w-0.5 rounded-full bg-[var(--ro-red)]" />}
        {body}
        {saving && <Spinner size={10} className="absolute -right-5 top-2 text-[var(--ro-muted)]" />}
        <Popover open={menu} anchor={menuBtn} onClose={() => setMenu(false)} className="max-h-96 w-52 overflow-y-auto">
          <p className="px-2 pb-1 pt-0.5 text-[12px] font-semibold text-[var(--ro-muted)]">
            <Kind size={12} className="mr-1 inline" />
            Turn into
          </p>
          {BLOCK_KINDS.filter((k) => k.type !== b.type).map((k) => (
            <button
              key={k.type}
              type="button"
              className={menuItem}
              onClick={() => {
                setMenu(false);
                void save().then(() => onType(k.type));
              }}
            >
              <k.icon size={14} /> {k.label}
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--ro-hair)]" />
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              setMenu(false);
              void save().then(() => onMove(-1));
            }}
          >
            <ArrowUp size={14} /> Move up
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              setMenu(false);
              void save().then(() => onMove(1));
            }}
          >
            <ArrowDown size={14} /> Move down
          </button>
          <button
            type="button"
            className={cn(menuItem, 'text-[var(--ro-red)]')}
            onClick={() => {
              setMenu(false);
              onDelete();
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </Popover>
      </div>
      {errors.slice(0, 3).map((x, i) => (
        <p key={i} className="mb-1 flex items-start gap-1.5 text-[12px] leading-4 text-[var(--ro-red-text)]">
          <CircleAlert size={12} className="mt-0.5 shrink-0" />
          <span>
            LaTeX: {x.message}
            {x.line !== undefined && <span className="num text-[var(--ro-muted)]"> (line {x.line})</span>}
          </span>
        </p>
      ))}
    </div>
  );
}

/** A displayed equation, drawn with its number; a click edits its LaTeX. */
function MathBlock({ src, n, editing, onClick }: { src: string; n: string | undefined; editing: boolean; onClick: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const ready = useMath();
  const [problem, setProblem] = useState('');
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.dataset['math'] = src;
    setProblem(paintMath(el, src, true));
  }, [src, ready]);
  return (
    <div>
      <div role="button" tabIndex={-1} aria-label="Edit the equation" onClick={onClick} className={cn('flex cursor-text items-center gap-3 rounded-[var(--ro-r)] px-2 py-1', !editing && 'hover:bg-[var(--ro-row)]')}>
        <div ref={ref} className={cn('min-w-0 flex-1 overflow-x-auto text-center text-[15px]', problem !== '' && 'font-mono text-[13px] text-[var(--ro-ink-2)]')} />
        {n !== undefined && <span className="num shrink-0 text-[13px] text-[var(--ro-ink-2)]">({n})</span>}
      </div>
      {editing && problem !== '' && <p className="px-2 text-[12px] leading-4 text-[var(--ro-amber-text)]">The preview cannot draw this ({problem}). LaTeX may still typeset it, for example with a command from your preamble.</p>}
    </div>
  );
}

/** A table's cells (the notes' table), saved a moment after you stop typing. */
function TableMedia({ data, onData, onRemove }: { data: BlockData | null; onData: (d: BlockData) => void; onRemove: () => void }): React.JSX.Element {
  const shape = (d: BlockData | null): BlockData => {
    const t = blankTable();
    return { rows: d?.rows && d.rows.length > 0 ? d.rows : (t.rows as string[][]), header: d?.header !== false, align: d?.align ?? (t.align as Align[]) };
  };
  const [d, setD] = useState<BlockData>(() => shape(data));
  const latest = useRef(d);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const send = useRef(onData);
  send.current = onData;
  const json = JSON.stringify(data);
  // What the server has, unless you are in the table or a save is on its way.
  useEffect(() => {
    if (timer.current !== null || box.current?.contains(document.activeElement)) return;
    const next = shape(data);
    latest.current = next;
    setD(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);
  const flush = (): void => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    send.current(latest.current);
  };
  useEffect(() => flush, []);
  const change = (patch: Partial<NoteBlock>): void => {
    const next: BlockData = { ...latest.current, ...(patch.rows ? { rows: patch.rows } : {}), ...(patch.header !== undefined ? { header: patch.header } : {}), ...(Array.isArray(patch.align) ? { align: patch.align } : {}) };
    latest.current = next;
    setD(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };
  return (
    <div
      ref={box}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) flush();
      }}
    >
      <TableBlock b={{ id: '', type: 'table', rows: d.rows ?? [], header: d.header !== false, align: d.align ?? [] }} onChange={change} onRemove={onRemove} setFirstRef={() => undefined} />
    </div>
  );
}

/** A LaTeX block: code put in the PDF as it is. */
function LatexCode({ id, code, onCode, onArrow }: { id: string; code: string; onCode: (code: string) => void; onArrow: (dir: -1 | 1) => void }): React.JSX.Element {
  const [v, setV] = useState(code);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const saved = useRef(code);
  const send = useRef(onCode);
  send.current = onCode;
  useEffect(() => {
    if (timer.current !== null || document.activeElement === area.current) return;
    saved.current = code;
    setV(code);
  }, [code]);
  const flush = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const now = area.current?.value ?? v;
    if (now === saved.current) return;
    saved.current = now;
    send.current(now);
  };
  useEffect(() => flush, []);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
      <span className="flex select-none items-center gap-1 text-[12px] font-semibold text-[var(--ro-muted)]">
        <Braces size={12} /> LaTeX, put in the PDF as it is
      </span>
      <textarea
        ref={area}
        data-block={id}
        value={v}
        spellCheck={false}
        aria-label="LaTeX"
        placeholder="\begin{tabular}{ll} ... \end{tabular}"
        onChange={(e) => {
          setV(e.target.value);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 900);
        }}
        onBlur={flush}
        onKeyDown={(e) => {
          const t = e.currentTarget;
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertText', false, '  ');
          } else if (e.key === 'ArrowUp' && t.selectionStart === 0 && t.selectionEnd === 0) {
            e.preventDefault();
            onArrow(-1);
          } else if (e.key === 'ArrowDown' && t.selectionStart === t.value.length) {
            e.preventDefault();
            onArrow(1);
          }
        }}
        className="min-h-[60px] w-full resize-none rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-row)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--ro-ink)] outline-none [field-sizing:content] focus:border-[var(--ro-ink)]"
      />
    </div>
  );
}

/** Read-only text of segments (a proposed change), citations by their papers' labels. */
export function SegText({ segs, labels, numbers }: { segs: Seg[]; labels: Map<string, WorkRow>; numbers?: Record<string, Num> }): React.JSX.Element {
  return (
    <>
      {segs.map((s, i) =>
        s.t === 'text' ? (
          <span key={i} className={cn(s.b && 'font-bold', s.i && 'italic', 'whitespace-pre-wrap')}>
            {s.v}
          </span>
        ) : s.t === 'cite' ? (
          <span key={i} className="ro-cite">
            ({s.works.map((w) => labels.get(w)?.label ?? 'source').join('; ')}
            {s.locator !== '' ? ', ' + s.locator : ''})
          </span>
        ) : s.t === 'math' ? (
          <MathInline key={i} src={s.v} />
        ) : s.t === 'ref' ? (
          <span key={i} className="ro-ref">
            {numbers !== undefined ? refLabel(numbers, s) : 'reference'}
          </span>
        ) : (
          <span key={i} className="ro-claimchip">
            claim
          </span>
        ),
      )}
    </>
  );
}

function MathInline({ src }: { src: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const ready = useMath();
  useLayoutEffect(() => {
    if (ref.current === null) return;
    ref.current.dataset['math'] = src;
    paintMath(ref.current, src, false);
  }, [src, ready]);
  return <span ref={ref} className="ro-math" />;
}

/** What a proposed block holds: its text, and a figure's picture, a table's size or LaTeX code. */
function ChangeBody({ after, labels, numbers }: { after: NonNullable<Change['after']>; labels: Map<string, WorkRow>; numbers: Record<string, Num> }): React.JSX.Element {
  const d = after.data ?? null;
  if (after.type === 'latex') return <pre className="whitespace-pre-wrap font-mono text-[12px] leading-4">{d?.code ?? ''}</pre>;
  if (after.type === 'equation') return <MathInline src={textOf(after.content)} />;
  return (
    <>
      {after.type === 'figure' && <span className="mr-1 font-bold">Figure.</span>}
      {after.type === 'table' && <span className="mr-1 font-bold">Table.</span>}
      <SegText segs={after.content} labels={labels} numbers={numbers} />
      {after.type === 'table' && d?.rows !== undefined && (
        <table className="mt-1.5 border-collapse text-[12px]">
          <tbody>
            {d.rows.slice(0, 6).map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={cn('border border-[var(--ro-line)] px-1.5 py-0.5', i === 0 && d.header !== false && 'font-semibold')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ChangeCard({ c, labels, numbers }: { c: Change; labels: Map<string, WorkRow>; numbers: Record<string, Num> }): React.JSX.Element {
  const [busy, setBusy] = useState<'k' | 'u' | null>(null);
  const act = async (which: 'k' | 'u'): Promise<void> => {
    setBusy(which);
    try {
      const r = await op<{ kept?: number; stale?: string[] }>(which === 'k' ? 'ms.keep' : 'ms.undo', { changes: [c.id] });
      if (which === 'k' && (r.stale ?? []).length > 0) toast.error('That paragraph changed after your AI agent suggested this; the suggestion was set aside.');
      changed('ms_changes', 'ms_blocks', 'manuscripts');
    } catch {
      /* toasted */
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="my-1.5 flex flex-col gap-1.5 rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)]/60 p-2.5">
      <span className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--ro-accent-text)]">
        <Sparkles size={12} /> {c.kind === 'insert' ? 'Your AI agent suggests adding' : c.kind === 'replace' ? 'Your AI agent suggests rewording' : 'Your AI agent suggests removing this'}
      </span>
      {c.after !== null && (
        <div className={cn('rounded-[var(--ro-r)] bg-[var(--ro-card)] px-3 py-2', BLOCK_CLS[c.after.type], 'pt-2')}>
          <ChangeBody after={c.after} labels={labels} numbers={numbers} />
        </div>
      )}
      {c.why !== '' && <p className="text-[12px] leading-4 text-[var(--ro-ink-2)]">{c.why}</p>}
      <span className="flex gap-1">
        <Button size="sm" icon={Check} loading={busy === 'k'} onClick={() => void act('k')}>
          Keep
        </Button>
        <Button size="sm" variant="ghost" icon={Undo2} loading={busy === 'u'} onClick={() => void act('u')}>
          Undo
        </Button>
      </span>
    </div>
  );
}

/* ------------------------------------------------ maths and references */

/** Close a picker that floats at a point when you click elsewhere. */
function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [ref, onClose]);
}

function place(at: DOMRect, width: number, height: number): { left: number; top: number } {
  return { left: Math.max(8, Math.min(window.innerWidth - width - 8, at.left)), top: at.bottom + height > window.innerHeight ? Math.max(8, at.top - height - 4) : at.bottom + 6 };
}

/** Put text (or a chip) where the marker is, and give the block its input back. */
function settle(block: string, marker: HTMLElement, nodes: Node[]): void {
  const el = document.querySelector<HTMLElement>(`[data-block="${block}"]`);
  if (el === null || !marker.isConnected) return;
  marker.replaceWith(...nodes);
  el.focus();
  const lastNode = nodes[nodes.length - 1];
  if (lastNode !== undefined) caretAfter(lastNode);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Inline maths: type LaTeX, see it drawn. Enter puts it in; Esc keeps what
 * you typed as text with its $ (for a price, say). On a chip it edits it.
 */
function MathPicker({ pick, onClose }: { pick: Extract<Pick, { kind: 'math' | 'math-edit' }>; onClose: () => void }): React.JSX.Element {
  const editing = pick.kind === 'math-edit';
  const [v, setV] = useState(editing ? (pick.chip.dataset['math'] ?? '') : '');
  const ref = useRef<HTMLDivElement | null>(null);
  const preview = useRef<HTMLSpanElement | null>(null);
  const ready = useMath();
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = preview.current;
    if (el === null) return;
    el.dataset['math'] = v;
    if (v.trim() === '') el.textContent = '';
    else paintMath(el, v, false);
  }, [v, ready]);
  const problem = ready ? mathProblem(v) : '';
  const finish = (how: 'insert' | 'text' | 'remove' | 'cancel'): void => {
    if (done.current) return;
    done.current = true;
    if (pick.kind === 'math') {
      const marker = pick.marker;
      if (how === 'insert' && v.trim() !== '') settle(pick.block, marker, [chipFor({ t: 'math', v: v.trim() }, ''), document.createTextNode('​')]);
      else settle(pick.block, marker, [document.createTextNode('$' + v)]);
    } else {
      const chip = pick.chip;
      const el = document.querySelector<HTMLElement>(`[data-block="${pick.block}"]`);
      if (how === 'remove' || (how === 'insert' && v.trim() === '')) chip.remove();
      else if (how === 'insert') {
        chip.dataset['math'] = v.trim();
        paintMath(chip, v.trim(), false);
      }
      if (how !== 'cancel') el?.dispatchEvent(new Event('input', { bubbles: true }));
    }
    onClose();
  };
  // Clicking elsewhere puts the maths in as it stands.
  useOutside(ref, () => finish(v.trim() !== '' ? 'insert' : editing ? 'cancel' : 'text'));
  useEffect(
    () => () => {
      if (pick.kind === 'math' && pick.marker.isConnected) pick.marker.remove();
    },
    [pick],
  );
  const pos = place(pick.at, 360, 150);
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', ...pos }} className="ro-pop z-50 flex w-[360px] flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2 text-[var(--ro-ink)] shadow-[var(--ro-shadow)]">
      <input
        autoFocus
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish('insert');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(editing ? 'cancel' : 'text');
          } else if (e.key === 'Backspace' && v === '' && !editing) {
            e.preventDefault();
            finish('text');
          }
        }}
        placeholder="Maths in LaTeX, e.g. \alpha = 0.05"
        aria-label="Inline maths in LaTeX"
        className="h-7 w-full rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-2 font-mono text-[13px] outline-none focus:border-[var(--ro-ink)]"
      />
      <div className="flex min-h-8 items-center justify-center rounded-[var(--ro-r)] bg-[var(--ro-row)] px-2 py-1 text-[15px]">
        {v.trim() === '' ? <span className="text-[12px] text-[var(--ro-muted)]">The maths shows here as you type</span> : <span ref={preview} />}
      </div>
      {problem !== '' && <p className="text-[12px] leading-4 text-[var(--ro-amber-text)]">The preview cannot draw this ({problem}). LaTeX may still typeset it.</p>}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12px] text-[var(--ro-muted)]">{editing ? 'Enter saves' : 'Enter puts it in, Esc keeps the $ as text'}</span>
        {editing && (
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => finish('remove')}>
            Remove
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}

const REF_ICON: Record<Num['kind'], LucideIcon> = { section: Hash, equation: Sigma, figure: ImageIcon, table: Table2 };

function snippet(b: Block): string {
  if (b.type === 'equation') return textOf(b.content);
  return textOf(b.content).trim();
}

/** Refer to a heading, equation, figure or table: it reads as its number, kept up to date. */
function RefPicker({ pick, blocks, numbers, onClose }: { pick: Extract<Pick, { kind: 'ref' }>; blocks: Block[]; numbers: Record<string, Num>; onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [bare, setBare] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  const all = blocks.filter((b) => numbers[b.id] !== undefined);
  const s = q.trim().toLowerCase();
  const list = s === '' ? all : all.filter((b) => (numbers[b.id]?.label + ' ' + snippet(b)).toLowerCase().includes(s));
  useEffect(() => setActive(0), [q]);
  const finish = (b: Block | null): void => {
    if (done.current) return;
    done.current = true;
    if (b === null) settle(pick.block, pick.marker, [document.createTextNode('#' + q)]);
    else settle(pick.block, pick.marker, [chipFor({ t: 'ref', block: b.id, ...(bare ? { bare: true } : {}) }, refLabel(numbers, { block: b.id, bare })), document.createTextNode('​')]);
    onClose();
  };
  useOutside(ref, () => finish(null));
  useEffect(
    () => () => {
      if (pick.marker.isConnected) pick.marker.remove();
    },
    [pick],
  );
  const pos = place(pick.at, 380, 330);
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', ...pos }} className="ro-pop z-50 flex w-[380px] flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink)] shadow-[var(--ro-shadow)]">
      <div className="border-b border-[var(--ro-hair)] p-1.5">
        <input
          ref={input}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const b = list[active];
              if (b !== undefined) finish(b);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              finish(null);
            }
          }}
          placeholder="Refer to a figure, table, equation or section"
          aria-label="Find what to refer to"
          className="h-7 w-full bg-transparent px-1 text-[13px] outline-none"
        />
      </div>
      <ul data-scroll className="max-h-64 overflow-y-auto py-1">
        {list.length === 0 && <li className="px-3 py-3 text-[12px] text-[var(--ro-muted)]">{all.length === 0 ? 'Nothing to refer to yet: add a heading, an equation, a figure or a table' : 'Nothing matches'}</li>}
        {list.map((b, i) => {
          const t = numbers[b.id] as Num;
          const Icon = REF_ICON[t.kind];
          return (
            <li key={b.id}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => finish(b)} className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left', i === active && 'bg-[var(--ro-row-hover)]')}>
                <Icon size={13} className="mt-0.5 shrink-0 text-[var(--ro-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold">{t.label}</span>
                  {snippet(b) !== '' && <span className={cn('block truncate text-[12px] text-[var(--ro-muted)]', b.type === 'equation' && 'font-mono')}>{snippet(b)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 border-t border-[var(--ro-hair)] px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--ro-ink-2)]">
          <Toggle
            checked={bare}
            onChange={(v) => {
              setBare(v);
              input.current?.focus();
            }}
            label="Number only"
          />
          Number only
        </span>
        <span className="flex-1 text-right text-[12px] text-[var(--ro-muted)]">Esc keeps the # as text</span>
      </div>
    </div>,
    document.body,
  );
}

/** A cross-reference you clicked: what it points at, number only or not, go there, remove it. */
function RefPopover({ pick, blocks, numbers, onClose }: { pick: Extract<Pick, { kind: 'ref-edit' }>; blocks: Block[]; numbers: Record<string, Num>; onClose: () => void }): React.JSX.Element {
  const chip = pick.chip;
  const id = chip.dataset['ref'] ?? '';
  const [bare, setBare] = useState(chip.dataset['bare'] === '1');
  const ref = useRef<HTMLDivElement | null>(null);
  useOutside(ref, onClose);
  const target = blocks.find((b) => b.id === id);
  const t = numbers[id];
  const commit = (): void => {
    document.querySelector<HTMLElement>(`[data-block="${pick.block}"]`)?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pos = place(pick.at, 300, 170);
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', ...pos }} className="ro-pop z-50 flex w-[300px] flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2.5 text-[var(--ro-ink)] shadow-[var(--ro-shadow)]">
      <span className="text-[12px] font-bold text-[var(--ro-muted)]">Cross-reference</span>
      {target === undefined || t === undefined ? (
        <p className="text-[12px] leading-4 text-[var(--ro-red-text)]">It points at something no longer in the manuscript.</p>
      ) : (
        <>
          <span className="text-[13px] font-semibold">{t.label}</span>
          {snippet(target) !== '' && <span className={cn('line-clamp-2 text-[12px] leading-4 text-[var(--ro-muted)]', target.type === 'equation' && 'font-mono')}>{snippet(target)}</span>}
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--ro-ink-2)]">
            <Toggle
              checked={bare}
              onChange={(v) => {
                setBare(v);
                if (v) chip.dataset['bare'] = '1';
                else delete chip.dataset['bare'];
                chip.textContent = refLabel(numbers, { block: id, bare: v });
                commit();
              }}
              label="Number only"
            />
            Number only
          </span>
        </>
      )}
      <div className="flex justify-end gap-1.5 border-t border-[var(--ro-hair)] pt-2">
        {target !== undefined && (
          <Button
            size="sm"
            onClick={() => {
              onClose();
              goToBlock(id);
            }}
          >
            Go to it
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          icon={X}
          onClick={() => {
            chip.remove();
            commit();
            onClose();
          }}
        >
          Remove
        </Button>
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------- citation picker */

export function CitePicker({ at, marker, block, works, onClose }: { at: DOMRect; marker: HTMLElement; block: string; works: WorkRow[]; onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<WorkRow[] | null>(null);
  const [active, setActive] = useState(0);
  const [group, setGroup] = useState<WorkRow[]>([]);
  const [locator, setLocator] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => void op<{ works: WorkRow[] }>('works.list', { q: q.trim(), limit: 20 }, { quiet: true, signal: ctl.signal }).then((r) => setFound(r.works)).catch(() => undefined), 160);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);
  const list = (found ?? works).slice(0, 20);
  useEffect(() => setActive(0), [q]);
  useOutside(ref, onClose);
  // The marker left at the caret when @ was pressed: the citation takes its place.
  useEffect(
    () => () => {
      if (marker.isConnected) marker.remove();
    },
    [marker],
  );
  const insert = (ws: WorkRow[]): void => {
    if (ws.length === 0) return;
    const el = document.querySelector<HTMLElement>(`[data-block="${block}"]`);
    if (el === null || !marker.isConnected) return;
    const chip = chipFor({ t: 'cite', works: ws.map((w) => w.id), locator: locator.trim() }, '(' + ws.map((w) => w.label).join('; ') + (locator.trim() !== '' ? ', ' + locator.trim() : '') + ')');
    const space = document.createTextNode(' ');
    marker.replaceWith(chip, space);
    el.focus();
    caretAfter(space);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    onClose();
  };
  const cancel = (typeAt: boolean): void => {
    const el = document.querySelector<HTMLElement>(`[data-block="${block}"]`);
    onClose();
    if (el === null || !marker.isConnected) return;
    const atNode = document.createTextNode(typeAt ? '@' : '');
    marker.replaceWith(atNode);
    el.focus();
    caretAfter(atNode);
    if (typeAt) el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const choose = (w: WorkRow | undefined, more: boolean): void => {
    if (w === undefined) {
      if (group.length > 0) insert(group);
      return;
    }
    if (!w.citable) {
      toast.error('"' + w.title.slice(0, 60) + '" cannot be cited yet: its identifier has not resolved.');
      return;
    }
    const next = group.some((g) => g.id === w.id) ? group : [...group, w];
    if (more) {
      setGroup(next);
      setQ('');
    } else insert(next);
  };
  const left = Math.max(8, Math.min(window.innerWidth - 400, at.left));
  const top = at.bottom + 340 > window.innerHeight ? Math.max(8, at.top - 344) : at.bottom + 6;
  return (
    <div ref={ref} style={{ position: 'fixed', left, top }} className="ro-pop z-50 flex w-[390px] flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] shadow-[var(--ro-shadow)]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--ro-hair)] p-1.5">
        {group.map((g) => (
          <span key={g.id} className="inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-accent-soft)] pl-1.5 pr-0.5 text-[12px] font-semibold">
            {g.label}
            <button type="button" aria-label={'Remove ' + g.label} onClick={() => setGroup((x) => x.filter((y) => y.id !== g.id))} className="rounded-[3px] p-0.5 hover:bg-[var(--ro-row-hover)]">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(q === '' && group.length > 0 ? undefined : list[active], e.shiftKey);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              // Nothing searched for: the @ was meant as text.
              cancel(q === '' && group.length === 0);
            }
          }}
          placeholder={group.length > 0 ? 'Add another, or Enter' : 'Cite: title, author, year'}
          aria-label="Search the library to cite"
          className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none"
        />
      </div>
      <ul data-scroll className="max-h-64 overflow-y-auto py-1">
        {list.length === 0 && <li className="px-3 py-3 text-[12px] text-[var(--ro-muted)]">{found === null ? 'Type to search the library' : 'No papers match'}</li>}
        {list.map((w, i) => (
          <li key={w.id}>
            <button type="button" onMouseEnter={() => setActive(i)} onClick={(e) => choose(w, e.shiftKey)} className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left', i === active && 'bg-[var(--ro-row-hover)]', !w.citable && 'opacity-50')}>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[12px] font-semibold leading-4">{w.title}</span>
                <span className="block truncate text-[12px] text-[var(--ro-muted)]">
                  {w.label}
                  {!w.citable && ' · not identified yet'}
                  {w.integrity === 'retracted' && ' · retracted'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-[var(--ro-hair)] px-2 py-1.5">
        <input value={locator} onChange={(e) => setLocator(e.target.value)} placeholder="Page (p. 4)" aria-label="Page or section" className="h-6 w-28 rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-1.5 text-[12px] outline-none focus:border-[var(--ro-ink)]" />
        <span className="flex-1 text-right text-[12px] text-[var(--ro-muted)]">Shift+Enter adds another</span>
      </div>
    </div>
  );
}
