/**
 * What a paste or a drop carries into a note: pictures, or a table (a
 * spreadsheet's range comes as an HTML table; tab-separated lines work too).
 */

export const TABLE_ROWS = 500;
export const TABLE_COLS = 30;

const PICTURE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp' };
const PICTURE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

const extOf = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

/** The pictures in a paste or a drop. A pasted screenshot has no useful name, so it gets one with the time. */
export function picturesIn(dt: DataTransfer): File[] {
  const fromItems = Array.from(dt.items)
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
  const all = fromItems.length > 0 ? fromItems : Array.from(dt.files);
  const pics = all.filter((f) => PICTURE_TYPES[f.type] !== undefined || PICTURE_EXT.has(extOf(f.name)));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return pics.map((f, i) => {
    const ext = extOf(f.name);
    if (PICTURE_EXT.has(ext) && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f;
    const as = PICTURE_TYPES[f.type] ?? (PICTURE_EXT.has(ext) ? ext : 'png');
    return new File([f], 'pasted-' + stamp + (pics.length > 1 ? '-' + (i + 1) : '') + '.' + as, { type: f.type || 'image/' + as });
  });
}

/** Any files in a paste or a drop (to say when none of them are pictures). */
export const hasFiles = (dt: DataTransfer): boolean => Array.from(dt.types).includes('Files');

function rectangle(rows: string[][]): string[][] {
  const cols = Math.min(TABLE_COLS, Math.max(1, ...rows.map((r) => r.length)));
  return rows.slice(0, TABLE_ROWS).map((r) => Array.from({ length: cols }, (_, j) => r[j] ?? ''));
}

/** Tab-separated lines as rows (every line with the same number of tabs, at least one). */
export function tsvRows(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length === 0 || !lines.every((l) => l.includes('\t'))) return null;
  const n = (lines[0] ?? '').split('\t').length;
  if (!lines.every((l) => l.split('\t').length === n)) return null;
  return rectangle(lines.map((l) => l.split('\t')));
}

/** A table on the clipboard: an HTML table (spreadsheets copy their ranges as one), else tab-separated lines. */
export function tableIn(dt: DataTransfer): string[][] | null {
  const html = dt.getData('text/html');
  if (html !== '' && /<table/i.test(html)) {
    const t = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
    if (t !== null) {
      const rows = Array.from(t.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th, td')).map((td) => (td.textContent ?? '').replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ').trim()))
        .filter((r) => r.length > 0);
      if (rows.length > 0) return rectangle(rows);
    }
  }
  return tsvRows(dt.getData('text/plain'));
}
