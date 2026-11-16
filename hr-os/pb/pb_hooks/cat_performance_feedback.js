/**
 * Catalog: continuous feedback, praise (the praise wall, company values)
 * and feedback requests. People only for every write: feedback is in
 * people's own words.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  {
    name: 'feedback.list',
    method: 'GET',
    fn: 'lib_performance_feedback.list',
    perm: 'signed',
    effect: 'read',
    desc: 'Feedback the caller may see by --view: received (default), given, requests (asked of me), asked (my requests and their answers), about (--employee), wall (public praise, filter by --value).',
    params: { view: S('received | given | requests | asked | about | wall', { enum: ['received', 'given', 'requests', 'asked', 'about', 'wall'] }), employee: S('The person (about; wall: praise to or from them)'), kind: S('praise | feedback', { enum: ['praise', 'feedback', ''] }), since: S('From this day'), value: S('Company value code (wall)'), limit: N('Rows (default 30)'), offset: N('Rows to skip') },
  },
  {
    name: 'feedback.give',
    method: 'POST',
    fn: 'lib_performance_feedback.give',
    perm: 'signed',
    agent: 'deny',
    effect: 'write',
    desc: 'Praise someone (on the wall or private, tagged with values) or give feedback (private to them, or their manager only). --request answers a request.',
    params: { to: S('The person (employee number, id or email; not needed with --request)'), kind: S('praise (default) | feedback', { enum: ['praise', 'feedback'] }), text: S('What you want to say', { required: true }), values: S('JSON list of company value codes (praise)'), visibility: S('praise: public | private; feedback: private (the person) | manager (their manager only)', { enum: ['public', 'private', 'manager'] }), request: S('Feedback request id this answers') },
  },
  { name: 'feedback.request', method: 'POST', fn: 'lib_performance_feedback.requestOp', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Ask people for feedback about yourself, or (managers, HR) about someone you manage. Each person gets a request to answer.', params: { from: S('JSON list of the people to ask', { required: true }), about: S('The person it is about (default you)'), text: S('Your question'), due: S('Answer by this day') } },
  { name: 'feedback.decline', method: 'POST', fn: 'lib_performance_feedback.decline', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Decline a feedback request sent to you.', params: { request: S('Request id', { required: true }), reason: S('Why') } },
  { name: 'feedback.delete', method: 'POST', fn: 'lib_performance_feedback.remove', perm: 'signed', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove feedback or praise you wrote (HR may remove posts from the praise wall).', params: { feedback: S('Feedback id', { required: true }) } },
];
