/**
 * Catalog: job openings (from a requisition or direct), their pipeline
 * stages and board, the job post your AI agent drafts as a proposal, the
 * open roles everyone may see, and interview kits.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const OPENING = S('Opening id or number (J0001)', { required: true });

const FIELDS = {
  title: S('Title of the role'),
  description: S('Job post in markdown'),
  department: S('Department (name or id)'),
  job_title: S('Job title from the list (name or id)'),
  location: S('Location (name or id); sets the work country and region'),
  location_text: S('Where, as shown on the post (city, or "Anywhere in the EU")'),
  country: S('Work country (two letters)'),
  region: S('Work region (state or province code, e.g. CA, NY, ON)'),
  remote: S('onsite | hybrid | remote', { enum: ['onsite', 'hybrid', 'remote'] }),
  employment_type: S('Employment type (code or id)'),
  salary_min: S('Pay range low in the opening currency, major units'),
  salary_max: S('Pay range high, major units'),
  pay_per: S('year | month | week | day | hour', { enum: ['year', 'month', 'week', 'day', 'hour'] }),
  show_pay: B('Show the pay range on the post'),
  positions: N('How many people to hire'),
  hiring_manager: S('Hiring manager (member id or email)'),
  team: S('JSON list of members on the hiring team (ids or emails)'),
};

module.exports = [
  { name: 'openings.list', method: 'GET', fn: 'lib_hiring_jobs.list', perm: 'hiring:view', effect: 'read', desc: 'Job openings the caller may see with candidates per stage; managers see the ones they are part of. Status active (draft, open, on hold) by default.', params: { status: S('active (default) | all | draft | open | on_hold | closed'), entity: S('Entity'), department: S('Department'), mine: B('Only openings I manage or am on the team of'), q: S('Title or number contains'), limit: N('Rows'), offset: N('Rows to skip') } },
  { name: 'openings.get', method: 'GET', fn: 'lib_hiring_jobs.get', perm: 'hiring:view', effect: 'read', desc: 'One opening: post, work place, pay range and the pay transparency rule of its place, stages with counts, hiring team, kits, warnings.', params: { opening: OPENING } },
  { name: 'openings.board', method: 'GET', fn: 'lib_hiring_jobs.board', perm: 'hiring:view', effect: 'read', desc: 'The pipeline of an opening: active candidates per stage (days in stage, next interview, scorecards in, offer) or the closed ones. Cards are sorted by waiting time, applied day or name, never by merit.', params: { opening: OPENING, sort: S('waiting (default) | applied | name', { enum: ['waiting', 'applied', 'name'] }), status: S('active (default) | rejected | withdrawn | hired | closed', { enum: ['active', 'rejected', 'withdrawn', 'hired', 'closed'] }) } },
  { name: 'openings.open-roles', method: 'GET', fn: 'lib_hiring_jobs.openList', perm: 'signed', effect: 'read', desc: 'Open roles anyone in the company may see and refer people to (title, place, post, pay when shown).', params: { q: S('Title contains') } },
  { name: 'openings.add', method: 'POST', preview: 'lib_hiring_jobs.previewAdd', fn: 'lib_hiring_jobs.add', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Draft an opening from an approved --requisition, like an earlier one (--copy_from) or directly (--entity --title); post in --description (markdown). Open: openings.set-status.', params: Object.assign({ requisition: S('Approved requisition id or number'), copy_from: S('An earlier opening to start from (post, place, pay, stages, team)'), entity: S('Entity (for a direct opening)'), stages: S('JSON list of stages [{name, kind}] (default from settings)') }, FIELDS) },
  { name: 'openings.update', method: 'POST', fn: 'lib_hiring_jobs.update', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', preview: 'lib_hiring_jobs.previewUpdate', effect: 'write', desc: 'Change an opening: the job post (markdown description), place, remote mode, type, pay range, positions, hiring manager, team. Your AI agent drafts or improves job posts with it.', params: Object.assign({ opening: OPENING, currency: S('Currency of the pay range') }, FIELDS) },
  { name: 'openings.stages', method: 'POST', preview: 'lib_hiring_jobs.previewStages', fn: 'lib_hiring_jobs.setStages', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Set the pipeline stages of an opening (rename, add, reorder, remove; first kind applied, last kind hired). Candidates in a removed stage move where --moves says.', params: { opening: OPENING, stages: S('JSON list [{key, name, kind, kit}] (keep keys to keep candidates)', { required: true }), moves: S('JSON {"<removed key>":"<new key>"}') } },
  { name: 'openings.set-status', method: 'POST', fn: 'lib_hiring_jobs.setStatus', perm: 'hiring:full', agent: 'deny', effect: 'write', desc: 'Open an opening, put it on hold, close it (filled, cancelled, other) or move an empty one back to draft. Closing says how many candidates are active.', params: { opening: OPENING, status: S('open | on_hold | closed | draft', { required: true, enum: ['open', 'on_hold', 'closed', 'draft'] }), close_reason: S('filled | cancelled | other', { enum: ['filled', 'cancelled', 'other'] }) } },
  { name: 'openings.delete', method: 'POST', fn: 'lib_hiring_jobs.remove', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an opening that has no candidates (close it otherwise).', params: { opening: OPENING } },
  { name: 'openings.draft-post', method: 'POST', fn: 'lib_hiring_jobs.draftPost', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Ask your AI agent to draft or improve the job post (the job_post_draft trigger with the opening); its draft comes back as a proposal on openings.update. Asked once while that ask is open.', params: { opening: OPENING, notes: S('What to stress or change') } },

  { name: 'interview-kits.list', method: 'GET', fn: 'lib_hiring_jobs.kitsList', perm: 'hiring:view', effect: 'read', desc: 'Interview kits (criteria and questions): the shared ones, or with --opening also that opening\'s own.', params: { opening: S('Opening'), archived: B('Include archived shared kits') } },
  { name: 'interview-kits.save', method: 'POST', preview: 'lib_hiring_jobs.previewKit', fn: 'lib_hiring_jobs.kitsSave', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Add or change an interview kit: name, kind, minutes, criteria [{name, description}] scored 1 to 4, questions [{text, criterion, guidance}]. --opening ties it to an opening.', params: { kit: S('Kit id (empty to add)'), opening: S('Opening (empty for a shared kit)'), name: S('Name'), kind: S('phone | video | onsite | technical | panel | other', { enum: ['phone', 'video', 'onsite', 'technical', 'panel', 'other'] }), duration_min: N('Minutes'), criteria: S('JSON list [{key, name, description}]'), questions: S('JSON list [{text, criterion, guidance}]'), archived: B('Archived') } },
  { name: 'interview-kits.delete', method: 'POST', fn: 'lib_hiring_jobs.kitsDelete', perm: 'hiring:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove an interview kit (archived instead when interviews used it).', params: { kit: S('Kit id', { required: true }) } },
];
