/**
 * Catalog: experiments inside a project (record, runs, journal, results, reuse).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const KINDS = ['lab', 'chemistry', 'computational', 'study', 'field', 'other'];
const STATUS = ['planned', 'running', 'paused', 'done', 'cancelled'];
const RUN_STATUS = ['planned', 'done', 'failed', 'excluded'];
const LOG_KINDS = ['note', 'observation', 'result', 'deviation', 'issue'];
const REASONS = ['typo', 'recording', 'calculation', 'late', 'review', 'other'];
const VARIABLES =
  'JSON list of variables: [{"name":"Temperature","role":"condition","type":"number","unit":"°C","levels":["20","30","37"]},{"name":"Medium","role":"constant","value":"LB broth"},{"name":"OD600","role":"measure","type":"number"}] (roles: condition = varied, constant = held fixed, measure = recorded; types: number, text, category with "options", yesno). Keep a variable\'s "id" to keep its data.';
const STEPS = 'JSON list of protocol steps: ["Prepare 50 mM Tris, pH 7.4", {"text":"Incubate at 37 °C","minutes":30}] (minutes = a timer in bench mode; keep a step\'s "id" to keep its tick)';
const MATERIALS = 'JSON list: [{"name":"Tris buffer","detail":"50 mM, pH 7.4"},{"name":"Python","detail":"3.12, numpy 2.1"}]';
const LINKS = 'JSON list of what it tests: [{"kind":"node","id":"<claim or question>"},{"kind":"work","id":"<paper>"}]';

module.exports = [
  { name: 'exp.list', method: 'GET', fn: 'lib_exp.list', effect: 'read', desc: "A project's experiments: status, outcome, tags, dates, the next protocol step, runs and journal counts, lineage.", params: { project: S('Project', { required: true }), status: S('Only this status', { enum: STATUS }) } },
  { name: 'exp.get', method: 'GET', fn: 'lib_exp.get', effect: 'read', desc: 'One experiment: objective, design (variables, materials), protocol with ticks, links, status and dates, outcome and conclusion, what it repeats and its repeats.', params: { experiment: S('Experiment', { required: true }) } },
  { name: 'exp.runs', method: 'GET', fn: 'lib_exp.runs', effect: 'read', desc: "An experiment's runs (values keyed by variable id; the variables come with them).", params: { experiment: S('Experiment', { required: true }), status: S('Only this status', { enum: RUN_STATUS }) } },
  { name: 'exp.entries', method: 'GET', fn: 'lib_exp.entries', effect: 'read', desc: "An experiment's journal, oldest first: kind, what it is about (step or run), corrections, strike-throughs, late entries, files (with file_path for your AI agent).", params: { experiment: S('Experiment', { required: true }), limit: N('The newest this many (default 500)') } },
  { name: 'exp.results', method: 'GET', fn: 'lib_exp.results', effect: 'read', desc: 'Per measure, n, mean, SD, min and max (or counts for text, categories and yes/no) by condition group, from done runs.', params: { experiment: S('Experiment', { required: true }), by: S('The conditions that make the groups: variable ids, or a JSON list of names (default all; the rest pool, e.g. seeds or batches as replicates; [] pools every run)') } },
  { name: 'exp.export', method: 'GET', fn: 'lib_exp.exportCsv', effect: 'read', desc: 'The runs as CSV: a column per condition and measure, with units.', params: { experiment: S('Experiment', { required: true }) } },
  { name: 'exp.file', method: 'GET', fn: 'lib_exp.file', effect: 'read', desc: 'A file attached to a journal entry (your AI agent gets its file_path).', params: { entry: S('Journal entry', { required: true }), name: S('Stored file name, as exp.entries lists it', { required: true }) } },
  { name: 'exp.templates', method: 'GET', fn: 'lib_exp.templates', effect: 'read', desc: 'Templates (plans and protocols kept for reuse), usable in every project.', params: {} },
  {
    name: 'exp.create',
    method: 'POST',
    fn: 'lib_exp.create',
    effect: 'capture',
    desc: 'Plan a new experiment in a project (numbered EXP-001, EXP-002...), blank or from a template.',
    params: { project: S('Project', { required: true }), title: S('Title (from a template: defaults to its name)'), template: S('Template to start from'), kind: S('Kind', { enum: KINDS }), aim: S('What it sets out to find'), hypothesis: S('What you expect, and why'), variables: S(VARIABLES), steps: S(STEPS), materials: S(MATERIALS), links: S(LINKS), tags: S('JSON list of tags'), planned_start: S('Planned start, YYYY-MM-DD'), planned_end: S('Planned end, YYYY-MM-DD') },
  },
  { name: 'exp.repeat', method: 'POST', fn: 'lib_exp.repeat', effect: 'capture', desc: 'Run an experiment again: a new planned experiment with the same objective, design and protocol (unticked), linked to the original. Runs, journal and conclusion start empty.', params: { experiment: S('Experiment to repeat', { required: true }), title: S('Title (default: the same with "(repeat)")'), planned_start: S('Planned start, YYYY-MM-DD') } },
  {
    name: 'exp.update',
    method: 'POST',
    fn: 'lib_exp.update',
    effect: 'capture',
    desc: 'Change an experiment: title, kind, aim, hypothesis, variables, steps, materials, links, tags, planned dates, pin, or status (running stamps the start, done or cancelled the end; the journal notes each change).',
    params: { experiment: S('Experiment', { required: true }), title: S('Title'), kind: S('Kind', { enum: KINDS }), aim: S('Aim'), hypothesis: S('Hypothesis'), variables: S(VARIABLES), steps: S(STEPS), materials: S(MATERIALS), links: S(LINKS), tags: S('JSON list of tags'), planned_start: S('Planned start, YYYY-MM-DD ("" clears it)'), planned_end: S('Planned end, YYYY-MM-DD ("" clears it)'), pinned: B('Pinned to the top of the list'), status: S('Status', { enum: STATUS }) },
  },
  { name: 'exp.step', method: 'POST', fn: 'lib_exp.step', effect: 'capture', desc: 'Tick (or untick with --done false) a protocol step of a started experiment; the journal notes it with the time.', params: { experiment: S('Experiment', { required: true }), step: S('Step id', { required: true }), done: B('Done (default: the opposite of now)') } },
  { name: 'exp.delete', method: 'POST', fn: 'lib_exp.remove', effect: 'change', agent: 'deny', destructive: true, desc: 'Delete an experiment with its runs, journal and files (--preview shows what goes). Its repeats stay.', params: { experiment: S('Experiment', { required: true }), preview: B('Only show what would go') } },
  {
    name: 'exp.add-runs',
    method: 'POST',
    fn: 'lib_exp.addRuns',
    effect: 'capture',
    desc: 'Record runs (trials, samples, participants, simulations). A run with a measured value is done unless a status says otherwise. Record only values that were measured or computed.',
    params: { experiment: S('Experiment', { required: true }), runs: S('JSON list: [{"values":{"Temperature":37,"OD600":0.82},"status":"done","note":".."}] (values by variable name)'), csv: S('Or CSV / tab-separated text: a header row of variable names (Status and Note columns optional), then one row per run') },
  },
  { name: 'exp.plan-runs', method: 'POST', fn: 'lib_exp.planRuns', effect: 'capture', desc: 'Plan one run for every combination of condition levels, times replicates (--preview counts them).', params: { experiment: S('Experiment', { required: true }), replicates: N('Replicates of each combination (default 1)'), preview: B('Only count the runs') } },
  { name: 'exp.update-run', method: 'POST', fn: 'lib_exp.updateRun', effect: 'capture', desc: 'Change a run: values (merged; "" clears one), status or note. Measuring a planned run makes it done.', params: { run: S('Run', { required: true }), values: S('JSON object of values by variable name'), status: S('Status', { enum: RUN_STATUS }), note: S('Note') } },
  { name: 'exp.delete-runs', method: 'POST', fn: 'lib_exp.removeRuns', effect: 'change', destructive: true, desc: 'Remove runs (Activity can bring them back).', params: { runs: S('Run ids', { required: true }) } },
  {
    name: 'exp.log',
    method: 'POST',
    fn: 'lib_exp.log',
    effect: 'capture',
    files: ['files'],
    bodyLimit: 200 * 1024 * 1024,
    desc: "Write in an experiment's journal: a note, observation, result, deviation or issue, about a step or a run when given, with files (people upload; your AI agent gives --paths). An entry dated earlier shows as a late entry.",
    params: { experiment: S('Experiment', { required: true }), text: S('What happened'), kind: S('Kind of entry', { enum: LOG_KINDS }), ref: S('What it is about: {"kind":"step","id":"<step>"} or {"kind":"run","id":"<run>"}'), at: S('When it happened, "YYYY-MM-DD HH:MM" (default now)'), paths: S('JSON list of absolute paths of files to attach (your AI agent)') },
  },
  { name: 'exp.correct', method: 'POST', fn: 'lib_exp.correct', effect: 'capture', desc: "Correct a journal entry's text or kind. The original stays in its history with the reason. The app's own entries stay as written.", params: { entry: S('Journal entry', { required: true }), text: S('Corrected text'), kind: S('Kind', { enum: LOG_KINDS }), reason: S('Why', { required: true, enum: REASONS }) } },
  { name: 'exp.strike', method: 'POST', fn: 'lib_exp.strike', effect: 'capture', desc: 'Strike a journal entry through with a reason. It stays legible in the journal; nothing is erased.', params: { entry: S('Journal entry', { required: true }), reason: S('Why it is struck out', { required: true }) } },
  { name: 'exp.conclude', method: 'POST', fn: 'lib_exp.conclude', effect: 'judge', desc: "The outcome (supports, refutes, inconclusive, failed), what the data show, and next steps. Your AI agent's conclusion stays proposed until a person keeps it.", params: { experiment: S('Experiment', { required: true }), outcome: S('Outcome ("" clears it)', { enum: ['supports', 'refutes', 'inconclusive', 'failed', ''] }), summary: S('What the data show: effects with n, caveats'), next_steps: S('What to do next') } },
  { name: 'exp.save-template', method: 'POST', fn: 'lib_exp.saveTemplate', effect: 'capture', desc: "Keep an experiment's objective, design and protocol as a template for any project.", params: { experiment: S('Experiment', { required: true }), name: S('Template name (default: the title)') } },
  { name: 'exp.delete-template', method: 'POST', fn: 'lib_exp.removeTemplate', effect: 'change', agent: 'deny', destructive: true, desc: 'Remove a template (experiments made from it keep their copy).', params: { template: S('Template', { required: true }) } },
];
