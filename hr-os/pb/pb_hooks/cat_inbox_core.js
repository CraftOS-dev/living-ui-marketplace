/**
 * Catalog: the Inbox (approvals and their flows, your AI agent's proposals,
 * questions to your AI agent and asking it again, notifications).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const QUESTION = S('Question id', { required: true });

module.exports = [
  { name: 'approvals.list', method: 'GET', fn: 'lib_approvals.list', perm: 'signed', effect: 'read', desc: 'Approvals by --view: mine (waiting for the caller, default; also counts overseen ones), overseen (waiting for others, overseen as owner or module administrator), requested (asked by the caller), all.', params: Object.assign({ view: S('mine | overseen | requested | all', { enum: ['mine', 'overseen', 'requested', 'all'] }), status: S('pending (default) | approved | rejected | cancelled | decided | any', { enum: ['pending', 'approved', 'rejected', 'cancelled', 'decided', 'any'] }), kind: S('Approval kind, e.g. leave_request') }, PAGE) },
  { name: 'approvals.get', method: 'GET', fn: 'lib_approvals.get', perm: 'signed', effect: 'read', desc: 'One approval with its steps, history and whether the caller can decide it.', params: { approval: S('Approval id', { required: true }) } },
  { name: 'approvals.decide', method: 'POST', fn: 'lib_approvals.decideOp', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Approve or reject a request waiting for you. Bank details and pay runs need your PIN to approve.', params: { approval: S('Approval id', { required: true }), decision: S('approved | rejected', { required: true, enum: ['approved', 'rejected'] }), note: S('Note for the person who asked'), pin: S('Your approval PIN (when the request needs it)', { secret: true }) } },
  { name: 'approvals.cancel', method: 'POST', fn: 'lib_approvals.cancelOp', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Cancel a pending request you made (administrators can cancel any).', params: { approval: S('Approval id', { required: true }), note: S('Why') } },
  { name: 'approval-flows.list', method: 'GET', fn: 'lib_approvals.flowsList', perm: 'signed', effect: 'read', desc: 'Approval flows (steps per kind, entity and department, auto-approve limits) and the kinds modules handle.' },
  { name: 'approval-flows.save', method: 'POST', fn: 'lib_approvals.flowsSave', perm: 'admin:full', agent: 'deny', effect: 'write', desc: 'Add or change an approval flow: steps manager, manager_of_manager, department_approver, role (code) or member (id); auto-approve below an amount or days.', params: { flow: S('Flow id (empty to add one)'), kind: S('Approval kind, e.g. leave_request'), entity: S('Entity it applies to (empty = all)'), department: S('Department it applies to (empty = all)'), steps: S('JSON list, e.g. [{"type":"manager"},{"type":"role","role":"hr_admin"}]'), auto: S('JSON {max_amount, currency, max_days}'), active: B('In use'), note: S('Note') } },
  { name: 'approval-flows.delete', method: 'POST', fn: 'lib_approvals.flowsDelete', perm: 'admin:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an approval flow (the kind then goes to the manager).', params: { flow: S('Flow id', { required: true }) } },

  { name: 'proposals.list', method: 'GET', fn: 'lib_proposals.list', perm: 'signed', effect: 'read', desc: "Your AI agent's proposals the caller can act on: pending (default, oldest first) or decided, each with items (what changes, before and after) and risk.", params: Object.assign({ status: S('pending | decided | all', { enum: ['pending', 'decided', 'all'] }), kind: S('people | time | leave | expenses | payroll | hiring | performance | packs | mixed') }, PAGE) },
  { name: 'proposals.get', method: 'GET', fn: 'lib_proposals.get', perm: 'signed', effect: 'read', desc: 'One proposal with its items and their states (pending, applied, stale, failed, dismissed, superseded).', params: { proposal: S('Proposal id', { required: true }) } },
  { name: 'proposals.create', method: 'POST', fn: 'lib_proposals.create', perm: 'signed', effect: 'write', desc: 'Your AI agent: propose several changes as one set (each item an op that becomes a proposal, with its params).', params: { title: S('What the set does'), why: S('One or two lines on why'), items: S('JSON list [{"op":"job.update","params":{...}}]', { required: true }) } },
  { name: 'proposals.accept', method: 'POST', fn: 'lib_proposals.accept', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Accept a proposal (all items, or the chosen ones; the rest are dismissed). Each runs as you, checked again first.', params: { proposal: S('Proposal id', { required: true }), items: S('JSON list of item indexes to apply (default all)') } },
  { name: 'proposals.dismiss', method: 'POST', fn: 'lib_proposals.dismiss', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Dismiss a proposal, with a note for your AI agent.', params: { proposal: S('Proposal id', { required: true }), note: S('Why, so your AI agent does better next time') } },
  { name: 'proposals.withdraw', method: 'POST', fn: 'lib_proposals.withdraw', perm: 'signed', effect: 'write', desc: 'Withdraw a pending proposal that no longer applies.', params: { proposal: S('Proposal id', { required: true }) } },

  { name: 'questions.ask', method: 'POST', fn: 'lib_agent.questionAsk', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Ask your AI agent a question about HR in this company (one question asks it once; the answer comes back here and in the Inbox).', params: { question: S('The question', { required: true }), context: S('Where you were, e.g. people:E0001') } },
  { name: 'questions.list', method: 'GET', fn: 'lib_agent.questionList', perm: 'signed', effect: 'read', desc: 'Questions to your AI agent: the ones the caller asked (administrators add --everyone true; your AI agent sees all), newest first, with the answer and the ask (request id, when).', params: Object.assign({ status: S('asked | answered | cancelled | all (default)', { enum: ['asked', 'answered', 'cancelled', 'all'] }), everyone: B('Administrators: the questions of everyone') }, PAGE) },
  { name: 'questions.get', method: 'GET', fn: 'lib_agent.questionGet', perm: 'signed', effect: 'read', desc: 'One question with who asked it, from where, and the answer.', params: { question: QUESTION } },
  { name: 'questions.answer', method: 'POST', fn: 'lib_agent.questionAnswer', perm: 'signed', effect: 'write', desc: 'Your AI agent: answer the question named by the question_asked trigger. The person who asked is notified.', params: { question: QUESTION, answer: S('The plain answer, short, with the numbers and dates you used', { required: true }) } },
  { name: 'questions.cancel', method: 'POST', fn: 'lib_agent.questionCancel', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Cancel a question you asked that is not answered yet.', params: { question: QUESTION } },
  { name: 'agent.retry', method: 'POST', fn: 'lib_agent.retryOp', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Ask your AI agent again about one record, once: for a request that ended, was refused or was not picked up in a day. --request names the request asked again for.', params: { trigger: S('The trigger, e.g. letter_draft', { required: true }), record: S('The record id the trigger names', { required: true }), request: S('The request id asked again for', { required: true }) } },
  { name: 'agent.triggers', method: 'GET', fn: 'lib_agent.triggersOp', perm: 'signed', effect: 'read', desc: 'What wakes your AI agent: each trigger in plain words (what fires it, the record it names, its cooldown) and the Automatic work switches.' },

  {
    name: 'inbox.route',
    method: 'POST',
    fn: 'lib_notify.route',
    perm: 'signed',
    effect: 'write',
    desc: 'Your AI agent only: hand a request you may not do (a people-only op, an approval, a refused change) to the people who can, as an Inbox item for the role of --op (or --role, --member).',
    params: {
      request: S('What was asked, with the record, dates and amounts (shown quoted, as passed on by your AI agent)', { required: true }),
      op: S('The op that needs a person, e.g. bank.add'),
      role: S('Role code: owner, hr_admin, payroll_admin, finance, manager, recruiter, employee'),
      member: S('A member (id or email) instead of a role'),
      employee: S('The person it is about (number, email or name); for their own self-service ops they are told too'),
      record: S('The record it is about: an employee, a pay run number (PR-0001), an approval or proposal id (the link is made from it)'),
      asked_by: S('Who asked you (a member email or an employee), shown with the request'),
      link: S('An in-app route starting with #/ (default: the record)'),
    },
  },
  { name: 'notifications.list', method: 'GET', fn: 'lib_notify.list', perm: 'signed', effect: 'read', desc: 'Your notifications, newest first, with the unread count.', params: Object.assign({ unread: B('Only unread ones') }, PAGE) },
  { name: 'notifications.read', method: 'POST', fn: 'lib_notify.read', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Mark a notification read (or unread with --read false).', params: { notification: S('Notification id', { required: true }), read: B('Read (default true)') } },
  { name: 'notifications.read-all', method: 'POST', fn: 'lib_notify.readAll', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Mark all your notifications read.' },
];
