// Renders the funds documents (a call notice, a distribution notice, an LP pack) to PNG with pdf.js in
// headless Chromium, to review their layout. Run after seed_ui.mjs.
//   node pdf_shot.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, newApi, fileBytes } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots', 'docs');
mkdirSync(OUT, { recursive: true });
const PDFJS = join(APP, 'frontend', 'node_modules', 'pdfjs-dist', 'build');

const api = newApi();
const FIN = { as: 'finance@venture.test' };
const ev = (await api.op('calls.list', { fund: 'Fund I', status: 'all' }, FIN)).events;
const call = ev.find((e) => e.kind === 'call' && e.status !== 'previewed' && e.status !== 'draft');
const dist = ev.find((e) => e.kind === 'distribution' && e.status === 'issued');
const docs = {};
const getBin = async (name, params) => (await fileBytes(api, name, params, 'finance@venture.test')).bytes;
const c = (await api.op('calls.get', { event: call.id }, FIN)).event;
docs.call = await getBin('calls.notice', { line: (c.lines.find((l) => l.lp_name.startsWith('山田')) || c.lines[0]).id });
const d = (await api.op('calls.get', { event: dist.id }, FIN)).event;
docs.dist = await getBin('calls.notice', { line: d.lines[0].id });
const qs = (await api.op('quarters.list', { fund: 'Fund I' }, FIN)).quarters.find((q) => q.status === 'sent' || q.status === 'final');
const qg = await api.op('quarters.get', { quarter: qs.id }, FIN);
docs.pack = await getBin('reports.pack', { report: (qg.packs.find((x) => x.lp_name.startsWith('山田')) || qg.packs[0]).id });

const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/pdfjs/')) {
    res.setHeader('content-type', 'text/javascript');
    return res.end(readFileSync(join(PDFJS, u.pathname.slice(7))));
  }
  if (u.pathname.startsWith('/doc/')) {
    res.setHeader('content-type', 'application/pdf');
    return res.end(Buffer.from(docs[u.pathname.slice(5)]));
  }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><body style="margin:0;background:#888"><div id=out></div><script type=module>
import * as pdfjs from '/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
const name = new URLSearchParams(location.search).get('d');
const pdf = await pdfjs.getDocument({ url: '/doc/' + name }).promise;
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const vp = page.getViewport({ scale: 1.4 });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.display='block'; c.style.margin='8px';
  document.getElementById('out').appendChild(c);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
}
window.done = pdf.numPages;
</script>`);
});
await new Promise((r) => srv.listen(3297, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 860, height: 1200 } });
page.on('console', (m) => console.log('console:', m.type(), m.text())); page.on('pageerror', (e) => console.log('pageerror', e.message)); page.on('requestfailed', (r) => console.log('failed', r.url()));
for (const k of Object.keys(docs)) {
  await page.goto('http://127.0.0.1:3297/?d=' + k);
  await page.waitForFunction(() => window.done > 0, null, { timeout: 20000 });
  await page.screenshot({ path: join(OUT, k + '.png'), fullPage: true });
  console.log(k, 'pages', await page.evaluate(() => window.done));
}
await browser.close();
srv.close();
