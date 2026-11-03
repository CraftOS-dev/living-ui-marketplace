/**
 * Catalog: buyer conversations across every shop.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const THREAD = S('The conversation id', { required: true });
const INTENTS = ['where_is_order', 'return', 'refund', 'cancel', 'change_address', 'product_question', 'complaint', 'other'];

module.exports = [
  { name: 'inbox.list', method: 'GET', fn: 'lib_inbox.list', effect: 'read', desc: 'Conversations by view: due (open, soonest reply deadline first), to_draft (due with no draft yet), drafted (a reply waits for the seller), waiting (answered, waiting on the buyer), open, closed, all. Each row: shop, buyer, order, subject, last message, hours left, intent, draft and task.', params: { view: S('due | to_draft | drafted | waiting | open | closed | all', { enum: ['due', 'to_draft', 'drafted', 'waiting', 'open', 'closed', 'all'] }), shop: S('Only this shop'), q: S('Search subject, buyer, text or order number'), limit: N('Rows (default 100)') } },
  { name: 'inbox.get', method: 'GET', fn: 'lib_inbox.get', effect: 'read', desc: "One conversation: messages (in, out, private notes), the draft with its reasons and warnings, the buyer, the linked order (status, tracking), the buyer's other orders and the shop's policies and seller centre.", params: { thread: THREAD } },
  {
    name: 'inbox.add',
    method: 'POST',
    fn: 'lib_inbox.add',
    effect: 'write',
    desc: 'Log a buyer message (one that came by email, chat or phone): starts a conversation, or adds to --thread.',
    params: { thread: S('Add to this conversation'), shop: S('The shop (default Direct)'), buyer_name: S('Buyer name'), buyer_email: S('Buyer email'), buyer_phone: S('Buyer phone'), subject: S('Subject'), order: S('Order number it is about'), text: S('The message', { required: true }), at: S('When (default now)'), channel: S('chat | email | whatsapp | phone | social | other', { enum: ['chat', 'email', 'whatsapp', 'phone', 'social', 'other'] }), intent: S(INTENTS.join(' | '), { enum: INTENTS }), direction: S('in (from the buyer, default) | out (a reply already sent)', { enum: ['in', 'out'] }) },
  },
  { name: 'inbox.add-many', method: 'POST', fn: 'lib_inbox.addMany', effect: 'write', desc: "Bring in a shop's conversations (your AI agent's sync), matched on the platform's conversation and message ids so repeating adds nothing twice. Row format: app.guide rows.conversation.", params: { shop: S('The shop (id or name)', { required: true }), items: S('JSON list of conversation rows', { required: true }) } },
  { name: 'inbox.draft', method: 'POST', fn: 'lib_inbox.draft', effect: 'write', desc: 'Write the reply draft of a conversation, with why (the facts and policy used). The seller reads, edits and sends it. Finishes a draft_reply task.', params: { thread: THREAD, text: S('The reply', { required: true }), why: S('What it is based on: order status, tracking, policy'), intent: S(INTENTS.join(' | '), { enum: INTENTS }) } },
  { name: 'inbox.reply', method: 'POST', fn: 'lib_inbox.reply', effect: 'confirm', agent: 'deny', press: 'Send in the conversation', desc: 'The seller sends a reply: copied (pasted into the seller centre, recorded as sent), manual (sent some other way) or agent (your AI agent sends it: a send_reply task).', params: { thread: THREAD, text: S('The reply', { required: true }), mode: S('copied | agent | manual', { enum: ['copied', 'agent', 'manual'] }), close: B('Close the conversation') } },
  { name: 'inbox.sent', method: 'POST', fn: 'lib_inbox.sent', effect: 'write', desc: 'Your AI agent: confirm it sent a reply the seller handed it (--message), or, only when replies are set to automatic, record a reply it sent (--thread --text).', params: { message: S('The message in state sending'), thread: S('The conversation (automatic replies)'), text: S('What was sent (automatic replies)'), at: S('When') } },
  { name: 'inbox.send-failed', method: 'POST', fn: 'lib_inbox.sendFailed', effect: 'write', desc: 'Your AI agent: a reply could not be sent (the conversation reopens for the seller).', params: { message: S('The message in state sending', { required: true }), error: S('Why', { required: true }) } },
  { name: 'inbox.note', method: 'POST', fn: 'lib_inbox.note', effect: 'write', desc: 'Add a private note to a conversation (never sent).', params: { thread: THREAD, text: S('The note', { required: true }) } },
  { name: 'inbox.update', method: 'POST', fn: 'lib_inbox.update', effect: 'write', desc: "Change a conversation's status (open, waiting, closed), intent, subject or linked order.", params: { thread: THREAD, status: S('open | waiting | closed', { enum: ['open', 'waiting', 'closed'] }), intent: S('Intent (or "" to clear)'), subject: S('Subject'), order: S('Order number or id ("" to unlink)') } },
  { name: 'inbox.ask-draft', method: 'POST', fn: 'lib_inbox.requestDraft', effect: 'write', desc: 'Ask your AI agent to draft a reply (a draft_reply task).', params: { thread: THREAD, note: S('What the seller wants said') } },
  { name: 'inbox.ask-draft-all', method: 'POST', fn: 'lib_inbox.requestDraftAll', effect: 'write', desc: 'Ask your AI agent to draft replies for every open conversation without a draft.', params: {} },
];
