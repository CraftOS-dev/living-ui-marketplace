/**
 * Catalog: employee advances and travel requests.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const ADVANCE = S('Advance number (ADV-0001) or id', { required: true, example: 'ADV-0001' });
const TRAVEL = S('Trip number (TRV-0001) or id', { required: true, example: 'TRV-0001' });
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const WHO = { view: S('mine | team | all', { enum: ['mine', 'team', 'all'] }), entity: S('Entity'), employee: S('Employee number, id or work email') };
const PURPOSES = ['client_visit', 'conference', 'training', 'internal_meeting', 'sales', 'relocation', 'other'];

module.exports = [
  { name: 'advances.list', method: 'GET', fn: 'lib_expenses_trips.advancesList', perm: 'signed', effect: 'read', desc: 'Advances the caller may see with totals per currency (outstanding balance, approved and not paid).', params: Object.assign({ status: S('open (default: requested, approved, paid) | requested | approved | paid | settled | rejected | cancelled | any', { enum: ['open', 'requested', 'approved', 'paid', 'settled', 'rejected', 'cancelled', 'any'] }) }, WHO, PAGE) },
  { name: 'advances.get', method: 'GET', fn: 'lib_expenses_trips.advancesGet', perm: 'signed', effect: 'read', desc: 'One advance with its balance, settlements (claims, repayments, payroll recoveries), approval and what the caller can do.', params: { advance: ADVANCE } },
  { name: 'advances.request', method: 'POST', fn: 'lib_expenses_trips.advancesRequest', perm: 'self', agent: 'deny', effect: 'write', desc: 'Ask for an advance (money ahead of spending, e.g. a trip); the manager then finance approve. HR may ask for --employment and set pay-out and recovery.', params: { employment: S('Employment or employee number (default: your own)'), amount: S('Amount, major units in the entity currency', { required: true }), purpose: S('What it is for', { required: true }), travel: S('Trip it is for (TRV-0001)'), needed_by: S('Day it is needed'), pay_via: S('bank | payroll (HR only)', { enum: ['payroll', 'bank'] }), recover_via: S('claim | payroll (HR only)', { enum: ['payroll', 'claim'] }), recover_from: S('Day recovery from pay may start'), note: S('Note') } },
  { name: 'advances.cancel', method: 'POST', fn: 'lib_expenses_trips.advancesCancel', perm: 'self', agent: 'deny', effect: 'write', desc: 'Cancel an advance that is waiting for approval, or approved and not yet paid.', params: { advance: ADVANCE, note: S('Why') } },
  { name: 'advances.mark-paid', method: 'POST', fn: 'lib_expenses_trips.advancesMarkPaid', perm: 'expenses:full', agent: 'deny', effect: 'write', desc: 'Finance: an approved advance was paid by transfer (with the reference); its balance opens for settlement.', params: { advance: ADVANCE, reference: S('Payment reference', { required: true }), day: S('Day paid (default today)') } },
  { name: 'advances.settle', method: 'POST', fn: 'lib_expenses_trips.advancesSettle', perm: 'expenses:full', agent: 'deny', effect: 'write', desc: 'Finance: settle part or all of a paid advance: the person paid it back (repayment, with a reference) or against an approved claim (claim).', params: { advance: ADVANCE, kind: S('repayment (default) | claim', { enum: ['repayment', 'claim'] }), amount: S('Amount, major units (default the balance)'), claim: S('Claim for kind claim'), reference: S('Reference of the repayment'), day: S('Day (default today)'), note: S('Note') } },
  { name: 'advances.update', method: 'POST', fn: 'lib_expenses_trips.advancesUpdate', perm: 'expenses:full', agent: 'deny', effect: 'write', desc: 'Finance: change how an advance is paid (before it is paid) and recovered, or its note.', params: { advance: ADVANCE, pay_via: S('payroll | bank', { enum: ['payroll', 'bank'] }), recover_via: S('payroll | claim', { enum: ['payroll', 'claim'] }), recover_from: S('Day recovery from pay may start'), note: S('Note') } },

  { name: 'travel.list', method: 'GET', fn: 'lib_expenses_trips.travelList', perm: 'signed', effect: 'read', desc: 'Trips the caller may see, latest first, each with what was claimed against its estimate.', params: Object.assign({ status: S('open (default) | upcoming | draft | requested | approved | rejected | cancelled | any', { enum: ['open', 'draft', 'requested', 'approved', 'rejected', 'cancelled', 'upcoming', 'any'] }) }, WHO, PAGE) },
  { name: 'travel.get', method: 'GET', fn: 'lib_expenses_trips.travelGet', perm: 'signed', effect: 'read', desc: 'One trip: purpose, days, destinations, itinerary, estimate by category, the claims made on it and their total, advances, approval and what the caller can do.', params: { travel: TRAVEL } },
  {
    name: 'travel.save',
    method: 'POST',
    fn: 'lib_expenses_trips.travelSave',
    perm: 'self',
    effect: 'write',
    desc: 'Start a draft trip (for yourself, or for --employment as HR or your AI agent drafting for someone who asked) or change a draft (--travel). Submit it with travel.submit.',
    params: {
      travel: S('Trip to change (empty to start one)'),
      employment: S('Employment or employee number (default: your own)'),
      purpose: S(PURPOSES.join(' | '), { enum: PURPOSES }),
      details: S('What the trip is for'),
      from_day: S('First day'),
      to_day: S('Last day'),
      destinations: S('JSON list [{"city":"Tokyo","country":"JP"}]'),
      itinerary: S('JSON list of legs [{"day":"2026-11-20","from":"Singapore","to":"Tokyo","mode":"flight","note":"SQ638"}]; mode flight, train, car, bus, boat or other'),
      costs: S('JSON list of the estimate [{"category":"lodging","amount":"900.00","note":"3 nights"}]'),
    },
  },
  { name: 'travel.submit', method: 'POST', fn: 'lib_expenses_trips.travelSubmit', perm: 'self', agent: 'deny', effect: 'write', desc: 'Ask for approval of a draft trip with its estimate.', params: { travel: TRAVEL } },
  { name: 'travel.cancel', method: 'POST', fn: 'lib_expenses_trips.travelCancel', perm: 'self', agent: 'deny', effect: 'write', desc: 'Cancel a draft, requested or approved trip.', params: { travel: TRAVEL, note: S('Why') } },
];
