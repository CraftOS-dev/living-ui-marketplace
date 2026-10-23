/**
 * Catalog: the app itself (guide, status, Home), settings, activity and the
 * search palette. Plain data, read by lib_catalog.js and tools/gen.mjs.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'demo.preview', method: 'GET', fn: 'lib_demo.preview', effect: 'read', desc: 'Read-only preview of a complete research-data reset: counts, a fingerprint and the four synthetic demo projects. Preserves users, settings, integrations and schema. Confidential projects block agent access.', params: {} },
  { name: 'demo.reset', method: 'POST', fn: 'lib_demo.reset', effect: 'change', destructive: true, desc: 'Only on an explicit user request: permanently replace research data and attachments with four labeled synthetic demo projects. Preview first. Requires exact phrase, acknowledgement, unchanged preview fingerprint and agent confirmation. No optional backup; never invoke from a trigger.', params: { phrase: S('Type RESET AND LOAD DEMO exactly', { required: true }), acknowledge: B('Acknowledge irreversible deletion without an optional backup', { required: true }), fingerprint: S('Fingerprint from a fresh demo.preview', { required: true }) } },
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', effect: 'read', desc: 'START HERE: conventions, the claims grammar, highlight colors, what your AI agent may do, the error codes and ready-to-run recipes (identify PDFs, read scans, map claims, answer, search, plan and analyze experiments, draft, screen, work the to-do list, use the research repository).', params: { topic: S('One recipe in full (identify, ocr, claims, answer, access, search, feeds, experiment, draft, support, responses, screening, references, tasks, repository)') } },
  { name: 'app.status', method: 'GET', fn: 'lib_settings.status', effect: 'read', desc: 'Counts the frame shows: what needs a person, files being read, papers resolving, projects.', params: {} },
  { name: 'home.summary', method: 'GET', fn: 'lib_settings.home', effect: 'read', desc: 'Everything Home shows: library numbers, continue reading, recently added, projects, needs-you counts, recent activity, new candidates.', params: {} },
  { name: 'find.all', method: 'GET', fn: 'lib_guide.find', effect: 'read', desc: 'Search everything at once (papers, projects, notes, claims) for the palette.', params: { q: S('What to find', { required: true }), limit: N('At most this many per kind (default 6)') } },
  { name: 'settings.get', method: 'GET', fn: 'lib_settings.get', effect: 'read', desc: 'Highlight colors and their meanings, the citation style, the contact email for registries, your AI agent limits.', params: {} },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_settings.update',
    effect: 'admin',
    agent: 'deny',
    desc: 'Change settings: highlight meanings, citation style, contact email, daily limits for your AI agent, automatic identification, OCR and open-access downloads.',
    params: {
      highlight_slots: S('JSON list [{"slot":1,"meaning":"Key point","hue":"yellow"}]'),
      citation_style: S('Default style', { enum: ['apa', 'chicago', 'harvard', 'ieee', 'vancouver', 'mla', 'nature'] }),
      contact_email: S('Email sent to Crossref and OpenAlex for their polite pool ("" to send none)'),
      node_cap: N('Daily limit on claims, evidence and links your AI agent proposes'),
      auto_identify: B('Ask your AI agent to identify new PDFs'),
      auto_ocr: B('Ask your AI agent to read scanned pages'),
      auto_oa: B('Download open-access PDFs when a paper is added'),
      welcome_done: B('Hide the first-run card'),
    },
  },
  {
    name: 'activity.list',
    method: 'GET',
    fn: 'lib_activity.list',
    effect: 'read',
    desc: 'What changed, newest first: who (person, agent, system), what, on which record.',
    params: { actor: S('Who', { enum: ['person', 'agent', 'system'] }), target: S('Kind of record (works, nodes, files, ...)'), record: S('One record id'), project: S('Project id'), since: S('Only after this timestamp'), limit: N('Rows (default 50)'), offset: N('Skip rows') },
  },
  { name: 'activity.undo', method: 'POST', fn: 'lib_activity.undo', effect: 'change', desc: 'Undo one change (--entry) or a whole batch (--batch) when it can be undone. Your AI agent undoes only its own.', params: { entry: S('Activity entry id'), batch: S('Batch id from an earlier answer') } },
  { name: 'files.engine-test', method: 'GET', fn: 'lib_files.engineTest', effect: 'read', desc: 'Check the text engine on this machine (Node and pdf.js) and how many PDFs wait to be read.', params: {} },
];
