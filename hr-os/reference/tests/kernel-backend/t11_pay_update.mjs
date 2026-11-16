// Seeded: pay.update takes a joiner's starting pay (reason hire, the first pay record
// only), defaults the day to the first day of work when there is no pay yet, and
// refuses in plain sentences with a code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const HR = { as: 'hr@northwind.test' };
const AG = { as: 'agent' };

section('starting pay');
const farah = await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Farah Aziz', given_name: 'Farah', family_name: 'Aziz', start_day: '2026-12-01', title: 'Operations Associate' }, HR);
const m = farah.employment.id;
eq((await api.op('pay.history', { employment: m }, PAY)).records.length, 0, 'a hire without pay has no pay record');
const early = await refuses(api, 'pay.update', { employment: m, effective_from: '2026-11-15', reason: 'hire', amount: '4200.00' }, PAY, 400, 'before_start', 'pay before the first day of work is before_start');
ok(early.body.data.start_day === '2026-12-01' && early.body.data.param === 'effective_from' && early.body.message === 'Pay can start on the first day of work (2026-12-01) or later.', 'with the first day and a plain sentence', early.body);
const bad = await refuses(api, 'pay.update', { employment: m, reason: 'hire', amount: '4200.123' }, PAY, 400, 'invalid_amount', 'an amount with three decimals is refused');
ok(/^The amount is in SGD with at most 2 decimals/.test(bad.body.message) && bad.body.message.indexOf('amount must') < 0 && bad.body.data.param === 'amount', 'in a plain sentence', bad.body.message);
const noAmount = await refuses(api, 'pay.update', { employment: m, reason: 'hire' }, PAY, 400, 'missing_param', 'starting pay needs an amount');
eq(noAmount.body.message, 'Enter the amount, for example 6500.00.', 'asked for in a plain sentence');
const prop = await api.op('pay.update', { employment: m, reason: 'hire', amount: '4200.00' }, AG);
ok(JSON.stringify(prop).indexOf('2026-12-01') >= 0, 'your AI agent\'s proposal shows the first day of work as the day', prop);
const start = await api.op('pay.update', { employment: m, reason: 'hire', amount: '4200.00', note: 'Offer letter' }, PAY);
ok(start.record.effective_from === '2026-12-01' && start.record.reason === 'hire' && start.record.amount_minor === 420000, 'no day given: the starting pay is from the first day of work', start.record);
const again = await refuses(api, 'pay.update', { employment: m, effective_from: '2026-12-01', reason: 'raise', amount: '4300.00' }, PAY, 409, 'exists', 'a second record on that day is refused');
ok(/^There is already a pay record from 2026-12-01: correct that one instead/.test(again.body.message) && again.body.data.record === start.record.id, 'naming the record to correct', again.body);
const notFirst = await refuses(api, 'pay.update', { employment: m, effective_from: '2027-01-01', reason: 'hire', amount: '4300.00' }, PAY, 400, 'not_first', 'starting pay is the first pay record only');
ok(notFirst.body.data.first_day === '2026-12-01' && /^Starting pay is the first pay record, and Farah Aziz has pay from 2026-12-01\./.test(notFirst.body.message), 'saying since when there is pay', notFirst.body.message);
const later = await api.op('pay.update', { employment: m, effective_from: '2027-01-01', reason: 'raise', amount: '4400.00' }, PAY);
eq(later.record.reason, 'raise', 'a later raise is a normal change');

section('defaults and the rest');
const emily = (await api.op('people.get', { employee: 'emily@northwind.test' }, PAY)).employments[0];
const raise = await api.op('pay.update', { employment: emily.id, reason: 'adjustment', amount: '99000.00' }, PAY);
ok(raise.record.effective_from > emily.start_day && raise.record.effective_from >= '2026-11-04', 'with pay already, no day given means today', raise.record.effective_from);
await refuses(api, 'pay.update', { employment: emily.id, amount: '99500.00' }, PAY, 400, 'missing_param', 'a reason is still required');
await refuses(api, 'pay.update', { employment: emily.id, effective_from: '2026-13-01', reason: 'raise', amount: '99500.00' }, PAY, 400, 'invalid_param', 'a day that is not a date is refused');
await refuses(api, 'job.update', { employment: emily.id, reason: 'hire', title: 'Account Executive II' }, HR, 400, 'invalid_param', 'a job change is never a hire');
const spec = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8')).operations.find((o) => o.name === 'pay.update');
ok(spec && JSON.stringify(spec).indexOf('hire') >= 0, 'operations.json offers reason hire for pay.update');

const s = summary('t11_pay_update');
process.exitCode = s.failed > 0 ? 1 : 0;
