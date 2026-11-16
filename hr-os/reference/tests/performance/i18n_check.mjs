// Every performance copy key used in the pages exists (static t()/tn() keys and the dynamic families), no dashes or emoji.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const APP = process.env.HR_APP ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const F = join(APP, 'frontend', 'src', 'app');
const cat = readFileSync(join(F, 'i18n', 'performance.en.ts'), 'utf8');
const keys = new Set([...cat.matchAll(/'([a-z0-9_.]+)':/g)].map((m) => m[1]));
const kernel = new Set([...readFileSync(join(F, 'i18n', 'kernel.en.ts'), 'utf8').matchAll(/'([a-z0-9_.]+)':/g)].map((m) => m[1]));
const files = [];
for (const d of ['pages/performance', 'components/performance']) for (const f of readdirSync(join(F, d))) files.push(join(F, d, f));
let bad = 0;
const has = (k) => keys.has(k) || kernel.has(k) || keys.has(k + '.other');
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\btn?\('([a-z0-9_.]+)'/g)) if (!has(m[1])) { console.log('missing', m[1], 'in', f.split(/[\/]/).pop()); bad++; }
  if (/[\u2013\u2014]/.test(s)) { console.log('dash in', f); bad++; }
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) { console.log('emoji in', f); bad++; }
  if (/craftbot/i.test(s)) { console.log('platform name in', f); bad++; }
}
const fam = {
  'perf.goal.status': ['on_track', 'at_risk', 'off_track', 'done', 'dropped'],
  'perf.reason': ['at_risk', 'off_track', 'overdue', 'due_soon', 'stale'],
  'perf.phase': ['goals', 'self', 'peer', 'upward', 'manager', 'calibration', 'sharing'],
  'perf.wiz.phase_help': ['goals', 'self', 'peer', 'upward', 'manager', 'calibration', 'sharing'],
  'perf.kind': ['self', 'manager', 'peer', 'upward'],
  'perf.stage': ['open', 'submitted', 'shared', 'acknowledged', 'signoff', 'signed', 'removed'],
  'perf.cycle.kind': ['annual', 'half_year', 'quarterly', 'probation', 'project'],
  'perf.cycle.status': ['draft', 'active', 'closed'],
  'perf.review.status': ['draft', 'submitted', 'declined'],
  'perf.goal.scope': ['personal', 'team', 'company'],
  'perf.goal.kr': ['start', 'target', 'current', 'unit'].map((x) => '_' + x),
  'perf.goal.now': ['done', 'dropped', 'on_track'].map((x) => '_' + x),
  'perf.training.state': ['done', 'expiring', 'due', 'overdue'],
  'perf.fb.kind': ['praise', 'feedback', 'request'],
  'perf.fb.vis_tag': ['private', 'manager', 'public'],
  'perf.fb.req': ['open', 'answered', 'declined'],
  'perf.fb.empty': ['wall', 'received', 'given', 'requests', 'asked', 'about'],
  'perf.fb.empty_text': ['wall', 'received', 'given', 'requests', 'asked', 'about'],
  'perf.tr.kind': ['course', 'workshop', 'certification'],
  'perf.tr.status': ['planned', 'open', 'done', 'cancelled'],
  'perf.tr.att': ['invited', 'enrolled', 'attended', 'completed', 'no_show', 'cancelled'],
  'perf.tr.result': ['pass', 'fail'],
  'perf.set.sec': ['goals', 'competencies', 'questions'],
};
for (const [base, list] of Object.entries(fam)) for (const x of list) { const k = x.startsWith('_') ? base + x : base + '.' + x; if (!has(k)) { console.log('missing family key', k); bad++; } }
const catText = cat;
if (/[\u2013\u2014]/.test(catText) || /craftbot/i.test(catText)) { console.log('catalog has a dash or the platform name'); bad++; }
console.log(bad === 0 ? 'i18n ok: ' + keys.size + ' keys, ' + files.length + ' files' : bad + ' problem(s)');
process.exitCode = bad === 0 ? 0 : 1;
