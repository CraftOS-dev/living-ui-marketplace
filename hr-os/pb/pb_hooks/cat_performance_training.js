/**
 * Catalog: training programs, sessions, enrolment and attendance, results,
 * certificates (protected files), the attendee's feedback, external
 * completions, and required trainings with compliance (done, expiring,
 * due, overdue).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const KINDS = ['course', 'workshop', 'certification'];
const PROGRAM = S('Program id or name', { required: true });
const TRAINING = S('Training session id', { required: true });
const ATTENDEE = S('Attendee id (a person on a session, or a recorded completion)', { required: true });
const REQ = S('Requirement id', { required: true });

const PROGRAM_FIELDS = {
  kind: S('course | workshop | certification', { enum: KINDS }),
  provider: S('Provider'),
  description: S('What it covers'),
  duration_hours: N('Hours'),
  valid_months: N('A completion stays valid this many months (0 = forever); renewals follow'),
  link: S('Link to the course'),
  entity: S('Entity it is for (empty = all)'),
};
const SESSION_FIELDS = {
  program: S('Program id or name'),
  program_name: S('Or: a new program by name (made for you)'),
  title: S('Title (default the program name)'),
  kind: S('course | workshop | certification', { enum: KINDS }),
  provider: S('Provider'),
  entity: S('Entity'),
  start: S('First day (default in two weeks)'),
  end: S('Last day (one-day sessions leave it empty)'),
  start_time: S('Start time HH:MM'),
  end_time: S('End time HH:MM'),
  location: S('Room or address'),
  link: S('Online link'),
  capacity: N('Seats (0 = no limit)'),
  cost: S('Cost in major units, e.g. 1200.00'),
  currency: S('Currency of the cost (default the entity currency)'),
  trainer: S('Trainer'),
  description: S('Agenda or notes'),
  status: S('planned | open (enrolment open, default) | done | cancelled', { enum: ['planned', 'open', 'done', 'cancelled'] }),
};
const REQ_FIELDS = {
  entity: S('Only this entity'),
  department: S('Only this department'),
  job_title: S('Only this job title'),
  due_days: N('Due this many days after the person starts (new joiners)'),
  due_day: S('Due by this day (everyone already here)'),
  active: B('In force'),
  note: S('Note'),
};
const COMPLIANCE = { employee: S('One person'), requirement: S('One requirement'), department: S('Department id'), state: S('done | expiring | due | overdue | open (not done)', { enum: ['done', 'expiring', 'due', 'overdue', 'open', ''] }) };

module.exports = [
  { name: 'training-programs.list', method: 'GET', fn: 'lib_performance_training.programsList', perm: 'signed', effect: 'read', desc: 'Training programs (courses, workshops, certifications) with sessions, upcoming sessions, completions and whether they are required.', params: { q: S('Name or provider contains'), kind: S('course | workshop | certification', { enum: KINDS.concat(['']) }), archived: B('Include archived') } },
  { name: 'training-programs.add', method: 'POST', fn: 'lib_performance_training.programsAdd', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Add a training program.', params: Object.assign({ name: S('Program name', { required: true }) }, PROGRAM_FIELDS) },
  { name: 'training-programs.update', method: 'POST', fn: 'lib_performance_training.programsUpdate', perm: 'performance:edit', agent: 'propose', kind: 'performance', diff: { collection: 'training_programs', id: 'program', fields: { name: 'name', kind: 'kind', provider: 'provider', description: 'description', duration_hours: 'duration_hours', valid_months: 'valid_months', link: 'link', archived: 'archived' } }, effect: 'write', desc: 'Change a training program (archive it to hide it).', params: Object.assign({ program: PROGRAM, name: S('Name'), archived: B('Archive') }, PROGRAM_FIELDS) },
  { name: 'training-programs.delete', method: 'POST', fn: 'lib_performance_training.programsDelete', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a program without sessions or completions.', params: { program: PROGRAM } },

  { name: 'trainings.list', method: 'GET', fn: 'lib_performance_training.trainingsList', perm: 'signed', effect: 'read', desc: 'Training sessions: upcoming (default), past, mine or all, with seats taken, status and the caller\'s own place. People see open and done sessions and the ones they are on.', params: { view: S('upcoming | past | mine | all', { enum: ['upcoming', 'past', 'mine', 'all'] }), program: S('Program'), status: S('planned | open | done | cancelled', { enum: ['planned', 'open', 'done', 'cancelled', ''] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') } },
  { name: 'trainings.get', method: 'GET', fn: 'lib_performance_training.trainingsGet', perm: 'signed', effect: 'read', desc: 'One training session with the attendees the caller may see (status, score, result, certificate), the feedback average and what the caller can do.', params: { training: TRAINING } },
  { name: 'trainings.add', method: 'POST', fn: 'lib_performance_training.trainingsAdd', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Schedule a training session of a program (or start a new program with --program_name).', params: SESSION_FIELDS },
  { name: 'trainings.update', method: 'POST', fn: 'lib_performance_training.trainingsUpdate', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Change a session (days, place, seats, status: open enrolment, done, cancelled; cancelling tells the people on it).', params: Object.assign({ training: TRAINING }, SESSION_FIELDS) },
  { name: 'trainings.delete', method: 'POST', fn: 'lib_performance_training.trainingsDelete', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a session nobody is on (cancel it otherwise).', params: { training: TRAINING } },
  { name: 'trainings.enrol', method: 'POST', fn: 'lib_performance_training.trainingsEnrol', perm: 'signed', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Enrol yourself in an open session (no --employees), or people you manage (managers, HR). Refused when the session is full.', params: { training: TRAINING, employees: S('JSON list of people (number, id or email)') } },
  { name: 'trainings.attendance', method: 'POST', fn: 'lib_performance_training.trainingsAttendance', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Mark attendance and results: --rows, a JSON list of {attendee or employee, status, score, result} (example in app.guide). Completed rows get completion and expiry days.', params: { training: TRAINING, rows: S('JSON list of rows', { required: true }) } },
  { name: 'trainings.feedback', method: 'POST', fn: 'lib_performance_training.trainingsFeedback', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Your feedback on a session you attended: a rating 1 to 5 and a note.', params: { training: TRAINING, rating: N('1 to 5'), feedback: S('What worked, what did not') } },
  { name: 'trainings.compliance', method: 'GET', fn: 'lib_performance_training.compliance', perm: 'signed', effect: 'read', desc: 'Required trainings per person: done, expiring (30 days), due or overdue, with due day, last completion, expiry, enrolled session. HR sees their entities, managers their team, people themselves.', params: Object.assign({}, COMPLIANCE, { limit: N('Rows (default 100)'), offset: N('Rows to skip') }) },
  { name: 'trainings.export', method: 'GET', fn: 'lib_performance_training.exportCsv', perm: 'signed', agent: 'deny', effect: 'read', desc: 'A CSV of required training compliance the caller sees.', params: COMPLIANCE },

  { name: 'training-attendees.certificate', method: 'POST', fn: 'lib_performance_training.certificateSet', perm: 'signed', agent: 'deny', effect: 'write', files: ['file'], desc: 'Attach a certificate (PDF or image) to an attendance or completion: the person or HR.', params: { attendee: ATTENDEE } },
  { name: 'training-attendees.file', method: 'GET', fn: 'lib_performance_training.certificateFile', perm: 'signed', effect: 'read', desc: 'Open a certificate (the person, their managers, HR; your AI agent gets its path).', params: { attendee: ATTENDEE, download: B('Download instead of view') } },
  { name: 'training-attendees.record', method: 'POST', fn: 'lib_performance_training.recordExternal', perm: 'signed', agent: 'deny', effect: 'write', files: ['file'], desc: 'Record training done elsewhere (course or certificate, optionally the file): your own (a manager or HR verifies), or as manager or HR for your people.', params: { employee: S('The person (default you)'), program: S('Program id or name'), program_name: S('Or: a new program by name'), kind: S('course | workshop | certification (new program)', { enum: KINDS }), provider: S('Provider (new program)'), valid_months: N('Validity in months (new program)'), completed_on: S('Completion day (default today)'), expires_on: S('Expiry day (default from the program)'), score: N('Score'), result: S('pass (default) | fail', { enum: ['pass', 'fail', ''] }), note: S('Note') } },
  { name: 'training-attendees.verify', method: 'POST', fn: 'lib_performance_training.verify', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Verify a completion a person recorded (their manager or HR).', params: { attendee: ATTENDEE } },
  { name: 'training-attendees.cancel', method: 'POST', fn: 'lib_performance_training.cancelAttendee', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Cancel a place on a session (your own, or for people you manage).', params: { attendee: ATTENDEE } },

  { name: 'training-requirements.list', method: 'GET', fn: 'lib_performance_training.requirementsList', perm: 'signed', effect: 'read', desc: 'Required trainings (program, for whom, due rule) with how many people are done, expiring, due and overdue.', params: { inactive: B('Include requirements no longer in force') } },
  { name: 'training-requirements.add', method: 'POST', fn: 'lib_performance_training.requirementsAdd', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Require a training program for everyone, an entity, a department or a job title: due by a day and/or N days after starting (default 30). Renewals follow its validity.', params: Object.assign({ program: PROGRAM }, REQ_FIELDS) },
  { name: 'training-requirements.update', method: 'POST', fn: 'lib_performance_training.requirementsUpdate', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Change a training requirement.', params: Object.assign({ requirement: REQ, program: S('Program id or name') }, REQ_FIELDS) },
  { name: 'training-requirements.delete', method: 'POST', fn: 'lib_performance_training.requirementsDelete', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a training requirement (or set it inactive).', params: { requirement: REQ } },
];
