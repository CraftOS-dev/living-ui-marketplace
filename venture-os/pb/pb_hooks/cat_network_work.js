/**
 * Catalog: intros, meeting briefs and the calendar (SPEC 7.5). A person
 * asks for an intro and records its outcome; your AI agent drafts the ask
 * (sending is the kernel's outbound, people only). Briefs are written by
 * your AI agent when asked (trigger meeting_brief), or by a person.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const INTRO = S('Intro id', { required: true });
const STATUSES = ['requested', 'drafted', 'sent', 'failed', 'made', 'declined', 'no_answer', 'cancelled', 'open', 'all'];

module.exports = [
  {
    name: 'intros.request',
    method: 'POST',
    fn: 'lib_network_work.opRequest',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'intros',
    preview: 'lib_network_work.previewRequest',
    effect: 'write',
    desc: 'Ask for an intro to --target through one path of network.paths: --via the member on it, --connector the person in the middle (none for a direct path). Your AI agent is asked to draft the ask (trigger intro_draft); it waits in Next for approval. For you it is a proposal: the person who accepts asks, then you are asked for the draft.',
    params: { target: S('The person to meet (id or email)', { required: true }), via: S('The member on the path (email or id)', { required: true }), connector: S('The person in the middle (id or email; empty for a direct path)'), company: S('The company searched for (id, domain or name)'), deal: S('Deal id or number (default: the target company\'s open deal)'), note: S('A line for the draft, e.g. why now') },
  },
  {
    name: 'intros.draft',
    method: 'POST',
    fn: 'lib_network_work.opDraft',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Draft the intro ask as an outbound message (kind intro) to the intro\'s recipient: a short ask plus a forwardable blurb. The asker approves and sends it from Next; you never send.',
    params: { intro: INTRO, subject: S('Subject', { required: true }), body: S('The ask, then the forwardable blurb', { required: true }) },
  },
  {
    name: 'intros.outcome',
    method: 'POST',
    fn: 'lib_network_work.opOutcome',
    perm: 'network:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Record how an intro went: made, declined or no_answer. People only.',
    params: { intro: INTRO, outcome: S('made, declined or no_answer', { required: true, enum: ['made', 'declined', 'no_answer'] }) },
  },
  {
    name: 'intros.cancel',
    method: 'POST',
    fn: 'lib_network_work.opCancel',
    perm: 'network:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Cancel an intro not yet sent (its draft goes too). People only.',
    params: { intro: INTRO },
  },
  {
    name: 'intros.list',
    method: 'GET',
    fn: 'lib_network_work.opListIntros',
    perm: 'network:view',
    effect: 'read',
    desc: 'Intros, newest first: to or through a --person, to a --company, by --status (open = asked, drafted or sent), --mine true for the ones you asked.',
    params: { person: S('Person id or email'), company: S('Company id, domain or name'), status: S('A status, open or all', { enum: STATUSES }), mine: B('true: only intros you asked for'), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'intros.get',
    method: 'GET',
    fn: 'lib_network_work.opGetIntro',
    perm: 'network:view',
    effect: 'read',
    desc: 'One intro: target, path (members, people, strength on each edge), who asked, the recipient, the draft and its status, the outcome.',
    params: { intro: INTRO },
  },
  {
    name: 'briefs.list',
    method: 'GET',
    fn: 'lib_network_work.opListBriefs',
    perm: 'network:view',
    effect: 'read',
    desc: 'Meeting briefs with their state (queued, reading, ready, failed). With --deal or --company: every meeting of it, the latest first; otherwise from --from_at (default yesterday), the soonest first.',
    params: { deal: S('Deal id or number'), company: S('Company id, domain or name'), from_at: S('ISO time'), state: S('queued, reading, ready, failed or all', { enum: ['queued', 'reading', 'ready', 'failed', 'all'] }), limit: N('Rows (default 50)') },
  },
  {
    name: 'briefs.get',
    method: 'GET',
    fn: 'lib_network_work.opGetBrief',
    perm: 'network:view',
    effect: 'read',
    desc: 'One brief by --brief or --event: the meeting, attendees with the firm\'s strength and best member, the company and deal, the written sections (who, history, deal, questions, news with links) and its state.',
    params: { brief: S('Brief id'), event: S('Calendar event id') },
  },
  {
    name: 'briefs.request',
    method: 'POST',
    fn: 'lib_network_work.opRequestBrief',
    perm: 'network:view',
    effect: 'write',
    desc: 'Ask your AI agent for the brief of an external meeting now. A brief being prepared or ready is answered as it is (--again true asks again).',
    params: { event: S('Calendar event id', { required: true }), again: B('true: ask again even when a brief exists') },
  },
  {
    name: 'briefs.save',
    method: 'POST',
    fn: 'lib_network_work.opSaveBrief',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Write a brief\'s sections: {"who":[{"name","email","person","text"}],"history":"...","deal":"...","questions":["..."],"news":[{"title","url","day","source"}]}. Short plain text; every news item has its link. Numbers about the firm come from the app, not the text.',
    params: { brief: S('Brief id'), event: S('Calendar event id (instead of --brief)'), sections: S('JSON object of the sections', { required: true }) },
  },
  {
    name: 'calendar.list',
    method: 'GET',
    fn: 'lib_network_work.opCalendar',
    perm: 'network:view',
    effect: 'read',
    desc: 'Your meetings from --day (default today) for --days (default 1), external ones unless --all true, with attendees, company, deal and each brief\'s state.',
    params: { day: S('YYYY-MM-DD'), days: N('Days (1 to 14)'), all: B('true: internal meetings too') },
  },
  {
    name: 'calendar.add-note',
    method: 'POST',
    fn: 'lib_network_work.opAddNote',
    perm: 'network:view',
    agent: 'deny',
    effect: 'write',
    desc: 'Open the note of a meeting that ended (the deal\'s note, else the company\'s): answers the link to open; the Next item goes. People only.',
    params: { event: S('Calendar event id', { required: true }) },
  },
  {
    name: 'calendar.skip-note',
    method: 'POST',
    fn: 'lib_network_work.opSkipNote',
    perm: 'network:view',
    agent: 'deny',
    effect: 'write',
    desc: 'No note for a meeting that ended; the Next item goes. People only.',
    params: { event: S('Calendar event id', { required: true }) },
  },
];
