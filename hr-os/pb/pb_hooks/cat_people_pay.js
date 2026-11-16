/**
 * Catalog: pay records (effective-dated pay of an employment). The kernel
 * creates them; the payroll module may add its own pay ops.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const EMPLOYMENT = S('Employment number or id (an employee number means their primary employment)', { required: true });
const PAY = {
  amount: S('Amount in the entity currency, major units, e.g. 6500.00'),
  basis: S('salary | hourly | daily', { enum: ['salary', 'hourly', 'daily'] }),
  per: S('year | month | week | day | hour', { enum: ['year', 'month', 'week', 'day', 'hour'] }),
  pay_schedule: S('Pay schedule id (payroll)'),
  note: S('Note'),
};

module.exports = [
  { name: 'pay.history', method: 'GET', fn: 'lib_people.payHistory', perm: 'signed', effect: 'read', desc: 'Every pay record of an employment (past, current, scheduled), for those who may see the pay.', params: { employment: EMPLOYMENT } },
  { name: 'pay.update', method: 'POST', fn: 'lib_people.payUpdate', perm: 'payroll:edit', agent: 'propose', kind: 'payroll', preview: 'lib_people.previewPayUpdate', effect: 'write', desc: 'A pay change from a day (a raise, a promotion, or a joiner\'s starting pay with reason hire): a new record, history kept; what you leave out carries over.', params: Object.assign({ employment: EMPLOYMENT, effective_from: S('From day (default today; the first day of work when the employment has no pay yet; future days schedule it)'), reason: S('hire (starting pay, the first pay record only) | raise | promotion | adjustment | correction | change', { required: true, enum: ['hire', 'raise', 'promotion', 'adjustment', 'correction', 'change'] }) }, PAY) },
  { name: 'pay.edit', method: 'POST', fn: 'lib_people.payEdit', perm: 'payroll:edit', agent: 'propose', kind: 'payroll', preview: 'lib_people.previewPayEdit', effect: 'write', desc: 'Correct a pay record in place. Refused once a locked pay run used it (then make a new record and back pay).', params: Object.assign({ record: S('Pay record id', { required: true }), reason: S('Reason', { enum: ['hire', 'raise', 'promotion', 'adjustment', 'correction', 'change'] }) }, PAY) },
  { name: 'pay.delete', method: 'POST', fn: 'lib_people.payDelete', perm: 'payroll:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a scheduled (future) pay change.', params: { record: S('Pay record id', { required: true }) } },
];
