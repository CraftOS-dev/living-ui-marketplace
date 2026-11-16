/**
 * Catalog: time, attendance (board, month grid, day detail, marking by
 * hand one or many, processing, export, attendance requests).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const FILTERS = { entity: S('Entity'), location: S('Location'), department: S('Department'), team: B('Only my team') };
const MARK = S('present | absent | half_day | remote | on_duty | holiday | weekly_off', { enum: ['present', 'absent', 'half_day', 'remote', 'on_duty', 'holiday', 'weekly_off'] });

module.exports = [
  { name: 'attendance.board', method: 'GET', fn: 'lib_time_att.board', perm: 'signed', effect: 'read', desc: 'Who is in, on a break, out, late, absent, on leave or remote on a day (today by default), with counts by location and department and one row per person. HR sees their entities, managers their team.', params: Object.assign({ day: S('Day (default today)') }, FILTERS) },
  { name: 'attendance.month', method: 'GET', fn: 'lib_time_att.month', perm: 'signed', effect: 'read', desc: 'The month grid: one row per person (or --employment for one), a status per day (P present, A absent, HD half day, L leave, H holiday, O day off, R remote, D on duty), planned days ahead, and totals.', params: Object.assign({ month: S('YYYY-MM (default this month)'), employment: S('One person'), limit: N('People per page (default 100)'), offset: N('People to skip') }, FILTERS) },
  { name: 'attendance.get', method: 'GET', fn: 'lib_time_att.dayGet', perm: 'signed', effect: 'read', desc: "One person's day: the plan (shift or work hours), leave, attendance, every punch (taken-out ones too) and attendance requests.", params: { employment: S('Employment (default: your own)'), day: S('Day (default today)') } },
  { name: 'attendance.list', method: 'GET', fn: 'lib_time_att.list', perm: 'signed', effect: 'read', desc: 'Attendance rows for a period (last 30 days by default), newest first, filtered by person, status, late or days with punch issues.', params: Object.assign({ employment: S('One person'), from: S('First day'), to: S('Last day'), status: S('A status'), late: B('Only late days'), issues: B('Only days with a missing punch or a punch outside the area'), limit: N('Rows (default 100)'), offset: N('Rows to skip') }, FILTERS) },
  { name: 'attendance.export', method: 'GET', fn: 'lib_time_att.exportCsv', perm: 'time:view', agent: 'deny', effect: 'read', desc: 'Attendance rows of a period as CSV text (at most 2000 rows).', params: Object.assign({ employment: S('One person'), from: S('First day'), to: S('Last day'), status: S('A status') }, FILTERS) },
  {
    name: 'attendance.mark',
    method: 'POST',
    fn: 'lib_time_att.mark',
    perm: 'signed',
    agent: 'propose',
    kind: 'time',
    preview: 'lib_time_att.previewMark',
    effect: 'write',
    desc: 'Set a day by hand (status, and optionally in and out times); auto attendance keeps it. HR or the manager; your AI agent proposes it. Not for days a locked pay run used.',
    params: { employment: S('Employment', { required: true }), day: S('Day', { required: true }), status: Object.assign({}, MARK, { required: true }), in_time: S('In HH:MM (with out_time)'), out_time: S('Out HH:MM'), break_min: N('Break minutes (default the scheduled break on days over 6 hours)'), note: S('Why', { required: true }) },
  },
  {
    name: 'attendance.mark-bulk',
    method: 'POST',
    fn: 'lib_time_att.markBulk',
    perm: 'signed',
    agent: 'propose',
    kind: 'time',
    effect: 'write',
    desc: 'One status for many people on a day or a few days (the employee attendance tool), for example a site closure or an off-site day. Locked days are skipped and listed.',
    params: { employments: S('JSON list of employments, e.g. ["E0004","E0005"]', { required: true }), day: S('The day (or from and to)'), from: S('First day'), to: S('Last day (at most 31 days)'), status: Object.assign({}, MARK, { required: true }), note: S('Why', { required: true }) },
  },
  { name: 'attendance.reset', method: 'POST', fn: 'lib_time_att.reset', perm: 'signed', agent: 'propose', kind: 'time', effect: 'write', desc: 'Drop a day set by hand and follow the punches again.', params: { employment: S('Employment', { required: true }), day: S('Day', { required: true }) } },
  { name: 'attendance.process', method: 'POST', fn: 'lib_time_att.processOp', perm: 'time:edit', effect: 'write', desc: 'Work out auto attendance from punches now (yesterday and today by default; it also runs every 30 minutes). Days set by hand, by a request or used by a locked pay run are kept.', params: { employment: S('One person'), entity: S('Entity'), from: S('First day'), to: S('Last day (at most three months)') } },
  {
    name: 'attendance-requests.add',
    method: 'POST',
    fn: 'lib_time_att.requestsAdd',
    perm: 'self',
    agent: 'deny',
    effect: 'write',
    desc: 'Ask the manager to fix a day: missed_punch, correction, remote (work from home) or on_duty, for a day or a range. HR may ask for someone (--employment).',
    params: { kind: S('missed_punch | correction | remote | on_duty', { required: true, enum: ['missed_punch', 'correction', 'remote', 'on_duty'] }), from_day: S('Day (first day)', { required: true }), to_day: S('Last day (remote, on duty)'), half_day: B('Half a day (remote, on duty)'), in_time: S('In HH:MM'), out_time: S('Out HH:MM'), break_min: N('Break minutes (correction)'), reason: S('Why', { required: true }), employment: S('Employment (yours by default)') },
  },
  { name: 'attendance-requests.list', method: 'GET', fn: 'lib_time_att.requestsList', perm: 'signed', effect: 'read', desc: 'Attendance requests: mine or my team\'s, open by default.', params: { view: S('mine | team', { enum: ['mine', 'team'] }), status: S('open | pending | approved | rejected | cancelled | all', { enum: ['open', 'pending', 'approved', 'rejected', 'cancelled', 'all'] }), entity: S('Entity') } },
  { name: 'attendance-requests.cancel', method: 'POST', fn: 'lib_time_att.requestsCancel', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Cancel an attendance request that is not decided yet.', params: { request: S('Request id', { required: true }), note: S('Why') } },
];
