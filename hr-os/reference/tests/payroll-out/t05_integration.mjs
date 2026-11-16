// Integration with payroll-core's real pay runs (their files in the scratch
// copy only): calculate, approve and lock real Singapore and Japan runs, then
// pay them out with GIRO and Zengin files, confirm the upload (payroll-core's
// markPaid), and check the filings ledger and year-end figures against the
// real locked lines. Needs payroll-core's lib_payroll*.js in the scratch app.
import { join } from 'node:path';
import { APP, PORT, download, eq, ok, refuses, section, summary } from './lib.mjs';

process.env.HR_APP = APP;
process.env.HR_PORT = String(PORT);
const core = await import('file:///' + join(APP, '..', '..', 'payroll-core', 'tests', 'lib.mjs').replace(/\\/g, '/'));
const api = core.newApi();
core.fresh({ seed: true });
await core.preparePayable(api);
const O = { as: 'owner' };
const PAY = 'payroll@northwind.test';

async function lockedRun(entityName) {
  const home = await api.op('payroll.home', {}, O);
  const s = home.schedules.find((x) => x.entity_name === entityName);
  const run = (await api.op('payruns.create', { schedule: s.schedule }, O)).payrun;
  await core.calcRun(api, run.id);
  const iss = await api.op('payruns.issues', { payrun: run.id }, O);
  if (iss.issues.some((i) => i.severity !== 'blocker')) await api.op('payruns.acknowledge', { payrun: run.id, reason: 'reviewed_ok' }, { as: PAY });
  const sub = await api.op('payruns.submit', { payrun: run.id }, { as: PAY });
  await core.decideAny(api, sub.approval.id, 'approved');
  await api.op('payruns.lock', { payrun: run.id }, { as: PAY, pin: true });
  return run;
}

section('a real Singapore run, locked by payroll-core');
const sg = await lockedRun('Northwind Pte Ltd');
const ov = await api.op('payout.overview', { status: 'open' }, { as: PAY });
const row = ov.runs.find((r) => r.id === sg.id);
ok(row && row.status === 'locked' && row.next === 'export', 'the locked run waits for its bank file', row);
const pr = await api.op('payout.run', { payrun: sg.id }, { as: PAY });
ok(pr.check.problems.some((p) => p.code === 'bank_code_shape'), 'the GIRO writer refuses the test bank code 001 (4 digits needed), per person', pr.check.problems.slice(0, 2));
await refuses(api, 'bankfiles.export', { payrun: sg.id }, { as: PAY, pin: true }, 422, 'bank_file_problems', 'no file while problems remain');
const dir = await api.op('people.directory', { status: 'current', entity: 'Northwind Pte Ltd', limit: 100 }, O);
for (const p of dir.people) await api.op('testpout.bank', { employee: p.number, accounts: [{ bank_code: '7171', branch_code: '081', number: '0123' + p.number.replace(/\D/g, '') + '99', account_type: 'savings' }] }, O);
const ex = await api.op('bankfiles.export', { payrun: sg.id }, { as: PAY, pin: true });
const runNow = (await api.op('payout.overview', { status: 'all' }, { as: PAY })).runs.find((r) => r.id === sg.id);
eq(ex.bank_file.total_minor, runNow.net_minor, 'the GIRO file total equals the run net pay');
const cu = await api.op('payout.confirm-upload', { bank_file: ex.bank_file.id, reference: 'DBS-IDEAL-0001' }, { as: PAY, pin: true });
eq(cu.run.status, 'paid', 'payroll-core markPaid: the run is paid');
const notes = await api.call('payruns.get', { payrun: sg.id }, O);
ok(notes.status === 200 && notes.body.payrun.status === 'paid', 'payroll-core sees the run paid');
const jr = await api.op('journal.preview', { payrun: sg.id }, { as: PAY });
eq(jr.balanced, true, 'the journal of a real run balances');
eq(jr.debit_minor, runNow.gross_minor + runNow.employer_minor + (runNow.reimbursement_minor || 0), 'journal debits are gross + employer cost + reimbursements');

section('filings from real locked lines');
const gen = await api.op('filings.generate', { entity: 'Northwind Pte Ltd' }, { as: PAY });
ok(gen.rows > 0, 'ledger rows for Singapore');
const fl = await api.op('filings.list', { entity: 'Northwind Pte Ltd', show: 'all' }, { as: PAY });
const cpf = fl.filings.find((f) => f.kind === 'sg_cpf' && f.period === sg.period_end.slice(0, 7));
ok(cpf !== undefined, 'a CPF row for the run month', fl.filings.map((f) => f.kind + ' ' + f.period));
const reg = await api.op('payreports.register', { payrun: sg.id }, { as: PAY });
const ytd = await api.op('payreports.ytd', { entity: 'Northwind Pte Ltd', year: Number(sg.pay_date.slice(0, 4)) }, { as: PAY });
const cpfLines = ytd.rows.reduce((s, r) => s + (r.by_code.SG_CPF_EE || 0), 0);
const fg = await api.op('filings.get', { filing: cpf.id }, { as: PAY });
const eeOf = (w) => (w.codes.find((c) => c.code === 'SG_CPF_EE') || { amount: 0 }).amount;
let eeYear = 0;
for (const f of fl.filings.filter((x) => x.kind === 'sg_cpf' && x.period.slice(0, 4) === sg.pay_date.slice(0, 4))) eeYear += eeOf((await api.op('filings.get', { filing: f.id }, { as: PAY })).filing.worksheet);
eq(eeYear, cpfLines, 'the CPF worksheets of the year add up to the locked SG_CPF_EE lines (the demo\'s October run and this run)');
ok(eeOf(fg.filing.worksheet) > 0 && cpf.amount_minor > eeOf(fg.filing.worksheet), 'the CPF filing adds employer CPF and SDL to the employee share');
eq(cpf.due_day, (() => { const [y, m] = sg.period_end.slice(0, 7).split('-').map(Number); const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y; return ny + '-' + String(nm).padStart(2, '0') + '-14'; })(), 'CPF due the 14th of the next month');
void reg;

section('year-end IR8A from the real lines');
const ir = await api.op('yearend.document', { entity: 'Northwind Pte Ltd', doc: 'sg_ir8a', year: Number(sg.pay_date.slice(0, 4)) }, { as: PAY });
eq(ir.totals.cpf_ee, cpfLines, 'IR8A employee CPF total equals the locked lines');
ok(ir.rows.length === dir.people.length, 'one IR8A row per person paid');

section('a real Japan run: Zengin from the furigana');
const jp = await lockedRun('Northwind KK');
const jdir = await api.op('people.directory', { status: 'current', entity: 'Northwind KK', limit: 100 }, O);
let i = 0;
for (const p of jdir.people) await api.op('testpout.bank', { employee: p.number, accounts: [{ bank_code: '0005', branch_code: String(100 + i++).padStart(3, '0'), number: '12345' + String(i).padStart(2, '0'), account_type: 'futsu' }] }, O);
await api.op('payout.settings-set', { entity: 'Northwind KK', bank_format: 'zengin', payer: { zengin: { consignor_code: '1234567890', consignor_kana: 'ノースウインド(カ', bank_code: '0005', branch_code: '001', account_type: 'ordinary', account: '1234567' } } }, O);
const jx = await api.op('bankfiles.export', { payrun: jp.id }, { as: PAY, pin: true });
const jd = await download(api, 'bankfiles.download', { bank_file: jx.bank_file.id }, PAY);
eq(jd.buf.length, (jdir.people.length + 3) * 122, 'Zengin records for every person with a kana name');
ok(jd.buf.slice(0, 1).toString() === '1' && jd.buf.slice(1, 3).toString() === '11', 'salary transfer header');
const jf = await api.op('filings.generate', { entity: 'Northwind KK' }, { as: PAY });
void jf;
const jfl = await api.op('filings.list', { entity: 'Northwind KK', show: 'all', kind: 'jp_gensen' }, { as: PAY });
ok(jfl.filings.some((f) => f.amount_minor > 0), '源泉所得税 row with the withheld tax of the locked run', jfl.filings.map((f) => f.period + ' ' + f.amount_minor));

const s = summary('t05_integration');
process.exitCode = s.failed > 0 ? 1 : 0;
