/**
 * Catalog: leave for people and managers (balances, requests, the wallchart,
 * cashing in, compensatory leave, approval context, the Japanese five-day
 * rule and the annual paid leave register).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const EMPLOYMENT = S('Employment number or id (an employee number means their primary employment); default your own');
const TYPE = S('Leave type code (annual, sick, ...) or id', { required: true, example: 'annual' });
const DAY = (what) => S(what + ' (YYYY-MM-DD)');
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const REQUEST_PARAMS = {
  employment: EMPLOYMENT,
  type: TYPE,
  start: S('First day (YYYY-MM-DD)', { required: true, example: '2026-12-21' }),
  end: DAY('Last day, default the first day'),
  start_half: S('am or pm: a half day on the first day (pm = from the afternoon); on a one-day request, which half', { enum: ['am', 'pm', ''] }),
  end_half: S('am: the last day ends at noon', { enum: ['am', ''] }),
  hours: N('Hours of leave on one day (types taken by the hour)'),
};

module.exports = [
  { name: 'leave.home', method: 'GET', fn: 'lib_leave_views.overview', perm: 'signed', effect: 'read', desc: 'Leave home: who is out today and this week, requests waiting for a decision, entities without leave set up. HR sees their entities, managers their team. Balances to watch: leave.attention.', params: { entity: S('Entity'), department: S('Department'), day: DAY('Day to look from, default today') } },
  { name: 'leave.attention', method: 'GET', fn: 'lib_leave_views.attentionOp', perm: 'signed', effect: 'read', desc: 'Balances that need attention: people short of the Japanese five-day rule (at risk or missed), days that lapse within 60 days, balances below zero. HR sees their entities, managers their team.', params: { entity: S('Entity'), department: S('Department'), day: DAY('Day for the team and days left, default today') } },
  { name: 'leave.mine', method: 'GET', fn: 'lib_leave_views.mine', perm: 'signed', effect: 'read', desc: 'One person\'s leave (default the caller): a balance per type (available, taken, booked, waiting, expiring), the types they can request, requests, cash-ins, compensatory leave, five-day rule.', params: { employment: EMPLOYMENT } },
  { name: 'leave.balances', method: 'GET', fn: 'lib_leave_views.balancesTable', perm: 'signed', effect: 'read', desc: 'Balance table: one row per person in an entity (HR) or the team (managers), a column per leave type with the balance and what is available.', params: Object.assign({ entity: S('Entity (types differ per entity)'), department: S('Department'), type: S('Only this type code'), q: S('Name or number contains'), day: DAY('Balances on this day, default today') }, PAGE) },
  { name: 'leave.balance', method: 'GET', fn: 'lib_leave_views.balanceDetail', perm: 'signed', effect: 'read', desc: 'One balance explained: how the number was reached (opening, grants, accruals, carry-over, expiries, leave taken, adjustments, running balance), its lots and expiry, and a projection to project_to.', params: { employment: EMPLOYMENT, type: TYPE, day: DAY('Day, default today'), project_to: DAY('Project the balance to this future day') } },
  { name: 'leave.ledger', method: 'GET', fn: 'lib_leave_views.ledgerList', perm: 'signed', effect: 'read', desc: "The ledger rows of one person's leave (every grant, accrual, take, adjustment, carry-over, expiry, cash-in and compensatory grant), newest first.", params: { employment: EMPLOYMENT, type: S('Type code'), from: DAY('From'), to: DAY('To'), limit: N('Rows (default 200)') } },
  { name: 'leave.calendar', method: 'GET', fn: 'lib_leave_views.calendar', perm: 'signed', effect: 'read', desc: 'The wallchart for up to two months: people as rows, leave bars by type, holidays, days off and locked periods. HR sees their entities, managers the team, employees colleagues as away only.', params: { from: DAY('First day, default the first of this month'), to: DAY('Last day, default the month end'), entity: S('Entity'), department: S('Department'), q: S('Name or number contains') } },
  { name: 'leave.out', method: 'GET', fn: 'lib_leave_views.out', perm: 'signed', effect: 'read', desc: 'Who is out on a day or between two days (approved leave; add pending with include_pending), with a count per day.', params: { from: DAY('First day, default today'), to: DAY('Last day, default the first'), entity: S('Entity'), department: S('Department'), include_pending: B('Count requests still waiting too') } },
  { name: 'leave.requests', method: 'GET', fn: 'lib_leave_req.requestsList', perm: 'signed', effect: 'read', desc: 'Leave requests: mine, my team or all I may see, filtered by status (open = pending, approved, cancelling), person, type, entity and days.', params: Object.assign({ view: S('mine | team | all', { enum: ['mine', 'team', 'all'] }), status: S('pending | approved | rejected | cancelled | withdrawn | cancelling | open | any (comma list allowed)'), employment: S('Employment'), type: S('Type code'), entity: S('Entity'), from: DAY('Overlapping from'), to: DAY('Overlapping to'), sort: S('recent (default) | start', { enum: ['recent', 'start'] }) }, PAGE) },
  { name: 'leave.get', method: 'GET', fn: 'lib_leave_req.requestGet', perm: 'signed', effect: 'read', desc: 'One leave request with its days, warnings, approvals, the balance and what the caller can do (withdraw, cancel, attach, decide).', params: { request: S('Request id', { required: true }) } },
  { name: 'leave.check', method: 'GET', fn: 'lib_leave_req.check', perm: 'self', effect: 'read', desc: 'Check a request before sending it (nothing is written): the days it takes, the balance before and after, notice, locked dates, certificates, overlaps and who else in the team is away.', params: Object.assign({}, REQUEST_PARAMS, { request: S('A request id to leave out (when changing it)') }) },
  {
    name: 'leave.request',
    method: 'POST',
    fn: 'lib_leave_req.request',
    perm: 'self',
    agent: 'propose',
    kind: 'leave',
    preview: 'lib_leave_req.previewRequest',
    effect: 'write',
    files: ['attachment'],
    desc: 'Request time off for yourself or (manager, HR) someone else; it goes to the approval flow. --override goes past a lock, notice or balance check; --record (HR) needs no approval.',
    params: Object.assign({}, REQUEST_PARAMS, { reason: S('Reason or note for the approver'), override: B('Manager or HR: go past a lock, notice or balance check (say why in reason)'), record: B('HR (full Leave access): record the leave as approved, without an approval') }),
  },
  { name: 'leave.withdraw', method: 'POST', fn: 'lib_leave_req.withdraw', perm: 'self', agent: 'deny', effect: 'write', desc: 'Withdraw a leave request that is still waiting for a decision.', params: { request: S('Request id', { required: true }), note: S('Note') } },
  { name: 'leave.cancel', method: 'POST', fn: 'lib_leave_req.cancel', perm: 'self', agent: 'deny', effect: 'write', desc: 'Cancel approved leave, all of it or from a day. Not started: cancelled at once. Started: the approver decides first (HR with full Leave access: at once).', params: { request: S('Request id', { required: true }), from: DAY('Cancel from this day of the leave, default all of it'), reason: S('Why') } },
  { name: 'leave.attach', method: 'POST', fn: 'lib_leave_req.attach', perm: 'self', agent: 'deny', effect: 'write', files: ['attachment'], desc: 'Add a certificate (photo or PDF) to a leave request.', params: { request: S('Request id', { required: true }) } },
  { name: 'leave.attachment', method: 'GET', fn: 'lib_leave_req.attachmentFile', perm: 'self', effect: 'read', desc: "Open a leave request's certificate (the person, their managers, HR and the approver; your AI agent gets the file path).", params: { request: S('Request id', { required: true }), download: B('Download instead of view') } },
  { name: 'leave.approval-context', method: 'GET', fn: 'lib_leave_req.approvalContext', perm: 'signed', effect: 'read', desc: 'What an approver needs for a leave approval (leave_request, leave_encash, comp_off): the request, balance before and after, who else is away, holidays and locks in the range, checks passed.', params: { approval: S('Approval id', { required: true }) } },
  { name: 'leave.encash-request', method: 'POST', fn: 'lib_leave_req.encashRequest', perm: 'self', agent: 'deny', effect: 'write', desc: 'Ask to cash in days of a leave type that allows it. Once approved (manager, then HR) they leave the balance and are paid in the run covering the pay day.', params: { employment: EMPLOYMENT, type: TYPE, days: N('Days, in half days', { required: true, example: '3' }), reason: S('Reason'), pay_on: DAY('HR: the day it is paid, default the decision day') } },
  { name: 'leave.encash-withdraw', method: 'POST', fn: 'lib_leave_req.encashWithdraw', perm: 'self', agent: 'deny', effect: 'write', desc: 'Withdraw a request to cash in leave that is still waiting.', params: { encash: S('Cash-in request id', { required: true }) } },
  { name: 'leave.encashments', method: 'GET', fn: 'lib_leave_req.encashList', perm: 'signed', effect: 'read', desc: 'Requests to cash in leave: one person, or all (HR, payroll), by status.', params: { employment: S('Employment'), status: S('pending | approved | rejected | withdrawn | paid') } },
  { name: 'leave.comp-off-request', method: 'POST', fn: 'lib_leave_req.compOffRequest', perm: 'self', agent: 'propose', kind: 'leave', effect: 'write', desc: 'Ask for compensatory leave for a rest day or holiday worked. After approval the days are added to the compensatory leave balance and expire after the months the policy says.', params: { employment: EMPLOYMENT, worked_day: S('The day worked (YYYY-MM-DD)', { required: true }), days: N('Days earned, 0.5 to 2 (default 1)'), hours: N('Hours worked that day'), reason: S('What the work was'), type: S('Compensatory leave type code, default the one of the entity') } },
  { name: 'leave.comp-off-withdraw', method: 'POST', fn: 'lib_leave_req.compOffWithdraw', perm: 'self', agent: 'deny', effect: 'write', desc: 'Withdraw a compensatory leave request that is still waiting.', params: { comp_off: S('Compensatory leave request id', { required: true }) } },
  { name: 'leave.comp-offs', method: 'GET', fn: 'lib_leave_req.compOffList', perm: 'signed', effect: 'read', desc: 'Compensatory leave requests: one person, the team or all (HR).', params: { employment: S('Employment') } },
  { name: 'leave.obligation', method: 'GET', fn: 'lib_leave_views.obligation', perm: 'signed', effect: 'read', desc: 'Japan five-day rule: everyone granted 10 or more days of annual paid leave, with the grant day, deadline, days taken, planned and short, and the status (missed, at_risk, on_track, done).', params: { entity: S('Entity'), department: S('Department'), employment: S('One person'), day: DAY('Day, default today') } },
  { name: 'leave.register', method: 'GET', fn: 'lib_leave_views.register', perm: 'signed', effect: 'read', desc: 'Japan\'s annual paid leave register (年次有給休暇管理簿): per person and grant year the base date, days carried and granted, each leave taken, what remains, the five-day rule, keep-until day.', params: { entity: S('Entity'), department: S('Department'), employment: S('One person'), from: DAY('Grant years overlapping from (default a year ago)'), to: DAY('To (default today)') } },
  { name: 'leave.register-export', method: 'GET', fn: 'lib_leave_views.registerExport', perm: 'signed', agent: 'deny', effect: 'read', desc: 'The annual paid leave register as a CSV file (Japanese and English headers).', params: { entity: S('Entity'), department: S('Department'), employment: S('One person'), from: DAY('From'), to: DAY('To') } },
];
