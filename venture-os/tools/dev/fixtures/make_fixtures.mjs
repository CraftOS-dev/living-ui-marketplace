/**
 * Write the sample PDFs the mock bridge serves as Gmail attachments: small
 * but realistic pitch decks and an investor update, each a real PDF with a
 * real text layer (standard Helvetica, WinAnsi text), so text extraction
 * (pdf.js, Research OS pdftext.mjs) reads them like a founder's file.
 *
 *   node tools/dev/fixtures/make_fixtures.mjs
 *
 * Slides are 960 x 540 points (16:9). The content is invented sample data
 * for tests; no real company.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** One page's content stream: a title, then lines (strings, or [text, size]). */
function pageStream(page, w, h) {
  const ops = ['BT', '/F2 30 Tf', '60 ' + (h - 80) + ' Td', '(' + esc(page.title) + ') Tj', 'ET'];
  let y = h - 140;
  for (const line of page.lines) {
    const [text, size] = Array.isArray(line) ? line : [line, 18];
    ops.push('BT', '/F1 ' + size + ' Tf', '60 ' + y + ' Td', '(' + esc(text) + ') Tj', 'ET');
    y -= Math.round(size * 1.6);
  }
  if (page.footer) ops.push('BT', '/F1 11 Tf', '60 30 Td', '(' + esc(page.footer) + ') Tj', 'ET');
  return ops.join('\n');
}

/** A PDF document of slides: [{ title, lines, footer }]. */
function pdf(meta, pages, w = 960, h = 540) {
  const objs = [];
  const add = (s) => {
    objs.push(s);
    return objs.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const p of pages) {
    const stream = pageStream(p, w, h);
    const content = add('<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream');
    kids.push(add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + content + ' 0 R >>'));
  }
  objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
  objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
  const info = add('<< /Title (' + esc(meta.title) + ') /Author (' + esc(meta.author) + ') /Producer (Venture OS test fixtures) >>');
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += i + 1 + ' 0 obj\n' + o + '\nendobj\n';
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

const files = {
  'decks/acme_robotics_seed.pdf': pdf({ title: 'Acme Robotics: Seed round', author: 'Maya Chen' }, [
    { title: 'Acme Robotics', lines: ['Autonomous picking robots for mid-size warehouses', '', 'Seed round, November 2026', 'Maya Chen, CEO  |  maya@acmerobotics.ai'], footer: 'Confidential. Shared with Northwind Ventures under NDA.' },
    { title: 'The problem', lines: ['Mid-size warehouses (20k to 200k sq ft) cannot hire enough pickers.', 'Picker turnover is 43% a year; wages rose 18% since 2023.', 'Existing robots need a full re-layout and cost USD 2M+ per site.'] },
    { title: 'Our solution', lines: ['Mobile picking arms that work in existing aisles, no re-layout.', 'Live on site in 10 days; priced per pick (USD 0.09).', 'Vision model trained on 40M real picks.'] },
    { title: 'Traction', lines: ['ARR: USD 1.2M (October 2026), up from USD 310k a year ago', 'Customers: 14 sites, 9 paying logos; net revenue retention 138%', 'Revenue growth: 15% month over month for the last 6 months', 'Gross margin: 61%'] },
    { title: 'Team', lines: ['Maya Chen, CEO: 7 years at Amazon Robotics, led the Sparrow picking program', 'Dr. Tomas Varga, CTO: PhD Carnegie Mellon (grasp planning)', 'Prior exit: Tomas co-founded Gripline (acquired by Zebra in 2021)', 'Team size: 23 (16 engineering)'] },
    { title: 'Market', lines: ['18,000 mid-size warehouses in the US and EU', 'Serviceable market: USD 7.4B in annual picking labor'] },
    { title: 'The round', lines: ['Raising USD 3,000,000 on a post-money SAFE', 'Valuation cap: USD 15,000,000 post-money', 'Lead: open; USD 750k committed from existing angels', 'Use of funds: 60% deployments, 30% engineering, 10% sales', 'Runway after the round: 26 months at a net burn of USD 115k a month'] },
  ]),
  'decks/lumen_health_preseed.pdf': pdf({ title: 'Lumen Health: Pre-seed', author: 'Raj Patel' }, [
    { title: 'Lumen Health', lines: ['AI triage for urgent care clinics', '', 'Pre-seed, 2026', 'Raj Patel, CEO  |  raj@lumenhealth.io'] },
    { title: 'What we do', lines: ['Patients describe symptoms by text before arrival.', 'Lumen ranks urgency and routes them to the right clinician.', 'Pilots: 3 clinics in Austin; 2,100 patients triaged.'] },
    { title: 'Business model', lines: ['SaaS, USD 900 per clinic per month', 'Revenue so far: USD 8,400 (pilot conversions)', 'Not yet live outside Texas'] },
    { title: 'The ask', lines: ['Raising USD 1,500,000 pre-seed', 'Instrument: SAFE, cap USD 9,000,000 post-money', 'Founders: Raj Patel (ex-Epic), Dana Wu (ER physician)'] },
  ]),
  'updates/northwind_analytics_q3_2026.pdf': pdf({ title: 'Northwind Analytics: Q3 2026 investor update', author: 'Ana Silva' }, [
    { title: 'Q3 2026 investor update', lines: ['Northwind Analytics  |  quarter ended 30 September 2026', 'Prepared by Ana Silva, CEO'] },
    { title: 'Numbers', lines: ['Revenue Q3 2026: USD 410,000 (Q2 2026: USD 352,000)', 'ARR at 30 September: USD 1,720,000', 'Net burn: USD 180,000 per month (average of the quarter)', 'Cash at 30 September: USD 2,900,000', 'Headcount: 22  |  Customers: 61', 'Gross margin: 74%'] },
    { title: 'Highlights and asks', lines: ['Signed Halden Retail (USD 140k ARR), our largest contract.', 'Ask 1: introductions to heads of data at mid-market retailers.', 'Ask 2: a VP Sales candidate with a PLG background.', 'Forecast (not a commitment): Q4 revenue USD 470,000.'] },
  ]),
};

for (const [rel, bytes] of Object.entries(files)) {
  const p = join(here, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, bytes);
  console.log(rel + ' ' + bytes.length + ' bytes');
}
