/**
 * Export helpers — the two mechanisms the app's reports need, both
 * dependency-free:
 *   • downloadCsv  — serialize rows to a spreadsheet file (Excel/Numbers open it)
 *   • printDocument — render a self-contained HTML report and hand it to the
 *     browser's print dialog, where "Save as PDF" produces the document.
 *
 * Money amounts are written as bare numbers (the app is currency-agnostic);
 * never put symbols or thousands separators in a CSV amount column or the
 * spreadsheet imports them as text.
 */
import { todayStr } from './useCompany.ts';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export type CsvCell = string | number | null | undefined;

/** RFC-4180 quoting: wrap in quotes and double any inner quote when needed. */
function csvCell(v: CsvCell): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Trigger a download of `rows` as a CSV file. A UTF-8 BOM is prepended so
 * Excel on Windows reads accented characters correctly.
 */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filesystem-safe slug for filenames, e.g. "Acme Co" → "acme-co". */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'export'
  );
}

/** `basename-2026-08-26.csv` */
export function stampedName(basename: string, ext: string): string {
  return `${slug(basename)}-${todayStr()}.${ext}`;
}

/* ------------------------------------------------------------------ */
/* HTML → print → PDF                                                  */
/* ------------------------------------------------------------------ */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Print-document stylesheet: clean, black-on-white, mirrors the app's calm hierarchy. */
const PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #18181b; font-size: 12px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .doc { max-width: 760px; margin: 0 auto; padding: 32px 28px; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 2px solid #18181b; padding-bottom: 12px; margin-bottom: 22px; gap: 16px; }
  .masthead .company { font-size: 16px; font-weight: 700; }
  .masthead .doc-title { font-size: 11px; text-transform: uppercase; letter-spacing: .09em; color: #71717a; margin-top: 2px; }
  .masthead .meta { text-align: right; font-size: 11px; color: #71717a; white-space: nowrap; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: #71717a;
    margin: 24px 0 8px; font-weight: 600; }
  .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 4px; }
  .kpi { flex: 1 1 140px; border: 1px solid #e4e4e7; padding: 12px 14px; }
  .kpi .label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #71717a; }
  .kpi .value { font-size: 22px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .kpi .sub { font-size: 11px; color: #71717a; margin-top: 2px; }
  p.note { color: #3f3f46; margin: 6px 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e4e4e7; font-size: 12px; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #71717a; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-top: 2px solid #18181b; border-bottom: none; font-weight: 700; }
  .pos { color: #047857; } .neg { color: #b91c1c; }
  .muted { color: #71717a; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid #f4f4f5; }
  .row:last-child { border-bottom: none; }
  .pill { display: inline-block; border: 1px solid #d4d4d8; border-radius: 999px;
    padding: 1px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #52525b; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e4e4e7; font-size: 10px; color: #a1a1aa; }
  @media print { .doc { padding: 0; } @page { margin: 16mm; } }
`;

/** Masthead block for a report: company name, document title, generated date. */
export function reportMasthead(company: string, title: string): string {
  const when = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `<div class="masthead">
    <div>
      <div class="company">${escapeHtml(company)}</div>
      <div class="doc-title">${escapeHtml(title)}</div>
    </div>
    <div class="meta">Generated ${escapeHtml(when)}</div>
  </div>`;
}

/**
 * Render `bodyHtml` as a standalone document and open the print dialog.
 * Uses a hidden iframe (popup-blocker-proof) and prints just that document.
 */
export function printDocument(title: string, bodyHtml: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>${PRINT_CSS}</style></head><body><div class="doc">${bodyHtml}</div></body></html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (win === null || doc === undefined || doc === null) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = (): void => {
    setTimeout(() => iframe.remove(), 500);
  };
  win.onafterprint = cleanup;
  // Give the iframe a tick to lay out before printing.
  setTimeout(() => {
    win.focus();
    win.print();
    // Fallback cleanup if onafterprint never fires (some browsers).
    setTimeout(cleanup, 60_000);
  }, 200);
}
