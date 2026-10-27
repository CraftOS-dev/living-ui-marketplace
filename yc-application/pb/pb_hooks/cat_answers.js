/**
 * Catalog: the questions and the answers.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const KEY = S('Question key from answers.list (founder profile keys look like fp.<founder id>.impressive)', { required: true, example: 'c_desc' });
const SECTIONS = ['founders', 'company', 'progress', 'idea', 'equity', 'curious', 'profile'];

module.exports = [
  { name: 'questions.list', method: 'GET', fn: 'lib_answers.questions', effect: 'read', desc: 'The YC form: every question in order with its key, type (long, short, url, yesno, number, choice, months), limit, yes/no gate and who should write it (fill: your AI agent; draft: your AI agent drafts, a founder rewrites; founder: only a founder knows).', params: {} },
  {
    name: 'answers.list',
    method: 'GET',
    fn: 'lib_answers.list',
    effect: 'read',
    desc: 'Every question with its answer, who wrote it, whether a founder confirmed it, the reviewer\'s verdict and counts. --only missing|unconfirmed|flagged|needs narrows it (flagged: the reviewer or a failing check points at it); --brief true gives one line per question.',
    params: { section: S('Section', { enum: SECTIONS }), only: S('Which questions', { enum: ['all', 'missing', 'unconfirmed', 'flagged', 'needs'] }), brief: B('One line per question') },
  },
  { name: 'answers.get', method: 'GET', fn: 'lib_answers.get', effect: 'read', desc: 'One question with its answer, the reviewer\'s verdict (what a stranger understands, issues, missing parts, a shorter version) and counts.', params: { key: KEY } },
  {
    name: 'answers.set',
    method: 'POST',
    fn: 'lib_answers.set',
    effect: 'write',
    desc: 'Write an answer. yesno takes yes or no; number takes a number; choice one of the listed choices; months a JSON object {"2026-09":1200}. Your AI agent fills empty or unconfirmed answers; on an answer a founder wrote or confirmed its text is kept as a suggestion with --why.',
    params: {
      key: KEY,
      value: S('The answer ("" clears an unconfirmed one)', { required: true }),
      source: S('Your AI agent: where the facts come from, e.g. "acme.com/about; Jane\'s LinkedIn"'),
      need: S('Your question to the founders on this answer ("" clears it once answered)'),
      why: S('Your AI agent: why the founder should take your suggestion'),
    },
  },
  { name: 'answers.confirm', method: 'POST', fn: 'lib_answers.confirm', effect: 'confirm', agent: 'deny', press: '"Looks right" under each answer on the Answers step, or "Confirm all" above the list', desc: 'A founder marks answers as read and right: one --key or a whole --section.', params: { key: S('Question key'), section: S('Section', { enum: SECTIONS }) } },
  { name: 'answers.accept', method: 'POST', fn: 'lib_answers.accept', effect: 'confirm', agent: 'deny', press: '"Use it" in the "Your AI agent suggests" box under the answer', desc: 'A founder takes your AI agent\'s suggestion for an answer.', params: { key: KEY } },
  { name: 'answers.use-shorter', method: 'POST', fn: 'lib_answers.useShorter', effect: 'confirm', agent: 'deny', press: '"Use it" under "Shorter version" in the review of the answer', desc: 'A founder takes the reviewer\'s shorter version of an answer.', params: { key: KEY } },
  { name: 'answers.dismiss', method: 'POST', fn: 'lib_answers.dismiss', effect: 'write', desc: 'Drop the suggestion on an answer.', params: { key: KEY } },
  {
    name: 'answers.set-many',
    method: 'POST',
    fn: 'lib_answers.setMany',
    effect: 'write',
    desc: 'Write several answers (and questions for the founders) in one call: --items \'[{"key":"c_name","value":"Molarly","source":"molarly.example"}, {"key":"e_breakdown","need":"How do you split equity?"}, {"key":"p_users","value":"14","need":""}]\'. An item with "need" and no "value" only asks; "need":"" clears the question. Same rules as answers.set for each; the answer lists what was stored, kept as a suggestion, asked, or refused and why.',
    params: { items: S('JSON list of {key, value, source, why, need}', { required: true }) },
  },
  {
    name: 'answers.find',
    method: 'GET',
    fn: 'lib_answers.find',
    effect: 'read',
    desc: 'Which answers mention some words (a number, a name): use it before changing a fact so every answer that states it is updated.',
    params: { text: S('Words or a number to look for', { required: true, example: '"9 clinics"' }) },
  },
  {
    name: 'answers.need',
    method: 'POST',
    fn: 'lib_answers.need',
    effect: 'write',
    desc: 'Your AI agent asks the founders for what it cannot find or must check: one short question they can answer in a line, shown on the answer until a founder answers it or you clear it. Writing the answer yourself keeps the question open: clear it with --clear true (or --need "" on answers.set). For many at once use answers.set-many items with "need".',
    params: { key: KEY, text: S('The question for the founders'), clear: B('Remove the question') },
  },
  { name: 'answers.recheck', method: 'POST', fn: 'lib_answers.recheck', effect: 'judge', desc: 'Have the reviewer read one answer again (--key), or every answer.', params: { key: S('Question key (empty: every answer)') } },
];
