/**
 * Catalog: each project's research repository (folders and files).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const FOLDER = 'Folder: its id or path, e.g. "data/raw" ("" or left out: the top)';

module.exports = [
  {
    name: 'repo.list',
    method: 'GET',
    fn: 'lib_repo.list',
    effect: 'read',
    desc: "A project's whole repository: every folder and file with its path, size, version and how the app shows it. ready false means its starter repository is not made yet (repo.init makes it).",
    params: { project: S('Project', { required: true }) },
  },
  { name: 'repo.get', method: 'GET', fn: 'lib_repo.get', effect: 'read', desc: 'One folder (with what is directly inside it) or file (with its versions).', params: { item: S('File or folder id', { required: true }) } },
  { name: 'repo.versions', method: 'GET', fn: 'lib_repo.versions', effect: 'read', desc: "A file's versions, newest first: who made each and when.", params: { item: S('File', { required: true }) } },
  { name: 'repo.read', method: 'GET', fn: 'lib_repo.read', effect: 'read', desc: "A text file's content (up to 2 MB: notes, code, CSV, Markdown). For other files, repo.file gives where the file is on this machine.", params: { item: S('File', { required: true }) } },
  {
    name: 'repo.file',
    method: 'GET',
    fn: 'lib_repo.file',
    effect: 'read',
    desc: 'The file itself, or an earlier version. Pages show pictures, PDFs, sound, video and text in place; your AI agent gets where the file is on this machine (disk_path).',
    params: { item: S('File', { required: true }), version: N('Version number (default: the current one)'), download: B('As a download') },
  },
  { name: 'repo.init', method: 'POST', fn: 'lib_repo.init', effect: 'capture', desc: "Make a project's starter repository (README.md, data/raw, data/processed, code, results, docs) if it was never made. New projects get it when they are made.", params: { project: S('Project', { required: true }) } },
  {
    name: 'repo.mkdir',
    method: 'POST',
    fn: 'lib_repo.mkdir',
    effect: 'capture',
    desc: 'Make a folder. A path such as "results/figures/2026" makes each folder that is missing.',
    params: { project: S('Project', { required: true }), name: S('Folder name or path', { required: true, example: 'results/figures' }), folder: S('Inside which folder (' + FOLDER + ')') },
  },
  {
    name: 'repo.upload',
    method: 'POST',
    fn: 'lib_repo.upload',
    effect: 'capture',
    files: ['files'],
    bodyLimit: 1073741824 + 16777216,
    desc: 'Put files in a folder (at most 100 at a time, 1 GB each). A file whose name is already there becomes its next version; the one before is kept. People upload; your AI agent gives --paths.',
    params: { project: S('Project', { required: true }), folder: S(FOLDER), path: S('Subfolders to make under the folder first, e.g. "run-3/plates" (a folder upload)'), paths: S('JSON list of absolute paths of files on this machine (your AI agent)') },
  },
  {
    name: 'repo.write',
    method: 'POST',
    fn: 'lib_repo.write',
    effect: 'capture',
    desc: 'Write a text file (notes, code, CSV, Markdown; up to 2 MB): a new one with --name in --folder, or a new version of one with --item (the one before is kept).',
    params: { project: S('Project (for a new file)'), folder: S(FOLDER), name: S('File name, e.g. analysis.py'), item: S('An existing text file (writes its next version)'), content: S('The whole text of the file ("" for an empty file)') },
  },
  { name: 'repo.rename', method: 'POST', fn: 'lib_repo.rename', effect: 'change', desc: 'Rename a file or folder (names cannot hold / \\ : * ? " < > |).', params: { item: S('File or folder', { required: true }), name: S('New name', { required: true }) } },
  { name: 'repo.move', method: 'POST', fn: 'lib_repo.move', effect: 'change', desc: 'Move files and folders into another folder of the same project.', params: { items: S('Item ids (JSON list or one id)', { required: true }), to: S('Into which folder (' + FOLDER + ')') } },
  {
    name: 'repo.delete',
    method: 'POST',
    fn: 'lib_repo.remove',
    effect: 'change',
    agent: 'propose',
    preview: 'lib_repo.removePreview',
    destructive: true,
    desc: 'Delete files and folders, with everything inside them and every earlier version.',
    params: { items: S('Item ids (JSON list or one id)', { required: true }), preview: B('Only say what would go') },
  },
  { name: 'repo.restore', method: 'POST', fn: 'lib_repo.restore', effect: 'change', desc: 'Make an earlier version of a file the current one; the current one is kept as a version too.', params: { item: S('File', { required: true }), version: N('Version number', { required: true }) } },
];
