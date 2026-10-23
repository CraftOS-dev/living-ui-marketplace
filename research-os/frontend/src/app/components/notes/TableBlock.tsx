/**
 * A table in a note. Type in any cell; Tab and Shift+Tab move across (Tab in
 * the last cell adds a row), Enter moves down (on the last row it adds one),
 * Shift+Enter breaks a line inside a cell, and the arrows move between rows
 * at a cell's start or end. Hover for + below (a row) and at the right (a
 * column); right click a cell, or the menu at the top right, to insert or
 * delete rows and columns, align a column, turn the header row on or off, or
 * delete the table. A range pasted from a spreadsheet fills the cells from
 * the one pasted into, growing the table as needed.
 */
import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Heading, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import type { NoteBlock } from '../../lib/types.ts';
import { useContextMenu, type MenuEntry } from '../ui.tsx';
import { TABLE_COLS, TABLE_ROWS, tableIn } from './clipboard.ts';

type Align = 'left' | 'center' | 'right';

export const blankTable = (): Pick<NoteBlock, 'rows' | 'header' | 'align'> => ({ rows: [['', '', ''], ['', '', ''], ['', '', '']], header: true, align: ['left', 'left', 'left'] });

function caretAt(el: HTMLElement): { start: boolean; end: boolean } {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) return { start: true, end: true };
  const r = sel.getRangeAt(0);
  const before = r.cloneRange();
  before.selectNodeContents(el);
  before.setEnd(r.startContainer, r.startOffset);
  const after = r.cloneRange();
  after.selectNodeContents(el);
  after.setStart(r.endContainer, r.endOffset);
  return { start: before.toString().length === 0, end: after.toString().replace(/\n$/, '').length === 0 };
}

export function TableBlock({ b, onChange, onRemove, setFirstRef }: { b: NoteBlock; onChange: (patch: Partial<NoteBlock>) => void; onRemove: () => void; setFirstRef: (el: HTMLDivElement | null) => void }): React.JSX.Element {
  const rows = b.rows !== undefined && b.rows.length > 0 ? b.rows : (blankTable().rows as string[][]);
  const cols = rows[0]?.length ?? 1;
  const header = b.header !== false;
  const align: Align[] = Array.from({ length: cols }, (_, j) => {
    const a = Array.isArray(b.align) ? b.align[j] : undefined;
    return a === 'center' || a === 'right' ? a : 'left';
  });
  const cells = useRef(new Map<string, HTMLDivElement>());
  const [at, setAt] = useState<[number, number]>([0, 0]);
  const pending = useRef<[number, number, boolean] | null>(null);
  const menu = useContextMenu();

  // Focus a cell once it exists (after a row or column is added), caret at its end.
  useEffect(() => {
    const p = pending.current;
    if (p === null) return;
    const el = cells.current.get(p[0] + ':' + p[1]);
    if (el === undefined) return;
    pending.current = null;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!p[2]);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
  });
  const go = (r: number, c: number, atEnd = true): void => {
    pending.current = [r, c, atEnd];
    setAt([r, c]);
  };

  const set = (next: string[][], extra: Partial<NoteBlock> = {}): void => onChange({ rows: next, ...extra });
  // Before rows or columns move, the cell being typed in lets go: a focused cell is never rewritten from the data.
  const letGo = (): void => {
    const a = document.activeElement;
    if (a instanceof HTMLDivElement && [...cells.current.values()].includes(a)) a.blur();
  };
  const setCell = (r: number, c: number, text: string): void => set(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? text : x)) : row)));
  const addRow = (where: number): string[][] => {
    if (rows.length >= TABLE_ROWS) return rows;
    letGo();
    const next = [...rows];
    next.splice(where, 0, Array.from({ length: cols }, () => ''));
    set(next);
    return next;
  };
  const delRow = (r: number): void => {
    if (rows.length <= 1) return onRemove();
    letGo();
    set(rows.filter((_, i) => i !== r));
    go(Math.max(0, Math.min(r, rows.length - 2)), at[1]);
  };
  const addCol = (where: number): void => {
    if (cols >= TABLE_COLS) return;
    letGo();
    const a = [...align];
    a.splice(where, 0, 'left');
    set(
      rows.map((row) => {
        const n = [...row];
        n.splice(where, 0, '');
        return n;
      }),
      { align: a },
    );
  };
  const delCol = (c: number): void => {
    if (cols <= 1) return onRemove();
    letGo();
    set(
      rows.map((row) => row.filter((_, j) => j !== c)),
      { align: align.filter((_, j) => j !== c) },
    );
    go(at[0], Math.max(0, Math.min(c, cols - 2)));
  };
  const setAlign = (c: number, a: Align): void => onChange({ align: align.map((x, j) => (j === c ? a : x)) });

  const entries = (r: number, c: number): MenuEntry[] => [
    { label: 'Insert a row above', icon: ArrowUpToLine, disabled: rows.length >= TABLE_ROWS, onClick: () => (addRow(r), go(r, c)) },
    { label: 'Insert a row below', icon: ArrowDownToLine, disabled: rows.length >= TABLE_ROWS, onClick: () => (addRow(r + 1), go(r + 1, c)) },
    { label: 'Delete the row', icon: Trash2, danger: true, onClick: () => delRow(r) },
    { divider: true, label: '' },
    { label: 'Insert a column left', icon: ArrowLeftToLine, disabled: cols >= TABLE_COLS, onClick: () => (addCol(c), go(r, c)) },
    { label: 'Insert a column right', icon: ArrowRightToLine, disabled: cols >= TABLE_COLS, onClick: () => (addCol(c + 1), go(r, c + 1)) },
    { label: 'Delete the column', icon: Trash2, danger: true, onClick: () => delCol(c) },
    { divider: true, label: '' },
    { label: 'Align the column left', icon: AlignLeft, onClick: () => setAlign(c, 'left') },
    { label: 'Align the column centre', icon: AlignCenter, onClick: () => setAlign(c, 'center') },
    { label: 'Align the column right', icon: AlignRight, onClick: () => setAlign(c, 'right') },
    { divider: true, label: '' },
    { label: header ? 'Turn off the header row' : 'Make the first row a header', icon: Heading, onClick: () => onChange({ header: !header }) },
    { label: 'Delete the table', icon: Trash2, danger: true, onClick: onRemove },
  ];

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>, r: number, c: number): void => {
    const last = r === rows.length - 1 && c === cols - 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (c > 0) go(r, c - 1);
        else if (r > 0) go(r - 1, cols - 1);
      } else if (last) {
        addRow(rows.length);
        go(r + 1, 0);
      } else go(c === cols - 1 ? r + 1 : r, c === cols - 1 ? 0 : c + 1);
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (r === rows.length - 1) addRow(rows.length);
      go(r + 1, c);
    } else if (e.key === 'ArrowUp' && r > 0 && caretAt(e.currentTarget).start) {
      e.preventDefault();
      go(r - 1, c);
    } else if (e.key === 'ArrowDown' && r < rows.length - 1 && caretAt(e.currentTarget).end) {
      e.preventDefault();
      go(r + 1, c, false);
    }
  };

  /** A pasted range fills cells from (r, c), adding rows and columns as needed. */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>, r: number, c: number): void => {
    e.preventDefault();
    const grid = tableIn(e.clipboardData);
    if (grid === null || (grid.length === 1 && (grid[0]?.length ?? 0) === 1)) {
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      return;
    }
    const needRows = Math.min(TABLE_ROWS, Math.max(rows.length, r + grid.length));
    const needCols = Math.min(TABLE_COLS, Math.max(cols, c + (grid[0]?.length ?? 0)));
    const next = Array.from({ length: needRows }, (_, i) => Array.from({ length: needCols }, (_, j) => grid[i - r]?.[j - c] ?? rows[i]?.[j] ?? ''));
    const a = Array.from({ length: needCols }, (_, j) => align[j] ?? 'left');
    // Cells being typed in keep their text in the page: write the pasted ones there too.
    for (const [key, el] of cells.current) {
      const [i, j] = key.split(':').map(Number) as [number, number];
      if (next[i]?.[j] !== undefined && el.innerText !== next[i][j]) el.innerText = next[i][j];
    }
    set(next, { align: a });
  };

  return (
    <div className="group/tbl relative my-1.5 w-fit max-w-full">
      <div className="flex items-stretch gap-1">
        <div className="min-w-0 overflow-x-auto">
          <table className="border-collapse text-[13px]">
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((text, c) => {
                    const Cell = header && r === 0 ? 'th' : 'td';
                    return (
                      <Cell key={c} className={cn('border border-[var(--ro-line)] p-0 align-top font-normal', header && r === 0 && 'bg-[var(--ro-row)] font-semibold')}>
                        <div
                          ref={(el) => {
                            const key = r + ':' + c;
                            if (el) {
                              cells.current.set(key, el);
                              if (document.activeElement !== el && el.innerText !== text) el.innerText = text;
                            } else cells.current.delete(key);
                            if (r === 0 && c === 0) setFirstRef(el);
                          }}
                          contentEditable
                          suppressContentEditableWarning
                          role="textbox"
                          aria-label={'Row ' + (r + 1) + ', column ' + (c + 1)}
                          onInput={(e) => setCell(r, c, (e.currentTarget as HTMLDivElement).innerText.replace(/\n$/, ''))}
                          onKeyDown={(e) => onKey(e, r, c)}
                          onPaste={(e) => onPaste(e, r, c)}
                          onFocus={() => setAt([r, c])}
                          onContextMenu={(e) => menu(e, entries(r, c))}
                          style={{ textAlign: align[c] }}
                          className="min-h-[30px] min-w-[96px] max-w-[420px] whitespace-pre-wrap break-words px-2 py-1 leading-5 text-[var(--ro-ink)] outline-none focus:bg-[var(--ro-shell)] focus:shadow-[inset_0_0_0_1.5px_var(--ro-ink)]"
                        />
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          aria-label="Add a column"
          title="Add a column"
          disabled={cols >= TABLE_COLS}
          onClick={() => {
            addCol(cols);
            go(at[0], cols);
          }}
          className="flex w-5 shrink-0 items-center justify-center rounded-[var(--ro-r-sm)] border border-dashed border-[var(--ro-line)] text-[var(--ro-muted)] opacity-0 transition-opacity hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)] group-hover/tbl:opacity-100 group-focus-within/tbl:opacity-100 [@media(hover:none)]:opacity-100 disabled:hidden"
        >
          <Plus size={12} />
        </button>
      </div>
      <button
        type="button"
        aria-label="Add a row"
        title="Add a row"
        disabled={rows.length >= TABLE_ROWS}
        onClick={() => {
          addRow(rows.length);
          go(rows.length, 0);
        }}
        className="mt-1 flex h-5 w-full items-center justify-center rounded-[var(--ro-r-sm)] border border-dashed border-[var(--ro-line)] text-[var(--ro-muted)] opacity-0 transition-opacity hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)] group-hover/tbl:opacity-100 group-focus-within/tbl:opacity-100 [@media(hover:none)]:opacity-100 disabled:hidden"
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        aria-label="Table options"
        title="Table options"
        onClick={(e) => menu(e, entries(at[0], at[1]))}
        className="absolute -top-2.5 right-6 flex size-6 items-center justify-center rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink-2)] opacity-0 shadow-[var(--ro-shadow-sm)] transition-opacity hover:text-[var(--ro-ink)] group-hover/tbl:opacity-100 group-focus-within/tbl:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  );
}
