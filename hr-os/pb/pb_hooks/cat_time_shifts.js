/**
 * Catalog: time, shifts (shift types, patterns, the week schedule with
 * draft and published states, shift requests and swaps).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const TYPE_FIELDS = {
  name: S('Name, e.g. Morning'),
  code: S('Short code shown in the grid, e.g. M'),
  start: S('Start HH:MM'),
  end: S('End HH:MM (earlier than start for a night shift)'),
  break_min: N('Unpaid break minutes'),
  color: S('grey | blue | teal | ink', { enum: ['grey', 'blue', 'teal', 'ink'] }),
  grace_in_min: N('Minutes after the start before someone counts as late'),
  grace_out_min: N('Minutes before the end before leaving counts as early'),
  half_day_below_min: N('Worked minutes below which the day is a half day (0 = never)'),
  absent_below_min: N('Worked minutes below which the day is an absence (0 = never)'),
  auto_attendance: B('Work out attendance from punches (default true)'),
  location: S('Default location of the shift'),
  sort: N('Order in lists'),
};
const FILTERS = { entity: S('Entity'), location: S('Location'), department: S('Department'), team: B('Only my team') };

module.exports = [
  { name: 'shift-types.list', method: 'GET', fn: 'lib_time_shift.shiftTypesList', perm: 'signed', effect: 'read', desc: 'Shift types (start, end, break, grace, code and colour) of the entities the caller may see.', params: { entity: S('Entity'), archived: B('Include archived ones') } },
  { name: 'shift-types.add', method: 'POST', fn: 'lib_time_shift.shiftTypesAdd', perm: 'time:edit', agent: 'propose', kind: 'time', effect: 'write', desc: 'Add a shift type to an entity.', params: Object.assign({}, TYPE_FIELDS, { entity: S('Entity', { required: true }), name: S('Name', { required: true }), start: S('Start HH:MM', { required: true }), end: S('End HH:MM', { required: true }) }) },
  { name: 'shift-types.update', method: 'POST', fn: 'lib_time_shift.shiftTypesUpdate', perm: 'time:edit', agent: 'propose', kind: 'time', effect: 'write', diff: { collection: 'shift_types', id: 'shift_type', fields: { name: 'name', code: 'code', start: 'start', end: 'end', break_min: 'break_min', grace_in_min: 'grace_in_min', archived: 'archived' } }, desc: 'Change a shift type (shifts already published keep their hours in attendance worked out before the change).', params: Object.assign({ shift_type: S('Shift type id, code or name', { required: true }), archived: B('Archived') }, TYPE_FIELDS) },
  { name: 'shift-types.delete', method: 'POST', fn: 'lib_time_shift.shiftTypesDelete', perm: 'time:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a shift type that was never used (else archive it).', params: { shift_type: S('Shift type id, code or name', { required: true }) } },
  { name: 'shift-patterns.list', method: 'GET', fn: 'lib_time_shift.patternsList', perm: 'signed', effect: 'read', desc: 'Repeating shift patterns (a cycle of shift types and days off) to lay over many people.', params: { entity: S('Entity'), archived: B('Include archived ones') } },
  { name: 'shift-patterns.save', method: 'POST', fn: 'lib_time_shift.patternsSave', perm: 'time:edit', agent: 'propose', kind: 'time', effect: 'write', desc: 'Add or change a shift pattern: days is a JSON list, one item per day of the cycle, each a shift type (id, code or name) or "" for a day off.', params: { pattern: S('Pattern id or name (empty to add one)'), entity: S('Entity (when adding)'), name: S('Name, e.g. Two on two off'), days: S('JSON list, e.g. ["D","D","",""]'), note: S('Note'), archived: B('Archived') } },
  { name: 'shift-patterns.delete', method: 'POST', fn: 'lib_time_shift.patternsDelete', perm: 'time:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a shift pattern (shifts laid with it stay).', params: { pattern: S('Pattern id or name', { required: true }) } },
  { name: 'shifts.week', method: 'GET', fn: 'lib_time_shift.shiftsWeek', perm: 'signed', effect: 'read', desc: 'The schedule of a week: people by days with their shift (draft or published), work weeks, approved leave, holidays, conflicts, hours per person and day, and unpublished changes.', params: Object.assign({ week: S('Any day of the week (default today)') }, FILTERS) },
  {
    name: 'shifts.set',
    method: 'POST',
    fn: 'lib_time_shift.shiftsSet',
    perm: 'signed',
    effect: 'write',
    desc: 'Change cells of the draft schedule: cells JSON [{employment, day, shift_type}] (shift_type "" clears the day). Nobody sees a change until it is published. HR and managers.',
    params: { cells: S('JSON list of cells'), employment: S('One cell: employment'), day: S('One cell: day'), shift_type: S('One cell: shift type ("" clears)'), location: S('One cell: location') },
  },
  { name: 'shifts.copy-week', method: 'POST', fn: 'lib_time_shift.shiftsCopyWeek', perm: 'signed', effect: 'write', desc: 'Copy a week of shifts to another week as drafts: fill only empty days (default) or replace.', params: { from_week: S('Any day of the week to copy', { required: true }), to_week: S('Any day of the week to fill (default the week after)'), mode: S('fill | replace', { enum: ['fill', 'replace'] }), employments: S('JSON list of employments (default everyone shown)'), entity: S('Entity'), location: S('Location'), department: S('Department') } },
  { name: 'shifts.assign-pattern', method: 'POST', fn: 'lib_time_shift.shiftsAssignPattern', perm: 'signed', effect: 'write', desc: 'Lay a shift pattern over many people for a date range (drafts): the bulk shift assignment tool.', params: { pattern: S('Pattern id or name', { required: true }), employments: S('JSON list of employments, e.g. ["E0004","E0005"]', { required: true }), from: S('First day', { required: true }), to: S('Last day (at most six months)', { required: true }), offset: N('Start at this day of the cycle (0 = the first)'), mode: S('replace (default) | fill', { enum: ['fill', 'replace'] }) } },
  { name: 'shifts.discard', method: 'POST', fn: 'lib_time_shift.shiftsDiscard', perm: 'signed', effect: 'write', desc: 'Throw away draft changes and go back to what was published (a week by default).', params: Object.assign({ week: S('Any day of the week'), from: S('First day'), to: S('Last day') }, FILTERS) },
  {
    name: 'shifts.publish',
    method: 'POST',
    fn: 'lib_time_shift.shiftsPublish',
    perm: 'signed',
    agent: 'propose',
    kind: 'time',
    preview: 'lib_time_shift.previewPublish',
    effect: 'write',
    desc: 'Publish the draft schedule (a week by default): people then see their shifts, attendance follows them, and only the people whose shifts changed are told.',
    params: Object.assign({ week: S('Any day of the week'), from: S('First day'), to: S('Last day') }, FILTERS),
  },
  { name: 'shifts.mine', method: 'GET', fn: 'lib_time_shift.shiftsMine', perm: 'self', effect: 'read', desc: "The caller's published shifts (and work hours on days without a shift), leave and holidays for two weeks, plus their open shift requests.", params: { from: S('First day (default this week)'), to: S('Last day'), employment: S('One of your employments') } },
  { name: 'shifts.of', method: 'GET', fn: 'lib_time_shift.shiftsOf', perm: 'signed', effect: 'read', desc: "One person's published schedule for a range (profile Time tab).", params: { employment: S('Employment', { required: true }), from: S('First day'), to: S('Last day') } },
  { name: 'shifts.colleagues', method: 'GET', fn: 'lib_time_shift.shiftsColleagues', perm: 'self', effect: 'read', desc: "People at the caller's location or in their department on a day, with that day's published shift (to pick someone to swap with).", params: { day: S('Day (default today)'), employment: S('One of your employments') } },
  {
    name: 'shift-requests.add',
    method: 'POST',
    fn: 'lib_time_shift.shiftRequestsAdd',
    perm: 'self',
    agent: 'deny',
    effect: 'write',
    desc: 'Ask for a different shift on some days (kind change) or to swap a day with a colleague (kind swap: swap_with, swap_day; they agree first).',
    params: { kind: S('change | swap', { enum: ['change', 'swap'] }), from_day: S('Day (first day)', { required: true }), to_day: S('Last day (change)'), shift_type: S('The shift you want (change)'), swap_with: S('Colleague (employee number)'), swap_day: S("The colleague's day (default the same day)"), reason: S('Why'), employment: S('One of your employments') },
  },
  { name: 'shift-requests.respond', method: 'POST', fn: 'lib_time_shift.shiftRequestsRespond', perm: 'self', agent: 'deny', effect: 'write', desc: 'Agree to or decline a colleague\'s swap request (agreeing sends it to the manager).', params: { request: S('Shift request id', { required: true }), answer: S('accept | decline', { required: true, enum: ['accept', 'decline'] }), note: S('A note') } },
  { name: 'shift-requests.list', method: 'GET', fn: 'lib_time_shift.shiftRequestsList', perm: 'signed', effect: 'read', desc: 'Shift requests: mine (asked by me or asking me to swap) or my team\'s.', params: { view: S('mine | team', { enum: ['mine', 'team'] }), status: S('open (default) | pending | awaiting_peer | approved | rejected | declined | cancelled | all', { enum: ['open', 'pending', 'awaiting_peer', 'approved', 'rejected', 'declined', 'cancelled', 'all'] }), entity: S('Entity') } },
  { name: 'shift-requests.cancel', method: 'POST', fn: 'lib_time_shift.shiftRequestsCancel', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Cancel a shift request that is not decided yet (the person who asked, or HR).', params: { request: S('Shift request id', { required: true }), note: S('Why') } },
];
