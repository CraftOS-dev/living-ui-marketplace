/**
 * Catalog: time, timesheets, overtime rules and requests, hours for
 * payroll and the review your AI agent does.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'timesheets.mine', method: 'GET', fn: 'lib_time_sheet.sheetMine', perm: 'self', effect: 'read', desc: "The caller's timesheet for a week (this week by default): rows by day built from attendance (regular, overtime, leave, holiday) plus their own project rows, totals and exceptions.", params: { week: S('Any day of the week'), employment: S('One of your employments') } },
  { name: 'timesheets.get', method: 'GET', fn: 'lib_time_sheet.sheetGet', perm: 'signed', effect: 'read', desc: 'One timesheet (by id, or employment and week) with its rows, totals, projects, exceptions and the days behind them.', params: { timesheet: S('Timesheet id'), employment: S('Employment'), week: S('Any day of the week') } },
  { name: 'timesheets.list', method: 'GET', fn: 'lib_time_sheet.sheetList', perm: 'signed', effect: 'read', desc: "A week's timesheets of everyone the caller sees, waiting ones and those with exceptions first, with totals.", params: { week: S('Any day of the week (default this week)'), status: S('draft | submitted | approved | rejected', { enum: ['draft', 'submitted', 'approved', 'rejected'] }), entity: S('Entity'), location: S('Location'), department: S('Department'), team: B('Only my team') } },
  {
    name: 'timesheets.save-entries',
    method: 'POST',
    fn: 'lib_time_sheet.saveEntries',
    perm: 'signed',
    agent: 'propose',
    kind: 'time',
    preview: 'lib_time_sheet.previewSaveEntries',
    effect: 'write',
    desc: 'Replace the rows of some days of a week (projects, tasks or corrected hours) with entries JSON; a day in days with no rows goes back to attendance.',
    params: { timesheet: S('Timesheet id'), employment: S('Employment (default: your own)'), week: S('Any day of the week'), entries: S('JSON list of rows', { required: true }), days: S('JSON list of days to put back to attendance'), note: S('A note for the approver') },
  },
  { name: 'timesheets.submit', method: 'POST', fn: 'lib_time_sheet.submit', perm: 'self', agent: 'deny', effect: 'write', desc: 'Send your week for approval (your manager sees the numbers and the exceptions).', params: { timesheet: S('Timesheet id'), week: S('Any day of the week (default this week)'), note: S('A note for the approver') } },
  { name: 'timesheets.withdraw', method: 'POST', fn: 'lib_time_sheet.withdraw', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Take back a submitted timesheet to change it.', params: { timesheet: S('Timesheet id'), employment: S('Employment'), week: S('Any day of the week') } },
  { name: 'timesheets.reopen', method: 'POST', fn: 'lib_time_sheet.reopen', perm: 'time:edit', agent: 'deny', effect: 'write', desc: 'Reopen an approved timesheet (not yet paid in a locked run) so it can be corrected and approved again.', params: { timesheet: S('Timesheet id'), employment: S('Employment'), week: S('Any day of the week'), note: S('Why') } },
  { name: 'timesheets.review-ask', method: 'POST', fn: 'lib_time_sheet.reviewAsk', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Ask your AI agent to check a week of timesheets and propose fixes (it never approves): a timesheet check and the timesheet_review trigger with its id. Time editors: an entity; managers: their own team.', params: { week: S('Any day of the week (default last week)'), entity: S('Entity'), team: B('Only my team'), note: S('What to look at') } },
  { name: 'timesheet-reviews.list', method: 'GET', fn: 'lib_time_sheet.reviewList', perm: 'signed', effect: 'read', desc: 'The latest timesheet checks of your AI agent the caller asked for or may see, newest first, with their state and result.', params: { limit: N('Rows (default 10)') } },
  { name: 'timesheet-reviews.get', method: 'GET', fn: 'lib_time_sheet.reviewGet', perm: 'signed', effect: 'read', desc: 'One timesheet check (the review_id of timesheet_review or timesheet_check): the week (from, to), the entity or the people of a team, the person\'s note and the result.', params: { review: S('Timesheet check id', { required: true }) } },
  { name: 'timesheet-reviews.done', method: 'POST', fn: 'lib_time_sheet.reviewDone', perm: 'signed', effect: 'write', desc: 'Your AI agent: finish a timesheet check with what you proposed and found. Closes the ask; the person who asked (or HR, for the weekly check) is told.', params: { review: S('Timesheet check id', { required: true }), note: S('One line for HR', { required: true }), people: N('People checked'), proposals: S('JSON list of the proposal ids you made'), anomalies: S('JSON list [{"employment":"E0005","day":"2026-11-03","note":"..."}]') } },
  { name: 'time.review', method: 'GET', fn: 'lib_time_sheet.review', perm: 'signed', effect: 'read', desc: 'Everyone\'s time exceptions in a period (default the last 7 days): missed punches with the day\'s punches and plan, absences, long days, edited timesheets, area flags, rest-day work.', params: { from: S('First day'), to: S('Last day'), entity: S('Entity'), team: B('Only my team'), people: S('Only these employments (ids, comma separated)') } },
  { name: 'time.payroll-check', method: 'GET', fn: 'lib_time_sheet.payrollCheck', perm: 'time:view|payroll:view', effect: 'read', desc: 'Hours for payroll per person in an entity for a period (default this month): worked, regular, overtime by pay component, absences, late, night minutes and the issues to fix.', params: { entity: S('Entity', { required: true }), from: S('First day'), to: S('Last day') } },
  { name: 'time.pay-inputs', method: 'GET', fn: 'lib_time_sheet.payInputsOp', perm: 'time:view|payroll:view', effect: 'read', desc: "One person's hours for payroll for a period, as payroll reads them (lib_time.payInputs), with the days behind them.", params: { employment: S('Employment', { required: true }), from: S('First day'), to: S('Last day') } },
  { name: 'overtime-rules.list', method: 'GET', fn: 'lib_time_ot.rulesList', perm: 'signed', effect: 'read', desc: 'Overtime rule sets of the entities: rules with multipliers and pay component codes, settings (clocking, timesheets, severities, pre-approval) and overtime limits.', params: { entity: S('Entity') } },
  { name: 'overtime-rules.defaults', method: 'GET', fn: 'lib_time_ot.rulesDefaults', perm: 'signed', effect: 'read', desc: 'The default overtime rules for a country (and region), with notes.', params: { country: S('Country code', { required: true }), region: S('Region code, e.g. CA') } },
  {
    name: 'overtime-rules.save',
    method: 'POST',
    fn: 'lib_time_ot.rulesSave',
    perm: 'time:full',
    agent: 'propose',
    kind: 'time',
    preview: 'lib_time_ot.previewRulesSave',
    effect: 'write',
    desc: 'Add or change an overtime rule set: rules, settings, caps (minutes) and applies, each as JSON (app.guide time has the shapes).',
    params: { rule_set: S('Rule set id or name (empty to add one)'), entity: S('Entity (when adding)'), name: S('Name'), rules: S('JSON list of rules'), settings: S('JSON object of settings'), caps: S('JSON object of overtime limits in minutes'), applies: S('JSON object {"employment_types":[codes]} (empty for everyone else)'), active: B('In use'), notes: S('Notes') },
  },
  { name: 'overtime-rules.reset', method: 'POST', fn: 'lib_time_ot.rulesReset', perm: 'time:full', agent: 'propose', kind: 'time', effect: 'write', desc: "Put an entity's general overtime rules back to its country's defaults (the old set is kept, inactive).", params: { entity: S('Entity', { required: true }) } },
  { name: 'overtime-rules.delete', method: 'POST', fn: 'lib_time_ot.rulesDelete', perm: 'time:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an overtime rule set.', params: { rule_set: S('Rule set id or name', { required: true }) } },
  { name: 'overtime-rules.try', method: 'GET', fn: 'lib_time_ot.rulesTry', perm: 'signed', effect: 'read', desc: 'Try rules on made-up days (nothing saved): days JSON [{"day":"2026-11-02","kind":"work","worked":600,"night":0}] with a saved rule set or rules JSON.', params: { rule_set: S('Saved rule set'), rules: S('JSON list of rules'), settings: S('JSON settings'), days: S('JSON list of days', { required: true }) } },
  { name: 'overtime-requests.add', method: 'POST', fn: 'lib_time_ot.otRequestsAdd', perm: 'self', agent: 'deny', effect: 'write', desc: 'Ask your manager to approve overtime on a day (before, or at most a week after).', params: { day: S('Day', { required: true }), minutes: N('Minutes of overtime', { required: true }), reason: S('Why', { required: true }), employment: S('One of your employments') } },
  { name: 'overtime-requests.list', method: 'GET', fn: 'lib_time_ot.otRequestsList', perm: 'signed', effect: 'read', desc: 'Overtime requests: mine or my team\'s.', params: { view: S('mine | team', { enum: ['mine', 'team'] }), status: S('pending | approved | rejected | cancelled | all', { enum: ['pending', 'approved', 'rejected', 'cancelled', 'all'] }), entity: S('Entity') } },
  { name: 'overtime-requests.cancel', method: 'POST', fn: 'lib_time_ot.otRequestsCancel', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Cancel an overtime request that is not decided yet.', params: { request: S('Request id', { required: true }), note: S('Why') } },
];
