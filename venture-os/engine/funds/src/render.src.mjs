/**
 * The funds PDF engine (hook-spawned Node, bundled into ../render.mjs with
 * pdf-lib and @pdf-lib/fontkit by build.mjs).
 *
 *   node engine/funds/render.mjs <job.json>
 *   job: { dir, docs: [{ out, doc: 'notice' | 'pack', han: 'jp'|'sc'|'kr', ...input }] }
 *   prints { ok: true, files: [out...] } or { ok: false, error } and exits 0 or 1.
 *
 * Every string is drawn in runs of one font each: Noto Sans (Latin, Greek,
 * Cyrillic, Vietnamese; 400 and 700) and Noto Sans JP, SC and KR (400) as
 * the Google Fonts WOFF slices of ../fonts (fonts.json maps each slice to
 * its Unicode ranges). Only the slices a document uses are embedded, and
 * each only with the glyphs it draws (pdf-lib subsetting). Han characters
 * take the Japanese, Chinese or Korean form by the document's `han` (the
 * LP's country), or by the kana or hangul in the same string.
 *
 * Numbers are laid out from the stored values Venture OS passes; nothing
 * is computed here but positions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, grayscale } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const W = 595.28;
const H = 841.89;
const M = 56;
const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS = join(HERE, 'fonts');
const CATALOG = JSON.parse(readFileSync(join(FONTS, 'fonts.json'), 'utf8'));
const bytesCache = new Map();

function fileBytes(file) {
  if (!bytesCache.has(file)) bytesCache.set(file, readFileSync(join(FONTS, file)));
  return bytesCache.get(file);
}

function inRanges(ranges, cp) {
  for (const r of ranges) if (cp >= r[0] && cp <= r[1]) return true;
  return false;
}

const KANA = (cp) => (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f);
const HANGUL = (cp) => (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f);

/* --------------------------------------------------------------- money */

function group(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/** Minor units -> "USD 1,234.50" (exp: the currency's decimals). */
function money(minor, cur, exp) {
  const n = Math.round(Number(minor || 0));
  const neg = n < 0;
  let digits = String(Math.abs(n));
  while (digits.length <= exp) digits = '0' + digits;
  const whole = exp > 0 ? digits.slice(0, digits.length - exp) : digits;
  const frac = exp > 0 ? digits.slice(digits.length - exp) : '';
  return (neg ? '-' : '') + cur + ' ' + group(whole) + (frac !== '' ? '.' + frac : '');
}

function mult(e8) {
  if (e8 === null || e8 === undefined) return 'n/a';
  return (Math.round(Number(e8) / 1e6) / 100).toFixed(2) + 'x';
}

function pct(ppm) {
  if (ppm === null || ppm === undefined) return 'n/a';
  return (Math.round(Number(ppm) / 1000) / 10).toFixed(1) + '%';
}

/* ------------------------------------------------------------ document */

async function makeDoc(han) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embedded = new Map();
  const font = async (file) => {
    if (!embedded.has(file)) embedded.set(file, await pdf.embedFont(fileBytes(file), { subset: true }));
    return embedded.get(file);
  };
  const order = { jp: ['jp', 'sc', 'kr'], sc: ['sc', 'jp', 'kr'], kr: ['kr', 'jp', 'sc'] };
  /** The slice that draws code point cp: Latin family first (with its weight), then CJK by preference. */
  const sliceFor = (cp, bold, pref) => {
    const w = bold ? 700 : 400;
    for (const s of CATALOG.latin) if (s.weight === w && inRanges(s.ranges, cp)) return s.file;
    for (const fam of order[pref] || order.sc) for (const s of CATALOG[fam]) if (inRanges(s.ranges, cp)) return s.file;
    return null;
  };
  /** A string as runs [{ text, file }] (a character no font draws becomes '?'). */
  const runs = (text, bold) => {
    const cps = Array.from(String(text));
    let pref = han || 'sc';
    if (cps.some((c) => KANA(c.codePointAt(0)))) pref = 'jp';
    else if (cps.some((c) => HANGUL(c.codePointAt(0)))) pref = 'kr';
    const out = [];
    for (let ch of cps) {
      let cp = ch.codePointAt(0);
      if (cp === 9 || cp === 10 || cp === 13) {
        ch = ' ';
        cp = 32;
      }
      let file = sliceFor(cp, bold, pref);
      if (file === null) {
        ch = '?';
        file = sliceFor(63, bold, pref);
      }
      const last = out[out.length - 1];
      if (last && last.file === file) last.text += ch;
      else out.push({ text: ch, file });
    }
    return out;
  };
  const widthOf = async (text, size, bold) => {
    let w = 0;
    for (const r of runs(text, bold)) w += (await font(r.file)).widthOfTextAtSize(r.text, size);
    return w;
  };
  let page = pdf.addPage([W, H]);
  const self = {
    W,
    H,
    margin: M,
    newPage() {
      page = pdf.addPage([W, H]);
    },
    widthOf,
    async text(x, y, value, o = {}) {
      const size = o.size || 10;
      const s = String(value === undefined || value === null ? '' : value);
      if (s === '') return;
      let left = x;
      if (o.align === 'right') left = x - (await widthOf(s, size, o.bold));
      else if (o.align === 'center') left = x - (await widthOf(s, size, o.bold)) / 2;
      const color = grayscale(o.gray === undefined ? 0 : o.gray);
      for (const r of runs(s, o.bold)) {
        const f = await font(r.file);
        page.drawText(r.text, { x: left, y: H - y, size, font: f, color });
        left += f.widthOfTextAtSize(r.text, size);
      }
    },
    line(x1, y1, x2, y2, o = {}) {
      page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: o.width || 0.5, color: grayscale(o.gray === undefined ? 0.75 : o.gray) });
    },
    box(x, y, w, h, o = {}) {
      page.drawRectangle({ x, y: H - y - h, width: w, height: h, color: grayscale(o.fill === undefined ? 0.95 : o.fill) });
    },
    /** A wrapped paragraph from baseline y; answers the y after it (a new page when it runs past the bottom). */
    async wrap(x, y, w, value, o = {}) {
      const size = o.size || 10;
      const lead = o.lead || size * 1.45;
      let yy = y;
      for (const para of String(value || '').split(/\r?\n/)) {
        // Words split on spaces; a word wider than the line (CJK text has no spaces) breaks by character.
        const words = [];
        for (const word of para.split(/\s+/).filter((t) => t !== '')) {
          if ((await widthOf(word, size, o.bold)) <= w) words.push(word);
          else {
            let piece = '';
            for (const ch of Array.from(word)) {
              if (piece !== '' && (await widthOf(piece + ch, size, o.bold)) > w) {
                words.push(piece);
                piece = '';
              }
              piece += ch;
            }
            if (piece !== '') words.push(piece);
          }
        }
        let line = '';
        const flush = async () => {
          if (yy > H - M) {
            self.newPage();
            yy = M + size;
          }
          await self.text(x, yy, line, { size, bold: o.bold, gray: o.gray });
          yy += lead;
          line = '';
        };
        for (const word of words) {
          const next = line === '' ? word : line + ' ' + word;
          if (line !== '' && (await widthOf(next, size, o.bold)) > w) {
            await flush();
            line = word;
          } else line = next;
        }
        if (line !== '') await flush();
        else if (words.length === 0) yy += lead * 0.5;
      }
      return yy;
    },
    /** Rows of cells at column x positions (numbers right-aligned at their x); head: first row on a band; total: last row ruled and bold. */
    async table(y, cols, rows, o = {}) {
      const size = o.size || 9.5;
      const lead = o.lead || 17;
      let yy = y;
      for (let i = 0; i < rows.length; i++) {
        if (yy > H - M) {
          self.newPage();
          yy = M + size;
        }
        const head = o.head && i === 0;
        const total = o.total && i === rows.length - 1;
        if (head) self.box(M, yy - size - 3, W - 2 * M, lead, { fill: 0.94 });
        if (total) self.line(M, yy - size - 4, W - M, yy - size - 4, { gray: 0.4 });
        for (let j = 0; j < rows[i].length; j++) await self.text(cols[j].x, yy, rows[i][j], { size, bold: head || total, align: cols[j].align || 'left', gray: head ? 0.25 : 0 });
        yy += lead;
      }
      return yy;
    },
    async save() {
      return pdf.save({ useObjectStreams: true });
    },
  };
  return self;
}

/* ------------------------------------------------------------- notices */

async function notice(o) {
  const d = await makeDoc(o.han);
  const cur = o.fund.currency;
  const exp = o.fund.exp;
  const m = (v) => money(v, cur, exp);
  const call = o.kind === 'call';
  const R = W - M;
  let y = M + 14;
  await d.text(M, y, o.firm, { size: 15, bold: true });
  await d.text(R, y, call ? 'Capital call notice' : 'Distribution notice', { size: 11, align: 'right', gray: 0.35 });
  y += 30;
  const head = [
    ['To', o.lp.name + (o.lp.attention ? ' (attention: ' + o.lp.attention + ')' : '')],
    ['From', o.firm],
    ['Re', o.fund.legal_name || o.fund.name],
    ['Notice', o.number],
    ['Date of notice', o.notice_day],
    [call ? 'Due date' : 'Payment date', o.due_day],
  ];
  for (const h of head) {
    await d.text(M, y, h[0], { size: 9, gray: 0.4 });
    await d.text(M + 110, y, h[1], { size: 10 });
    y += 15;
  }
  y += 8;
  d.line(M, y, R, y);
  y += 22;
  const total = o.totals.total_minor;
  y = await d.wrap(M, y, R - M, o.summary, { size: 10.5 });
  y += 6;
  await d.text(M, y, call ? 'Your portion of the call' : 'Your portion of the distribution', { size: 9, gray: 0.4 });
  y += 20;
  await d.text(M, y, m(o.line.total_minor), { size: 20, bold: true });
  y += 24;
  const b = o.line.balances || {};
  const bal = call
    ? 'After this notice you will have contributed ' + pct(b.contributed_ppm) + ' of your commitment of ' + m(b.commitment_minor) + ', and your unfunded commitment will be ' + m(b.unfunded_minor) + '. You have received ' + m(b.distributed_minor) + ' in distributions, of which ' + m(b.recallable_minor) + ' is recallable capital.'
    : 'After this distribution you will have received ' + m(b.distributed_minor) + ' in distributions, of which ' + m(b.recallable_minor) + ' is recallable capital. You have contributed ' + m(b.contributed_minor) + ' of your commitment of ' + m(b.commitment_minor) + '.';
  y = await d.wrap(M, y, R - M, bal, { size: 10 });
  y += 10;
  const rows = [['Transaction type', 'Your amount', 'Fund total']];
  for (const t of o.types) {
    const v = (o.line.amounts || {})[t.key] || 0;
    const ft = o.totals[t.key] || 0;
    if (v === 0 && ft === 0) continue;
    rows.push([t.label, m(v), m(ft)]);
  }
  rows.push(['Total', m(o.line.total_minor), m(total)]);
  y = await d.table(y, [{ x: M + 6 }, { x: R - 150, align: 'right' }, { x: R - 6, align: 'right' }], rows, { head: true, total: true });
  y += 14;
  await d.text(M, y, 'Description', { size: 11, bold: true });
  y += 18;
  for (const t of o.description) y = (await d.wrap(M, y, R - M, t, { size: 9.5 })) + 4;
  if (o.narrative) y = (await d.wrap(M, y + 4, R - M, o.narrative, { size: 9.5 })) + 4;
  if (call && o.wire) {
    if (y > H - 230) {
      d.newPage();
      y = M + 14;
    }
    y += 10;
    d.box(M, y - 12, R - M, 150, { fill: 0.96 });
    await d.text(M + 10, y + 4, 'Wire instructions', { size: 11, bold: true });
    y += 22;
    const w = o.wire;
    const lines = [
      ['Amount due', m(o.line.total_minor)],
      ['Due date', o.due_day],
      ['Bank', w.bank_name],
      ['Account name', w.account_name],
      ['Account number', w.account_number],
      ['Routing', w.routing],
      ['SWIFT', w.swift],
      ['IBAN', w.iban],
      ['Bank address', w.bank_address],
      ['Reference', w.reference || o.number],
    ].filter((x) => x[1]);
    for (const l of lines.slice(0, 9)) {
      await d.text(M + 10, y, l[0], { size: 9, gray: 0.4 });
      await d.text(M + 120, y, l[1], { size: 9.5, bold: l[0] === 'Amount due' });
      y += 13;
    }
    y += 16;
    y = await d.wrap(M, y, R - M, 'Before you send funds, confirm these wire instructions by phone with a contact you already know at ' + o.firm + '. We never change wire instructions by email.', { size: 9.5, bold: true });
  } else if (!call) {
    y += 6;
    y = await d.wrap(M, y, R - M, 'The amount will be paid to the account you have on file with ' + o.firm + ' on the payment date. If your bank details changed, confirm them by phone with a contact you already know.', { size: 9.5 });
  }
  await d.text(M, H - 34, 'Issued under the Limited Partnership Agreement of ' + (o.fund.legal_name || o.fund.name) + ' (' + o.number + ')', { size: 8, gray: 0.5 });
  return d.save();
}

/* --------------------------------------------------------------- packs */

async function pack(o) {
  const d = await makeDoc(o.han);
  const cur = o.fund.currency;
  const m = (v) => money(v, cur, o.fund.exp);
  const R = W - M;
  let y = M + 14;
  await d.text(M, y, o.firm, { size: 15, bold: true });
  await d.text(R, y, o.quarter.label + ' letter', { size: 11, align: 'right', gray: 0.35 });
  y += 30;
  await d.text(M, y, 'To the limited partners of ' + (o.fund.legal_name || o.fund.name), { size: 10, gray: 0.4 });
  y += 24;
  for (const para of o.paragraphs) y = (await d.wrap(M, y, R - M, para, { size: 10.5 })) + 8;
  d.newPage();
  y = M + 14;
  await d.text(M, y, 'Capital account statement', { size: 14, bold: true });
  await d.text(R, y, o.quarter.label, { size: 11, align: 'right', gray: 0.35 });
  y += 22;
  y = await d.wrap(M, y, R - M, o.lp.name + ' in ' + (o.fund.legal_name || o.fund.name) + ', as of ' + o.quarter.period_end, { size: 10 });
  y += 10;
  const a = o.account;
  y = await d.table(
    y,
    [{ x: M + 6 }, { x: R - 6, align: 'right' }],
    [
      ['Item', cur],
      ['Commitment', m(a.commitment_minor)],
      ['Contributed (' + pct(a.contributed_ppm) + ')', m(a.contributed_minor)],
      ['Unfunded commitment', m(a.unfunded_minor)],
      ['Distributions received', m(a.distributed_minor)],
      ['Of which recallable', m(a.recallable_minor)],
      ['Share of net asset value (estimate)', m(o.nav_share_minor)],
    ],
    { head: true },
  );
  y += 18;
  await d.text(M, y, 'Performance (net beside gross)', { size: 11, bold: true });
  y += 18;
  const fm = o.fund_metrics;
  y = await d.table(
    y,
    [{ x: M + 6 }, { x: M + 250, align: 'right' }, { x: R - 6, align: 'right' }],
    [
      ['Measure', 'Net (to LPs)', 'Gross (fund)'],
      ['Multiple', 'TVPI ' + mult(fm.tvpi_e8), 'MOIC ' + mult(fm.gross_moic_e8)],
      ['IRR', pct(fm.net_irr_ppm), pct(fm.gross_irr_ppm)],
      ['DPI / RVPI', mult(fm.dpi_e8) + ' / ' + mult(fm.rvpi_e8), ''],
      ['Your account', 'TVPI ' + mult(o.lp_metrics.tvpi_e8) + ', IRR ' + pct(o.lp_metrics.net_irr_ppm), ''],
    ],
    { head: true },
  );
  y += 14;
  y = await d.wrap(M, y, R - M, 'Net figures are after fees, expenses and carried interest; gross figures are before them. Figures are from the frozen quarter and are not forecasts.', { size: 8.5, gray: 0.4 });
  if (o.flows && o.flows.length > 0) {
    y += 14;
    await d.text(M, y, 'Activity', { size: 11, bold: true });
    y += 18;
    await d.table(y, [{ x: M + 6 }, { x: M + 90 }, { x: R - 6, align: 'right' }], [['Day', 'Type', cur]].concat(o.flows.map((f) => [f.day, f.label, m(f.amount_minor)])), { head: true });
  }
  await d.text(M, H - 34, o.firm + ', ' + o.quarter.label + '. Snapshot ' + String(o.hash || '').slice(0, 16), { size: 8, gray: 0.5 });
  return d.save();
}

/* ---------------------------------------------------------------- main */

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const files = [];
  for (const doc of job.docs) {
    const bytes = doc.doc === 'pack' ? await pack(doc) : await notice(doc);
    writeFileSync(join(job.dir, doc.out), bytes);
    files.push(doc.out);
  }
  return files;
}

// Every failure is answered as JSON on stdout with exit code 0, so the hook always reads the reason.
const fail = (err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((err && err.stack) || err) }));
  process.exit(0);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const guard = setTimeout(() => fail('timeout'), 120000);
main()
  .then((files) => {
    clearTimeout(guard);
    process.stdout.write(JSON.stringify({ ok: true, files }));
  })
  .catch((err) => {
    clearTimeout(guard);
    fail(err);
  });
