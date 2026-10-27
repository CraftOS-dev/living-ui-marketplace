/**
 * Catalog: the links and files your AI agent reads.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});

const KINDS = ['link', 'file', 'website', 'linkedin', 'github', 'x', 'deck', 'doc', 'video', 'metrics', 'other'];
const SOURCE = S('The source: its id, its link or its title', { required: true });

module.exports = [
  { name: 'sources.list', method: 'GET', fn: 'lib_sources.list', effect: 'read', desc: 'The links and files to read, with their state (new, reading, read, failed), what was learned and, for files, the disk_path to read them from.', params: { state: S('Only this state', { enum: ['new', 'reading', 'read', 'failed'] }) } },
  { name: 'sources.get', method: 'GET', fn: 'lib_sources.get', effect: 'read', desc: 'One source with its summary and disk_path; for a text file (.md, .txt, .csv, .json, .html) its text too. Read PDFs and decks at disk_path with your file tools.', params: { source: SOURCE } },
  { name: 'sources.add', method: 'POST', fn: 'lib_sources.add', effect: 'write', desc: 'Add a link to read (the company site, a founder\'s LinkedIn or GitHub, a launch post).', params: { url: S('The link', { required: true }), kind: S('What it is', { enum: KINDS }), title: S('Title'), founder: S('The founder it is about (id or name)') } },
  { name: 'sources.upload', method: 'POST', fn: 'lib_sources.upload', effect: 'write', files: ['file'], bodyLimit: 52428800, desc: 'Add a file (a deck, notes, a past application). Your AI agent gives --path to a file on this machine.', params: { path: S('Your AI agent: absolute path of the file'), kind: S('What it is', { enum: KINDS }), title: S('Title'), founder: S('The founder it is about (id or name)') } },
  {
    name: 'sources.update',
    method: 'POST',
    fn: 'lib_sources.update',
    effect: 'write',
    desc: 'Record what you learned from a source: its kind and title, state reading/read/failed, and a summary of the facts with numbers and dates.',
    params: { source: SOURCE, kind: S('What it is', { enum: KINDS }), title: S('Title'), state: S('State', { enum: ['new', 'reading', 'read', 'failed'] }), summary: S('The facts learned'), error: S('Why it could not be read'), founder: S('The founder it is about (id or name)') },
  },
  { name: 'sources.remove', method: 'POST', fn: 'lib_sources.remove', effect: 'write', destructive: true, lookup: 'lib_sources.lookup', desc: 'Remove a link or file.', params: { source: SOURCE } },
];
