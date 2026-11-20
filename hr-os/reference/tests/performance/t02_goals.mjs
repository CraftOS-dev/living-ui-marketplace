// Goals and OKRs on the demo company: ownership and team scope, key
// results and check-ins, alignment and roll-up, what needs an update,
// visibility, your AI agent's proposals and autonomy, CSV.
import { AGENT, emp, ENG, eq, fresh, HARUTO, HR, newApi, ok, OWNER, refuses, SALES, SAM, ANANYA, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const sam = await emp(api, 'sam@northwind.test');
const nurul = await emp(api, 'nurul@northwind.test');
const ananya = await emp(api, 'ananya@northwind.test');

section('own goal with key results');
const g = (await api.op('goals.create', { title: 'Ship the mobile app', due: '2026-12-31', weight: 60, key_results: [{ title: 'Beta users', target: 500, unit: 'count' }, { title: 'Crash-free sessions', start: 90, target: 99.5, current: 90, unit: '%' }] }, SAM)).goal;
eq([g.scope, g.kind, g.progress, g.key_results.length, g.employee.id], ['personal', 'okr', 0, 2, sam.employee], 'personal OKR, progress 0');
const c1 = await api.op('goals.checkin', { goal: g.id, key_results: { kr1: 250, kr2: 94.75 }, note: 'Beta open to staff' }, SAM);
eq(c1.goal.progress, 50, 'progress fills from key results (50% and 50%)');
eq(c1.checkin.key_results.length, 2, 'the check-in records both changes');
const c2 = await api.op('goals.checkin', { goal: g.id, key_results: '[{"key":"kr1","current":500}]' }, SAM);
eq(c2.goal.progress, 75, 'a list form of key result values works too');
await refuses(api, 'goals.checkin', { goal: g.id, key_results: { kr9: 1 } }, SAM, 400, 'invalid_param', 'unknown key result');
await refuses(api, 'goals.checkin', { goal: g.id }, SAM, 400, 'missing_param', 'an empty check-in is refused');
const got = (await api.op('goals.get', { goal: g.id }, SAM)).goal;
eq(got.checkins.length, 2, 'two check-ins in the history');
ok(got.last_checkin !== '', 'last check-in day kept');

section('who may add goals');
await refuses(api, 'goals.create', { title: 'For Nurul', employee: nurul.employee }, SAM, 403, 'not_permitted', 'an employee cannot add a goal for a colleague');
const mg = (await api.op('goals.create', { title: 'Mentor two juniors', employee: sam.employee }, ENG)).goal;
eq(mg.employee.id, sam.employee, 'a manager adds a goal for a direct report');
const ag = (await api.op('goals.create', { title: 'Learn the payments stack', employee: ananya.employee }, ENG)).goal;
eq(ag.employee.id, ananya.employee, 'and for an indirect report');
const n = await api.op('notifications.list', {}, SAM);
ok(n.notifications.some((x) => x.title.indexOf('Mentor two juniors') >= 0), 'the report is told about the new goal');
await refuses(api, 'goals.create', { title: 'Sales goal for Sam', employee: sam.employee }, SALES, 403, 'not_permitted', 'another team manager cannot');
const team = (await api.op('goals.create', { title: 'Engineering ships weekly', department: 'Engineering' }, ENG)).goal;
eq(team.scope, 'team', 'a manager adds a goal for their own department');
await refuses(api, 'goals.create', { title: 'Engineering from sales', department: 'Engineering' }, SALES, 403, 'not_permitted', 'not for another department');
const co = (await api.op('goals.create', { title: 'Grow ARR to 12m', company: true, key_results: [{ title: 'ARR', start: 8, target: 12, current: 9, unit: 'USD m' }] }, HR)).goal;
eq([co.scope, co.progress], ['company', 25], 'HR adds a company goal (25%)');
await refuses(api, 'goals.create', { title: 'My company goal', company: true }, SAM, 403, 'not_permitted', 'an employee cannot add company goals');

section('alignment and roll-up');
await api.op('goals.update', { goal: g.id, parent: team.id }, SAM);
await api.op('goals.update', { goal: mg.id, parent: team.id }, ENG);
let t = (await api.op('goals.get', { goal: team.id }, ENG)).goal;
eq([t.progress, t.children.length, t.progress_from], [38, 2, 'aligned'], 'a team goal without key results fills from aligned goals ((75+0)/2)');
await api.op('goals.checkin', { goal: mg.id, progress: 25, note: 'One mentee' }, ENG);
t = (await api.op('goals.get', { goal: team.id }, ENG)).goal;
eq(t.progress, 50, 'a check-in below rolls up');
await api.op('goals.update', { goal: team.id, parent: co.id }, ENG);
eq((await api.op('goals.get', { goal: co.id }, HR)).goal.progress, 25, 'a goal with key results keeps its own progress');
await refuses(api, 'goals.update', { goal: co.id, parent: g.id }, HR, 400, 'invalid_param', 'no cycles in the tree');
const tree = await api.op('goals.tree', {}, ENG);
ok(tree.roots.includes(co.id) && tree.nodes.find((x) => x.id === team.id).parent === co.id, 'the tree has company > team > personal');
eq((await api.op('goals.get', { goal: g.id }, SAM)).goal.chain.map((x) => x.id), [co.id, team.id], 'the chain above a goal');

section('visibility');
await refuses(api, 'goals.get', { goal: g.id }, SALES, 403, 'not_permitted', "another manager cannot open Sam's goal");
await refuses(api, 'goals.get', { goal: g.id }, HARUTO, 403, 'not_permitted', 'a colleague cannot');
const hl = await api.op('goals.list', {}, HARUTO);
ok(hl.goals.every((x) => x.scope !== 'personal' || x.employee.id !== sam.employee), "a colleague's list holds no personal goal of Sam");
ok(hl.goals.some((x) => x.id === team.id) && hl.goals.some((x) => x.id === co.id), 'team and company goals are visible to everyone');
const hr = await api.op('goals.list', { employee: sam.employee }, HR);
eq(hr.total, 2, 'HR sees Sam\'s two goals');
const tm = await api.op('goals.list', { view: 'team' }, ENG);
ok(tm.goals.some((x) => x.id === g.id) && tm.goals.some((x) => x.id === ag.id) && tm.goals.some((x) => x.id === team.id), 'a manager\'s team view holds reports\' and team goals');
await refuses(api, 'goals.list', { employee: sam.employee }, SALES, 403, 'not_permitted', 'filtering on someone you cannot see');
await refuses(api, 'goals.update', { goal: g.id, title: 'x' }, HARUTO, 403, 'not_permitted', 'a colleague cannot change it');

section('what needs an update');
const late = (await api.op('goals.create', { title: 'Old migration', start_day: '2026-01-05', due: '2026-10-01' }, SAM)).goal;
eq(late.reasons.includes('overdue'), true, 'overdue reason');
await api.op('goals.checkin', { goal: mg.id, status: 'off_track', note: 'Mentee left' }, SAM);
const mgv = (await api.op('goals.get', { goal: mg.id }, SAM)).goal;
ok(mgv.reasons.includes('off_track'), 'off track reason');
const mn = await api.op('notifications.list', {}, ENG);
ok(mn.notifications.some((x) => x.title.indexOf('off track') >= 0), 'the manager hears when a report\'s goal goes off track');
const need = await api.op('goals.list', { view: 'mine', needs_update: true }, SAM);
ok(need.goals.length === 2 && need.goals.every((x) => x.needs_update), 'mine needing an update: the overdue and the off track goal', need.goals.map((x) => [x.title, x.reasons]));
const home = await api.op('perf.home', {}, SAM);
eq(home.goals_total, 2, 'Home counts them');
const mhome = await api.op('perf.home', {}, ENG);
ok(mhome.team_goals_needing_update >= 2, 'manager Home counts the team');
await api.op('goals.update', { goal: late.id, status: 'done' }, SAM);
eq((await api.op('goals.get', { goal: late.id }, SAM)).goal.progress, 100, 'done without key results is 100%');

section('your AI agent');
const pr = await api.op('goals.create', { title: 'Write the API guide', employee: sam.employee, due: '2027-01-31', why: 'Sam mentioned it in the last one to one' }, AGENT);
ok(pr.proposed === true && typeof pr.proposal === 'string', 'goals.create from your AI agent becomes a proposal');
eq((await api.op('goals.list', { employee: sam.employee, q: 'API guide' }, HR)).total, 0, 'nothing changed yet');
const acc = await api.op('proposals.accept', { proposal: pr.proposal }, ENG).catch((e) => e);
ok(acc.status === 403, 'a manager without performance rights cannot accept a performance proposal', acc.body);
const acc2 = await api.op('proposals.accept', { proposal: pr.proposal }, HR);
eq(acc2.applied, 1, 'HR accepts it');
eq((await api.op('goals.list', { employee: sam.employee, q: 'API guide' }, HR)).total, 1, 'the goal exists');
const ck = await api.op('goals.checkin', { goal: g.id, progress: 90, note: 'from agent' }, AGENT);
ok(ck.proposed === true, 'a check-in from your AI agent is a proposal');
await refuses(api, 'goals.delete', { goal: g.id, confirm: true }, AGENT, 403, 'agent_not_permitted', 'your AI agent cannot delete goals');
await api.op('settings.autonomy', { autonomy: { performance: 'auto' } }, OWNER);
const auto = await api.op('goals.create', { title: 'Automatic agent goal', company: true }, AGENT);
eq([auto.goal && auto.goal.origin, auto.goal && auto.goal.scope], ['agent', 'company'], 'with performance on automatic the agent goal is made at once, marked as your AI agent\'s');
await api.op('settings.autonomy', { autonomy: { performance: 'ask' } }, OWNER);

section('delete');
await refuses(api, 'goals.delete', { goal: team.id }, SAM, 403, 'not_permitted', 'an employee cannot delete a team goal');
await api.op('goals.delete', { goal: team.id }, ENG);
eq((await api.op('goals.get', { goal: g.id }, SAM)).goal.parent.id, co.id, 'aligned goals move up to the deleted goal\'s parent');

section('CSV');
const csv = await api.op('goals.export', { view: 'team' }, ENG);
ok(csv.rows >= 3 && csv.csv.startsWith('employee,department,title'), 'export of the team goals', csv.rows);
await refuses(api, 'goals.export', {}, AGENT, 403, 'agent_not_permitted', 'your AI agent does not export');
const bad = await api.op('goals.import-check', { csv: 'employee,title,due,kr_title,kr_target\nE0005,Fix login,2026-13-01,,\nE9999,Nope,,,\n' }, HR);
eq([bad.ok, bad.problems.length], [false, 2], 'import-check reports a bad day and an unknown person');
const goodCsv = 'employee,title,kind,due,kr_title,kr_start,kr_target,kr_unit\nE0005,Reduce build time,okr,2026-12-31,Build minutes,20,8,min\nE0005,Reduce build time,okr,2026-12-31,Flaky tests,30,0,count\n,Company NPS 50,goal,2027-03-31,,,,\n';
const good = await api.op('goals.import-check', { csv: goodCsv }, HR);
eq([good.ok, good.goals], [true, 2], 'two goals from three rows');
await refuses(api, 'goals.import-check', { csv: goodCsv }, SAM, 403, 'not_permitted', 'an employee cannot import');
const imp = await api.op('goals.import', { csv: goodCsv }, HR);
eq(imp.imported, 2, 'imported');
const bt = (await api.op('goals.list', { employee: sam.employee, q: 'build time' }, HR)).goals[0];
eq([bt.key_results.length, bt.progress], [2, 0], 'merged key results, falling targets start at 0%');
await api.op('goals.checkin', { goal: bt.id, key_results: { kr1: 14, kr2: 15 } }, SAM);
eq((await api.op('goals.get', { goal: bt.id }, SAM)).goal.progress, 50, 'a key result going down to its target counts up');

const s = summary('t02_goals');
process.exitCode = s.failed > 0 ? 1 : 0;
