// QA2 probe: payroll-out filings of voided runs, au_super due days, October rows,
// the salary certificate's money format and signer, SG self-help group profile.
import { newApi } from './lib.mjs';
const api = newApi();
const O = { as: 'owner' };
const PAY = { as: 'payroll@northwind.test' };
const runs = (await api.op('payruns.list', { status: 'all', limit: 200 }, PAY)).payruns;
const voided = runs.filter((r) => r.status === 'void').map((r) => r.number);
console.log('void runs', voided.join(' '));
const ents = (await api.op('entities.list', {}, O)).entities;
for (const e of ents) {
  const fl = await api.op('filings.list', { entity: e.id, show: 'all', year: 2026, limit: 300 }, PAY);
  const rows = fl.filings || [];
  const onVoid = rows.filter((f) => voided.some((v) => JSON.stringify(f).includes('"' + v + '"') || (f.period || '').includes(v)));
  const sup = rows.filter((f) => f.kind === 'au_super');
  const counts = {};
  for (const f of rows) counts[f.status] = (counts[f.status] || 0) + 1;
  console.log(e.country, e.name, 'rows', rows.length, JSON.stringify(counts), '| on void runs:', onVoid.map((f) => f.kind + ' ' + f.period + ' ' + f.status).join('; '));
  if (sup.length) console.log('   au_super', sup.map((f) => f.period + ' due ' + f.due_day + ' ' + f.status).join('; '));
  const oct = rows.filter((f) => (f.period || '').startsWith('2026-10'));
  if (oct.length) console.log('   october', oct.map((f) => f.kind + ' ' + f.status + ' due ' + f.due_day).join('; '));
}
const tpl = await api.op('letter-templates.list', {}, O);
const sal = (tpl.templates || []).find((t) => /salary/i.test(t.name || t.title || ''));
const d = await api.call('letters.draft', { template: sal.id, employee: 'E0020', why: 'QA2' }, O);
const L = d.body.letter || d.body;
const g = await api.call('letters.get', { letter: L.id }, O);
const text = JSON.stringify(g.body);
const money = text.match(/INR[^"\\]{0,40}|4[,.]?50[,.]?000[^"\\]{0,20}/g);
console.log('letter', d.status, g.status, 'money text', JSON.stringify(money && money.slice(0, 4)), '| signer placeholders', /\[Signed by\]|\[Title of the signer\]/.test(text), '| keys', Object.keys(g.body.letter || g.body).join(','));
const sig = text.match(/[Ss]igne[dr][^"\\]{0,60}/g);
console.log('signer text', JSON.stringify(sig && sig.slice(0, 4)));
const tp = await api.op('taxprofile.get', { employment: 'E0008' }, O);
console.log('E0008 tax profile', JSON.stringify(tp).slice(0, 300));
