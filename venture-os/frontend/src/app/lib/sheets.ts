/**
 * Spreadsheets in the browser: read a CSV or XLSX a person drops (for
 * imports.preview and imports.run), and write CSV or XLSX for exports.
 * The XLSX libraries load on first use (they are large).
 *
 *   const t = await readTable(file);                 // { headers, rows }
 *   await saveXlsx([{ name: 'Capital', columns: ['LP', 'Called'], rows }], 'capital.xlsx');
 *   saveText(toCsv([headers, ...rows]), 'deals.csv');  // lib/api.ts
 */
import { saveBlob } from './api.ts';

export interface Table {
  headers: string[];
  /** One string per header, trimmed ('' when blank). */
  rows: string[][];
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF; a BOM is dropped). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = (() => {
    const first = s.split(/\r?\n/, 1)[0] ?? '';
    const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const);
    return counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  })();
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) out.push(row);
  return out;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** A dropped .csv, .tsv, .txt or .xlsx file as headers and rows (first non-empty row = headers). */
export async function readTable(file: File): Promise<Table> {
  const name = file.name.toLowerCase();
  let grid: string[][];
  if (name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    grid = data.map((r) => r.map(cellText));
  } else {
    grid = parseCsv(await file.text()).map((r) => r.map((c) => c.trim()));
  }
  const [head = [], ...body] = grid.filter((r) => r.some((c) => c !== ''));
  const headers = head.map((h, i) => (h !== '' ? h : `Column ${i + 1}`));
  return { headers, rows: body.map((r) => headers.map((_, i) => r[i] ?? '')) };
}

/** Rows to CSV text (quotes where needed). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export interface XlsxSheet {
  name: string;
  columns: string[];
  rows: (string | number | Date | null)[][];
  /** Column widths in characters. */
  widths?: number[] | undefined;
}

/** Write one or more sheets to an .xlsx and save it (header row bold, frozen). */
export async function saveXlsx(sheets: XlsxSheet[], fileName: string): Promise<void> {
  const mod = await import('write-excel-file/browser');
  const write = mod.default;
  const data = sheets.map((s) => [
    s.columns.map((c) => ({ value: c, fontWeight: 'bold' as const })),
    ...s.rows.map((r) => r.map((v) => (v === null ? null : { value: v }))),
  ]);
  const blob = await write(data as never, { sheets: sheets.map((s) => s.name.slice(0, 31)), columns: sheets.map((s) => (s.widths ?? s.columns.map(() => 16)).map((w) => ({ width: w }))), stickyRowsCount: 1 } as never).toBlob();
  saveBlob(blob, fileName);
}
