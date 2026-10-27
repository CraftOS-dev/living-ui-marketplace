/**
 * Catalog: work for your AI agent (gathering, messages).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'gather.start', method: 'POST', fn: 'lib_agent.gatherStart', effect: 'write', agent: 'deny', press: '"Fill my application" on the Links & files step (or just do the gather recipe yourself when they ask you in chat)', desc: 'A founder asks your AI agent to read every source and fill the application.', params: { focus: S('Anything to focus on') } },
  { name: 'gather.begin', method: 'POST', fn: 'lib_agent.gatherBegin', effect: 'write', desc: 'Your AI agent: say you started gathering (the pipeline shows it working).', params: {} },
  { name: 'gather.finish', method: 'POST', fn: 'lib_agent.gatherFinish', effect: 'write', desc: 'Your AI agent: say you finished, with a summary of what you filled and what you need from the founders.', params: { summary: S('What you filled and what you need', { required: true }), failed: B('You could not finish') } },
  { name: 'messages.list', method: 'GET', fn: 'lib_agent.messages', effect: 'read', desc: 'What the founders told your AI agent and its replies, oldest first. Messages with state sent or queued are not answered yet.', params: { limit: N('How many (default 30)') } },
  { name: 'messages.send', method: 'POST', fn: 'lib_agent.send', effect: 'write', agent: 'deny', press: 'the "Tell your AI agent" box beside every step', desc: 'A founder tells your AI agent something (news, a fact, a request).', params: { text: S('The message', { required: true }) } },
  { name: 'messages.reply', method: 'POST', fn: 'lib_agent.reply', effect: 'write', desc: 'Your AI agent replies to a founder\'s message (--message), or with no --message posts a note in the thread: what you did, or the answer.', params: { message: S('The message you answer (leave out for a note)'), text: S('Your reply, two sentences at most', { required: true }) } },
];
