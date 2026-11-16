/**
 * Catalog: the diligence checklist (diligence module). Your AI agent reads
 * a deal's checklist, applies a checklist, proposes questions and answers
 * open questions with citations (its answers wait as proposed); only people
 * confirm or reject an answer.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const DEAL = S('Deal id or D-0001', { required: true, example: 'D-0001' });

module.exports = [
  {
    name: 'dd.get',
    method: 'GET',
    fn: 'lib_diligence.opGet',
    perm: 'diligence:view',
    effect: 'read',
    desc: "A deal's checklist: questions by area with the answer shown (value, unit, grade, num_kind, cites with quotes, sources, status), progress per area, the room (files, pages read, pages needing OCR) and your AI agent's ask (its state). --state open lists only unanswered questions.",
    params: { deal: DEAL, state: S('Only questions in this state', { enum: ['open', 'proposed', 'confirmed', 'all'] }), area: S('Only this area key, e.g. traction') },
  },
  {
    name: 'dd.templates',
    method: 'GET',
    fn: 'lib_diligence.opTemplates',
    perm: 'diligence:view',
    effect: 'read',
    desc: 'The checklists (seed, series_a and the firm\'s own): areas and, with --full, every question with its key, type (text, number, yes_no, date) and unit (money, %, or a word).',
    params: { full: B('true: include the questions'), all: B('true: archived ones too') },
  },
  {
    name: 'dd.template-save',
    method: 'POST',
    fn: 'lib_diligence.opTemplateSave',
    perm: 'settings:edit|diligence:full',
    agent: 'propose',
    kind: 'templates',
    preview: 'lib_diligence.previewTemplateSave',
    effect: 'write',
    desc: 'Create or change a checklist: --name, --areas \'[{"key","label"}]\', --questions \'[{"key","area","text","type","unit"}]\' (the whole list), --archived. For you it is a proposal.',
    params: { template: S('Checklist key or id (omit to create)'), name: S('Checklist name'), areas: S('JSON list of {key, label}'), questions: S('JSON list of {key, area, text, type, unit}'), archived: B('true: hide it') },
  },
  {
    name: 'dd.template-apply',
    method: 'POST',
    fn: 'lib_diligence.opTemplateApply',
    perm: 'diligence:edit',
    effect: 'write',
    desc: 'Add a checklist\'s questions to a deal (default: seed for pre-seed and seed rounds, series_a later). Questions already there are kept. Your AI agent is asked to answer when the room has files.',
    params: { deal: DEAL, template: S('Checklist key or id (default by the round)') },
  },
  {
    name: 'dd.questions-save',
    method: 'POST',
    fn: 'lib_diligence.opQuestionsSave',
    perm: 'diligence:edit',
    agent: 'propose',
    kind: 'dd_questions',
    preview: 'lib_diligence.previewQuestionsSave',
    effect: 'write',
    desc: 'Add or change questions on a deal: --questions \'[{"area":"traction","text":"Logo churn","type":"number","unit":"%"}]\' (with "question":"<id>" to change one); --remove \'["<id>"]\'. Types: text, number, yes_no, date. For you it is a proposal.',
    params: { deal: DEAL, questions: S('JSON list of {question?, area, area_label?, text, type, unit}'), remove: S('JSON list of question ids to remove') },
  },
  {
    name: 'dd.answer',
    method: 'POST',
    fn: 'lib_diligence.opAnswer',
    perm: 'diligence:edit',
    effect: 'write',
    desc: 'Answer questions: --answers \'[{"question","value","unit","num_kind":"quoted|external","grade","anchors":[ids or {"file","page","lines"|"quote"}],"sources":[links],"note"}]\' or {"question","not_found":true,"note"}. Yours wait as proposed and must cite; you never compute a number. One bad item refuses all, each named. Grid cells: grid, company, column.',
    params: { answers: S('JSON list of answers'), rest_not_found: S('Every other open question of the deal is checked not found, with this note (where you looked)'), deal: S('With --rest_not_found: the deal (default: the deal of the answers)') },
  },
  {
    name: 'dd.confirm',
    method: 'POST',
    fn: 'lib_diligence.opConfirm',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'A person confirms proposed answers (one, or a list; --grade high confirms only the high-grade ones of the list and leaves the rest waiting). An answer replaced since is skipped as stale.',
    params: { answer: S('Answer id'), answers: S('JSON list of answer ids'), grade: S('high: only the high-grade answers of the list (artifact or public); all (default)', { enum: ['high', 'all'] }) },
  },
  {
    name: 'dd.reject',
    method: 'POST',
    fn: 'lib_diligence.opReject',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'A person rejects an answer; its question opens again (unless a confirmed answer remains).',
    params: { answer: S('Answer id'), answers: S('JSON list of answer ids'), reason: S('Why', { enum: ['wrong', 'unsupported', 'outdated', 'other'] }) },
  },
  {
    name: 'dd.ask',
    method: 'POST',
    fn: 'lib_diligence.opAsk',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    track: false,
    desc: 'Ask your AI agent to answer the deal\'s open questions now (trigger diligence_answers, one for the deal); answers the request and its progress. 409 while it waits for an answer, on a cooldown or in a demo firm.',
    params: { deal: DEAL, again: S('The request id a screen saw done or rejected: ask once more') },
  },
];
