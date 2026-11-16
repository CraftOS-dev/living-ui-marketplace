/**
 * Catalog: letter templates and letters.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const KINDS = ['offer', 'appointment', 'confirmation', 'experience', 'salary_certificate', 'warning', 'relieving', 'custom'];
const KIND = S(KINDS.join(' | '), { enum: KINDS });
const LETTER = S('Letter id or number (L0001)', { required: true });
const TEMPLATE = S('Letter template id or name', { required: true });
const PERSON = { employee: S('Employee number (E0001), id or work email'), employment: S('Employment (for a person with several)') };

module.exports = [
  { name: 'letter-templates.list', method: 'GET', fn: 'lib_lifecycle_letters.templatesList', perm: 'people:view', effect: 'read', desc: 'Letter templates by kind (offer, appointment, confirmation, experience, salary certificate, warning, relieving, custom) with the placeholders they use, and the list of placeholders.', params: { kind: KIND, country: S('Country code (its own and the shared templates)'), archived: B('Include archived templates') } },
  { name: 'letter-templates.get', method: 'GET', fn: 'lib_lifecycle_letters.templatesGet', perm: 'people:view', effect: 'read', desc: 'One letter template with its body.', params: { template: TEMPLATE } },
  {
    name: 'letter-templates.save',
    method: 'POST',
    fn: 'lib_lifecycle_letters.templatesSave',
    perm: 'people:edit',
    agent: 'propose',
    kind: 'people',
    diff: { collection: 'letter_templates', id: 'template', fields: { name: 'name', kind: 'kind', body: 'body', needs_ack: 'needs_ack', archived: 'archived' } },
    effect: 'write',
    desc: 'Add or change a letter template: markdown with placeholders such as {{employee.name}}, or {{letter.<word>}} for a value given with each letter (letter-templates.list lists them).',
    params: { template: S('Template id or name (empty to add one)'), kind: KIND, name: S('Name'), country: S('Country code (empty = every country)'), entity: S('Entity (empty = every entity)'), language: S('en | ja', { enum: ['en', 'ja'] }), description: S('What it is for'), body: S('The letter in markdown with {{placeholders}}'), needs_ack: B('Letters from it ask the person to acknowledge'), archived: B('Archived templates are not offered') },
  },
  { name: 'letter-templates.delete', method: 'POST', fn: 'lib_lifecycle_letters.templatesDelete', perm: 'people:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a letter template no letter was written from (archive a used one instead).', params: { template: TEMPLATE } },

  { name: 'letters.list', method: 'GET', fn: 'lib_lifecycle_letters.lettersList', perm: 'signed', effect: 'read', desc: 'Letters: HR sees drafts and issued letters in their entities; a person sees the letters issued to them.', params: { status: S('draft | issued | void | all (default, without void)', { enum: ['draft', 'issued', 'void', 'all'] }), kind: KIND, employee: S('Employee'), q: S('Title, number or name contains'), limit: N('Rows (default 50)'), offset: N('Rows to skip') } },
  { name: 'letters.get', method: 'GET', fn: 'lib_lifecycle_letters.lettersGet', perm: 'signed', effect: 'read', desc: 'One letter with its text filled in (drafts: the values still missing; issued: the frozen text) and what the print page needs.', params: { letter: LETTER } },
  { name: 'letters.preview', method: 'GET', fn: 'lib_lifecycle_letters.lettersPreview', perm: 'people:view', effect: 'read', desc: 'Fill a template (or a body) for a person without saving: the text, the missing values, the pay values hidden from the caller.', params: Object.assign({ template: S('Template id or name'), body: S('Markdown with placeholders (instead of a template)'), letter_day: S('Letter date (default today)'), values: S('JSON values for {{letter.<word>}} placeholders') }, PERSON) },
  { name: 'letters.draft', method: 'POST', fn: 'lib_lifecycle_letters.lettersDraft', perm: 'people:edit', agent: 'propose', kind: 'people', preview: 'lib_lifecycle_letters.previewDraft', effect: 'write', desc: 'Draft a letter for a person from a template (--template, or --kind: that kind\'s template for their entity, country or company) or your own markdown --body. A person issues it.', params: Object.assign({ template: S('Template id or name'), kind: KIND, title: S('Title'), body: S('Markdown with placeholders (instead of the template text)'), letter_day: S('Letter date (default today)'), values: S('JSON values for {{letter.<word>}} placeholders, e.g. {"purpose":"a bank loan"}'), needs_ack: B('Ask the person to acknowledge it'), note: S('Note for HR') }, PERSON) },
  { name: 'letters.update', method: 'POST', fn: 'lib_lifecycle_letters.lettersUpdate', perm: 'people:edit', agent: 'propose', kind: 'people', diff: { collection: 'letters', id: 'letter', fields: { title: 'title', body: 'body', letter_day: 'letter_day', needs_ack: 'needs_ack' } }, effect: 'write', desc: 'Change a draft letter: title, text, date, values, acknowledgement. Your AI agent writes the text of a requested draft with this.', params: { letter: LETTER, title: S('Title'), body: S('Markdown with placeholders'), kind: KIND, letter_day: S('Letter date'), values: S('JSON values for {{letter.<word>}} placeholders (merged)'), needs_ack: B('Ask the person to acknowledge it'), note: S('Note for HR') } },
  { name: 'letters.request-draft', method: 'POST', fn: 'lib_lifecycle_letters.lettersRequestDraft', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Ask your AI agent to draft a letter no template covers: a draft is made at once and your AI agent is asked to write its text (the letter_draft trigger with the letter). HR issues it.', params: Object.assign({ instructions: S('What the letter is for and what it must say', { required: true }), kind: KIND, title: S('Title'), template: S('A template to start from'), letter_day: S('Letter date') }, PERSON) },
  { name: 'letters.issue', method: 'POST', fn: 'lib_lifecycle_letters.lettersIssue', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Issue a draft: frozen with today\'s data, signed by you, filed with the person, who is told. Refused if values are missing or it shows pay hidden from you.', params: { letter: LETTER, needs_ack: B('Ask the person to acknowledge it'), notify: B('Tell the person (default true)') } },
  { name: 'letters.void', method: 'POST', fn: 'lib_lifecycle_letters.lettersVoid', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Void an issued letter (it leaves the person\'s documents; the record stays).', params: { letter: LETTER, reason: S('Why', { required: true }) } },
  { name: 'letters.delete', method: 'POST', fn: 'lib_lifecycle_letters.lettersDelete', perm: 'people:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a draft letter.', params: { letter: LETTER } },
  { name: 'letters.acknowledge', method: 'POST', fn: 'lib_lifecycle_letters.lettersAcknowledge', perm: 'self', agent: 'deny', effect: 'write', desc: 'The person confirms they read a letter issued to them.', params: { letter: LETTER } },
];
