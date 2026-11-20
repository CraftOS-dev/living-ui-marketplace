/**
 * Catalog: meeting notes and their templates (deals module). A person
 * writes a note in a template's sections and may attach a transcript; Ask
 * your AI agent on a saved note asks for its review (trigger note_review):
 * it writes the summary (notes.summary-save), proposes deal changes with their quotes
 * (deals.update), opens tasks for stated next steps (tasks.save) and logs
 * references (refs.log). Your AI agent never edits a person's note.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const CONSENT = ['informed', 'not_recorded', 'unknown'];
const NOTE = S('Note id', { required: true });
const WRITE = 'pipeline:edit|portfolio:edit';
const SECTIONS = S('JSON object of section key to text, e.g. {"team":"Two founders...","next_steps":"..."} (notes.templates lists the keys)');

module.exports = [
  {
    name: 'notes.templates',
    method: 'GET',
    fn: 'lib_deals_notes.opTemplates',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: 'Note templates (First call, Partner meeting, Reference, Board, Free, and the firm\'s own): each with its sections (key and label) and the stages it is the default for.',
  },
  {
    name: 'notes.template-save',
    method: 'POST',
    fn: 'lib_deals_notes.opTemplateSave',
    perm: 'settings:edit',
    agent: 'propose',
    kind: 'templates',
    effect: 'write',
    desc: 'Add a note template (no --template) or change one: --name, --sections \'["Team","Product"]\' (a kept label keeps its key), --stages \'["first_meeting"]\' (stages it opens for), --archived. For you it is a proposal.',
    params: { template: S('Template key or id (empty to add one)'), name: S('Template name'), sections: S('JSON list of section labels (or {"key","label"})'), stages: S('JSON list of stage keys this template is the default for'), archived: B('true: hide it from new notes') },
  },
  {
    name: 'notes.list',
    method: 'GET',
    fn: 'lib_deals_notes.opList',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: 'Notes of a deal (--deal) or a company (--company), newest meeting first: template, author, day, consent, transcript state, status (draft or saved), summary and the review state (Saved, Reading, Summary, Ready). hidden counts notes of restricted deals you may not see.',
    params: { deal: S('Deal id or D-0001'), company: S('Company id, domain or name'), author: S('"me" for my notes'), status: S('draft, saved or all (default)', { enum: ['draft', 'saved', 'all'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'notes.get',
    method: 'GET',
    fn: 'lib_deals_notes.opGet',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: 'One note in full: its template sections and the person\'s text, the transcript (with its text for you), consent, the summary and the review: proposals (each change with its quote and state) and tasks it opened.',
    params: { note: NOTE, text: B('true: include the transcript text (always for your AI agent)') },
  },
  {
    name: 'notes.create',
    method: 'POST',
    fn: 'lib_deals_notes.opCreate',
    perm: WRITE,
    agent: 'allow',
    effect: 'write',
    desc: 'Start a note on a deal (or --company without a deal). The template defaults to the one for the deal\'s stage (First call early, Partner meeting later). --cal_event ties it to a meeting: asked again, the same note answers. --save true finishes it at once (then reviewed).',
    params: { deal: S('Deal id or D-0001'), company: S('Company id, domain or name (a note without a deal)'), template: S('Template key: first_call, partner_meeting, reference, board, free...'), title: S('A short title'), meeting_day: S('Meeting day YYYY-MM-DD (default today)'), consent: S('Did the meeting know it was recorded', { enum: CONSENT }), sections: SECTIONS, cal_event: S('The meeting (network calendar event id)'), save: B('true: the note is finished (Ask your AI agent then reviews it)') },
  },
  {
    name: 'notes.update',
    method: 'POST',
    fn: 'lib_deals_notes.opUpdate',
    perm: WRITE,
    agent: 'allow',
    effect: 'write',
    desc: 'Autosave a note: --sections (merged by key; empty text clears a section), --title, --meeting_day, --consent, --template (only while empty). --save true finishes it; notes.review then asks your AI agent for its review. You change only notes you wrote; a person\'s note is never yours to edit.',
    params: { note: NOTE, sections: SECTIONS, title: S('A short title'), meeting_day: S('Meeting day YYYY-MM-DD'), consent: S('Did the meeting know it was recorded', { enum: CONSENT }), template: S('Template key (only while the note is empty)'), save: B('true: the note is finished (Ask your AI agent then reviews it)') },
  },
  {
    name: 'notes.review',
    method: 'POST',
    fn: 'lib_deals_notes.opReview',
    perm: WRITE,
    agent: 'deny',
    effect: 'write',
    desc: 'Ask your AI agent to review a saved note now (trigger note_review: summary, proposed changes, tasks). 409 while it waits for an answer (Retry after 24 hours, or --again <request id> once it was done or rejected), on a cooldown or in a demo firm.',
    params: { note: NOTE, again: S('The request id a screen saw done or rejected: ask once more') },
  },
  {
    name: 'notes.attach-transcript',
    method: 'POST',
    fn: 'lib_deals_notes.opAttachTranscript',
    perm: WRITE,
    agent: 'allow',
    effect: 'write',
    files: ['file'],
    bodyLimit: 26214400,
    desc: 'Attach a meeting transcript (.txt, .vtt, .srt or .docx from any notetaker) to a note: people upload (field file), you give --path. Its text is read in the background; a saved note is reviewed once it is ready. --consent sets whether the meeting knew it was recorded.',
    params: { note: NOTE, path: S('Absolute local path of the transcript (your AI agent)'), consent: S('Did the meeting know it was recorded', { enum: CONSENT }) },
  },
  {
    name: 'notes.summary-save',
    method: 'POST',
    fn: 'lib_deals_notes.opSummarySave',
    perm: WRITE,
    agent: 'allow',
    effect: 'write',
    desc: 'Save a note\'s summary in its template\'s sections (--sections, merged by key; --headline one line) and link what the review made: --proposals (deals.update proposal ids), --tasks (task ids), --refs (reference ids). Never the person\'s own text.',
    params: { note: NOTE, headline: S('One line'), sections: SECTIONS, proposals: S('JSON list of proposal ids from deals.update'), tasks: S('JSON list of task ids from tasks.save'), refs: S('JSON list of reference ids from refs.log') },
  },
  {
    name: 'notes.delete',
    method: 'POST',
    fn: 'lib_deals_notes.opDelete',
    perm: WRITE,
    agent: 'deny',
    effect: 'write',
    destructive: true,
    desc: 'Move a note to the trash (its author or the owner). Undo brings it back.',
    params: { note: NOTE },
  },
];
