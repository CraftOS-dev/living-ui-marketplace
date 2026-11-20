// QA t01: empty-database sweep. After setup.complete only (plus four members
// with no linked people): every read op as owner, hr_admin, payroll_admin,
// manager, employee, your AI agent and nobody, with no params and with dummy
// required params; then every write op with no params as owner, your AI agent
// and an employee. Flags: any 5xx, any error that is not clean JSON {code,
// message} with a 4xx, any answer over 1.5 s, any sealed or secret key, an
// anonymous 200 on a non-public op, an agent 2xx on a deny op.
//
//   QA_APP=<qa/app> QA_PORT=3191 node t01_empty_sweep.mjs [--keep]
import { newApi, catalog, timed, sealedIn, cleanError, section, ok, summary, writeResult, freshServer, makeMember, dummyParams, logSize, serverErrors, DEMO, O, AG } from './lib.mjs';

const api = newApi();
if (!process.argv.includes('--keep')) {
  const b = freshServer();
  console.log('fresh server in ' + b.ms + ' ms');
}
const st = await api.op('setup.status');
if (st.needs_setup) {
  await api.op('setup.complete', { company_name: 'QA Empty Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
  await makeMember(api, 'hr@qa.test', 'Hana HR', 'hr_admin');
  await makeMember(api, 'payroll@qa.test', 'Paul Payroll', 'payroll_admin');
  await makeMember(api, 'mgr@qa.test', 'Mia Manager', 'manager');
  await makeMember(api, 'emp@qa.test', 'Eli Employee', 'employee');
}

const WHO = [
  ['owner', O],
  ['hr_admin', { as: 'hr@qa.test' }],
  ['payroll_admin', { as: 'payroll@qa.test' }],
  ['manager', { as: 'mgr@qa.test' }],
  ['employee', { as: 'emp@qa.test' }],
  ['agent', AG],
  ['anon', { as: 'anon' }],
];

const ops = catalog();
const reads = ops.filter((o) => o.effect === 'read');
const writes = ops.filter((o) => o.effect !== 'read');
const rows = [];
const flags = [];
const log0 = logSize();

function judge(op, who, mode, r) {
  const row = { op: op.name, who, mode, status: r.status, ms: Math.round(r.ms), server: r.server, code: r.body && r.body.code };
  rows.push(row);
  const f = [];
  if (r.status === 0 || r.status >= 500) f.push('5xx');
  else if (r.status >= 400 && !cleanError(r)) f.push('unclean_error');
  if (r.ms > 1500) f.push('slow');
  const s = sealedIn(r.body);
  if (s.length > 0) f.push('sealed:' + s.slice(0, 3).join(','));
  if (who === 'anon' && op.perm !== 'public' && r.status < 400) f.push('anon_allowed');
  if (who === 'agent' && op.agent === 'deny' && r.status < 400) f.push('agent_ran_deny');
  if (who === 'agent' && op.agent === 'deny' && r.status === 403 && r.body && r.body.code !== 'agent_not_permitted') f.push('agent_deny_code');
  if (f.length > 0) flags.push(Object.assign({ flags: f, message: r.body && r.body.message }, row));
  return f;
}

section('Reads with no params (' + reads.length + ' ops x ' + WHO.length + ' callers)');
for (const op of reads) {
  for (const [who, o] of WHO) {
    const r = await timed(api, op.name, {}, o);
    judge(op, who, 'none', r);
  }
}
section('Reads with dummy required params (owner, employee, agent)');
for (const op of reads) {
  const p = dummyParams(op);
  if (Object.keys(p).length === 0) continue;
  for (const [who, o] of [WHO[0], WHO[4], WHO[5]]) {
    const r = await timed(api, op.name, p, o);
    judge(op, who, 'dummy', r);
  }
}

// Writes: session-ending ones last.
const LAST = ['auth.logout', 'auth.refresh', 'members.signout'];
const order = writes.filter((o) => !LAST.includes(o.name) && o.name !== 'setup.complete').concat(writes.filter((o) => LAST.includes(o.name)));
section('Writes with no params (' + order.length + ' ops x owner, employee, agent)');
const writeOutcomes = [];
for (const op of order) {
  for (const [who, o] of [WHO[5], WHO[4], WHO[0]]) {
    const r = await timed(api, op.name, {}, o);
    const f = judge(op, who, 'write-none', r);
    writeOutcomes.push({ op: op.name, who, status: r.status, code: r.body && r.body.code, required: Object.entries(op.params).filter(([, d]) => d.required).map(([k]) => k), flags: f });
  }
}

const errs = serverErrors(log0);
writeResult('t01_rows.json', rows);
writeResult('t01_flags.json', flags);
writeResult('t01_writes.json', writeOutcomes);
writeResult('t01_server_errors.txt', errs.lines.join('\n'));

section('Verdicts');
const by = (k) => flags.filter((x) => x.flags.some((f) => f.startsWith(k)));
ok(by('5xx').length === 0, 'no 5xx (' + by('5xx').length + ')', by('5xx').slice(0, 10).map((x) => x.op + ' ' + x.who + ' ' + x.mode));
ok(by('unclean').length === 0, 'every error is clean JSON (' + by('unclean').length + ')', by('unclean').slice(0, 10).map((x) => x.op + ' ' + x.who + ' ' + x.status));
ok(by('slow').length === 0, 'nothing over 1.5 s (' + by('slow').length + ')', by('slow').slice(0, 10).map((x) => x.op + ' ' + x.who + ' ' + x.ms));
ok(by('sealed').length === 0, 'no sealed keys (' + by('sealed').length + ')', by('sealed').slice(0, 10));
ok(by('anon_allowed').length === 0, 'nobody gets nothing (' + by('anon_allowed').length + ')', by('anon_allowed').slice(0, 10).map((x) => x.op));
ok(by('agent_ran').length === 0, 'your AI agent never runs a deny op (' + by('agent_ran').length + ')', by('agent_ran').slice(0, 10).map((x) => x.op));
// Writes with no params that did not answer 400: list them (a 2xx means the op had nothing required).
const not400 = writeOutcomes.filter((w) => w.who === 'owner' && w.status !== 400);
writeResult('t01_writes_not400.json', not400);
console.log('owner writes with no params not answering 400: ' + not400.length);
for (const w of not400) console.log('   ' + w.op + ' -> ' + w.status + ' ' + (w.code || '') + (w.required.length ? ' (required: ' + w.required.join(',') + ')' : ''));
const times = rows.filter((r) => r.status < 500).map((r) => r.ms).sort((a, b) => a - b);
console.log('calls ' + rows.length + ', p50 ' + times[Math.floor(times.length / 2)] + ' ms, p95 ' + times[Math.floor(times.length * 0.95)] + ' ms, max ' + times[times.length - 1] + ' ms');
console.log('server error lines: ' + errs.lines.length);
const s = summary('t01_empty_sweep');
process.exitCode = s.failed > 0 ? 1 : 0;
