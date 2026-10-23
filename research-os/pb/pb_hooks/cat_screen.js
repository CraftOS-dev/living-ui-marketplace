/**
 * Catalog: systematic review screening.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'screen.list', method: 'GET', fn: 'lib_screen.list', effect: 'read', desc: "A project's systematic reviews with their PRISMA counts.", params: { project: S('Project', { required: true }) } },
  { name: 'screen.summary', method: 'GET', fn: 'lib_screen.summary', effect: 'read', desc: 'A review: protocol, PRISMA 2020 counts, agreement between the person and your AI agent (Cohen kappa).', params: { review: S('Review', { required: true }) } },
  {
    name: 'screen.create',
    method: 'POST',
    fn: 'lib_screen.create',
    effect: 'capture',
    agent: 'deny',
    desc: 'Start a systematic review in a project: question, criteria, exclusion reasons, dual screening with your AI agent as the blinded second screener.',
    params: { project: S('Project', { required: true }), title: S('Title'), question: S('Review question'), criteria: S('JSON {"include":[..],"exclude":[..]}'), reasons: S('JSON [{"key":"population","label":"Wrong population"}]'), dual: B('Two screeners (default true)'), blind: B('Hide the other decision until you decide (default true)'), agent_seat: B('Your AI agent is the second screener (default true)') },
  },
  { name: 'screen.update', method: 'POST', fn: 'lib_screen.update', effect: 'capture', agent: 'deny', desc: "Change a review's protocol or settings.", params: { review: S('Review', { required: true }), title: S('Title'), question: S('Question'), criteria: S('JSON criteria'), reasons: S('JSON reasons'), dual: B('Dual'), blind: B('Blind'), agent_seat: B('Agent seat'), stage: S('Stage', { enum: ['setup', 'title_abstract', 'full_text', 'done'] }) } },
  { name: 'screen.delete', method: 'POST', fn: 'lib_screen.remove', effect: 'change', agent: 'deny', destructive: true, desc: 'Delete a review, its records and decisions.', params: { review: S('Review', { required: true }) } },
  {
    name: 'screen.import',
    method: 'POST',
    fn: 'lib_screen.importRecords',
    effect: 'capture',
    desc: 'Records into a review: --from reading_list, --works, --collection, --import (a previewed RIS or BibTeX file), or --pubmed "query". Duplicates by DOI or PubMed ID are marked.',
    params: { review: S('Review', { required: true }), from: S('reading_list'), works: S('Papers'), collection: S('Collection'), project: S('Project'), import: S('Import id from import.preview'), pubmed: S('PubMed query'), max: N('Most records from PubMed (default 200)'), source_db: S('Database the records came from'), query: S('The search string used (for the methods)'), searched_on: S('Date searched YYYY-MM-DD') },
  },
  { name: 'screen.records', method: 'GET', fn: 'lib_screen.records', effect: 'read', desc: 'Records by state (ta, ft), with decisions (blinded ones hidden from people until they decide).', params: { review: S('Review', { required: true }), ta: S('Title/abstract state', { enum: ['pending', 'include', 'exclude', 'maybe', 'conflict'] }), ft: S('Full-text state', { enum: ['none', 'pending', 'include', 'exclude', 'conflict'] }), duplicates: B('Only duplicates'), stage: S('Stage for blinding', { enum: ['title_abstract', 'full_text'] }), limit: N('Rows'), offset: N('Skip') } },
  { name: 'screen.next', method: 'GET', fn: 'lib_screen.next', effect: 'read', desc: 'The next record this seat has not decided at a stage (abstract with its word count), or the next conflict.', params: { review: S('Review', { required: true }), stage: S('Stage', { enum: ['title_abstract', 'full_text'] }), queue: S('Queue', { enum: ['undecided', 'conflicts'] }) } },
  {
    name: 'screen.decide',
    method: 'POST',
    fn: 'lib_screen.decide',
    effect: 'judge',
    desc: 'Decide a record: include, exclude or maybe (full text: include or exclude, with a reason to exclude). Your AI agent adds --basis_words "a-b" (words of the abstract), --rationale and --confidence. People resolve conflicts with --seat final.',
    params: { record: S('Record', { required: true }), stage: S('Stage', { enum: ['title_abstract', 'full_text'] }), value: S('Decision', { required: true, enum: ['include', 'exclude', 'maybe'] }), reason: S('Exclusion reason key'), seat: S('People: final resolves a conflict', { enum: ['person', 'final'] }), basis_words: S('Your AI agent: word span of the abstract the decision rests on'), rationale: S('Why'), confidence: S('How sure', { enum: ['low', 'medium', 'high', 'very_high'] }) },
  },
  { name: 'screen.undo-decision', method: 'POST', fn: 'lib_screen.undoDecision', effect: 'judge', desc: "Take back this seat's decision on a record.", params: { record: S('Record', { required: true }), stage: S('Stage', { enum: ['title_abstract', 'full_text'] }), seat: S('Seat', { enum: ['person', 'final'] }) } },
  { name: 'screen.mark-duplicate', method: 'POST', fn: 'lib_screen.markDuplicate', effect: 'capture', agent: 'deny', desc: 'Mark a record as a duplicate of another ("" clears it).', params: { record: S('Record', { required: true }), of: S('The record it duplicates') } },
  { name: 'screen.export', method: 'GET', fn: 'lib_screen.exportCsv', effect: 'read', desc: 'Every record with its decisions as CSV.', params: { review: S('Review', { required: true }) } },
];
