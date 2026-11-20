// Seeded company (run seed_reports.mjs first): Home for each role, every report's numbers against the
// seed, diversity suppression, pay visibility (roles and the company switch for your AI agent), entity
// scope, CSV export, one-tap actions from Home, and what employees and managers are refused.
import { AGENT, DEMO, emp, ENG, HR, newApi, ok, OWNER, PAYROLL, PIN, READS, refuses, SAM, section, summary } from './lib.mjs';

const api = newApi();

section('every read as every role and your AI agent (no 5xx)');
for (const who of [OWNER, HR, PAYROLL, ENG, SAM, AGENT]) {
  for (const [name, params] of READS.concat([['home.directory', {}]])) {
    const r = await api.call(name, params, who);
    ok(r.status < 500, `${who.as} ${name} ${JSON.stringify(params)} -> ${r.status}`, r.status >= 500 ? r.body : undefined);
  }
}

section('admin home');
const h = await api.op('home.admin', {}, OWNER);
const dir = await api.op('people.directory', { status: 'current', limit: 500 }, OWNER);
const current = new Set(dir.people.map((p) => p.employee)).size;
ok(h.readouts.headcount === current, `headcount ${h.readouts.headcount} equals the directory's current people ${current}`);
ok(h.series.length === 12 && h.series[11].headcount === h.readouts.headcount, 'twelve months ending with today');
ok(h.pay_visible === true && h.series.some((s) => (s.gross_minor ?? 0) > 0), 'payroll cost in the series (a locked run)');
ok(h.readouts.cost_month_minor !== null && h.readouts.cost_month_minor > 0, 'cost of the last paid month');
ok(Array.isArray(h.readouts.cost_month_parts) && h.readouts.cost_month_parts.length > 0 && h.readouts.cost_month_parts.every((x) => x.minor > 0) && h.cost_currency === h.company.reporting_currency, 'the last paid month in each pay currency; the series in the reporting currency', h.readouts.cost_month_parts);
{
  // No rate to the reporting currency at all (a new company before its first rates): the cost is shown in
  // its own pay currency, never as a zero.
  const set = await api.call('settings.update', { reporting_currency: 'CHF' }, OWNER);
  ok(set.status === 200, 'reporting currency set to one without rates', set.body);
  const hc = await api.op('home.admin', {}, OWNER);
  ok(hc.readouts.cost_month_parts.length > 0 && hc.readouts.cost_month_parts.every((x) => x.minor > 0 && x.currency !== 'CHF'), 'without a CHF rate the last paid month is still told in its pay currencies', hc.readouts.cost_month_parts);
  if (hc.cost_currency !== 'CHF') {
    // Every payslip in one currency: the series and the tile stay in it.
    ok(hc.readouts.cost_month_minor === hc.readouts.cost_month_parts[0].minor && hc.series.some((x) => (x.gross_minor ?? 0) > 0), `one pay currency: the cost and the chart stay in ${hc.cost_currency}`, [hc.cost_currency, hc.readouts]);
  } else {
    // Several pay currencies: no total in CHF, each currency's own, and the chart lists what it leaves out.
    ok(hc.readouts.cost_month_minor === null && hc.readouts.cost_month_unconverted.length > 0 && hc.cost_missing_fx.length > 0, 'several pay currencies: no CHF total, each currency on its own, the left-out ones listed', hc.readouts);
  }
  await api.call('settings.update', { reporting_currency: h.company.reporting_currency }, OWNER);
}
const keys = h.attention.map((g) => g.key);
ok(keys.includes('approvals'), 'approvals wait for the owner', keys);
ok(keys.includes('blockers'), 'pay runs with blockers show', keys);
ok(h.attention.every((g) => g.items.length <= 6 && g.count >= g.items.length), 'groups carry at most six items and a count');
ok(h.agent.jobs.length > 0, 'your AI agent work is listed');
const hHr = await api.op('home.admin', {}, HR);
ok(hHr.pay_visible === true, 'HR (payroll view) sees cost');
await refuses(api, 'home.admin', {}, SAM, 403, undefined, 'an employee has no admin home');
await refuses(api, 'home.admin', {}, ENG, 403, undefined, 'a manager has no admin home');

section('one tap from Home');
const start = h.attention.find((g) => g.key === 'starting');
if (start !== undefined && start.items[0] && start.items[0].action) {
  const a = start.items[0].action;
  ok(a.op === 'checklists.start' && a.params.kind === 'onboarding', 'a starter offers Start onboarding', a);
  const r = await api.call(a.op, a.params, OWNER);
  ok(r.status === 200, 'the action runs as given', r.body);
  const h2 = await api.op('home.admin', {}, OWNER);
  const s2 = h2.attention.find((g) => g.key === 'starting');
  ok(s2 === undefined || !s2.items.some((x) => x.id === start.items[0].id), 'the starter leaves the group once the checklist exists');
} else ok(true, 'no starter without a checklist in this seed');
const ap = h.attention.find((g) => g.key === 'approvals');
if (ap !== undefined) {
  const first = ap.items.find((x) => !x.needs_pin);
  if (first) {
    const r = await api.call('approvals.decide', { approval: first.id, decision: 'approved' }, OWNER);
    ok(r.status === 200, 'approve from Home with one tap', r.body);
    const h3 = await api.op('home.admin', {}, OWNER);
    const g3 = h3.attention.find((g) => g.key === 'approvals');
    ok(g3 === undefined || g3.count === ap.count - 1 || !g3.items.some((x) => x.id === first.id), 'the approval leaves Needs you');
  }
}

section('manager and employee homes');
const m = await api.op('home.manager', {}, ENG);
const sam = await emp(api, 'sam@northwind.test');
ok(m.manager && m.people.some((p) => p.employee === sam.employee), 'Mei Lin sees Sam in her team', m.people.length);
ok(m.direct > 0 && m.team >= m.direct, 'direct and all reports');
const me = await api.op('home.me', {}, SAM);
ok(me.employee.number === sam.number && me.employments[0].manager !== null, 'Sam sees himself and his manager');
ok(me.answers.some((a) => a.answer !== ''), 'his answered question to your AI agent');
ok(me.clock !== null && ['in', 'out', 'break'].includes(me.clock.state), 'his clock comes with his Home', me.clock);
ok(me.clock !== null && Array.isArray(me.clock.next) && me.clock.next.length > 0 && typeof me.clock.employment?.id === 'string', 'the clock carries the next punch, so the card punches without a read of its own', me.clock);
ok(Array.isArray(me.requests) && me.requests_total >= me.requests.length, 'his latest requests come with his Home');
ok(me.facts.length === 0 && me.hub === null, 'the Home read carries no Me place counts');
const mp = await api.op('home.me', { places: true }, SAM);
ok(mp.facts.length > 0 && mp.hub !== null && typeof mp.hub.tasks_open === 'number' && typeof mp.hub.kiosk_pin === 'boolean', 'the Me page read adds the module facts and the place counts', mp.hub);
const facts = mp.facts.flatMap((f) => f.facts);
ok(facts.filter((f) => f.kind === 'money').every((f) => typeof f.value === 'number' && typeof f.currency === 'string'), 'money facts are typed (minor units and a currency), so the page formats them');
const ha = await api.op('home.admin', {}, OWNER);
ok(ha.pay !== null && Array.isArray(ha.pay.schedules) && ha.pay.schedules.length > 0, 'the admin Home read carries the pay runs of every schedule');
ok(ha.setup !== undefined && Array.isArray(ha.setup.steps), 'and the setup steps');
const hm = await api.op('home.manager', {}, ENG);
ok(hm.board !== null && Array.isArray(hm.board.people) && hm.clock !== null, 'the manager Home read carries the team board and her clock');
const d = await api.op('home.directory', {}, SAM);
ok(d.total >= 20, 'the directory lists the company for an employee', d.total);
const leak = d.people.some((p) => 'phone' in p || 'birth_date' in p || 'gender' in p || 'personal_email' in p);
ok(!leak, 'the directory carries work details only');
const dq = await api.op('home.directory', { q: 'engineer' }, SAM);
ok(dq.people.length > 0 && dq.people.every((p) => (p.name + p.title + p.department_name + p.location_name + p.work_email).toLowerCase().includes('engineer')), 'directory search');

section('reports: headcount and movement');
const hc = await api.op('reports.headcount', {}, OWNER);
ok(hc.readouts.now === h.readouts.headcount, 'headcount report agrees with Home');
ok(hc.readouts.joined === 5 && hc.readouts.left === 4, `five joined and four left this year (${hc.readouts.joined}, ${hc.readouts.left})`);
const hcd = await api.op('reports.headcount', { group_by: 'department' }, OWNER);
ok(hcd.series.length >= 4, 'by department');
const kk = await api.op('reports.headcount', { entity: 'Northwind KK' }, OWNER);
const kkDir = dir.people.filter((p) => p.entity_name === 'Northwind KK').length;
ok(kk.readouts.now === kkDir, `entity filter by name (${kk.readouts.now} = ${kkDir})`);
const eng = await api.op('reports.headcount', { department: 'Engineering' }, OWNER);
ok(eng.readouts.now > 0 && eng.readouts.now < hc.readouts.now, 'department filter');
const mv = await api.op('reports.movement', {}, OWNER);
ok(mv.readouts.left === 4 && mv.kinds.voluntary === 2 && mv.kinds.involuntary === 1 && mv.kinds.not_recorded === 1, 'leavers by separation kind (2 voluntary, 1 involuntary, 1 not recorded)', mv.kinds);
ok(mv.readouts.turnover_pct > 0 && mv.reasons.length === 3, 'turnover and reasons');
ok(mv.table.rows.length === 9, 'nine movements in the table');

section('reports: tenure, span, diversity');
const tn = await api.op('reports.tenure', {}, OWNER);
ok(tn.readouts.people === h.readouts.headcount || tn.readouts.people >= h.readouts.headcount, 'tenure covers everyone');
ok(tn.bands.reduce((a, b) => a + b.count, 0) === tn.readouts.people, 'bands add up');
const sp = await api.op('reports.span', {}, OWNER);
const meiRow = sp.table.rows.find((r) => r.name === 'Mei Lin Chua');
ok(meiRow !== undefined && meiRow.direct === m.direct, `Mei Lin's direct reports agree with her Home (${meiRow && meiRow.direct}, ${m.direct})`);
for (const dim of ['gender', 'age', 'nationality']) {
  const dv = await api.op('reports.diversity', { dimension: dim }, OWNER);
  ok(dv.groups.every((g) => g.count === null || g.count >= 5), dim + ': no group under 5 shown');
  ok(dv.groups.filter((g) => g.hidden).length !== 1, dim + ': never exactly one hidden group');
  const shown = dv.groups.filter((g) => g.count !== null).reduce((a, g) => a + g.count, 0);
  ok(dv.total === null || shown <= dv.total, dim + ': shown counts within the total');
}
const small = await api.op('reports.diversity', { department: 'People and Finance' }, OWNER);
ok(small.total === null && small.groups.every((g) => g.count === null), 'a team under 5 shows nothing but "fewer than 5"');
const csv = await api.op('reports.export', { report: 'diversity', department: 'People and Finance' }, OWNER);
ok(csv.csv.includes('fewer than 5') && !/,[1-4],/.test(csv.csv), 'the CSV hides small groups too');

section('reports: pay');
const cost = await api.op('reports.cost', {}, OWNER);
ok(cost.readouts.total_cost_minor > 0 && cost.currency === 'USD', 'payroll cost in the reporting currency');
ok(cost.readouts.total_cost_minor === cost.readouts.total_gross_minor + cost.readouts.total_employer_minor, 'cost is gross plus employer costs');
const costSgd = await api.op('reports.cost', { currency: 'SGD' }, OWNER);
ok(costSgd.currency === 'SGD' && costSgd.readouts.total_cost_minor > cost.readouts.total_cost_minor, 'converted to SGD at the rate', [cost.readouts.total_cost_minor, costSgd.readouts.total_cost_minor]);
const cb = await api.op('reports.comp-bands', {}, OWNER);
ok(cb.readouts.graded === 16 && cb.readouts.below === 1 && cb.readouts.above === 1, 'sixteen graded, one below and one above', cb.readouts);
await refuses(api, 'reports.cost', {}, ENG, 403, undefined, 'a manager cannot see payroll cost');
await refuses(api, 'reports.comp-bands', {}, SAM, 403, undefined, 'an employee cannot see grade pay');
const ll = await api.op('reports.leave-liability', {}, OWNER);
ok(ll.money && ll.readouts.days > 0 && ll.readouts.value_minor > 0, 'leave liability in days and money');
const llPaid = await api.op('reports.leave-liability', { basis: 'paid' }, OWNER);
ok(llPaid.readouts.days >= ll.readouts.days, 'every paid type owes at least the cash-in types');

section('your AI agent and the pay switch');
const agentCost = await api.op('reports.cost', {}, AGENT);
ok(agentCost.readouts.total_cost_minor === cost.readouts.total_cost_minor, 'your AI agent reads cost while the company allows');
await api.op('settings.update', { agent_sees_pay: false }, OWNER);
await refuses(api, 'reports.cost', {}, AGENT, 403, 'pay_hidden', 'pay hidden from your AI agent: cost refused');
await refuses(api, 'reports.comp-bands', {}, AGENT, 403, 'pay_hidden', 'pay hidden: grade pay refused');
const ah = await api.op('home.admin', {}, AGENT);
ok(ah.pay_visible === false && ah.series.every((s) => s.gross_minor === null), 'Home carries no money for your AI agent');
const al = await api.op('reports.leave-liability', {}, AGENT);
ok(al.money === false && al.readouts.value_minor === null && al.table.rows.every((r) => r.value_minor === undefined), 'leave liability in days only');
await api.op('settings.update', { agent_sees_pay: true }, OWNER);
await refuses(api, 'reports.export', { report: 'cost' }, AGENT, 403, undefined, 'your AI agent never exports CSV');

section('entity scope');
const sg = (await api.op('entities.list', {}, OWNER)).entities.find((e) => e.name === 'Northwind Pte Ltd');
const inv = await api.call('members.invite', { email: 'sg.hr@northwind.test', name: 'SG HR', role: 'hr_admin', entities: JSON.stringify([sg.id]) }, PIN);
if (inv.status === 200) await api.op('auth.accept-invite', { email: 'sg.hr@northwind.test', code: inv.body.code, password: DEMO.password });
const SGHR = { as: 'sg.hr@northwind.test' };
const sgh = await api.op('reports.headcount', {}, SGHR);
const sgDir = dir.people.filter((p) => p.entity_name === 'Northwind Pte Ltd').length;
ok(sgh.readouts.now === sgDir, `an HR member limited to Singapore counts Singapore only (${sgh.readouts.now} = ${sgDir})`);
await refuses(api, 'reports.headcount', { entity: 'Northwind KK' }, SGHR, 403, 'not_permitted', 'and cannot pick another entity');
const sgHome = await api.op('home.admin', {}, SGHR);
ok(sgHome.readouts.headcount === sgDir, 'their Home counts Singapore only');

section('time, hiring and training');
const ab = await api.op('reports.absence', {}, OWNER);
ok(ab.readouts.scheduled_days > 0 && ab.months.length === 3, 'absence: three months of scheduled days');
ok(ab.readouts.absent_days === ab.table.rows.reduce((a, r) => a + r.absent_days, 0), 'absent days add up per person');
// A fresh count is kept and served as it is. (The running month may lag a fresh count by up to 20 minutes
// while nothing it reads changes: a person becomes absent as the day goes on; so compare kept with just counted.)
const abFresh = await api.op('reports.absence', { fresh: true }, OWNER);
const abKept = await api.op('reports.absence', {}, OWNER);
ok(abFresh.counted_at >= ab.counted_at && JSON.stringify(abKept.readouts) === JSON.stringify(abFresh.readouts) && abKept.counted_at === abFresh.counted_at, 'the kept figures equal the count just made', [abFresh.readouts, abKept.readouts]);
{
  // A change in a closed month is seen at once (the month's fingerprint changes).
  const today = (await api.op('auth.me', {}, OWNER)).today;
  const prev = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  let day = prev + '-03';
  for (let i = 3; i < 28; i++) {
    const d = prev + '-' + String(i).padStart(2, '0');
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) {
      day = d;
      break;
    }
  }
  // Someone whose last month was not paid in a locked run (a locked day is not edited by hand).
  let mark = null;
  for (const x of dir.people.slice(0, 30)) {
    mark = await api.call('attendance.mark', { employment: x.employment, day, status: 'absent', note: 'cache check' }, HR);
    if (mark.status !== 409) break;
  }
  ok(mark !== null && mark.status === 200, 'mark an absence last month', mark && mark.body);
  const ab2 = await api.op('reports.absence', {}, OWNER);
  const fresh2 = await api.op('reports.absence', { fresh: true }, OWNER);
  ok(ab2.readouts.absent_days === ab.readouts.absent_days + 1 && JSON.stringify(ab2.readouts) === JSON.stringify(fresh2.readouts), 'the report counts the new absence without a fresh count', [ab.readouts.absent_days, ab2.readouts.absent_days, fresh2.readouts.absent_days]);
}
const llFresh = await api.op('reports.leave-liability', { basis: 'paid', fresh: true }, OWNER);
ok(JSON.stringify(llFresh.readouts) === JSON.stringify(llPaid.readouts), 'kept balances equal a fresh count', [llPaid.readouts, llFresh.readouts]);
const hi = await api.op('reports.hiring', {}, OWNER);
ok(hi.readouts.applications > 0 && hi.funnel.every((s, i) => i === 0 || s.count <= hi.funnel[i - 1].count), 'the funnel never widens');
const tr = await api.op('reports.training', {}, OWNER);
ok(tr.readouts.completed <= tr.readouts.places, 'training completion within the places');

section('CSV export of every report');
for (const rep of ['headcount', 'movement', 'tenure', 'span', 'diversity', 'comp-bands', 'cost', 'leave-liability', 'absence', 'hiring', 'training']) {
  const r = await api.call('reports.export', { report: rep }, OWNER);
  const lines = r.status === 200 ? r.body.csv.trim().split(/\r?\n/) : [];
  ok(r.status === 200 && lines.length === r.body.rows + 1, `${rep}: header and ${r.body && r.body.rows} rows`, r.status !== 200 ? r.body : undefined);
}
await refuses(api, 'reports.export', { report: 'headcount' }, SAM, 403, undefined, 'an employee cannot export');
const audit = await api.op('audit.list', { op: 'reports.export', limit: 5 }, OWNER);
ok((audit.entries || audit.audit || audit.rows || []).length > 0, 'exports are in the audit trail');

const s = summary('t02_seeded');
process.exit(s.failed === 0 ? 0 : 1);
