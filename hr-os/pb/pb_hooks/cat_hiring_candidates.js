/**
 * Catalog: candidates (one per email, resume, consent, retention) and their
 * applications to openings (move, reject, withdraw, reopen, message, link a
 * hire). Your AI agent may add and import candidates from files it was
 * given; moving, rejecting and hiring are people only.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const CANDIDATE = S('Candidate id or email', { required: true });
const SOURCES = ['applied', 'referral', 'sourced', 'agency', 'job_board', 'career_site', 'event', 'internal', 'import', 'other'];

const PERSON = {
  name: S('Full name'),
  email: S('Email (one candidate per email)'),
  phone: S('Phone'),
  location: S('Where they live'),
  current_title: S('Current job title'),
  current_company: S('Current employer'),
  source: S(SOURCES.join(' | '), { enum: SOURCES }),
  source_detail: S('Which board, agency, event or person'),
  links: S('JSON list of web addresses (LinkedIn, portfolio)'),
  tags: S('JSON list of tags'),
  consent: B('Agreed to be kept on file for future roles'),
  consent_at: S('When they agreed (default now)'),
  notes: S('Notes for the hiring team'),
  owner: S('Recruiter who owns the candidate (member id or email)'),
  country: S('Country whose retention rule applies (two letters; default the entity of their opening)'),
};
const BULK = { application: S('Application id'), applications: S('JSON list of application ids (bulk)') };

module.exports = [
  { name: 'candidates.list', method: 'GET', fn: 'lib_hiring_candidates.list', perm: 'hiring:view', effect: 'read', desc: 'Candidates the caller may see with their applications. Views: all, active (in process), pool (nothing open), hired, retention (past the retention day, to review), mine.', params: { view: S('all | active | pool | hired | retention | mine', { enum: ['all', 'active', 'pool', 'hired', 'retention', 'mine'] }), opening: S('Only candidates on this opening'), source: S('Source'), tag: S('Tag'), q: S('Name, email, title, company or tag contains'), email: S('Exact email'), sort: S('recent | name | retention', { enum: ['recent', 'name', 'retention'] }), limit: N('Rows'), offset: N('Rows to skip') } },
  { name: 'candidates.get', method: 'GET', fn: 'lib_hiring_candidates.get', perm: 'signed', effect: 'read', desc: 'A candidate profile: details, applications with interviews, scorecards (as the caller may see them), offers, timeline and referral. Interviewers see the basics and their own interviews.', params: { candidate: CANDIDATE } },
  { name: 'candidates.check', method: 'GET', fn: 'lib_hiring_candidates.check', perm: 'hiring:view', effect: 'read', desc: 'Is this email already a candidate? (duplicate check before adding)', params: { email: S('Email', { required: true }) } },
  { name: 'candidates.add', method: 'POST', fn: 'lib_hiring_candidates.add', perm: 'hiring:edit', effect: 'write', desc: 'Add a candidate (duplicate_candidate when the email exists: use applications.add). With --opening they join its first stage. Your AI agent adds people from CVs or lists given; never judges.', params: Object.assign({}, PERSON, { opening: S('Also put them on this opening'), stage: S('Stage on the opening (people only; default the first)') }) },
  { name: 'candidates.update', method: 'POST', fn: 'lib_hiring_candidates.update', perm: 'hiring:edit', effect: 'write', desc: 'Change a candidate\'s details, tags, consent or owner. Consent changes the retention day.', params: Object.assign({ candidate: CANDIDATE }, PERSON) },
  { name: 'candidates.note', method: 'POST', fn: 'lib_hiring_candidates.note', perm: 'hiring:view', effect: 'write', desc: 'Add a note to a candidate\'s timeline (optionally about one application). Facts only.', params: { candidate: CANDIDATE, text: S('Note', { required: true }), application: S('Application it is about') } },
  { name: 'candidates.resume', method: 'GET', fn: 'lib_hiring_candidates.resume', perm: 'signed', effect: 'read', desc: 'Open a candidate\'s resume (protected; your AI agent gets its path on this machine). Interviewers on their panel may open it.', params: { candidate: CANDIDATE, download: B('Download instead of view') } },
  { name: 'candidates.resume-set', method: 'POST', fn: 'lib_hiring_candidates.resumeSet', perm: 'hiring:edit', effect: 'write', files: ['resume'], desc: 'Attach a resume (upload field resume: PDF, Word, text or an image up to 15 MB; your AI agent gives --path), or remove it with --clear true.', params: { candidate: CANDIDATE, clear: B('Remove the resume'), path: S('Your AI agent: a file on this machine') } },
  { name: 'candidates.import', method: 'POST', fn: 'lib_hiring_candidates.importCsv', perm: 'hiring:edit', effect: 'write', files: ['file'], desc: 'Import candidates from a CSV (columns in app.guide --module hiring). Existing emails are never duplicated. --dry_run true reports only.', params: { csv: S('CSV text (or upload file, or --path)'), path: S('Your AI agent: a CSV file on this machine'), opening: S('Put everyone on this opening'), source: S('Source for rows without one (default import)', { enum: SOURCES }), dry_run: B('Report only, change nothing') } },
  { name: 'candidates.export', method: 'GET', fn: 'lib_hiring_candidates.exportCsv', perm: 'hiring:full', agent: 'deny', effect: 'read', desc: 'A CSV of the candidates the caller sees (one view).', params: { view: S('all | active | pool | hired | retention | mine', { enum: ['all', 'active', 'pool', 'hired', 'retention', 'mine'] }), opening: S('Only this opening') } },
  { name: 'candidates.delete', method: 'POST', fn: 'lib_hiring_candidates.remove', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete chosen candidates (retention review, wrong entries) with their applications, interviews, scorecards and offers. People who were hired are kept.', params: { candidate: S('Candidate id'), candidates: S('JSON list of candidate ids') } },

  { name: 'applications.list', method: 'GET', fn: 'lib_hiring_candidates.appsList', perm: 'hiring:view', effect: 'read', desc: 'Applications (a candidate on an opening) by opening, candidate, status or stage.', params: { opening: S('Opening'), candidate: S('Candidate'), status: S('active (default) | hired | rejected | withdrawn | all', { enum: ['active', 'hired', 'rejected', 'withdrawn', 'all'] }), stage: S('Stage key'), q: S('Name or email contains'), limit: N('Rows'), offset: N('Rows to skip') } },
  { name: 'applications.get', method: 'GET', fn: 'lib_hiring_candidates.appsGet', perm: 'signed', effect: 'read', desc: 'One application with its stages, interviews, visible scorecards and offers.', params: { application: S('Application id', { required: true }) } },
  { name: 'applications.add', method: 'POST', fn: 'lib_hiring_candidates.appsAdd', perm: 'hiring:edit', effect: 'write', desc: 'Put an existing candidate on an opening (its first stage; people may name another stage).', params: { candidate: CANDIDATE, opening: S('Opening id or number', { required: true }), stage: S('Stage key (people only)'), source: S('Source of this application'), owner: S('Recruiter (member id or email)') } },
  { name: 'applications.move', method: 'POST', fn: 'lib_hiring_candidates.move', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Move one or many candidates to a stage of their opening (key or name). The hired stage is reached only by hiring.', params: Object.assign({ stage: S('Stage key or name', { required: true }) }, BULK) },
  { name: 'applications.reject', method: 'POST', fn: 'lib_hiring_candidates.reject', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Reject one or many applications with a reason, optionally sending its message (or your own). Interviews ahead are cancelled; withdraw an open offer first.', params: Object.assign({ reason: S('Rejection reason (id or name)', { required: true }), note: S('Note for the team'), message: B('Send the message to the candidate'), subject: S('Subject (default the reason\'s)'), body: S('Message (default the reason\'s template)') }, BULK) },
  { name: 'applications.withdraw', method: 'POST', fn: 'lib_hiring_candidates.withdraw', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Record that candidates withdrew (reason of kind candidate optional). Interviews ahead are cancelled.', params: Object.assign({ reason: S('Reason (id or name)'), note: S('Note'), message: B('Send a message'), subject: S('Subject'), body: S('Message') }, BULK) },
  { name: 'applications.reopen', method: 'POST', fn: 'lib_hiring_candidates.reopen', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Bring a rejected or withdrawn application back into process at a stage.', params: { application: S('Application id', { required: true }), stage: S('Stage (default where it was)'), note: S('Why') } },
  { name: 'applications.message', method: 'POST', fn: 'lib_hiring_candidates.message', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Message one or many candidates (placeholders such as {{candidate_name}}, {{job_title}}). Kept on the timeline; emailed when candidate email is on.', params: Object.assign({ subject: S('Subject'), body: S('Message', { required: true }), send: B('Email it (default the settings)') }, BULK) },
  { name: 'applications.link-hire', method: 'POST', fn: 'lib_hiring_candidates.linkHire', perm: 'hiring:full', agent: 'deny', effect: 'write', desc: 'Link an employment to an application when the person was hired outside the offer flow: the application becomes hired and the opening and requisition fill.', params: { application: S('Application id', { required: true }), employment: S('Employment number or id', { required: true }) } },
];
