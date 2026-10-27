/**
 * Catalog: filling YC's form and submitting.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'submit.ready', method: 'GET', fn: 'lib_submit.ready', effect: 'read', desc: 'Whether the application is ready: the blockers and warnings left.', params: {} },
  { name: 'submit.packet', method: 'GET', fn: 'lib_submit.packet', effect: 'read', desc: 'Every field to type into YC\'s form, in the form\'s order (only questions whose yes/no gate is open), and each founder\'s profile and contact facts.', params: {} },
  { name: 'submit.fill', method: 'POST', fn: 'lib_submit.fill', effect: 'write', agent: 'deny', press: '"Fill the form" on the Submit step', desc: 'A founder asks your AI agent to type the application into YC\'s form. Refused while blockers remain unless --anyway true.', params: { anyway: B('Fill even though blockers remain') } },
  {
    name: 'submit.progress',
    method: 'POST',
    fn: 'lib_submit.progress',
    effect: 'write',
    desc: 'Your AI agent reports each step of filling YC\'s form, only after a founder pressed "Fill the form": started, waiting (for a founder to sign in), filled (a section), mismatch (a field that differs), stopped (could not go on), done (every section filled, waiting for the founder\'s Submit).',
    params: { section: S('The form section or step', { required: true }), status: S('What happened', { required: true, enum: ['started', 'waiting', 'filled', 'mismatch', 'stopped', 'done'] }), note: S('Fields left empty and why, or what the founder must do') },
  },
  { name: 'submit.done', method: 'POST', fn: 'lib_submit.submitted', effect: 'confirm', agent: 'deny', press: '"I submitted" on the Submit step, after pressing Submit on YC', desc: 'A founder pressed Submit on YC\'s site: keep exactly what was sent and lock the answers.', params: {} },
  { name: 'submit.status', method: 'POST', fn: 'lib_submit.setStatus', effect: 'write', desc: 'Record what happened after submitting: interview (with --when), accepted or rejected.', params: { status: S('Status', { required: true, enum: ['submitted', 'interview', 'accepted', 'rejected'] }), when: S('Interview date and time, ISO') } },
  { name: 'submit.next-batch', method: 'POST', fn: 'lib_submit.nextBatch', effect: 'write', agent: 'deny', press: '"Apply again" on the Submit step (shown after "Not this time")', desc: 'Start again for another batch: the answers stay, "applied before" turns on.', params: { batch: S('The batch, e.g. "Summer 2027"', { required: true }), deadline: S('Its deadline, ISO in UTC') } },
  { name: 'export.markdown', method: 'GET', fn: 'lib_submit.exportMarkdown', effect: 'read', desc: 'The whole application as Markdown.', params: {} },
];
