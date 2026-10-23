/**
 * Catalog: working with your AI agent (requests, questions, proposals,
 * field marks, what needs a person).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  {
    name: 'agent.request',
    method: 'POST',
    fn: 'lib_agent.request',
    effect: 'capture',
    agent: 'deny',
    desc: 'A person asks your AI agent for one piece of work from a screen (the matching trigger fires).',
    params: {
      kind: S('What to do', { required: true, enum: ['papers_waiting', 'ocr_requested', 'claims_requested', 'access_requested', 'search_requested', 'feed_review', 'draft_requested', 'support_check_requested', 'responses_requested', 'screening_requested', 'references_requested', 'experiment_requested'] }),
      project: S('Project (claims)'),
      works: S('Papers (claims)'),
      work: S('Paper (full text, references)'),
      search: S('Search (deep search)'),
      manuscript: S('Manuscript (draft, support check)'),
      brief: S('What to draft'),
      review: S('Review (responses: a received review; screening: a systematic review)'),
      stage: S('Screening stage', { enum: ['title_abstract', 'full_text'] }),
      experiment: S('Experiment (plan or analyze)'),
      ask: S('What to do with the experiment', { enum: ['plan', 'analyze'] }),
    },
  },
  { name: 'agent.needs-you', method: 'GET', fn: 'lib_agent.needsYou', effect: 'read', desc: 'Everything waiting for a person: proposed claims, evidence, links and notes; proposals; identifications to confirm; papers to identify; retractions; files that failed to read.', params: { limit: N('Items per kind (default 6)') } },
  { name: 'agent.scorecard', method: 'GET', fn: 'lib_agent.scorecard', effect: 'read', desc: 'How much of what your AI agent proposed was kept, edited or rejected, per kind of work.', params: {} },

  { name: 'asks.create', method: 'POST', fn: 'lib_agent.askCreate', effect: 'capture', agent: 'deny', desc: 'Ask your AI agent a question about a paper, a collection, a project or the library.', params: { question: S('The question', { required: true }), scope: S('About', { enum: ['work', 'collection', 'project', 'library'] }), work: S('Paper'), collection: S('Collection'), project: S('Project') } },
  { name: 'asks.list', method: 'GET', fn: 'lib_agent.askList', effect: 'read', desc: 'Questions and their answers.', params: { status: S('Status', { enum: ['waiting', 'working', 'answered', 'failed'] }), work: S('Paper'), project: S('Project'), limit: N('Rows') } },
  { name: 'asks.get', method: 'GET', fn: 'lib_agent.askGet', effect: 'read', desc: 'One question with its answer.', params: { ask: S('Question id', { required: true }) } },
  { name: 'asks.working', method: 'POST', fn: 'lib_agent.askWorking', effect: 'capture', desc: 'Say you are answering a question.', params: { ask: S('Question id', { required: true }) } },
  {
    name: 'asks.answer',
    method: 'POST',
    fn: 'lib_agent.askAnswer',
    effect: 'judge',
    desc: 'Answer a question with blocks: {"type":"paragraph","text":...}, {"type":"quote","passage":{"work":..,"page":3,"lines":"4-6"}} (or "anchor"), {"type":"node","node":..}, {"type":"cite","work":..}. Quotes make passages the person can open.',
    params: { ask: S('Question id', { required: true }), answer: S('JSON list of blocks'), text: S('A short plain answer (when no blocks)') },
  },
  { name: 'asks.fail', method: 'POST', fn: 'lib_agent.askFail', effect: 'capture', desc: 'Say a question cannot be answered from the app, and why.', params: { ask: S('Question id', { required: true }), reason: S('Why', { required: true }) } },
  { name: 'asks.delete', method: 'POST', fn: 'lib_agent.askDelete', effect: 'change', agent: 'deny', destructive: true, desc: 'Delete a question.', params: { ask: S('Question id', { required: true }) } },

  { name: 'proposals.list', method: 'GET', fn: 'lib_agent.proposals', effect: 'read', desc: 'Proposals by status (waiting by default) with their previews.', params: { status: S('Status', { enum: ['waiting', 'approved', 'rejected', 'returned', 'withdrawn', 'stale', 'all'] }), limit: N('Rows') } },
  { name: 'proposals.approve', method: 'POST', fn: 'lib_agent.approve', effect: 'confirm', agent: 'deny', desc: 'Approve a proposal: it runs as the person (refused as stale when its target changed since).', params: { proposal: S('Proposal id', { required: true }) } },
  { name: 'proposals.reject', method: 'POST', fn: 'lib_agent.reject', effect: 'confirm', agent: 'deny', desc: 'Reject a proposal.', params: { proposal: S('Proposal id', { required: true }), note: S('Why') } },
  { name: 'proposals.return', method: 'POST', fn: 'lib_agent.returnBack', effect: 'confirm', agent: 'deny', desc: 'Return a proposal to your AI agent with what to change.', params: { proposal: S('Proposal id', { required: true }), note: S('What to change', { required: true }) } },
  { name: 'proposals.withdraw', method: 'POST', fn: 'lib_agent.withdraw', effect: 'capture', desc: 'Withdraw your own proposal.', params: { proposal: S('Proposal id', { required: true }), note: S('Why') } },

  { name: 'marks.set', method: 'POST', fn: 'lib_agent.markSet', effect: 'judge', desc: 'Mark a field you filled (works, nodes, ms_blocks) as sure (high) or to check, with the reason.', params: { target: S('Kind of record', { required: true, enum: ['works', 'nodes', 'ms_blocks'] }), record: S('Record id', { required: true }), field: S('Field', { required: true }), confidence: S('How sure', { enum: ['high', 'check'] }), reason: S('Why') } },
  { name: 'marks.clear', method: 'POST', fn: 'lib_agent.markClear', effect: 'capture', desc: 'Remove a mark.', params: { target: S('Kind of record', { required: true }), record: S('Record id', { required: true }), field: S('Field', { required: true }) } },
];
