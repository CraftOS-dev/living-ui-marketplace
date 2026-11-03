/**
 * Catalog: the work handed to your AI agent, and the seller's messages to it.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const TASK = S('The task id', { required: true });

module.exports = [
  { name: 'tasks.list', method: 'GET', fn: 'lib_tasks.list', effect: 'read', desc: 'Your AI agent\'s tasks: open ones by default (queued, asked, working), oldest first. Each has a kind (sync, publish, push_stock, setup_help, prepare_listing, draft_reply, send_reply, tracking, exception, chat), a target, a label and params; app.guide has the recipe for each kind.', params: { state: S('queued | asked | working | done | failed | cancelled | all (default: the open ones)', { enum: ['queued', 'asked', 'working', 'done', 'failed', 'cancelled', 'all'] }), limit: N('Rows (default 50)') } },
  { name: 'tasks.recent', method: 'GET', fn: 'lib_tasks.recent', effect: 'read', desc: 'The latest tasks of any state, newest first (what the seller asked for and what came of it).', params: { limit: N('Rows (default 30)') } },
  { name: 'tasks.get', method: 'GET', fn: 'lib_tasks.get', effect: 'read', desc: 'One task.', params: { task: TASK } },
  { name: 'tasks.start', method: 'POST', fn: 'lib_tasks.start', effect: 'write', desc: 'Your AI agent: mark a task as being worked on (the seller sees it).', params: { task: TASK } },
  { name: 'tasks.finish', method: 'POST', fn: 'lib_tasks.finish', effect: 'write', desc: 'Your AI agent: finish a task with a one-line note the seller reads (or --failed true with why).', params: { task: TASK, note: S('What was done, or why not'), failed: B('true when it could not be done') } },
  { name: 'tasks.cancel', method: 'POST', fn: 'lib_tasks.cancel', effect: 'write', desc: 'Cancel an open task.', params: { task: TASK } },
  { name: 'chats.list', method: 'GET', fn: 'lib_tasks.chats', effect: 'read', desc: 'What the seller told your AI agent in the app and its replies, oldest first.', params: { limit: N('Rows (default 30)') } },
  { name: 'chats.send', method: 'POST', fn: 'lib_tasks.chatSend', effect: 'confirm', agent: 'deny', press: 'Tell your AI agent', desc: 'The seller tells your AI agent something (a chat task).', params: { text: S('The message', { required: true }), context: S('Where the seller was, e.g. order:<id>') } },
  { name: 'chats.reply', method: 'POST', fn: 'lib_tasks.chatReply', effect: 'write', desc: "Your AI agent: answer the seller's message (finishes its chat task).", params: { chat: S('The message id', { required: true }), text: S('The answer', { required: true }) } },
];
