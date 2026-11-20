// Sanity check: the electronic computation rule (甲, monthly) stays within 100 yen
// of the official 月額表 甲欄 at the middle of every table row, for 0 to 7 dependants.
// node crosscheck_jp.mjs  (exits 1 when a difference exceeds 100 yen)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = [path.join(here, '..', 'pb_hooks'), path.join(here, '..', '..', '..', 'pb', 'pb_hooks')].find((d) => fs.existsSync(path.join(d, 'packs', 'jp.js')));
const ENGINE = [path.join(HOOKS, 'lib_engine.js'), path.join(here, '..', '..', 'engine', 'pb_hooks', 'lib_engine.js')].find((f) => fs.existsSync(f));
const eng = require(ENGINE);
let bad = 0;
for (const file of ['jp.js', 'jp-2027.js']) {
  const pack = require(path.join(HOOKS, 'packs', file));
  const y = pack.version.slice(0, 4);
  let worst = 0, at = null, n = 0;
  for (const row of pack.tables.jp_monthly.rows) {
    for (let d = 0; d <= 7; d++) {
      const a = Math.floor((row.from + row.under) / 2);
      const out = eng.preview(pack, { run: { period_start: y + '-01-01', period_end: y + '-01-31', pay_date: y + '-01-25' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_dependants: d, jp_prefecture: '13', jp_smr: 300000, jp_health_insured: false, jp_pension_insured: false, jp_ei_insured: false }, entity: {}, lines: [{ code: 'B', kind: 'earning', amount: a, tags: ['jp_taxable'] }] }, []);
      const wht = (out.lines.find((l) => l.code === 'JP_WHT') || { amount: 0 }).amount;
      const diff = Math.abs(wht - row.values['k' + d]);
      n++;
      if (diff > worst) { worst = diff; at = { a, d, wht, table: row.values['k' + d] }; }
    }
  }
  if (worst > 100) bad++;
  console.log(file, 'rows x dependants', n, 'largest |electronic - table|', worst, JSON.stringify(at));
}
process.exit(bad ? 1 : 0);
