// classify after the speed work answers exactly as before, on random weeks
// of work under random rule sets (every rule kind, every week start).
//   node t04_classify_same.mjs <old lib_time_rules.js>
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { APP, ok, section, summary } from './lib.mjs';
const require = createRequire(import.meta.url);
const NEW = require(join(APP, 'pb', 'pb_hooks', 'lib_time_rules.js'));
const OLD = require(process.argv[2]);
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const KINDS = ['work', 'work', 'work', 'rest', 'holiday'];
function randomRules() {
  const r = [];
  if (rnd() < 0.7) r.push({ when: 'daily_over', threshold_min: pick([420, 480, 540, 600]), multiplier: 1.5, component: 'OT150' });
  if (rnd() < 0.3) r.push({ when: 'daily_over', threshold_min: 720, multiplier: 2, component: 'OT200' });
  if (rnd() < 0.6) r.push({ when: 'weekly_over', threshold_min: pick([2400, 2640, 2880]), multiplier: 1.5, component: 'OT150' });
  if (rnd() < 0.3) r.push({ when: 'monthly_over', threshold_min: pick([1200, 3600]), multiplier: 1.75, component: 'OT175' });
  if (rnd() < 0.4) r.push({ when: 'seventh_day', threshold_min: 0, multiplier: 1.5, component: 'OT150' }, { when: 'seventh_day', threshold_min: 480, multiplier: 2, component: 'OT200' });
  if (rnd() < 0.6) r.push({ when: 'rest_day', threshold_min: 0, multiplier: 1.35, component: 'RD135', dow: rnd() < 0.5 ? [0] : undefined });
  if (rnd() < 0.3) r.push({ when: 'rest_day', threshold_min: 480, multiplier: 2, component: 'RD200', dow: [6] });
  if (rnd() < 0.6) r.push({ when: 'holiday', threshold_min: 0, multiplier: 2, component: 'PH200' });
  if (rnd() < 0.5) r.push({ when: 'night', from: '22:00', to: '05:00', multiplier: 0.25, component: 'NIGHT25' });
  return r.map((x) => {
    const y = Object.assign({}, x);
    if (y.dow === undefined) delete y.dow;
    return y;
  });
}
section('classify: old and new answer the same');
let same = 0;
let runs = 0;
for (let i = 0; i < 3000; i++) {
  const rules = randomRules();
  const start = NEW.dayAdd('2024-12-20', Math.floor(rnd() * 800));
  const n = 1 + Math.floor(rnd() * 70);
  const days = [];
  let d = start;
  for (let k = 0; k < n; k++) {
    if (rnd() < 0.15) d = NEW.dayAdd(d, 1 + Math.floor(rnd() * 3));
    const worked = rnd() < 0.2 ? 0 : Math.floor(rnd() * 800);
    days.push({ day: d, kind: pick(KINDS), worked: worked, night: rnd() < 0.3 ? Math.floor(rnd() * 300) : 0, leave: rnd() < 0.1 ? 240 : 0 });
    d = NEW.dayAdd(d, 1);
  }
  const opts = { week_start: pick([0, 1, 6, undefined, null]), counts_leave: rnd() < 0.5 };
  const a = JSON.stringify(OLD.classify(JSON.parse(JSON.stringify(days)), JSON.parse(JSON.stringify(rules)), opts));
  const b = JSON.stringify(NEW.classify(JSON.parse(JSON.stringify(days)), JSON.parse(JSON.stringify(rules)), opts));
  runs++;
  if (a === b) same++;
  else if (runs - same <= 3) console.log('DIFF', JSON.stringify({ days, rules, opts }).slice(0, 800), '\n old', a.slice(0, 600), '\n new', b.slice(0, 600));
}
ok(same === runs, 'all ' + runs + ' random cases classify the same (' + same + ' same)');
summary('t04_classify_same');
