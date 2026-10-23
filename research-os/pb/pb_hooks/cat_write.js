/**
 * Catalog: the writing desk (manuscripts, tracked changes, snapshots,
 * export) and reviewer responses.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const STYLES = ['apa', 'chicago', 'harvard', 'ieee', 'vancouver', 'mla', 'nature'];
const TEMPLATES = ['generic', 'elsevier', 'nature', 'science', 'acl', 'iclr', 'neurips', 'ieee'];
const BLOCKS = ['h1', 'h2', 'h3', 'paragraph', 'quote', 'bullet', 'numbered', 'equation', 'abstract', 'figure', 'table', 'latex'];
const CONTENT =
  'JSON segments: [{"t":"text","v":"As shown by "},{"t":"cite","works":["<paper id>"],"locator":"p. 4"},{"t":"text","v":"."}] (text may carry "b" or "i": true; {"t":"claim","node":"<id>"} links a claim; {"t":"math","v":"x^2"} is inline LaTeX maths; {"t":"ref","block":"<heading, equation, figure or table>"} reads "Figure 2", with "bare":true "2"). An equation holds its LaTeX as text; a figure or table holds its caption.';
const DATA = 'What a figure, table or LaTeX block holds beyond its text, JSON: figure {"file":"<repository file: png, jpg or pdf>","width":80} (width in % of the text width); table {"rows":[["Strain","OD600"],["WT","1.12"]],"header":true,"align":["left","right"]}; latex {"code":"\\\\begin{tabular}..."}';

module.exports = [
  { name: 'ms.list', method: 'GET', fn: 'lib_ms.list', effect: 'read', desc: 'Manuscripts (of a project).', params: { project: S('Project') } },
  { name: 'ms.get', method: 'GET', fn: 'lib_ms.get', effect: 'read', desc: 'A manuscript: blocks, citations rendered in its style, bibliography, cited sources, proposed changes, the ready checks, what was typed, pasted or kept from your AI agent, the disclosure statement, the numbers of its sections, equations, figures and tables, the repository files its figures show and its style folder.', params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'ms.text', method: 'GET', fn: 'lib_ms.text', effect: 'read', desc: 'A manuscript as plain text per block, with [cite:<paper ids>] where citations are, $..$ for inline maths and [ref:<block>] for cross-references; figures, tables and LaTeX blocks carry their data (for reading and proposing changes).', params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'ms.latex', method: 'GET', fn: 'lib_ms.latex', effect: 'read', desc: "The LaTeX the PDF is built from (main.tex, references.bib, the figures and style files it uses, which lines each block wrote) and the venue's own preamble.", params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'ms.build', method: 'POST', fn: 'lib_ms.build', effect: 'capture', desc: 'Typeset the manuscript as a PDF with LaTeX, in the background (the first build on a computer fetches the engine and its packages, a few minutes; later ones take seconds). One build runs at a time; a second call answers the running one. Follow it with ms.build-status.', params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'ms.build-status', method: 'GET', fn: 'lib_ms.buildStatus', effect: 'read', desc: 'A PDF build (or the latest of a manuscript): running, done or failed, its phase, pages, the errors and warnings LaTeX gave with the block each line came from, whether the manuscript changed since (current), and the latest build that has a PDF (pdf_build).', params: { build: S('Build'), manuscript: S('Manuscript (its latest build)'), log: B("Add the engine's log") } },
  { name: 'ms.pdf', method: 'GET', fn: 'lib_ms.pdf', effect: 'read', desc: "A build's PDF (your AI agent gets its path on disk).", params: { build: S('Build', { required: true }), download: B('Download instead of showing it') } },
  { name: 'ms.create', method: 'POST', fn: 'lib_ms.create', effect: 'capture', desc: "Start a manuscript in a project (outline empty, imrad or review). Your AI agent's outline counts as its text in the AI-use disclosure; write in it with ms.propose.", params: { project: S('Project', { required: true }), title: S('Title'), style: S('Citation style', { enum: STYLES }), template: S('Venue (its LaTeX class, front matter and disclosure)', { enum: TEMPLATES }), outline: S('Starting outline', { enum: ['empty', 'imrad', 'review'] }) } },
  {
    name: 'ms.update',
    method: 'POST',
    fn: 'lib_ms.update',
    effect: 'change',
    agent: 'propose',
    preview: 'lib_ms.updatePreview',
    desc: "Change a manuscript's title, citation style, venue (its LaTeX class and front matter), authors, own LaTeX preamble or style folder.",
    params: {
      manuscript: S('Manuscript', { required: true }),
      title: S('Title'),
      style: S('Style', { enum: STYLES }),
      template: S('Venue', { enum: TEMPLATES }),
      authors: S('JSON list: [{"name":"..","affiliation":"..","email":".."}]'),
      preamble: S('Your own LaTeX from \\documentclass to before the title ("" uses the venue\'s)'),
      style_folder: S('A repository folder with the venue\'s style files (.cls, .sty, .bst); "" for none'),
    },
  },
  { name: 'ms.delete', method: 'POST', fn: 'lib_ms.remove', effect: 'change', agent: 'deny', destructive: true, desc: 'Delete a manuscript.', params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'ms.save-block', method: 'POST', fn: 'lib_ms.saveBlock', effect: 'capture', agent: 'deny', desc: 'Save one block (new when no --block, placed after --after). Citations must name citable papers.', params: { manuscript: S('Manuscript', { required: true }), block: S('Block'), after: S('New block goes after this one ("start" for the top)'), type: S('Type', { enum: BLOCKS }), content: S(CONTENT), data: S(DATA), typed: N('Characters typed since the last save'), pasted: N('Characters pasted since the last save') } },
  { name: 'ms.delete-block', method: 'POST', fn: 'lib_ms.deleteBlock', effect: 'capture', agent: 'deny', desc: 'Delete a block.', params: { block: S('Block', { required: true }) } },
  { name: 'ms.move-block', method: 'POST', fn: 'lib_ms.moveBlock', effect: 'capture', agent: 'deny', desc: 'Move a block after another ("start" for the top).', params: { block: S('Block', { required: true }), after: S('After this block', { required: true }) } },
  {
    name: 'ms.propose',
    method: 'POST',
    fn: 'lib_ms.propose',
    effect: 'judge',
    desc: 'Propose a tracked change: insert a block (after --after or at the start), replace a block, or delete one. The person keeps or undoes it. Citations must name citable papers.',
    params: { manuscript: S('Manuscript', { required: true }), kind: S('Change', { required: true, enum: ['insert', 'replace', 'delete'] }), block: S('Block to replace or delete'), after: S('Insert after this block ("start" for the top)'), type: S('Block type', { enum: BLOCKS }), content: S(CONTENT), data: S(DATA), why: S('Why this change') },
  },
  { name: 'ms.keep', method: 'POST', fn: 'lib_ms.keep', effect: 'confirm', agent: 'deny', desc: "Keep your AI agent's changes (a change to a block edited since is stale).", params: { changes: S('Change ids', { required: true }) } },
  { name: 'ms.undo', method: 'POST', fn: 'lib_ms.discard', effect: 'confirm', agent: 'deny', desc: 'Undo (discard) proposed changes.', params: { changes: S('Change ids', { required: true }) } },
  { name: 'ms.snapshot', method: 'POST', fn: 'lib_ms.snapshot', effect: 'capture', desc: 'Save a labelled snapshot of the text as it is (your AI agent: before proposing large changes).', params: { manuscript: S('Manuscript', { required: true }), label: S('Label') } },
  { name: 'ms.snapshots', method: 'GET', fn: 'lib_ms.snapshots', effect: 'read', desc: 'Snapshots of a manuscript.', params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'ms.restore', method: 'POST', fn: 'lib_ms.restore', effect: 'change', agent: 'deny', desc: 'Go back to a snapshot (the current version is snapshotted first).', params: { snapshot: S('Snapshot', { required: true }) } },
  { name: 'ms.set-status', method: 'POST', fn: 'lib_ms.setStatus', effect: 'confirm', agent: 'deny', desc: 'Mark a manuscript ready (refused while sources are unresolved, unconfirmed or retracted, unless --acknowledge_retracted) or back to draft.', params: { manuscript: S('Manuscript', { required: true }), status: S('Status', { required: true, enum: ['draft', 'ready'] }), acknowledge_retracted: B('Cite a retracted paper knowingly') } },
  { name: 'ms.export', method: 'GET', fn: 'lib_ms.exportMs', effect: 'read', desc: 'Export: LaTeX (main.tex and references.bib, with the figures and style files to put beside them as assets), Markdown with references.bib and its figures, plain text, or the model a Word file is built from. The PDF comes from ms.build.', params: { manuscript: S('Manuscript', { required: true }), format: S('Format', { enum: ['latex', 'markdown', 'docx', 'text'] }) } },

  { name: 'responses.list', method: 'GET', fn: 'lib_responses.list', effect: 'read', desc: 'Reviews received for a manuscript, each with its comments (type, strategy, status, response, linked change).', params: { manuscript: S('Manuscript', { required: true }) } },
  { name: 'responses.add-review', method: 'POST', fn: 'lib_responses.addReview', effect: 'capture', agent: 'deny', desc: 'Paste a review received.', params: { manuscript: S('Manuscript', { required: true }), label: S('Reviewer label'), body: S('The review text'), received_on: S('Date YYYY-MM-DD') } },
  { name: 'responses.update-review', method: 'POST', fn: 'lib_responses.updateReview', effect: 'capture', agent: 'deny', desc: "Change a review's label or text.", params: { review: S('Review', { required: true }), label: S('Label'), body: S('Text') } },
  { name: 'responses.delete-review', method: 'POST', fn: 'lib_responses.removeReview', effect: 'change', agent: 'deny', destructive: true, desc: 'Delete a review and its comments.', params: { review: S('Review', { required: true }) } },
  { name: 'responses.add-items', method: 'POST', fn: 'lib_responses.addItems', effect: 'judge', desc: 'Comments of a review: JSON [{"comment":"..","kind":"major","strategy":"accept","response":".."}] (kinds: major, minor, typo, misunderstanding, praise; strategies: accept, defend, clarify, experiment). Yours wait for a person.', params: { review: S('Review', { required: true }), items: S('JSON list', { required: true }) } },
  {
    name: 'responses.update',
    method: 'POST',
    fn: 'lib_responses.updateItem',
    effect: 'judge',
    desc: "A comment's type, strategy, response, linked change (a manuscript block) and status; addressed needs a linked change.",
    params: { item: S('Comment', { required: true }), comment: S('Comment text'), kind: S('Type', { enum: ['major', 'minor', 'typo', 'misunderstanding', 'praise'] }), strategy: S('Strategy', { enum: ['accept', 'defend', 'clarify', 'experiment'] }), response: S('Response'), change_block: S('The block that changed for it'), change_note: S('Where or what changed'), status: S('Status', { enum: ['open', 'addressed', 'declined', 'unresolved'] }) },
  },
  { name: 'responses.delete-item', method: 'POST', fn: 'lib_responses.removeItem', effect: 'judge', destructive: true, desc: 'Delete a comment (your AI agent: only its own unconfirmed ones).', params: { item: S('Comment', { required: true }) } },
  { name: 'responses.letter', method: 'GET', fn: 'lib_responses.letter', effect: 'read', desc: 'The response letter as Markdown.', params: { manuscript: S('Manuscript', { required: true }) } },
];
