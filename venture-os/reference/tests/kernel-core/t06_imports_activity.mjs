// Imports (targets, synonyms, preview by dry run, batches, proposals for
// your AI agent) and activity (every write one undo unit; your AI agent's
// run undone as a unit; conflicts refuse the whole undo; atomic ops).
import { eq, fresh, member, newApi, ok, refuses, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
await member(api, 'analyst@venture.test', 'analyst', 'Ann Analyst');
const PA = { as: 'partner@venture.test' };
const AN = { as: 'analyst@venture.test' };

section('import targets and preview');
const tg = await api.op('imports.targets', {}, PA);
const zz = tg.targets.find((t) => t.target === 'zz_things');
ok(zz && zz.fields.find((f) => f.key === 'name').synonyms.indexOf('Thing') >= 0 && tg.max_rows_per_call === 200, 'targets with fields and synonyms', tg);
eq((await api.op('imports.targets', {}, AN)).targets.length, 0, 'a target needs its permission (network edit)');
const csv = 'Thing,Amount,Date,E-mail,Tags,Ignored\nAlpha,10,2026-11-01,A@X.COM,a;b,zz\nBeta,-5,01/11/2026,b@x.com,,zz\nGamma,7,45962,,c,zz\n,9,,,,zz\n';
const pv = await api.op('imports.preview', { target: 'zz_things', csv: csv }, PA);
eq(pv.mapping, { Thing: 'name', Amount: 'value', Date: 'day', 'E-mail': 'email', Tags: 'tags', Ignored: '' }, 'columns matched by synonyms; unknown ones left out');
eq(pv.unmapped, ['Ignored'], 'unmapped columns listed');
eq(pv.results.map((r) => r.action), ['created', 'error', 'created', 'error'], 'each row: what it would do (negative value and empty name refused)');
ok(/negative/.test(pv.results[1].message) && /Name is empty/.test(pv.results[3].message), 'reasons per row', pv.results);
eq(pv.sample[0].values, { name: 'Alpha', value: 10, day: '2026-11-01', email: 'a@x.com', tags: ['a', 'b'] }, 'values converted by type');
eq(pv.sample[2].values.day, '2025-11-01', 'an Excel serial day is read as a date');
eq((await api.op('zz.stats', {}, O)).things, 0, 'a preview changes nothing');
const pv2 = await api.op('imports.preview', { target: 'zz_things', rows: JSON.stringify([{ Name: 'Delta', Score: '3' }]) }, PA);
eq([pv2.mapping.Name, pv2.mapping.Score, pv2.results[0].action], ['name', 'value', 'created'], 'rows as objects (the page reads CSV and Excel itself)');
const pv3 = await api.op('imports.preview', { target: 'zz_things', csv: 'Foo\n1\n' }, PA);
eq(pv3.missing_required, ['name'], 'a required field without a column is named');

section('import run and undo');
const run = await api.op('imports.run', { target: 'zz_things', csv: csv, file_name: 'things.csv' }, PA);
eq([run.counts.created, run.counts.error, run.import.rows, run.import.created_n, run.import.error_n], [2, 2, 4, 2, 2], 'good rows imported; bad rows left out with reasons');
ok(run._activity, 'the batch is one undo unit');
const again = await api.op('imports.run', { target: 'zz_things', csv: 'Thing,Amount\nAlpha,10\nGamma,8\nEpsilon,1\n', import: run.import.id }, PA);
eq([again.counts.skipped, again.counts.updated, again.counts.created, again.import.batches, again.import.rows], [1, 1, 1, 2, 7], 'a second batch continues the same import (skipped, updated, created)');
await refuses(api, 'imports.run', { target: 'zz_things', csv: 'Thing\n' + Array.from({ length: 201 }, (_, i) => 'r' + i).join('\n') }, PA, 400, 'too_many', 'more than 200 rows per call is refused');
eq((await api.op('zz.stats', {}, O)).things, 3, 'three things now');
const un = await api.op('activity.undo', { entry: again._activity }, PA);
eq(un.undone, 1, 'the second batch undone as one unit');
eq((await api.op('zz.stats', {}, O)).things, 2, 'its new thing is gone (and Gamma restored)');
const list = await api.op('imports.list', {}, PA);
eq(list.imports[0].batches, 2, 'imports.list keeps the record');

section('your AI agent imports by proposal');
const ap = await api.op('imports.run', { target: 'zz_things', csv: 'Thing,Amount\nZeta,4\n', why: 'From the CSV the partner shared' }, A);
ok(ap.proposed === true, 'imports.run by your AI agent is a proposal', ap);
eq((await api.op('zz.stats', {}, O)).things, 2, 'nothing imported yet');
const acc = await api.op('proposals.accept', { proposal: ap.proposal }, PA);
eq(acc.applied, 1, 'accepted by the partner');
eq((await api.op('zz.stats', {}, O)).things, 3, 'imported');
eq((await api.op('imports.preview', { target: 'zz_things', csv: 'Thing\nEta\n' }, A)).results[0].action, 'created', 'your AI agent may preview');

section('undo one change');
const m1 = await api.op('zz.make', { name: 'Undo me', value: 1 }, PA);
ok(m1._activity, 'a write answers its undo unit (_activity)');
const u1 = await api.op('activity.undo', { entry: m1._activity }, PA);
eq(u1.undone, 1, 'undone');
await refuses(api, 'zz.get', { thing: m1.thing.id }, PA, 404, 'not_found', 'the thing is gone');
await refuses(api, 'activity.undo', { entry: m1._activity }, PA, 409, 'conflict', 'cannot undo twice');
const m2 = await api.op('zz.make', { name: 'Mine', value: 1 }, PA);
await refuses(api, 'activity.undo', { entry: m2._activity }, AN, 403, 'not_permitted', "someone else's change is theirs to undo");
await refuses(api, 'activity.undo', { entry: m2._activity }, A, 403, 'agent_not_permitted', 'your AI agent never undoes');
const e1 = await api.op('zz.save', { thing: m2.thing.id, value: 5 }, PA);
await refuses(api, 'activity.undo', { entry: m2._activity }, PA, 409, 'changed_since', 'refused when the record changed again later');
await api.op('activity.undo', { entry: e1._activity }, PA);
eq((await api.op('zz.get', { thing: m2.thing.id }, PA)).thing.value, 1, 'undoing the edit restores the value');
await api.op('activity.undo', { entry: m2._activity }, PA);
await refuses(api, 'zz.get', { thing: m2.thing.id }, PA, 404, 'not_found', 'then the creation can be undone');

section("undo your AI agent's run");
await api.op('zz.cool', {}, PA);
await api.op('zz.make', { name: 'Kappa', ask: true }, PA);
const w1 = await api.op('zz.make', { name: 'Agent one', value: 1 }, A);
const run1 = (await api.op('activity.list', { target: w1.thing.id }, O)).entries[0].run;
ok(/^run_/.test(run1 || ''), "a fired trigger: your AI agent's next write starts a new run", run1);
const w2 = await api.op('zz.make', { name: 'Agent two', value: 2 }, A);
const w3 = await api.op('tasks.save', { title: 'Follow up', assignee: 'partner@venture.test' }, A);
const w4 = await api.op('outbound.draft', { kind: 'reply', module: 'network', to: '["a@b.co"]', subject: 'Hi', body: 'Draft' }, A);
const runs = await api.op('activity.list', { view: 'runs' }, O);
const mine = runs.runs.find((r) => r.run === run1);
ok(mine && mine.entries === 4, 'the run groups its four writes', runs.runs);
const ents = await api.op('activity.list', { run: run1 }, O);
ok(ents.entries.every((e) => e.actor === 'agent' && e.who === 'Your AI agent'), 'entries carry your AI agent');
const aud = await api.op('audit.list', { run: run1 }, O);
ok(aud.total >= 4, 'the audit trail carries the run too', aud.total);
const ur = await api.op('activity.undo', { run: run1 }, PA);
eq(ur.undone, 4, 'the whole run undone as one unit');
await refuses(api, 'zz.get', { thing: w1.thing.id }, PA, 404, 'not_found', 'its things are gone');
eq((await api.op('tasks.list', { view: 'all' }, PA)).tasks.filter((t) => t.id === w3.task.id).length, 0, 'its task is gone');
eq((await api.call('outbound.get', { outbound: w4.id }, PA)).status, 404, 'its draft is gone');
await refuses(api, 'activity.undo', { run: run1 }, PA, 404, 'not_found', 'nothing left in the run');

section('a run with a later change is refused whole');
await api.op('zz.cool', {}, PA);
await api.op('zz.make', { name: 'Lambda', ask: true }, PA);
const x1 = await api.op('zz.make', { name: 'Agent three', value: 3 }, A);
const n2 = { run: (await api.op('activity.list', { target: x1.thing.id }, O)).entries[0].run };
ok(n2.run !== run1, 'the next fire starts another run', n2.run);
const x2 = await api.op('zz.make', { name: 'Agent four', value: 4 }, A);
await api.op('zz.save', { thing: x1.thing.id, value: 30 }, PA);
await refuses(api, 'activity.undo', { run: n2.run }, PA, 409, 'changed_since', 'a person changed one of its records later: refused');
eq((await api.op('zz.get', { thing: x2.thing.id }, PA)).thing.value, 4, 'nothing of the run was undone (all or nothing)');

section('an op is atomic');
await refuses(api, 'zz.half', { name: 'x' }, PA, 409, 'conflict', 'an op that refuses after a write');
const st = await api.op('search.query', { q: 'half x' }, PA);
eq(st.results.filter((r) => r.title === 'half x').length, 0, 'leaves nothing behind');
await api.op('zz.cool', {}, PA);
const mu = await api.op('zz.make', { name: 'Mu', ask: true }, PA);
await api.op('activity.undo', { entry: (await api.op('activity.list', { op: 'zz.make', limit: 1 }, PA)).entries[0].id }, PA);
ok(mu.request !== '', 'undoing a change that asked your AI agent: the fired request stays (it is not undone)', mu);

const s = summary('t06_imports_activity');
process.exitCode = s.failed > 0 ? 1 : 0;
