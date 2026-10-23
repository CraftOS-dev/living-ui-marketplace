/**
 * A financial statement as a clean table: section headings, lines (indented,
 * each opening its account, party or document), subtotals and a total, in
 * one or more number columns (periods, comparisons, aging buckets). Phones
 * scroll wide statements sideways inside the card. The same rows give the
 * CSV export and the print.
 */
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { csvAmount, toCsv } from '../books/util.ts';
import { decimalsOf, money } from '../../lib/format.ts';

export interface SRow {
  kind: 'section' | 'line' | 'subtotal' | 'total' | 'gap';
  label: string;
  sub?: string | undefined;
  code?: string | undefined;
  values?: (number | null)[] | undefined;
  /** Shown instead of a number (a count, a percent). */
  texts?: (string | null)[] | undefined;
  onClick?: (() => void) | undefined;
  indent?: number | undefined;
  /** Colour the figures: red when negative is bad (net loss). */
  signTone?: boolean | undefined;
  /** A row with detail rows under it that open and close (aging documents). */
  toggle?: { open: boolean; onToggle: () => void; label: string } | undefined;
}

export interface SColumn {
  label: string;
  /** A share column ("%") or a count: drawn as text, not money. */
  text?: boolean | undefined;
  hideOnPhone?: boolean | undefined;
}

export function Statement({ columns, rows, currency, minWidth, labelHeader = '' }: { columns: SColumn[]; rows: SRow[]; currency: string; minWidth?: number | undefined; labelHeader?: string | undefined }): React.JSX.Element {
  const wide = minWidth ?? (columns.length > 2 ? 280 + columns.length * 104 : 0);
  return (
    <div className="-mx-2 relative overflow-x-auto px-2">
      <table className="w-full border-separate border-spacing-0 text-[14px]" style={wide > 0 ? { minWidth: wide } : undefined}>
        <thead>
          <tr className="text-[12px] text-[var(--erp-muted)]">
            <th className="sticky left-0 z-[1] bg-[var(--erp-card)] px-3 pb-2 text-left font-semibold">{labelHeader}</th>
            {columns.map((c, i) => (
              <th key={i} className={cn('whitespace-nowrap px-3 pb-2 text-right font-semibold', c.hideOnPhone === true && 'hidden @min-[640px]:table-cell')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <StatementRow key={i} r={r} columns={columns} currency={currency} wide={wide > 0} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ v, t, currency, strong, tone, hide }: { v: number | null | undefined; t: string | null | undefined; currency: string; strong: boolean; tone: boolean; hide: boolean }): React.JSX.Element {
  return (
    <td className={cn('num whitespace-nowrap px-3 py-2 text-right', strong ? 'font-extrabold' : 'font-semibold', tone && v !== null && v !== undefined && v < 0 && 'text-[var(--erp-red-text)]', hide && 'hidden @min-[640px]:table-cell')}>
      {t !== undefined && t !== null ? t : v === null || v === undefined ? '' : money(v, currency)}
    </td>
  );
}

function StatementRow({ r, columns, currency, wide }: { r: SRow; columns: SColumn[]; currency: string; wide: boolean }): React.JSX.Element {
  if (r.kind === 'gap') {
    return (
      <tr aria-hidden>
        <td colSpan={columns.length + 1} className="h-3" />
      </tr>
    );
  }
  if (r.kind === 'section') {
    return (
      <tr>
        <td colSpan={columns.length + 1} className="px-3 pb-1 pt-4 text-[13px] font-bold text-[var(--erp-ink)]">
          {r.label}
          {r.sub !== undefined && <span className="ml-2 text-[12px] font-semibold text-[var(--erp-muted)]">{r.sub}</span>}
        </td>
      </tr>
    );
  }
  const strong = r.kind === 'subtotal' || r.kind === 'total';
  const label: ReactNode = (
    <span className="flex min-w-0 items-center gap-2">
      {r.toggle !== undefined && (
        <button
          type="button"
          aria-expanded={r.toggle.open}
          aria-label={r.toggle.label}
          title={r.toggle.label}
          onClick={(e) => {
            e.stopPropagation();
            r.toggle?.onToggle();
          }}
          className="erp-no-print -ml-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]"
        >
          <ChevronDown size={13} aria-hidden className={cn('transition-transform', !r.toggle.open && '-rotate-90')} />
        </button>
      )}
      {/* Account codes are for wider reports; on a phone the name gets the room. */}
      {r.code !== undefined && r.code !== '' && <span className="num hidden shrink-0 text-[12px] font-bold text-[var(--erp-muted)] @min-[480px]:inline">{r.code}</span>}
      <span className={cn('min-w-0 @min-[640px]:truncate', wide && 'truncate', strong ? 'font-extrabold' : 'font-medium')}>{r.label}</span>
      {r.sub !== undefined && r.sub !== '' && <span className="hidden min-w-0 truncate text-[12px] text-[var(--erp-muted)] @min-[480px]:inline">{r.sub}</span>}
      {r.onClick !== undefined && <ChevronRight size={14} aria-hidden className="erp-no-print invisible shrink-0 text-[var(--erp-muted)] group-hover:visible" />}
    </span>
  );
  return (
    <tr
      className={cn(
        'group',
        r.onClick !== undefined && 'cursor-pointer hover:bg-[var(--erp-row)]',
        r.kind === 'subtotal' && '[&>td]:border-t [&>td]:border-[var(--erp-line)]',
        r.kind === 'total' && '[&>td]:bg-[var(--erp-row)] [&>td:first-child]:rounded-l-[14px] [&>td:last-child]:rounded-r-[14px]',
      )}
      onClick={r.onClick}
      tabIndex={r.onClick !== undefined ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && r.onClick !== undefined) r.onClick();
      }}
      role={r.onClick !== undefined ? 'link' : undefined}
    >
      <td
        className={cn(
          'sticky left-0 z-[1] bg-[var(--erp-card)] py-2 pr-3 group-hover:bg-[var(--erp-row)]',
          // Wide statements scroll sideways under a label column of a set width; narrow ones give the label the room.
          wide ? 'w-[220px] min-w-[220px] max-w-[220px] @min-[640px]:w-auto @min-[640px]:max-w-[360px]' : 'w-full min-w-[200px] max-w-0',
          r.kind === 'total' && 'bg-[var(--erp-row)]',
        )} style={{ paddingLeft: 12 + (r.indent ?? (r.kind === 'line' ? 1 : 0)) * 16 }}>
        {label}
      </td>
      {columns.map((c, i) => (
        <Cell key={i} v={r.values?.[i]} t={r.texts?.[i]} currency={currency} strong={strong} tone={r.signTone === true} hide={c.hideOnPhone === true} />
      ))}
    </tr>
  );
}

/** The statement as CSV: label, code, then each column. */
export function statementCsv(columns: SColumn[], rows: SRow[], currency: string): string {
  const d = decimalsOf(currency);
  const out: (string | number)[][] = [['Line', 'Code', ...columns.map((c) => c.label)]];
  for (const r of rows) {
    if (r.kind === 'gap') continue;
    if (r.kind === 'section') {
      out.push([r.label, '', ...columns.map(() => '')]);
      continue;
    }
    out.push([r.label, r.code ?? '', ...columns.map((_, i) => {
      const t = r.texts?.[i];
      if (t !== undefined && t !== null) return t;
      const v = r.values?.[i];
      return v === null || v === undefined ? '' : csvAmount(v, d);
    })]);
  }
  return toCsv(out);
}
