/**
 * Catalog: Home, search, proposals, the Inbox, questions, field marks, what
 * your AI agent did, and import and export.
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const re = (desc, values) => ({ type: 'string', required: true, desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const ENTITIES = ['documents', 'payments', 'parties', 'items', 'stock_changes', 'journals', 'accounts', 'banks', 'employees', 'expense_claims', 'leave_requests', 'payroll_runs', 'projects', 'project_tasks', 'builds', 'boms', 'assets', 'warehouses'];
const IMPORT_KINDS = ['parties', 'items', 'accounts', 'opening_accounts', 'opening_documents', 'opening_stock', 'employees'];
const EXPORT_KINDS = ['parties', 'items', 'stock', 'accounts', 'journal_lines', 'documents', 'document_lines', 'payments', 'employees', 'timesheets', 'trial_balance'];

module.exports = [
  { name: 'home.summary', method: 'GET', fn: 'lib_home.summary', perm: 'self', desc: "Home for the caller's role: cash, money owed both ways with aging, sales and profit this month, what is overdue and due, orders to deliver and receive, low stock, projects, their own leave, claims and time, and what is waiting on them.", params: {} },
  { name: 'home.needs', method: 'GET', fn: 'lib_home.needs', perm: 'self', desc: 'Needs you: everything waiting on the caller (approvals, proposals, exceptions), grouped.', params: {} },
  { name: 'search.global', method: 'GET', fn: 'lib_home.search', perm: 'self', desc: 'Search everything the caller may see: documents by number or party, customers and suppliers, items, employees, projects, accounts.', params: { q: r('What to find'), limit: n('Per kind (default 5)') } },

  { name: 'proposals.list', method: 'GET', fn: 'lib_agent.list', perm: 'self', desc: 'Proposals from your AI agent (waiting ones by default) that the caller may decide.', params: Object.assign({ status: e('Status', ['waiting', 'approved', 'rejected', 'failed']) }, page) },
  { name: 'proposals.get', method: 'GET', fn: 'lib_agent.get', perm: 'self', desc: 'One proposal: what it would post (journal lines), why, and its target.', params: { proposal: r('Proposal id') } },
  { name: 'proposals.approve', method: 'POST', fn: 'lib_agent.approve', perm: 'self', agent: 'deny', desc: 'Approve a proposal: it runs as you.', params: { proposal: r('Proposal id'), note: s('Note') } },
  { name: 'proposals.reject', method: 'POST', fn: 'lib_agent.reject', perm: 'self', agent: 'deny', desc: 'Reject a proposal.', params: { proposal: r('Proposal id'), note: s('Why') } },
  { name: 'proposals.withdraw', method: 'POST', fn: 'lib_agent.withdraw', perm: 'self', desc: 'Your AI agent takes back a waiting proposal.', params: { proposal: r('Proposal id'), note: s('Why') } },

  { name: 'inbox.list', method: 'GET', fn: 'lib_agent.inboxList', perm: 'self', desc: 'Files dropped for your AI agent to read (bills, receipts, statements) and what they became.', params: Object.assign({ status: e('Status', ['waiting', 'reading', 'done', 'failed']) }, page) },
  { name: 'inbox.add', method: 'POST', fn: 'lib_agent.inboxAdd', perm: 'self', files: ['file'], desc: 'Drop files for your AI agent (screens upload; your AI agent gives --path).', params: { kind: e('What it is', ['bill', 'receipt', 'statement', 'other']), note: s('A note for your AI agent'), path: s('Absolute path of a local file') } },
  { name: 'inbox.get', method: 'GET', fn: 'lib_agent.inboxGet', perm: 'self', desc: 'Open an inbox file (your AI agent gets its file path).', params: { file: r('Inbox file id'), download: b('As a download') } },
  { name: 'inbox.start', method: 'POST', fn: 'lib_agent.inboxStart', perm: 'self', desc: 'Your AI agent: mark a file as being read.', params: { file: r('Inbox file id') } },
  { name: 'inbox.complete', method: 'POST', fn: 'lib_agent.inboxComplete', perm: 'self', desc: 'Your AI agent: say what the file became (the file is attached to it).', params: { file: r('Inbox file id'), summary: r('What was recorded'), entity: e('What it became', ENTITIES), ref: s('Its number or id') } },
  { name: 'inbox.fail', method: 'POST', fn: 'lib_agent.inboxFail', perm: 'self', desc: 'Your AI agent: the file could not be read (say why, in words people can act on).', params: { file: r('Inbox file id'), reason: r('Why') } },
  { name: 'inbox.retry', method: 'POST', fn: 'lib_agent.inboxRetry', perm: 'self', desc: 'Ask your AI agent to read a file again.', params: { file: r('Inbox file id') } },
  { name: 'inbox.delete', method: 'POST', fn: 'lib_agent.inboxDelete', perm: 'self', destructive: true, desc: 'Remove an inbox file.', params: { file: r('Inbox file id'), preview: b('Only say what would happen') } },

  { name: 'asks.list', method: 'GET', fn: 'lib_agent.askList', perm: 'self', desc: 'Questions asked in the app (your AI agent sees all, with the asker\'s rights; people see their own).', params: { status: e('Status', ['waiting', 'working', 'answered', 'failed']), limit: n('How many') } },
  { name: 'asks.create', method: 'POST', fn: 'lib_agent.askCreate', perm: 'self', agent: 'deny', desc: 'Ask your AI agent a question from the app.', params: { question: r('The question') } },
  { name: 'asks.working', method: 'POST', fn: 'lib_agent.askWorking', perm: 'self', desc: 'Your AI agent: mark a question as being worked on.', params: { ask: r('Question id') } },
  { name: 'asks.answer', method: 'POST', fn: 'lib_agent.askAnswer', perm: 'self', desc: 'Your AI agent: answer a question (plain text; respect the asker\'s rights).', params: { ask: r('Question id'), answer: r('The answer') } },
  { name: 'asks.fail', method: 'POST', fn: 'lib_agent.askFail', perm: 'self', desc: 'Your AI agent: the question cannot be answered (say why).', params: { ask: r('Question id'), reason: r('Why') } },
  { name: 'asks.delete', method: 'POST', fn: 'lib_agent.askDelete', perm: 'self', destructive: true, desc: 'Delete one of your questions.', params: { ask: r('Question id') } },

  { name: 'agent.request', method: 'POST', fn: 'lib_agent.request', perm: 'self', agent: 'deny', desc: 'Ask your AI agent for a piece of work from the app (reorder drafts, payment reminders, sending a document, the month-end review, reconciling a bank). Rights are checked first.', params: { kind: re('What to ask for', ['reorder_review', 'collections_requested', 'doc_send_requested', 'close_review_requested', 'bank_lines_waiting']), doc: s('The document to send (doc_send_requested)'), month: s('Month YYYY-MM (close_review_requested)'), bank: s('Bank account (bank_lines_waiting)') } },

  { name: 'marks.set', method: 'POST', fn: 'lib_agent.markSet', perm: 'self', desc: 'Your AI agent: mark a field it filled in (shown to people, with "check" when unsure).', params: { entity: re('Kind of record', ENTITIES), ref: r('Record'), field: r('Field name'), confidence: e('high or check', ['high', 'check']), reason: s('Why, or where it came from') } },
  { name: 'marks.clear', method: 'POST', fn: 'lib_agent.markClear', perm: 'self', desc: 'A person reviewed what your AI agent filled in: clear the marks.', params: { entity: re('Kind of record', ENTITIES), ref: r('Record'), field: s('One field (default all)') } },
  { name: 'agent.activity', method: 'GET', fn: 'lib_agent.activity', perm: 'self', desc: 'What your AI agent did recently, proposals waiting and files waiting.', params: { from: s('Since YYYY-MM-DD (default a week ago)'), limit: n('How many') } },

  { name: 'import.preview', method: 'POST', fn: 'lib_import.preview', perm: 'self', files: ['file'], desc: 'Read a CSV for import: the column each field was matched to, what would be created or changed, and the problems per row. Nothing is written.', params: { kind: re('What the rows are', IMPORT_KINDS), path: s('Absolute path of the CSV (your AI agent)'), import_id: s('A previous preview to adjust'), mapping: s('JSON object field -> column number or header'), date: s('Opening date for opening balances and stock'), warehouse: s('Warehouse for opening stock') } },
  { name: 'import.run', method: 'POST', fn: 'lib_import.run', perm: 'self', desc: 'Run a previewed import.', params: { import_id: r('The preview id'), mapping: s('JSON object field -> column'), date: s('Opening date'), warehouse: s('Warehouse') } },
  { name: 'import.list', method: 'GET', fn: 'lib_import.list', perm: 'self', desc: 'Past imports.', params: { kind: e('Kind', IMPORT_KINDS) } },
  { name: 'import.undo', method: 'POST', fn: 'lib_import.undo', perm: 'self', destructive: true, desc: 'Undo an import of customers, suppliers, items, accounts or employees (records it created that nothing uses yet).', params: { import_id: r('Import id') } },
  { name: 'import.template', method: 'GET', fn: 'lib_import.template', perm: 'self', desc: 'A CSV header row for an import kind.', params: { kind: re('Kind', IMPORT_KINDS) } },
  { name: 'export.csv', method: 'GET', fn: 'lib_import.exportCsv', perm: 'self', desc: 'Export as CSV text (what the caller may see).', params: { kind: re('What to export', EXPORT_KINDS), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD'), type: s('Documents: the type') } },
];
