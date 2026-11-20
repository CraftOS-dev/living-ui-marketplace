/**
 * Catalog: outbound messages (drafted by your AI agent or people, approved
 * and sent by people), tasks, comments and saved views.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const MSG = S('Message id', { required: true });
const KINDS = ['pass', 'intro', 'request', 'notice', 'lp_pack', 'digest', 'reply'];
const MODULES = ['network', 'intake', 'pipeline', 'diligence', 'committee', 'portfolio', 'funds', 'lps', 'markets', 'settings'];

module.exports = [
  /* outbound */
  { name: 'outbound.list', method: 'GET', fn: 'lib_outbound.list', perm: 'signed', effect: 'read', desc: 'Messages the app sends: open ones by default (drafts, approved, failed), with recipients, subject, status and the AI-written share.', params: Object.assign({ status: S('open | draft | approved | sending | sent | failed | cancelled | all', { enum: ['open', 'draft', 'approved', 'sending', 'sent', 'failed', 'cancelled', 'all'] }), kind: S('pass | intro | request | notice | lp_pack | digest | reply', { enum: KINDS }), module: S('The module it belongs to'), ref_collection: S('Record collection'), ref_id: S('Record id'), deal: S('Deal id') }, PAGE) },
  { name: 'outbound.get', method: 'GET', fn: 'lib_outbound.get', perm: 'signed', effect: 'read', desc: 'One message in full (body, attachments, status, error), and any attachment that is missing.', params: { outbound: MSG } },
  {
    name: 'outbound.draft',
    method: 'POST',
    fn: 'lib_outbound.draftOp',
    perm: 'signed',
    effect: 'write',
    desc: 'Draft a message for a person to approve and send (it appears in their Next). Nothing is sent. --module is the module whose editors approve it.',
    params: {
      kind: S('pass | intro | request | notice | lp_pack | digest | reply', { required: true, enum: KINDS }),
      module: S('Module whose editors approve it', { required: true, enum: MODULES }),
      to: S('JSON list of email addresses (or one address)', { required: true }),
      subject: S('Subject', { required: true }),
      body: S('Body (plain text)', { required: true }),
      attachments: S('JSON list of file ids'),
      ref_collection: S('Record it is about: collection'),
      ref_id: S('Record it is about: id'),
      deal: S('Deal id when it is about a deal'),
      approver: S('A member who must approve it (default: any editor of the module)'),
    },
  },
  { name: 'outbound.update', method: 'POST', fn: 'lib_outbound.update', perm: 'signed', effect: 'write', desc: "Edit a draft (or a message that failed). Your AI agent edits only its own drafts no person touched.", params: { outbound: MSG, to: S('JSON list of email addresses'), subject: S('Subject'), body: S('Body'), attachments: S('JSON list of file ids') } },
  { name: 'outbound.approve', method: 'POST', fn: 'lib_outbound.approve', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Approve a message and send it now through Gmail (or within a minute when many go at once). Never sends twice. Refused when an attachment is missing.', params: { outbound: MSG } },
  { name: 'outbound.cancel', method: 'POST', fn: 'lib_outbound.cancel', perm: 'signed', effect: 'write', desc: 'Cancel a message that was not sent. Your AI agent cancels only its own drafts.', params: { outbound: MSG } },

  /* tasks */
  { name: 'tasks.list', method: 'GET', fn: 'lib_tasks.list', perm: 'signed', effect: 'read', desc: 'Tasks: mine (default), on a record (--ref_collection --ref_id), or all; open by default, by due day.', params: Object.assign({ view: S('mine | ref | all', { enum: ['mine', 'ref', 'all'] }), ref_collection: S('Record collection'), ref_id: S('Record id'), deal: S('Deal id'), status: S('open | done | cancelled | all', { enum: ['open', 'done', 'cancelled', 'all'] }) }, PAGE) },
  { name: 'tasks.save', method: 'POST', fn: 'lib_tasks.save', perm: 'signed', effect: 'write', desc: 'Open a task (no --task) or change one. Default owner: the caller. Your AI agent opens tasks for stated next steps and changes only the ones it opened.', params: { task: S('Task id (empty to open one)'), title: S('What to do'), ref_collection: S('Record collection, e.g. deals'), ref_id: S('Record id'), deal: S('Deal id'), assignee: S('Owner (member email or id)'), due_day: S('Due day YYYY-MM-DD'), note: S('Note'), job: S('Your AI agent: the job it comes from') } },
  { name: 'tasks.complete', method: 'POST', fn: 'lib_tasks.complete', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Mark a task done (or open again with --done false).', params: { task: S('Task id', { required: true }), done: B('Done (default true)') } },
  { name: 'tasks.delete', method: 'POST', fn: 'lib_tasks.remove', perm: 'signed', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a task (its opener, its owner or the firm owner).', params: { task: S('Task id', { required: true }) } },

  /* comments */
  { name: 'comments.list', method: 'GET', fn: 'lib_comments.list', perm: 'signed', effect: 'read', desc: 'Comments on a record, oldest first.', params: Object.assign({ ref_collection: S('Record collection, e.g. deals', { required: true }), ref_id: S('Record id', { required: true }) }, PAGE) },
  { name: 'comments.add', method: 'POST', fn: 'lib_comments.add', perm: 'signed', effect: 'write', desc: 'Comment on a record; --mentions tells those members.', params: { ref_collection: S('Record collection', { required: true }), ref_id: S('Record id', { required: true }), body: S('The comment', { required: true }), mentions: S('JSON list of members (emails or ids) to tell') } },
  { name: 'comments.delete', method: 'POST', fn: 'lib_comments.remove', perm: 'signed', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a comment (its author or the owner).', params: { comment: S('Comment id', { required: true }) } },

  /* saved views */
  { name: 'views.list', method: 'GET', fn: 'lib_views.list', perm: 'signed', effect: 'read', desc: "Saved views of a list or board (the caller's own and shared ones).", params: { page: S('Page key, e.g. deals.table', { required: true }) } },
  { name: 'views.save', method: 'POST', fn: 'lib_views.save', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Save a view (filters, columns, sort) for a page; --shared shows it to the team.', params: { view: S('View id (empty to add one)'), page: S('Page key, e.g. deals.table'), name: S('Name'), config: S('JSON of the page (filters, columns, sort)'), shared: B('Shared with the team'), sort: N('Order') } },
  { name: 'views.delete', method: 'POST', fn: 'lib_views.remove', perm: 'signed', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a saved view of yours.', params: { view: S('View id', { required: true }) } },
];
