/**
 * Catalog: hiring home, settings (stages, retention, rejection reasons,
 * offer terms, letter templates) and the retention review list.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'hiring.home', method: 'GET', fn: 'lib_hiring.home', perm: 'signed', effect: 'read', desc: 'What needs the caller in hiring: openings with candidates per stage, interviews today and this week, scorecards owed, offers waiting, requisitions to open, offers to hire, candidates past retention.', params: {} },
  { name: 'hiring.settings', method: 'GET', fn: 'lib_hiring.settingsGet', perm: 'hiring:view', effect: 'read', desc: 'Hiring settings: default stages, retention days by country (and with consent), candidate email, rejection reasons, offer terms, letter templates and placeholders, Google Calendar connected.', params: {} },
  {
    name: 'hiring.settings-update',
    method: 'POST',
    fn: 'lib_hiring.settingsUpdate',
    perm: 'hiring:full',
    agent: 'deny',
    effect: 'write',
    desc: 'Change hiring settings: default stages, retention days per country (default and with consent), and whether candidate messages go by your AI agent\'s Gmail.',
    params: {
      default_stages: S('JSON list [{key, name, kind}] (kinds applied, screen, interview, offer, hired, other; first applied, last hired)'),
      retention: S('JSON {"US":365,"GB":180,...}: days to keep a candidate after their last application closes, by country'),
      retention_default: N('Days for countries not listed'),
      consent_days: N('Days when the candidate agreed to be kept for future roles'),
      email_candidates: B('Messages to candidates go out by email'),
    },
  },
  { name: 'hiring.retention', method: 'GET', fn: 'lib_hiring.retentionList', perm: 'hiring:full', effect: 'read', desc: 'Candidates past their retention day with nothing in process, oldest first. Nothing is deleted automatically: a person reviews and deletes with candidates.delete.', params: { limit: N('Rows (default 500)') } },
  { name: 'hiring.people', method: 'GET', fn: 'lib_hiring.people', perm: 'hiring:view', effect: 'read', desc: 'Active members to pick as interviewers, hiring managers or the hiring team: name, sign-in email, title, role.', params: { q: S('Name, email or title contains') } },
  { name: 'hiring.calendar', method: 'GET', fn: 'lib_hiring_interviews.calendarStatusOp', perm: 'signed', effect: 'read', desc: 'Whether Google Calendar is connected to your AI agent (interviews can then be added to it).', params: {} },

  { name: 'rejection-reasons.list', method: 'GET', fn: 'lib_hiring.reasonsList', perm: 'hiring:view', effect: 'read', desc: 'Reasons an application closes (kind company or candidate), each with an optional message template to the candidate.', params: { archived: B('Include archived reasons') } },
  { name: 'rejection-reasons.save', method: 'POST', preview: 'lib_hiring.previewReason', fn: 'lib_hiring.reasonsSave', perm: 'hiring:full', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Add or change a rejection reason and its message template (placeholders {{candidate_name}}, {{job_title}}, {{company}}, {{sender_name}}).', params: { reason: S('Reason id (empty to add)'), name: S('Name, e.g. "Role filled"'), kind: S('company | candidate', { enum: ['company', 'candidate'] }), subject: S('Email subject'), message: S('Message to the candidate'), sort: N('Order'), archived: B('Archived') } },
  { name: 'rejection-reasons.delete', method: 'POST', fn: 'lib_hiring.reasonsDelete', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a rejection reason (archived instead when applications used it).', params: { reason: S('Reason id', { required: true }) } },

  { name: 'offer-terms.list', method: 'GET', fn: 'lib_hiring.termsList', perm: 'hiring:view', effect: 'read', desc: 'Offer terms to pick for offers (probation, notice, confidentiality...). An offer keeps its own copy.', params: { archived: B('Include archived terms') } },
  { name: 'offer-terms.save', method: 'POST', preview: 'lib_hiring.previewTerm', fn: 'lib_hiring.termsSave', perm: 'hiring:full', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Add or change an offer term (text may use {{country}}, {{company}}, {{entity}}).', params: { term: S('Term id (empty to add)'), title: S('Title'), text: S('Text'), category: S('Category'), sort: N('Order'), archived: B('Archived') } },
  { name: 'offer-terms.delete', method: 'POST', fn: 'lib_hiring.termsDelete', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove an offer term (offers keep their copy).', params: { term: S('Term id', { required: true }) } },

  { name: 'offer-templates.list', method: 'GET', fn: 'lib_hiring.templatesList', perm: 'hiring:view', effect: 'read', desc: 'Offer letter templates (markdown with {{placeholders}}) and the placeholders they may use.', params: { archived: B('Include archived templates') } },
  { name: 'offer-templates.save', method: 'POST', preview: 'lib_hiring.previewTemplate', fn: 'lib_hiring.templatesSave', perm: 'hiring:full', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Add or change an offer letter template: markdown with placeholders such as {{candidate_name}}, {{title}}, {{start_day}}, {{pay}} (offer-templates.list lists them all).', params: { template: S('Template id (empty to add)'), name: S('Name'), body: S('Markdown with {{placeholders}}'), entity: S('Only for this entity (empty for all)'), is_default: B('The default template'), archived: B('Archived') } },
  { name: 'offer-templates.delete', method: 'POST', fn: 'lib_hiring.templatesDelete', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a letter template (archived instead when offers used it).', params: { template: S('Template id', { required: true }) } },
];
