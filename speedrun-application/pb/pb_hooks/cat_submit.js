/**
 * Catalog: filling speedrun's form and submitting.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'submit.ready', method: 'GET', fn: 'lib_submit.ready', effect: 'read', desc: 'Whether the application is ready: the blockers and warnings left.', params: {} },
  { name: 'submit.packet', method: 'GET', fn: 'lib_submit.packet', effect: 'read', desc: 'Every field to type into speedrun\'s form, in the form\'s order (step, section, question, value and the text to type; only questions whose yes/no gate is open), and each founder\'s block (CEO first) with their relevant experience.', params: {} },
  { name: 'submit.fill', method: 'POST', fn: 'lib_submit.fill', effect: 'write', agent: 'deny', press: '"Fill the form" on the Submit step', desc: 'A founder asks your AI agent to type the application into speedrun\'s form. Refused while blockers remain unless --anyway true.', params: { anyway: B('Fill even though blockers remain') } },
  {
    name: 'submit.progress',
    method: 'POST',
    fn: 'lib_submit.progress',
    effect: 'write',
    desc: 'Your AI agent reports each step of filling speedrun\'s form, only after a founder pressed "Fill the form": started, waiting (for a founder in the browser), filled (a step), mismatch (a field that differs), stopped (could not go on), done (every step filled, waiting for the founder\'s Submit application).',
    params: { section: S('The form step or block', { required: true }), status: S('What happened', { required: true, enum: ['started', 'waiting', 'filled', 'mismatch', 'stopped', 'done'] }), note: S('Fields left empty and why, or what the founder must do') },
  },
  { name: 'submit.done', method: 'POST', fn: 'lib_submit.submitted', effect: 'confirm', agent: 'deny', press: '"I submitted" on the Submit step, after pressing Submit application on speedrun', desc: 'A founder pressed Submit application on speedrun\'s site: keep exactly what was sent and lock the answers.', params: {} },
  { name: 'submit.status', method: 'POST', fn: 'lib_submit.setStatus', effect: 'write', desc: 'Record what happened after submitting (speedrun\'s status page is speedrun.a16z.com/application-login): interview (with --when), accepted or rejected.', params: { status: S('Status', { required: true, enum: ['submitted', 'interview', 'accepted', 'rejected'] }), when: S('Interview date and time, ISO') } },
  { name: 'submit.next-cohort', method: 'POST', fn: 'lib_submit.nextCohort', effect: 'write', agent: 'deny', press: '"Apply again" on the Submit step (shown after "Not this time")', desc: 'Start again for another cohort: the answers stay as drafts to improve.', params: { cohort: S('The cohort, e.g. "SR009"', { required: true }), deadline: S('Its deadline, ISO in UTC') } },
  { name: 'export.markdown', method: 'GET', fn: 'lib_submit.exportMarkdown', effect: 'read', desc: 'The whole application as Markdown.', params: {} },
];
