/**
 * Catalog: leave administration (types, policies and their dated versions,
 * assignments, the bulk tools, locked dates, adjustments, the daily run and
 * the country defaults).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const DAY = (what) => S(what + ' (YYYY-MM-DD)');
const ICONS = 'sun, palmtree, plane, thermometer, stethoscope, hospital, baby, heart, heart-handshake, users, house, graduation-cap, briefcase, clock, calendar-off, calendar-clock, hand-coins, award, scale, umbrella, flower, landmark, shield, star';
const FILTERS = { entity: S('Entity'), department: S('Department'), location: S('Location'), employment_type: S('Employment type code'), employments: S('JSON list of employment or employee numbers (instead of the filters)') };

const TYPE_FIELDS = {
  type: S('Type id or code to change (empty to add one)'),
  entity: S('Entity it belongs to (empty = every entity)'),
  code: S('Code for a new type, e.g. study_leave'),
  name: S('Name people see'),
  paid: B('Paid leave (unpaid days reach payroll as unpaid)'),
  unit: S('day | hour', { enum: ['day', 'hour'] }),
  color: S('rh (blue) | lh (teal) | good (green) | warn (amber) | bad (red) | ink (grey)', { enum: ['rh', 'lh', 'good', 'warn', 'bad', 'ink'] }),
  icon: S('Line icon: ' + ICONS),
  allow_half: B('Half days allowed'),
  allow_hours: B('Hours allowed'),
  allow_negative: B('May go below zero'),
  max_negative: N('How far below zero (0 = no limit when allowed)'),
  attachment_after_days: N('A certificate is needed from this many days (0 = never)'),
  min_notice_days: N('Days of notice'),
  max_consecutive_days: N('Longest stretch in one request (0 = no limit)'),
  counts_holidays: B('Holidays inside the leave count as leave days'),
  counts_weekends: B('Calendar days: weekends and holidays count (maternity leave)'),
  statutory: B('Required by law'),
  gender_specific: S('For whom, as a note (e.g. female)'),
  encashable: B('Can be cashed in'),
  payout_on_exit: B('Pay out the unused balance on termination (with the final pay)'),
  comp_off: B('Compensatory leave (earned by working rest days)'),
  visibility: S('type | away: colleagues and managers see only "away"', { enum: ['type', 'away'] }),
  pay_code: S('Pay component code payroll uses for it'),
  note: S('Note (the law, the company rule)'),
  sort: N('Order in lists'),
  archived: B('No longer used'),
};

module.exports = [
  { name: 'leave.types', method: 'GET', fn: 'lib_leave_admin.typesList', perm: 'signed', effect: 'read', desc: 'Leave types per entity (code, name, paid, unit, colour, icon, half days, hours, negative balance, certificate, notice, longest stretch, cash-in, compensatory) and the icons and colours they can use.', params: { entity: S('Entity'), archived: B('Include archived types') } },
  { name: 'leave.types-save', method: 'POST', fn: 'lib_leave_admin.typesSave', perm: 'leave:full', agent: 'propose', kind: 'leave', effect: 'write', desc: 'Add a leave type or change one (only the fields you give change). The unit cannot change once people have balances.', params: TYPE_FIELDS, diff: { collection: 'leave_types', id: 'type', fields: { name: 'name', paid: 'paid', unit: 'unit', color: 'color', icon: 'icon', allow_half: 'allow_half', allow_hours: 'allow_hours', allow_negative: 'allow_negative', max_negative: 'max_negative', attachment_after_days: 'attachment_after_days', min_notice_days: 'min_notice_days', max_consecutive_days: 'max_consecutive_days', encashable: 'encashable', payout_on_exit: 'payout_on_exit', archived: 'archived', note: 'note' } } },
  { name: 'leave.types-delete', method: 'POST', fn: 'lib_leave_admin.typesDelete', perm: 'leave:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a leave type nobody used (archive one that has requests or balances).', params: { type: S('Type id', { required: true }) } },
  { name: 'leave.policies', method: 'GET', fn: 'lib_leave_admin.policiesList', perm: 'signed', effect: 'read', desc: 'Leave policies: the rule per type (fixed, monthly_accrual, per_hours_worked, tenure_table, statutory_jp, manual, none), the leave year, versions by day, people on each, the entity default.', params: { entity: S('Entity'), archived: B('Include archived') } },
  { name: 'leave.policy', method: 'GET', fn: 'lib_leave_admin.policyGet', perm: 'signed', effect: 'read', desc: 'One leave policy with every version of its rules.', params: { policy: S('Policy id or name', { required: true }) } },
  {
    name: 'leave.policy-save',
    method: 'POST',
    fn: 'lib_leave_admin.policySave',
    perm: 'leave:full',
    agent: 'propose',
    kind: 'leave',
    effect: 'write',
    desc: 'Add or change a leave policy. New rules apply from effective_from (default this leave year); earlier years keep their numbers. Rule keys: app.guide --module leave.',
    params: { policy: S('Policy id or name (empty to add one)'), name: S('Name'), entity: S('Entity (for a new policy)'), period_start: S('Leave year start MM-DD, e.g. 01-01 or 04-01'), rules: S('JSON list, one rule per type, e.g. [{"type":"annual","method":"fixed","amount":20,"carryover_max":5}]'), effective_from: DAY('The new rules apply from this day'), note: S('Note'), archived: B('No longer used'), make_default: B('New people of the entity follow it') },
  },
  { name: 'leave.policy-delete', method: 'POST', fn: 'lib_leave_admin.policyDelete', perm: 'leave:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a leave policy nobody follows.', params: { policy: S('Policy id or name', { required: true }) } },
  { name: 'leave.assignments', method: 'GET', fn: 'lib_leave_admin.assignmentsList', perm: 'signed', effect: 'read', desc: "Which policy a person follows from which day (one person's history, or everyone on a policy).", params: { employment: S('Employment'), policy: S('Policy'), limit: N('Rows') } },
  { name: 'leave.assign', method: 'POST', fn: 'lib_leave_admin.assign', perm: 'leave:edit', agent: 'propose', kind: 'leave', effect: 'write', desc: 'Make a person follow a leave policy from a day (earlier days keep their policy). Balances are worked out again from that day.', params: { employment: S('Employment', { required: true }), policy: S('Policy id or name', { required: true }), effective_from: DAY('From this day, default today'), note: S('Why') } },
  { name: 'leave.assignment-delete', method: 'POST', fn: 'lib_leave_admin.assignmentDelete', perm: 'leave:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove one policy assignment made by mistake (balances are worked out again).', params: { assignment: S('Assignment id', { required: true }) } },
  { name: 'leave.assign-bulk', method: 'POST', fn: 'lib_leave_admin.assignBulk', perm: 'leave:full', agent: 'propose', kind: 'leave', effect: 'write', desc: 'Assign a policy to many people at once (by entity, department, location, employment type, or a list), from a day. dry_run lists who would change.', params: Object.assign({ policy: S('Policy id or name', { required: true }), effective_from: DAY('From this day'), only_unassigned: B('Only people without any policy'), dry_run: B('List who would change, change nothing'), note: S('Why') }, FILTERS) },
  { name: 'leave.grant-bulk', method: 'POST', fn: 'lib_leave_admin.grantBulk', perm: 'leave:full', agent: 'propose', kind: 'leave', effect: 'write', desc: 'Give (or take away) days of a leave type to many people at once, e.g. one extra day for a company anniversary. dry_run lists who it reaches.', params: Object.assign({ type: S('Leave type code', { required: true }), amount: N('Days or hours (negative takes away)', { required: true }), reason: S('Reason people see', { required: true }), day: DAY('Day of the grant, default today'), expires: DAY('Days given expire on this day'), dry_run: B('List who it reaches, change nothing') }, FILTERS) },
  { name: 'leave.adjust', method: 'POST', fn: 'lib_leave_admin.adjust', perm: 'leave:edit', agent: 'propose', kind: 'leave', preview: 'lib_leave_admin.previewAdjust', effect: 'write', desc: "Adjust one person's balance with a reason (an opening balance from an old system, a correction, days given). Negative takes days away.", params: { employment: S('Employment', { required: true }), type: S('Leave type code', { required: true }), amount: N('Days or hours (negative takes away)', { required: true }), reason: S('Reason the person sees', { required: true }), day: DAY('Day, default today'), expires: DAY('Days added expire on this day') } },
  { name: 'leave.blocks', method: 'GET', fn: 'lib_leave_admin.blocksList', perm: 'signed', effect: 'read', desc: 'Locked periods: days when leave cannot be requested (an entity or a department, with people allowed through).', params: { from: DAY('From'), to: DAY('To') } },
  { name: 'leave.block-save', method: 'POST', fn: 'lib_leave_admin.blockSave', perm: 'leave:edit', agent: 'propose', kind: 'leave', effect: 'write', desc: 'Lock days against leave (people see the reason; managers and HR can still go past with override), or change a lock.', params: { block: S('Lock id (empty to add one)'), entity: S('Entity (empty = all)'), department: S('Department (empty = all)'), from: DAY('First day'), to: DAY('Last day'), reason: S('Reason people see'), allow: S('JSON list of employee numbers allowed through'), types: S('JSON list of type codes it covers (empty = all)') } },
  { name: 'leave.block-delete', method: 'POST', fn: 'lib_leave_admin.blockDelete', perm: 'leave:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a locked period.', params: { block: S('Lock id', { required: true }) } },
  { name: 'leave.sync', method: 'POST', fn: 'lib_leave_admin.syncOp', perm: 'leave:full', effect: 'write', desc: 'Run the daily leave run now (grants, accruals, the leave year close, expiries) for one person or entity, or all.', params: { employment: S('One employment'), entity: S('One entity') } },
  { name: 'leave.sync-log', method: 'GET', fn: 'lib_leave_admin.syncLog', perm: 'leave:view', effect: 'read', desc: 'The daily leave runs: per entity and local day, people covered, rows written, errors.', params: { limit: N('Rows') } },
  { name: 'leave.seed-defaults', method: 'POST', fn: 'lib_leave_admin.seedDefaultsOp', perm: 'leave:full', agent: 'propose', kind: 'leave', effect: 'write', desc: "Set up leave for an entity from its country's defaults: the leave types it lacks and a default policy; people without a policy follow it from their first day.", params: { entity: S('Entity', { required: true }) } },
];
