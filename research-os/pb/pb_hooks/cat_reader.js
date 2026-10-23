/**
 * Catalog: PDFs, the text layer, passages (anchors) and highlights.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const PASSAGE = {
  file: S('The file (or give --work for its current PDF)'),
  work: S('The paper (its current PDF)'),
  page: N('Page number (1-based)', { required: true }),
  lines: S('Lines "a-b" from pages.text (whole lines)'),
  from_char: N('With lines: start this many characters into the first line'),
  to_char: N('With lines: end this many characters into the last line'),
  start: N('Start offset in the page text (instead of lines)'),
  end: N('End offset in the page text'),
  area: S('An area box [x, y, width, height] in page units (figures, tables)'),
};

module.exports = [
  {
    name: 'files.upload',
    method: 'POST',
    fn: 'lib_files.upload',
    effect: 'capture',
    files: ['file'],
    bodyLimit: 1024 * 1024 * 1024,
    desc: "Add PDFs. With --work it becomes that paper's PDF; otherwise each PDF becomes a paper waiting to be identified. Your AI agent gives --path (a PDF it downloaded); people upload.",
    params: { path: S('Absolute path of a PDF on this computer (your AI agent)'), work: S('The paper this PDF belongs to'), collection: S('Put new papers in this collection'), project: S("Add new papers to this project's reading list") },
  },
  { name: 'files.fetch-oa', method: 'POST', fn: 'lib_files.fetchOa', effect: 'capture', desc: "Download a paper's open-access PDF (arXiv or the open copy its registry lists) and attach it.", params: { work: S('The paper', { required: true }) } },
  { name: 'files.content', method: 'GET', fn: 'lib_files.content', effect: 'read', desc: 'The PDF itself (screens load it; your AI agent gets the file and its file_path to read).', params: { file: S('File id', { required: true }) } },
  { name: 'files.thumb', method: 'GET', fn: 'lib_files.thumb', effect: 'read', desc: "The first page's picture (your AI agent gets thumb_path, where it is on this machine).", params: { file: S('File id', { required: true }) } },
  { name: 'files.set-thumb', method: 'POST', fn: 'lib_files.setThumb', effect: 'capture', agent: 'deny', files: ['thumb'], bodyLimit: 5 * 1024 * 1024, desc: 'Store the first-page picture the reader drew.', params: { file: S('File id', { required: true }) } },
  { name: 'files.position', method: 'POST', fn: 'lib_files.position', effect: 'capture', agent: 'deny', desc: 'Where the person is reading (the read state follows).', params: { file: S('File id', { required: true }), page: N('Page', { required: true }), frac: N('How far down the page, 0 to 1') } },
  { name: 'files.get', method: 'GET', fn: 'lib_files.get', effect: 'read', desc: 'One file: pages, text state, outline, PDF metadata, file_path.', params: { file: S('File id', { required: true }) } },
  { name: 'files.delete', method: 'POST', fn: 'lib_files.remove', effect: 'change', agent: 'propose', preview: 'lib_files.removePreview', destructive: true, desc: 'Remove a PDF and the highlights and passages on it.', params: { file: S('File id', { required: true }), preview: B('Only say what would go') } },
  { name: 'files.retry-text', method: 'POST', fn: 'lib_files.retryText', effect: 'capture', desc: "Read a file's text again after a failure.", params: { file: S('File id', { required: true }) } },

  {
    name: 'pages.text',
    method: 'GET',
    fn: 'lib_text.text',
    effect: 'read',
    desc: 'Read a PDF: pages as numbered lines [line, start, end, text] (10 pages per call; next_from gives the next). Anchor passages by these line numbers.',
    params: { file: S('File id'), work: S('Paper (its current PDF)'), from: N('First page (default 1)'), to: N('Last page (at most 50 per call)') },
  },
  { name: 'pages.get', method: 'GET', fn: 'lib_text.get', effect: 'read', desc: "Pages with their positioned text items (the reader's text layer).", params: { file: S('File id'), work: S('Paper'), from: N('First page'), to: N('Last page (20 at most)') } },
  { name: 'pages.find', method: 'GET', fn: 'lib_text.find', effect: 'read', desc: 'Find words in one paper: matching pages with a snippet.', params: { file: S('File id'), work: S('Paper'), q: S('Words', { required: true }) } },
  {
    name: 'pages.set-ocr',
    method: 'POST',
    fn: 'lib_text.setOcr',
    effect: 'capture',
    desc: 'Store your reading of a scanned page as words with boxes (read_pdf layout mode: x0, top, x1, bottom in points). The page becomes selectable and can be anchored.',
    params: { file: S('File id'), work: S('Paper'), page: N('Page', { required: true }), words: S('JSON list [{"text":"Results","x0":72.1,"top":96.4,"x1":120.3,"bottom":108.0}]', { required: true }) },
  },
  { name: 'pages.ocr-list', method: 'GET', fn: 'lib_text.ocrList', effect: 'read', desc: 'Files with scanned pages waiting to be read (page numbers and file_path).', params: {} },
  { name: 'anchors.create', method: 'POST', fn: 'lib_text.create', effect: 'capture', desc: 'Make a passage on a page (by lines, offsets or an area). Its quote is the page text there.', params: PASSAGE },
  { name: 'anchors.get', method: 'GET', fn: 'lib_text.getAnchor', effect: 'read', desc: 'One passage: quote, page, paper, rectangles.', params: { anchor: S('Passage id', { required: true }) } },

  {
    name: 'annotations.create',
    method: 'POST',
    fn: 'lib_annotations.create',
    effect: 'capture',
    agent: 'deny',
    desc: "Highlight, underline, comment on or box a passage (the person's reading marks).",
    params: Object.assign({ kind: S('Kind of mark', { enum: ['highlight', 'underline', 'note', 'area'] }), color_slot: N('Color 1 to 8 (its meaning is in Settings)'), comment: S('A comment') }, PASSAGE),
  },
  { name: 'annotations.update', method: 'POST', fn: 'lib_annotations.update', effect: 'capture', agent: 'deny', desc: "Change a mark's color, kind or comment.", params: { annotation: S('Mark id', { required: true }), kind: S('Kind', { enum: ['highlight', 'underline', 'note'] }), color_slot: N('Color 1 to 8'), comment: S('Comment') } },
  { name: 'annotations.delete', method: 'POST', fn: 'lib_annotations.remove', effect: 'change', agent: 'deny', destructive: true, desc: 'Remove a mark (Undo brings it back).', params: { annotation: S('Mark id', { required: true }) } },
  { name: 'annotations.list', method: 'GET', fn: 'lib_annotations.list', effect: 'read', desc: "A paper's marks with their passages, by page (or every mark in a project's papers, newest first); filter by color or kind.", params: { work: S('Paper'), file: S('File'), project: S('Project'), color_slot: N('Color 1 to 8'), kind: S('Kind', { enum: ['highlight', 'underline', 'note', 'area'] }) } },
];
