/**
 * Catalog: separations, the exit interview and its form, the full and
 * final statement.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const KINDS = ['resignation', 'termination', 'retirement', 'end_of_contract', 'death', 'other'];
const REASONS = ['better_opportunity', 'compensation', 'career_change', 'relocation', 'personal', 'health', 'study', 'performance', 'conduct', 'redundancy', 'restructuring', 'probation', 'contract_end', 'retirement', 'death', 'other'];
const SEPARATION = S('Separation id or number (S0001)', { required: true });

module.exports = [
  { name: 'separations.list', method: 'GET', fn: 'lib_lifecycle_separations.list', perm: 'signed', effect: 'read', desc: 'Separations the caller may see (HR: their entities with reasons; managers: their reports, kind and days only; everyone: their own).', params: { status: S('open (default: pending and approved) | pending | approved | completed | rejected | withdrawn | all', { enum: ['open', 'pending', 'approved', 'completed', 'rejected', 'withdrawn', 'all'] }), kind: S(KINDS.join(' | '), { enum: KINDS }), employee: S('Employee'), limit: N('Rows (default 50)'), offset: N('Rows to skip') } },
  { name: 'separations.get', method: 'GET', fn: 'lib_lifecycle_separations.get', perm: 'signed', effect: 'read', desc: 'One separation: kind, notice and last day, status, offboarding progress, the assets still held; for HR also the reason, rehire eligibility and the exit interview.', params: { separation: SEPARATION } },
  {
    name: 'separations.request',
    method: 'POST',
    fn: 'lib_lifecycle_separations.request',
    perm: 'signed',
    agent: 'deny',
    effect: 'write',
    desc: 'Start a separation for approval (manager, then HR): resign or retire (no --employment), or as manager or HR record any kind. Approval starts offboarding.',
    params: { employment: S('Employment or employee number (empty: your own)'), kind: S(KINDS.join(' | '), { enum: KINDS }), last_day: S('Last day of work', { required: true }), notice_day: S('Day notice was given (default today)'), reason: S('Reason in words (HR and the person see it)', { secret: true }), reason_code: S(REASONS.join(' | '), { enum: REASONS }), rehire_eligible: S('yes | no | unsure (HR)', { enum: ['yes', 'no', 'unsure'] }), hr_note: S('Note for HR only', { secret: true }) },
  },
  { name: 'separations.update', method: 'POST', fn: 'lib_lifecycle_separations.update', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'HR changes a separation. After approval a new last day ends the employment on that day, moves the offboarding due days and emits separation.changed.', params: { separation: SEPARATION, kind: S(KINDS.join(' | '), { enum: KINDS }), notice_day: S('Notice day'), last_day: S('Last day'), reason: S('Reason', { secret: true }), reason_code: S(REASONS.join(' | '), { enum: REASONS }), rehire_eligible: S('yes | no | unsure', { enum: ['yes', 'no', 'unsure'] }), hr_note: S('Note for HR only', { secret: true }) } },
  { name: 'separations.withdraw', method: 'POST', fn: 'lib_lifecycle_separations.withdraw', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Withdraw a separation still waiting for approval (the person who asked, or HR).', params: { separation: SEPARATION, note: S('Why') } },
  { name: 'separations.complete', method: 'POST', fn: 'lib_lifecycle_separations.complete', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Close an approved separation after the last day (the daily job does it once offboarding is done).', params: { separation: SEPARATION } },
  { name: 'separations.exit-interview', method: 'POST', fn: 'lib_lifecycle_separations.exitInterview', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Save exit interview answers (the person leaving, once, or HR). Answers are for HR only.', params: { separation: SEPARATION, answers: S('JSON {question key: answer}; ratings 1 to 5, yes_no yes or no', { secret: true }), done: B('Send it (the person cannot change it afterwards)') } },
  { name: 'separations.settlement', method: 'GET', fn: 'lib_lifecycle_separations.settlement', perm: 'people:edit', effect: 'read', desc: 'Full and final statement of a separation: claims to repay, advances and loans to recover, leave to cash in, assets not returned, the final pay run, totals per currency (amounts need pay access).', params: { separation: SEPARATION } },

  { name: 'exit-forms.list', method: 'GET', fn: 'lib_lifecycle_separations.exitFormsList', perm: 'people:view', effect: 'read', desc: 'Exit interview forms and their questions.' },
  { name: 'exit-forms.save', method: 'POST', fn: 'lib_lifecycle_separations.exitFormsSave', perm: 'people:edit', agent: 'propose', kind: 'people', diff: { collection: 'exit_forms', id: 'form', fields: { name: 'name', questions: 'questions' } }, effect: 'write', desc: 'Add or change an exit interview form: --questions, a JSON list of {key, label, type, options}; types text, rating (1 to 5), choice, yes_no (example: app.guide --module lifecycle).', params: { form: S('Form id (empty to add one)'), name: S('Name'), questions: S('JSON list of questions'), is_default: B('The form new separations use'), archived: B('Archived') } },
];
