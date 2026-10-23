/// <reference path="../pb_data/types.d.ts" />
/**
 * Experiments: a project's experiments of any kind (bench, chemistry,
 * simulation, a study with people, field work). Design and research:
 * reports/Experiments redesign.md.
 *
 *   Record   one notebook page: objective (aim, hypothesis), design
 *            (variables: conditions varied with their levels, what is held
 *            constant, what is measured; materials), protocol steps ticked off
 *            while it runs (each with an optional duration), runs, results,
 *            conclusion (outcome, summary, next steps).
 *   Status   progress (planned, running, paused, done, cancelled) and outcome
 *            (supports, refutes, inconclusive, failed) are separate; the first
 *            start and the end are stamped.
 *   Runs     one row per trial, sample, participant or simulation; "plan runs"
 *            makes every combination of condition levels times replicates.
 *   Journal  append-first: entries stamped with time and author, about a step
 *            or a run when given; corrections keep the original and a reason;
 *            removing strikes an entry through with a reason, it is never
 *            erased. The app writes status changes, ticked steps and runs.
 *   Reuse    run again (copies the plan, links back), templates for any project.
 *
 * Run values are keyed by variable id, so renaming a variable keeps its data
 * and removing one keeps the values (undo brings the variable back whole).
 */

const KINDS = ['lab', 'chemistry', 'computational', 'study', 'field', 'other'];
const STATUS = ['planned', 'running', 'paused', 'done', 'cancelled'];
const OUTCOMES = ['supports', 'refutes', 'inconclusive', 'failed'];
const ROLES = ['condition', 'constant', 'measure'];
const TYPES = ['number', 'text', 'category', 'yesno'];
const RUN_STATUS = ['planned', 'done', 'failed', 'excluded'];
const LOG_KINDS = ['note', 'observation', 'result', 'deviation', 'issue'];
const REASONS = ['typo', 'recording', 'calculation', 'late', 'review', 'other'];
const LINKS = { work: 'works', node: 'nodes' };
const LOG_WORD = { note: 'a note', observation: 'an observation', result: 'a result', deviation: 'a deviation', issue: 'an issue' };
const OUTCOME_WORD = { supports: 'supports the hypothesis', refutes: 'refutes the hypothesis', inconclusive: 'inconclusive', failed: 'failed, to be run again' };

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}

const code = (n) => 'EXP-' + String(n).padStart(3, '0');
const now = () => u().nowIso().replace('T', ' ');

function expOf(ctx, id) {
  const e = core().need(ctx.app, 'experiments', id, 'experiment');
  core().guardProjectId(ctx, e.getString('project'));
  return e;
}

/** Change an experiment inside one transaction, read afresh there (two quick edits never save over each other). Our own errors keep their status. */
function locked(app, id, fn) {
  let res;
  let failure = null;
  try {
    app.runInTransaction((tx) => {
      try {
        res = fn(tx, tx.findRecordById('experiments', id));
      } catch (e) {
        failure = e;
        throw e;
      }
    });
  } catch (e) {
    throw failure !== null ? failure : e;
  }
  return res;
}

/* ----------------------------------------------------------- cleaning */

const squash = (s) => u().squash(String(s === undefined || s === null ? '' : s));
/** Screens may name a new item's id themselves (8 lowercase letters or digits) so a row being typed in keeps its place. */
const okId = (id) => typeof id === 'string' && /^[a-z0-9]{8}$/.test(id);

function strList(util, raw, where, maxItems, maxLen) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw util.fail(400, where + ' is a list', 'invalid_param');
  const out = [];
  for (const x of raw) {
    const v = squash(x);
    if (v === '') continue;
    if (v.length > maxLen) throw util.fail(400, where + ': "' + v.slice(0, 40) + '..." is too long (at most ' + maxLen + ' characters)', 'invalid_param');
    if (!out.some((y) => y.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  if (out.length > maxItems) throw util.fail(400, where + ' takes at most ' + maxItems + ' items', 'invalid_param');
  return out;
}

/** Tags: lower case, one word or short phrase each, at most 12. */
function cleanTags(util, raw) {
  return strList(util, raw, 'tags', 12, 40).map((t) => t.toLowerCase());
}

/** Variables: [{id, name, role, type, unit, levels (condition), value (constant), options (category)}]. Known ids are kept. */
function cleanVariables(util, raw, before) {
  if (!Array.isArray(raw)) throw util.fail(400, 'variables is a JSON list: [{"name":"Temperature","role":"condition","type":"number","unit":"°C","levels":["20","37"]}] (roles: condition, constant, measure; types: number, text, category, yesno)', 'invalid_param', { param: 'variables' });
  if (raw.length > 60) throw util.fail(400, 'An experiment takes at most 60 variables.', 'invalid_param', { param: 'variables' });
  const known = {};
  for (const v of before || []) known[v.id] = true;
  const out = [];
  raw.forEach((v, i) => {
    const where = 'Variable ' + (i + 1);
    util.keysOnly(v, ['id', 'name', 'role', 'type', 'unit', 'levels', 'value', 'options'], where);
    const name = squash(v.name);
    if (name === '') throw util.fail(400, where + ' needs a name.', 'invalid_param', { param: 'variables' });
    if (name.length > 120) throw util.fail(400, where + ': the name is too long (at most 120 characters).', 'invalid_param', { param: 'variables' });
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw util.fail(400, 'Two variables are called "' + name + '"; give each its own name.', 'duplicate_name', { param: 'variables' });
    const role = util.choice(v.role, ROLES, 'measure', where + ' role', 'variables');
    const type = util.choice(v.type, TYPES, role === 'constant' ? 'text' : 'number', where + ' type', 'variables');
    const unit = squash(v.unit);
    if (unit.length > 40) throw util.fail(400, where + ': the unit is too long (at most 40 characters).', 'invalid_param', { param: 'variables' });
    const o = { id: (known[v.id] || okId(v.id)) && !out.some((x) => x.id === v.id) ? v.id : util.token(8), name: name, role: role, type: type, unit: unit };
    if (role === 'condition') o.levels = strList(util, v.levels, where + ' levels', 100, 120);
    if (role === 'constant') o.value = squash(v.value).slice(0, 300);
    if (type === 'category') o.options = strList(util, role === 'condition' && (v.options === undefined || v.options.length === 0) ? v.levels : v.options, where + ' options', 50, 120);
    if (type === 'number' && role === 'condition') for (const l of o.levels) if (!Number.isFinite(Number(l))) throw util.fail(400, where + ' is a number: level "' + l + '" is not a number.', 'invalid_param', { param: 'variables' });
    out.push(o);
  });
  return out;
}

/** Protocol steps: strings or {id, text, done, minutes}; ticks keep their time. */
function cleanSteps(util, raw, before) {
  if (!Array.isArray(raw)) throw util.fail(400, 'steps is a JSON list: ["Prepare the buffer", {"text":"Incubate at 37 °C","minutes":30}]', 'invalid_param', { param: 'steps' });
  if (raw.length > 200) throw util.fail(400, 'A protocol takes at most 200 steps.', 'invalid_param', { param: 'steps' });
  const old = {};
  for (const s of before || []) old[s.id] = s;
  const out = [];
  for (const s of raw) {
    const o = typeof s === 'string' ? { text: s } : s || {};
    const text = String(o.text === undefined || o.text === null ? '' : o.text).replace(/\r\n/g, '\n').trim();
    if (text === '') continue;
    if (text.length > 2000) throw util.fail(400, 'A step is at most 2000 characters.', 'invalid_param', { param: 'steps' });
    const prev = typeof o.id === 'string' ? old[o.id] : undefined;
    const done = o.done === undefined ? (prev ? prev.done === true : false) : o.done === true;
    const minutes = o.minutes === undefined ? (prev ? prev.minutes || 0 : 0) : Number(o.minutes);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 100000) throw util.fail(400, 'A step\'s minutes is a number from 0 to 100000.', 'invalid_param', { param: 'steps' });
    const sid = prev ? prev.id : okId(o.id) && !out.some((x) => x.id === o.id) ? o.id : util.token(8);
    out.push({ id: sid, text: text, minutes: Math.round(minutes * 10) / 10, done: done, done_at: done ? (prev && prev.done ? prev.done_at || '' : now()) : '' });
  }
  return out;
}

/** Materials and setup: strings or {id, name, detail} (reagents, instruments, software and versions, datasets, participants...). */
function cleanMaterials(util, raw, before) {
  if (!Array.isArray(raw)) throw util.fail(400, 'materials is a JSON list: [{"name":"Tris buffer","detail":"50 mM, pH 7.4"}]', 'invalid_param', { param: 'materials' });
  if (raw.length > 200) throw util.fail(400, 'At most 200 materials.', 'invalid_param', { param: 'materials' });
  const known = {};
  for (const m of before || []) known[m.id] = true;
  const out = [];
  for (const m of raw) {
    const o = typeof m === 'string' ? { name: m } : m || {};
    const name = squash(o.name);
    if (name === '') continue;
    out.push({ id: (known[o.id] || okId(o.id)) && !out.some((x) => x.id === o.id) ? o.id : util.token(8), name: name.slice(0, 200), detail: squash(o.detail).slice(0, 1000) });
  }
  return out;
}

/** What the experiment tests: claims or questions of the project, and papers. */
function cleanLinks(ctx, util, raw, projectId) {
  if (!Array.isArray(raw)) throw util.fail(400, 'links is a JSON list: [{"kind":"node","id":"<claim>"},{"kind":"work","id":"<paper>"}]', 'invalid_param', { param: 'links' });
  if (raw.length > 50) throw util.fail(400, 'At most 50 links.', 'invalid_param', { param: 'links' });
  const out = [];
  raw.forEach((l, i) => {
    util.keysOnly(l, ['kind', 'id'], 'Link ' + (i + 1));
    const col = LINKS[l.kind];
    if (col === undefined) throw util.fail(400, 'Link ' + (i + 1) + ': kind is node (a claim or question) or work (a paper).', 'invalid_param', { param: 'links' });
    const rec = core().need(ctx.app, col, String(l.id || ''), l.kind === 'node' ? 'claim' : 'paper');
    if (l.kind === 'work') {
      if (rec.getBool('trashed')) throw util.fail(409, 'Link ' + (i + 1) + ': that paper is in the trash.', 'invalid_param');
      core().guardWork(ctx, rec);
    } else if (rec.getString('project') !== projectId) throw util.fail(400, 'Link ' + (i + 1) + ': that claim belongs to another project.', 'invalid_param');
    if (!out.some((x) => x.kind === l.kind && x.id === rec.id)) out.push({ kind: l.kind, id: rec.id });
  });
  return out;
}

/** Find a variable by id or (case-insensitive) name, with or without its unit. */
function variableOf(vars, key) {
  const k = String(key).trim().toLowerCase();
  return vars.find((v) => v.id === key) || vars.find((v) => v.name.toLowerCase() === k) || vars.find((v) => (v.name + (v.unit ? ' (' + v.unit + ')' : '')).toLowerCase() === k) || null;
}

/** A value checked against its variable's type ('' or null clears it). */
function valueFor(util, v, raw, where) {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '') return null;
  if (v.type === 'number') {
    const n = typeof s === 'number' ? s : Number(String(s).replace(/,(?=\d{3}(\D|$))/g, ''));
    if (!Number.isFinite(n)) throw util.fail(400, where + ': "' + v.name + '" takes a number, not "' + String(s).slice(0, 40) + '".', 'invalid_value', { variable: v.name });
    return n;
  }
  if (v.type === 'yesno') {
    const t = String(s).toLowerCase();
    if (['true', 'yes', 'y', '1'].indexOf(t) >= 0 || s === true) return true;
    if (['false', 'no', 'n', '0'].indexOf(t) >= 0 || s === false) return false;
    throw util.fail(400, where + ': "' + v.name + '" takes yes or no, not "' + String(s).slice(0, 40) + '".', 'invalid_value', { variable: v.name });
  }
  const t = String(s).slice(0, 2000);
  if (v.type === 'category' && (v.options || []).length > 0) {
    const hit = v.options.find((o) => o.toLowerCase() === t.toLowerCase());
    if (!hit) throw util.fail(400, where + ': "' + v.name + '" is one of ' + v.options.join(', ') + ', not "' + t.slice(0, 40) + '".', 'invalid_value', { variable: v.name });
    return hit;
  }
  return t;
}

/** Values keyed by variable id, merged onto what the run had. */
function valuesFor(util, vars, raw, before, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw util.fail(400, where + ': values is an object keyed by variable name, e.g. {"Temperature": 37, "Yield": 82.5}.', 'invalid_param');
  const out = Object.assign({}, before || {});
  for (const k of Object.keys(raw)) {
    const v = variableOf(vars, k);
    if (v === null) throw util.fail(400, where + ': no variable "' + k + '". The variables are: ' + (vars.map((x) => x.name).join(', ') || 'none yet (add them to the design)') + '.', 'unknown_variable', { variable: k });
    if (v.role === 'constant') throw util.fail(400, where + ': "' + v.name + '" is held constant; its value is part of the design.', 'invalid_param', { variable: v.name });
    const val = valueFor(util, v, raw[k], where);
    if (val === null) delete out[v.id];
    else out[v.id] = val;
  }
  return out;
}

const hasMeasure = (vars, values) => vars.some((v) => v.role === 'measure' && values[v.id] !== undefined && values[v.id] !== null);

/* ------------------------------------------------------------- output */

function linksOut(app, links) {
  const util = u();
  return (links || [])
    .map((l) => {
      const rec = LINKS[l.kind] ? util.byId(app, LINKS[l.kind], l.id) : null;
      return rec === null ? null : { kind: l.kind, id: l.id, title: rec.getString('title'), node_kind: l.kind === 'node' ? rec.getString('kind') : '' };
    })
    .filter((x) => x !== null);
}

const brief = (e) => ({ id: e.id, code: code(e.getInt('number')), title: e.getString('title'), status: e.getString('status') });

function expOut(app, e) {
  const util = u();
  const c = util.one(
    app,
    "SELECT COUNT(*) AS runs, COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done, COALESCE(SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END), 0) AS planned, COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed, COALESCE(SUM(CASE WHEN status = 'excluded' THEN 1 ELSE 0 END), 0) AS excluded FROM exp_runs WHERE experiment = {:e}",
    { runs: 0, done: 0, planned: 0, failed: 0, excluded: 0 },
    { e: e.id },
  );
  const log = util.one(app, "SELECT COUNT(*) AS n, COALESCE(MAX(at), '') AS last FROM exp_log WHERE experiment = {:e} AND struck = ''", { n: 0, last: '' }, { e: e.id });
  const steps = util.jsonOf(e, 'steps') || [];
  const nextIndex = steps.findIndex((s) => !s.done);
  const parent = e.getString('parent') !== '' ? util.byId(app, 'experiments', e.getString('parent')) : null;
  return {
    id: e.id,
    project: e.getString('project'),
    number: e.getInt('number'),
    code: code(e.getInt('number')),
    title: e.getString('title'),
    kind: e.getString('kind'),
    status: e.getString('status'),
    outcome: e.getString('outcome'),
    aim: e.getString('aim'),
    hypothesis: e.getString('hypothesis'),
    variables: util.jsonOf(e, 'variables') || [],
    steps: steps,
    next_step: nextIndex >= 0 ? { id: steps[nextIndex].id, index: nextIndex, text: steps[nextIndex].text, minutes: steps[nextIndex].minutes || 0 } : null,
    materials: util.jsonOf(e, 'materials') || [],
    links: linksOut(app, util.jsonOf(e, 'links')),
    tags: util.jsonOf(e, 'tags') || [],
    planned_start: e.getString('planned_start'),
    planned_end: e.getString('planned_end'),
    started_at: e.getString('started_at'),
    ended_at: e.getString('ended_at'),
    pinned: e.getBool('pinned'),
    summary: e.getString('summary'),
    next_steps: e.getString('next_steps'),
    conclusion_by: e.getString('conclusion_by'),
    parent: parent !== null ? brief(parent) : null,
    repeats: app.findRecordsByFilter('experiments', 'parent = {:e}', 'number', 0, 0, { e: e.id }).map(brief),
    actor: e.getString('actor'),
    counts: Object.assign(util.plain([c])[0], { log: log ? log.n : 0, steps: steps.length, steps_done: steps.filter((s) => s.done).length }),
    last_log: log ? log.last : '',
    created: e.getString('created'),
    updated: e.getString('updated'),
  };
}

function runOut(r) {
  return { id: r.id, number: r.getInt('number'), code: 'R' + r.getInt('number'), values: u().jsonOf(r, 'values') || {}, status: r.getString('status'), note: r.getString('note'), recorded_at: r.getString('recorded_at'), actor: r.getString('actor'), created: r.getString('created') };
}

/** A stored file's name without the random part PocketBase adds ("gel_ab12cd34ef.png" reads "gel.png"). */
function shownName(n) {
  return String(n).replace(/_[a-z0-9]{10}(\.[A-Za-z0-9]+)?$/, '$1');
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json' };
const extOf = (n) => (String(n).match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();

/** What a journal entry is about, for people: "Step 3: Incubate..." or "R12". */
function refOut(app, e, ref) {
  if (!ref || typeof ref !== 'object' || !ref.kind) return null;
  if (ref.kind === 'step') {
    const steps = u().jsonOf(e, 'steps') || [];
    const i = steps.findIndex((s) => s.id === ref.id);
    return { kind: 'step', id: ref.id, label: i >= 0 ? 'Step ' + (i + 1) : 'A removed step', text: i >= 0 ? steps[i].text : '' };
  }
  if (ref.kind === 'run') {
    const r = u().byId(app, 'exp_runs', ref.id);
    return { kind: 'run', id: ref.id, label: r !== null ? 'R' + r.getInt('number') : 'A removed run', text: '' };
  }
  return null;
}

function logOut(app, e, l, withPaths) {
  const util = u();
  const names = l.getStringSlice('files') || [];
  const at = l.getString('at');
  const created = l.getString('created');
  const late = util.ms(created) - util.ms(at) > 10 * 60 * 1000;
  return {
    id: l.id,
    kind: l.getString('kind'),
    text: l.getString('text'),
    files: names.map((n) => {
      const o = { name: n, shown: shownName(n), image: /^image\//.test(MIME[extOf(n)] || '') };
      if (withPaths) o.file_path = $filepath.join(app.dataDir(), 'storage', l.baseFilesPath(), n);
      return o;
    }),
    ref: refOut(app, e, util.jsonOf(l, 'ref')),
    edits: util.jsonOf(l, 'edits') || [],
    struck: l.getString('struck'),
    struck_at: l.getString('struck_at'),
    at: at,
    late: late,
    written_at: created,
    actor: l.getString('actor'),
  };
}

/** A journal entry the app writes itself (status changes, steps, runs). */
function sysLog(app, ctx, expId, text, ref) {
  const l = u().newRecord(app, 'exp_log');
  l.set('experiment', expId);
  l.set('kind', 'system');
  l.set('text', text);
  if (ref) l.set('ref', ref);
  l.set('at', now());
  l.set('actor', ctx.actor === 'agent' ? 'agent' : 'system');
  app.save(l);
}

const PLAN_FIELDS = ['title', 'kind', 'status', 'outcome', 'aim', 'hypothesis', 'variables', 'steps', 'materials', 'links', 'tags', 'planned_start', 'planned_end', 'started_at', 'ended_at', 'pinned', 'summary', 'next_steps', 'conclusion_by'];

function snapshot(e) {
  const util = u();
  const o = {};
  for (const k of PLAN_FIELDS) o[k] = ['variables', 'steps', 'materials', 'links', 'tags'].indexOf(k) >= 0 ? util.jsonOf(e, k) || [] : k === 'pinned' ? e.getBool(k) : e.getString(k);
  return o;
}

function restore(rec, s) {
  for (const k of Object.keys(s)) rec.set(k, s[k]);
}

/* -------------------------------------------------------------- reads */

/** exp.list: a project's experiments with what is next in each, in number order. */
function list(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const rows = ctx.app.findRecordsByFilter('experiments', 'project = {:p}', 'number', 0, 0, { p: pr.id }).map((e) => expOut(ctx.app, e));
  const status = util.oneOf(p, 'status', STATUS, '');
  return { experiments: status === '' ? rows : rows.filter((x) => x.status === status) };
}

/** exp.get: one experiment with its plan, lineage and counts. */
function get(ctx, p) {
  return { experiment: expOut(ctx.app, expOf(ctx, u().req(p, 'experiment'))) };
}

/** exp.runs: every run of an experiment, in order. */
function runs(ctx, p) {
  const util = u();
  const e = expOf(ctx, util.req(p, 'experiment'));
  const status = util.oneOf(p, 'status', RUN_STATUS, '');
  const rows = ctx.app.findRecordsByFilter('exp_runs', status === '' ? 'experiment = {:e}' : 'experiment = {:e} && status = {:s}', 'number', 0, 0, { e: e.id, s: status }).map(runOut);
  return { runs: rows, variables: util.jsonOf(e, 'variables') || [] };
}

/** exp.entries: the journal, oldest first (the newest `limit` entries). */
function entries(ctx, p) {
  const util = u();
  const e = expOf(ctx, util.req(p, 'experiment'));
  const lim = util.int(p, 'limit', 500, 1, 5000);
  const recs = ctx.app.findRecordsByFilter('exp_log', 'experiment = {:e}', '-at,-created', lim, 0, { e: e.id });
  // The records come as a Go-backed list: map to plain objects before reversing (reversing it in place swaps entries wrongly).
  return { entries: recs.map((l) => logOut(ctx.app, e, l, ctx.isAgent)).reverse(), total: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM exp_log WHERE experiment = {:e}', { e: e.id }) };
}

/** The value of a run for a variable, written for a person. */
function shown(v, val) {
  if (val === undefined || val === null) return '';
  if (v.type === 'yesno') return val === true ? 'Yes' : 'No';
  return String(val);
}

/** exp.results: per measure, n, mean, SD, min and max (numbers) or counts (other types) by condition group, from done runs. --by picks the conditions that make the groups (the others pool, e.g. seeds or batches as replicates). */
function results(ctx, p) {
  const util = u();
  const e = expOf(ctx, util.req(p, 'experiment'));
  const vars = util.jsonOf(e, 'variables') || [];
  const allConds = vars.filter((v) => v.role === 'condition');
  let conds = allConds;
  if (util.has(p, 'by')) {
    const keys = util.ids(p, 'by', 60);
    const want = keys.map((k) => variableOf(vars, k));
    for (let i = 0; i < want.length; i++) if (want[i] === null || want[i].role !== 'condition') throw util.fail(400, '"' + keys[i] + '" is not a condition. The conditions are: ' + (allConds.map((c) => c.name).join(', ') || 'none') + '.', 'unknown_variable');
    conds = allConds.filter((c) => want.some((w) => w.id === c.id));
  }
  const measures = vars.filter((v) => v.role === 'measure');
  const rs = ctx.app.findRecordsByFilter('exp_runs', "experiment = {:e} && status = 'done'", 'number', 0, 0, { e: e.id }).map(runOut);
  // A group is one combination of condition values, in the order the levels were planned.
  const groupKey = (r) => conds.map((c) => shown(c, r.values[c.id])).join(' · ');
  const order = (c, val) => {
    const i = (c.levels || []).indexOf(shown(c, val));
    return i >= 0 ? i : 1000;
  };
  const groups = {};
  for (const r of rs) {
    const k = groupKey(r);
    if (!groups[k]) groups[k] = { key: k, conditions: conds.map((c) => ({ variable: c.id, name: c.name, value: shown(c, r.values[c.id]) })), runs: [] };
    groups[k].runs.push(r);
  }
  const keys = Object.keys(groups).sort((a, b) => {
    const ra = groups[a].runs[0];
    const rb = groups[b].runs[0];
    for (const c of conds) {
      const d = order(c, ra.values[c.id]) - order(c, rb.values[c.id]);
      if (d !== 0) return d;
      const va = ra.values[c.id];
      const vb = rb.values[c.id];
      if (typeof va === 'number' && typeof vb === 'number' && va !== vb) return va - vb;
      if (String(va) !== String(vb)) return String(va) < String(vb) ? -1 : 1;
    }
    return 0;
  });
  const out = measures.map((m) => {
    const rows = keys.map((k) => {
      const g = groups[k];
      const vals = g.runs.map((r) => r.values[m.id]).filter((x) => x !== undefined && x !== null);
      const row = { key: k, conditions: g.conditions, n: vals.length };
      if (m.type === 'number') {
        const nums = vals.filter((x) => typeof x === 'number');
        const n = nums.length;
        const mean = n > 0 ? nums.reduce((a, b) => a + b, 0) / n : null;
        const sd = n > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : null;
        Object.assign(row, { n: n, mean: mean, sd: sd, min: n > 0 ? Math.min.apply(null, nums) : null, max: n > 0 ? Math.max.apply(null, nums) : null, values: nums });
      } else {
        const counts = {};
        for (const x of vals) counts[shown(m, x)] = (counts[shown(m, x)] || 0) + 1;
        row.counts = counts;
      }
      return row;
    });
    return { variable: m.id, name: m.name, unit: m.unit, type: m.type, groups: rows };
  });
  const c = util.one(ctx.app, "SELECT COUNT(*) AS runs, COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done, COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed, COALESCE(SUM(CASE WHEN status = 'excluded' THEN 1 ELSE 0 END), 0) AS excluded FROM exp_runs WHERE experiment = {:e}", { runs: 0, done: 0, failed: 0, excluded: 0 }, { e: e.id });
  return { experiment: e.id, conditions: allConds.map((x) => ({ id: x.id, name: x.name, unit: x.unit, type: x.type })), grouped_by: conds.map((x) => x.id), measures: out, runs: util.plain([c])[0] };
}

/** exp.export: the runs as CSV (a column per condition and measure, with units). */
function exportCsv(ctx, p) {
  const util = u();
  const e = expOf(ctx, util.req(p, 'experiment'));
  const vars = (util.jsonOf(e, 'variables') || []).filter((v) => v.role !== 'constant');
  const esc = (s) => {
    let v = String(s === undefined || s === null ? '' : s);
    if (/^[=+\-@]/.test(v) && !/^-?\d/.test(v)) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const head = ['Run', 'Status'].concat(vars.map((v) => v.name + (v.unit ? ' (' + v.unit + ')' : ''))).concat(['Note', 'Recorded']);
  const lines = [head.map(esc).join(',')];
  for (const r of ctx.app.findRecordsByFilter('exp_runs', 'experiment = {:e}', 'number', 0, 0, { e: e.id }).map(runOut)) {
    lines.push(['R' + r.number, r.status].concat(vars.map((v) => shown(v, r.values[v.id]))).concat([r.note, r.recorded_at]).map(esc).join(','));
  }
  return { filename: code(e.getInt('number')) + ' ' + e.getString('title').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60) + '.csv', content: '﻿' + lines.join('\r\n') + '\r\n' };
}

/* ------------------------------------------------------------- writes */

function nextNumber(tx, projectId) {
  return u().count(tx, 'SELECT CAST(COALESCE(MAX(number), 0) AS INTEGER) + 1 AS n FROM experiments WHERE project = {:p}', { p: projectId });
}

/** A new, planned experiment holding a copy of a plan (steps unticked). */
function makeExperiment(tx, ctx, projectId, plan) {
  const util = u();
  const e = util.newRecord(tx, 'experiments');
  e.set('project', projectId);
  e.set('number', nextNumber(tx, projectId));
  e.set('title', plan.title);
  e.set('kind', plan.kind || 'other');
  e.set('status', 'planned');
  e.set('aim', plan.aim || '');
  e.set('hypothesis', plan.hypothesis || '');
  e.set('variables', plan.variables || []);
  e.set('steps', (plan.steps || []).map((s) => ({ id: s.id, text: s.text, minutes: s.minutes || 0, done: false, done_at: '' })));
  e.set('materials', plan.materials || []);
  e.set('links', plan.links || []);
  e.set('tags', plan.tags || []);
  e.set('planned_start', plan.planned_start || '');
  e.set('planned_end', plan.planned_end || '');
  if (plan.parent) e.set('parent', plan.parent);
  e.set('actor', ctx.actor);
  tx.save(e);
  return e;
}

function plannedDay(util, p, name) {
  return util.has(p, name) ? util.day(p, name, '') : '';
}

/** exp.create: a new experiment (planned), blank or from a template, with the next number in the project. */
function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = core().project(app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  let base = { kind: 'other', aim: '', hypothesis: '', variables: [], steps: [], materials: [], tags: [] };
  const tplId = util.str(p, 'template', '');
  if (tplId !== '') {
    const t = templateOf(ctx, tplId);
    base = { kind: t.getString('kind'), aim: t.getString('aim'), hypothesis: t.getString('hypothesis'), variables: util.jsonOf(t, 'variables') || [], steps: util.jsonOf(t, 'steps') || [], materials: util.jsonOf(t, 'materials') || [], tags: util.jsonOf(t, 'tags') || [] };
    if (!util.has(p, 'title')) base.title = t.getString('name');
  }
  const title = squash(util.text(p, 'title', 300, base.title || ''));
  if (title === '') throw util.fail(400, 'An experiment needs a title.', 'missing_param', { param: 'title' });
  const plan = {
    title: title,
    kind: util.oneOf(p, 'kind', KINDS, base.kind),
    aim: util.has(p, 'aim') ? util.text(p, 'aim', 4000, '') : base.aim,
    hypothesis: util.has(p, 'hypothesis') ? util.text(p, 'hypothesis', 4000, '') : base.hypothesis,
    variables: util.has(p, 'variables') ? cleanVariables(util, util.list(p, 'variables'), []) : base.variables,
    steps: util.has(p, 'steps') ? cleanSteps(util, util.list(p, 'steps'), []) : base.steps,
    materials: util.has(p, 'materials') ? cleanMaterials(util, util.list(p, 'materials'), []) : base.materials,
    links: util.has(p, 'links') ? cleanLinks(ctx, util, util.list(p, 'links'), pr.id) : [],
    tags: util.has(p, 'tags') ? cleanTags(util, util.list(p, 'tags')) : base.tags,
    planned_start: plannedDay(util, p, 'planned_start'),
    planned_end: plannedDay(util, p, 'planned_end'),
  };
  let e = null;
  app.runInTransaction((tx) => {
    e = makeExperiment(tx, ctx, pr.id, plan);
    sysLog(tx, ctx, e.id, code(e.getInt('number')) + ' planned' + (tplId !== '' ? ' from a template' : ''));
    act().write(tx, ctx, { label: 'Planned the experiment ' + code(e.getInt('number')) + ' "' + title.slice(0, 80) + '"', target: 'experiments', record: e.id, project: pr.id, undo: { fn: 'lib_exp.undoCreate', args: { experiment: e.id } } });
  });
  return { experiment: expOut(app, e) };
}

function undoCreate(ctx, args) {
  const e = u().byId(ctx.app, 'experiments', args.experiment);
  if (e !== null) ctx.app.delete(e);
}

/** exp.repeat: run an experiment again: a new planned one with the same plan and protocol (unticked), linked to the original. */
function repeat(ctx, p) {
  const util = u();
  const app = ctx.app;
  const o = expOf(ctx, util.req(p, 'experiment'));
  const title = squash(util.text(p, 'title', 300, '')) || o.getString('title').replace(/ \(repeat( \d+)?\)$/, '') + ' (repeat)';
  let e = null;
  app.runInTransaction((tx) => {
    e = makeExperiment(tx, ctx, o.getString('project'), {
      title: title,
      kind: o.getString('kind'),
      aim: o.getString('aim'),
      hypothesis: o.getString('hypothesis'),
      variables: util.jsonOf(o, 'variables') || [],
      steps: util.jsonOf(o, 'steps') || [],
      materials: util.jsonOf(o, 'materials') || [],
      links: util.jsonOf(o, 'links') || [],
      tags: util.jsonOf(o, 'tags') || [],
      planned_start: plannedDay(util, p, 'planned_start'),
      parent: o.id,
    });
    const oc = code(o.getInt('number'));
    const nc = code(e.getInt('number'));
    sysLog(tx, ctx, e.id, nc + ' planned as a repeat of ' + oc);
    sysLog(tx, ctx, o.id, 'Repeated as ' + nc);
    act().write(tx, ctx, { label: 'Planned ' + nc + ', a repeat of ' + oc, target: 'experiments', record: e.id, project: o.getString('project'), undo: { fn: 'lib_exp.undoCreate', args: { experiment: e.id } } });
  });
  return { experiment: expOut(app, e) };
}

/** exp.update: change the record: plan, tags, planned dates, pin, or status (the first start and the end are stamped; the journal notes each change). */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = expOf(ctx, util.req(p, 'experiment')).id;
  const projectId = app.findRecordById('experiments', id).getString('project');
  let title = null;
  if (util.has(p, 'title')) {
    title = squash(util.text(p, 'title', 300, ''));
    if (title === '') throw util.fail(400, 'An experiment needs a title.', 'invalid_param', { param: 'title' });
  }
  const links = util.has(p, 'links') ? cleanLinks(ctx, util, util.list(p, 'links'), projectId) : null;
  const e = locked(app, id, (tx, e) => {
    const before = snapshot(e);
    const label = code(e.getInt('number'));
    if (title !== null) e.set('title', title);
    if (util.has(p, 'kind')) e.set('kind', util.oneOf(p, 'kind', KINDS, before.kind));
    if (util.has(p, 'aim')) e.set('aim', util.text(p, 'aim', 4000, ''));
    if (util.has(p, 'hypothesis')) e.set('hypothesis', util.text(p, 'hypothesis', 4000, ''));
    if (util.has(p, 'variables')) e.set('variables', cleanVariables(util, util.list(p, 'variables'), before.variables));
    if (util.has(p, 'steps')) e.set('steps', cleanSteps(util, util.list(p, 'steps'), before.steps));
    if (util.has(p, 'materials')) e.set('materials', cleanMaterials(util, util.list(p, 'materials'), before.materials));
    if (util.has(p, 'tags')) e.set('tags', cleanTags(util, util.list(p, 'tags')));
    if (util.has(p, 'planned_start')) e.set('planned_start', util.day(p, 'planned_start', ''));
    if (util.has(p, 'planned_end')) e.set('planned_end', util.day(p, 'planned_end', ''));
    if (util.has(p, 'pinned')) e.set('pinned', util.bool(p, 'pinned', false));
    if (links !== null) e.set('links', links);
    const status = util.has(p, 'status') ? util.oneOf(p, 'status', STATUS, before.status) : before.status;
    if (status !== before.status) {
      e.set('status', status);
      const from = before.status;
      if (status === 'running') {
        if (from === 'planned' || before.started_at === '') e.set('started_at', now());
        e.set('ended_at', '');
        sysLog(tx, ctx, id, from === 'planned' ? label + ' started' : from === 'paused' ? label + ' resumed' : label + ' reopened');
      } else if (status === 'paused') {
        if (before.started_at === '') e.set('started_at', now());
        sysLog(tx, ctx, id, label + ' paused');
      } else if (status === 'planned') {
        e.set('started_at', '');
        e.set('ended_at', '');
        sysLog(tx, ctx, id, label + ' back to planned');
      } else {
        if (before.started_at === '') e.set('started_at', now());
        e.set('ended_at', now());
        sysLog(tx, ctx, id, label + (status === 'done' ? ' finished' : ' cancelled'));
      }
    }
    tx.save(e);
    act().write(tx, ctx, { label: 'Changed the experiment ' + label + ' "' + e.getString('title').slice(0, 80) + '"', target: 'experiments', record: id, project: projectId, undo: { fn: 'lib_exp.undoUpdate', args: { experiment: id, before: before } } });
    return e;
  });
  return { experiment: expOut(app, e) };
}

function undoUpdate(ctx, args) {
  const e = u().byId(ctx.app, 'experiments', args.experiment);
  if (e === null) return;
  restore(e, args.before);
  ctx.app.save(e);
}

/** exp.step: tick or untick a protocol step while it runs (the journal notes it). */
function step(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = expOf(ctx, util.req(p, 'experiment')).id;
  const stepId = util.req(p, 'step');
  const e = locked(app, id, (tx, e) => {
    const status = e.getString('status');
    if (status === 'planned') throw util.fail(409, 'Start the experiment before ticking its steps.', 'not_running');
    const steps = util.jsonOf(e, 'steps') || [];
    const i = steps.findIndex((s) => s.id === stepId);
    if (i < 0) throw util.fail(404, 'No step ' + stepId + ' in this experiment.', 'not_found');
    const s = steps[i];
    const done = util.bool(p, 'done', !s.done);
    if (done === s.done) return e;
    s.done = done;
    s.done_at = done ? now() : '';
    e.set('steps', steps);
    tx.save(e);
    sysLog(tx, ctx, id, (done ? 'Step ' + (i + 1) + ' done: ' : 'Step ' + (i + 1) + ' undone: ') + s.text.slice(0, 300), { kind: 'step', id: s.id });
    return e;
  });
  return { experiment: expOut(app, e) };
}

/** exp.delete: an experiment with its runs, journal and files (people only; preview shows what goes). */
function remove(ctx, p) {
  const util = u();
  const e = expOf(ctx, util.req(p, 'experiment'));
  const o = expOut(ctx.app, e);
  if (util.bool(p, 'preview', false)) return { preview: true, experiment: o, takes: { runs: o.counts.runs, log: o.counts.log } };
  ctx.app.runInTransaction((tx) => {
    // Repeats keep their own record; they just stop pointing here.
    for (const c of tx.findRecordsByFilter('experiments', 'parent = {:e}', '', 0, 0, { e: e.id })) {
      const r = tx.findRecordById('experiments', c.id);
      r.set('parent', '');
      tx.save(r);
    }
    tx.delete(tx.findRecordById('experiments', e.id));
    act().write(tx, ctx, { label: 'Deleted the experiment ' + o.code + ' "' + o.title.slice(0, 80) + '"', target: 'experiments', record: e.id, project: o.project });
  });
  return { deleted: true };
}

/** Parse CSV or tab-separated text (pasted from a spreadsheet) into rows of cells. */
function parseTable(text) {
  const src = String(text).replace(/^﻿/, '');
  const first = src.split(/\r?\n/)[0] || '';
  const sep = first.indexOf('\t') >= 0 ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (q) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src.charAt(i + 1) === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** CSV rows as runs: the first row names the columns (variable names, with or without the unit; Status; Note; Run is skipped). */
function runsFromCsv(util, vars, text) {
  const rows = parseTable(text);
  if (rows.length < 2) throw util.fail(400, 'The CSV needs a header row naming the columns and at least one row of values.', 'invalid_param', { param: 'csv' });
  const head = rows[0].map((h) => h.trim());
  const cols = head.map((h) => {
    const k = h.toLowerCase();
    if (k === 'status') return { kind: 'status' };
    if (k === 'note' || k === 'notes') return { kind: 'note' };
    if (k === 'run' || k === 'recorded' || k === '') return { kind: 'skip' };
    const v = variableOf(vars, h);
    if (v === null) throw util.fail(400, 'The column "' + h + '" is not a variable. The variables are: ' + (vars.map((x) => x.name).join(', ') || 'none yet (add them to the design)') + '.', 'unknown_variable', { variable: h });
    if (v.role === 'constant') return { kind: 'skip' };
    return { kind: 'var', v: v };
  });
  return rows.slice(1).map((r) => {
    const o = { values: {} };
    cols.forEach((c, i) => {
      const cell = (r[i] || '').trim();
      if (c.kind === 'var') o.values[c.v.name] = cell;
      else if (c.kind === 'status' && cell !== '') o.status = cell.toLowerCase();
      else if (c.kind === 'note') o.note = cell;
    });
    return o;
  });
}

function makeRun(tx, ctx, util, expId, number, values, status, note) {
  const r = util.newRecord(tx, 'exp_runs');
  r.set('experiment', expId);
  r.set('number', number);
  r.set('values', values);
  r.set('status', status);
  r.set('note', note);
  r.set('recorded_at', status === 'planned' ? '' : now());
  r.set('actor', ctx.actor);
  tx.save(r);
  return r;
}

/** exp.add-runs: record runs (JSON or CSV). A run with a measured value is done unless a status says otherwise. */
function addRuns(ctx, p) {
  const util = u();
  const app = ctx.app;
  const e = expOf(ctx, util.req(p, 'experiment'));
  const vars = util.jsonOf(e, 'variables') || [];
  let raw;
  if (util.has(p, 'csv')) raw = runsFromCsv(util, vars, util.text(p, 'csv', 5000000, ''));
  else raw = util.list(p, 'runs');
  if (!Array.isArray(raw) || raw.length === 0) throw util.fail(400, 'Give --runs [{"values":{"<variable>":value},"status":"done","note":".."}] or --csv with a header row.', 'missing_param');
  if (raw.length > 5000) throw util.fail(400, 'At most 5000 runs at once.', 'too_many');
  const items = raw.map((r, i) => {
    const where = 'Run ' + (i + 1);
    const o = typeof r === 'object' && r !== null && !Array.isArray(r) ? r : null;
    if (o === null) throw util.fail(400, where + ' must be an object with values.', 'invalid_param');
    util.keysOnly(o, ['values', 'status', 'note'], where);
    const values = valuesFor(util, vars, o.values || {}, {}, where);
    const st = o.status === undefined || o.status === '' ? (hasMeasure(vars, values) ? 'done' : 'planned') : String(o.status);
    if (RUN_STATUS.indexOf(st) < 0) throw util.fail(400, where + ': status is one of ' + RUN_STATUS.join(', ') + '.', 'invalid_param');
    return { values: values, status: st, note: squash(o.note).slice(0, 4000) };
  });
  const made = [];
  app.runInTransaction((tx) => {
    let n = util.count(tx, 'SELECT CAST(COALESCE(MAX(number), 0) AS INTEGER) AS n FROM exp_runs WHERE experiment = {:e}', { e: e.id });
    for (const it of items) made.push(makeRun(tx, ctx, util, e.id, ++n, it.values, it.status, it.note).id);
    const done = items.filter((x) => x.status !== 'planned').length;
    const what = done === items.length ? 'Recorded ' + done + (done === 1 ? ' run' : ' runs') : done === 0 ? 'Planned ' + items.length + (items.length === 1 ? ' run' : ' runs') : 'Added ' + items.length + ' runs (' + done + ' recorded)';
    sysLog(tx, ctx, e.id, what, made.length === 1 ? { kind: 'run', id: made[0] } : undefined);
    act().write(tx, ctx, { label: what + ' in ' + code(e.getInt('number')), target: 'exp_runs', record: e.id, project: e.getString('project'), undo: { fn: 'lib_exp.undoRuns', args: { runs: made } } });
  });
  return { added: made.length, runs: made.map((id) => runOut(app.findRecordById('exp_runs', id))) };
}

function undoRuns(ctx, args) {
  for (const id of args.runs || []) {
    const r = u().byId(ctx.app, 'exp_runs', id);
    if (r !== null) ctx.app.delete(r);
  }
}

/** exp.plan-runs: one planned run for every combination of condition levels, times replicates. */
function planRuns(ctx, p) {
  const util = u();
  const app = ctx.app;
  const e = expOf(ctx, util.req(p, 'experiment'));
  const vars = util.jsonOf(e, 'variables') || [];
  const reps = util.int(p, 'replicates', 1, 1, 1000);
  const conds = vars.filter((v) => v.role === 'condition' && (v.levels || []).length > 0);
  let combos = [{}];
  for (const c of conds) {
    const next = [];
    for (const base of combos) for (const l of c.levels) next.push(Object.assign({}, base, { [c.id]: c.type === 'number' ? Number(l) : c.type === 'yesno' ? valueFor(util, c, l, 'Level') : l }));
    combos = next;
  }
  const total = combos.length * reps;
  if (total > 5000) throw util.fail(400, combos.length + ' combinations × ' + reps + ' replicates is ' + total + ' runs; at most 5000 at once.', 'too_many');
  if (util.bool(p, 'preview', false)) return { preview: true, combinations: combos.length, replicates: reps, runs: total };
  const made = [];
  app.runInTransaction((tx) => {
    let n = util.count(tx, 'SELECT CAST(COALESCE(MAX(number), 0) AS INTEGER) AS n FROM exp_runs WHERE experiment = {:e}', { e: e.id });
    for (let r = 0; r < reps; r++) for (const c of combos) made.push(makeRun(tx, ctx, util, e.id, ++n, c, 'planned', reps > 1 ? 'Replicate ' + (r + 1) : '').id);
    const how = conds.map((c) => c.levels.length).concat(reps > 1 ? [reps + ' replicates'] : []).join(' × ');
    sysLog(tx, ctx, e.id, 'Planned ' + total + (total === 1 ? ' run' : ' runs') + (how !== '' ? ' (' + how + ')' : ''));
    act().write(tx, ctx, { label: 'Planned ' + total + ' runs in ' + code(e.getInt('number')), target: 'exp_runs', record: e.id, project: e.getString('project'), undo: { fn: 'lib_exp.undoRuns', args: { runs: made } } });
  });
  return { added: made.length, combinations: combos.length, replicates: reps };
}

/** exp.update-run: change a run's values (merged; "" clears one), status or note. Measuring a planned run makes it done. */
function updateRun(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r0 = core().need(app, 'exp_runs', util.req(p, 'run'), 'run');
  const e = expOf(ctx, r0.getString('experiment'));
  const vars = util.jsonOf(e, 'variables') || [];
  const patch = util.has(p, 'values') ? util.obj(p, 'values') : null;
  let before = null;
  let r = null;
  app.runInTransaction((tx) => {
    r = tx.findRecordById('exp_runs', r0.id);
    before = { values: util.jsonOf(r, 'values') || {}, status: r.getString('status'), note: r.getString('note'), recorded_at: r.getString('recorded_at') };
    let values = before.values;
    if (patch !== null) values = valuesFor(util, vars, patch, before.values, 'R' + r.getInt('number'));
    r.set('values', values);
    let st = util.has(p, 'status') ? util.oneOf(p, 'status', RUN_STATUS, before.status) : before.status;
    if (!util.has(p, 'status') && before.status === 'planned' && patch !== null && hasMeasure(vars, values) && !hasMeasure(vars, before.values)) st = 'done';
    r.set('status', st);
    if (st !== 'planned' && before.recorded_at === '') r.set('recorded_at', now());
    if (st === 'planned') r.set('recorded_at', '');
    if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 4000, ''));
    tx.save(r);
    act().write(tx, ctx, { label: 'Changed run R' + r.getInt('number') + ' of ' + code(e.getInt('number')), target: 'exp_runs', record: r.id, project: e.getString('project'), undo: { fn: 'lib_exp.undoRun', args: { run: r.id, before: before } } });
  });
  return { run: runOut(r) };
}

function undoRun(ctx, args) {
  const r = u().byId(ctx.app, 'exp_runs', args.run);
  if (r === null) return;
  restore(r, args.before);
  ctx.app.save(r);
}

/** exp.delete-runs: remove runs (Activity can bring them back). */
function removeRuns(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = util.ids(p, 'runs', 5000);
  if (ids.length === 0) throw util.fail(400, 'Give the runs to remove.', 'missing_param');
  const recs = ids.map((id) => core().need(app, 'exp_runs', id, 'run'));
  const expId = recs[0].getString('experiment');
  if (recs.some((r) => r.getString('experiment') !== expId)) throw util.fail(400, 'The runs belong to different experiments; remove them one experiment at a time.', 'invalid_param');
  const e = expOf(ctx, expId);
  const saved = recs.map((r) => ({ number: r.getInt('number'), values: util.jsonOf(r, 'values') || {}, status: r.getString('status'), note: r.getString('note'), recorded_at: r.getString('recorded_at'), actor: r.getString('actor') }));
  app.runInTransaction((tx) => {
    for (const r of recs) tx.delete(tx.findRecordById('exp_runs', r.id));
    act().write(tx, ctx, { label: 'Removed ' + recs.length + (recs.length === 1 ? ' run' : ' runs') + ' from ' + code(e.getInt('number')), target: 'exp_runs', record: e.id, project: e.getString('project'), undo: { fn: 'lib_exp.undoRemoveRuns', args: { experiment: e.id, runs: saved } } });
  });
  return { removed: recs.length };
}

function undoRemoveRuns(ctx, args) {
  const util = u();
  if (util.byId(ctx.app, 'experiments', args.experiment) === null) return;
  for (const s of args.runs || []) {
    if (util.findOne(ctx.app, 'exp_runs', 'experiment = {:e} && number = {:n}', { e: args.experiment, n: s.number }) !== null) continue;
    const r = util.newRecord(ctx.app, 'exp_runs');
    r.set('experiment', args.experiment);
    restore(r, s);
    ctx.app.save(r);
  }
}

/** When a journal entry happened: now, or a time given as "YYYY-MM-DD HH:MM" (an entry written up later shows as a late entry). */
function atFor(util, p) {
  const s = util.str(p, 'at', '');
  if (s === '') return now();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m || !util.isDay(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) throw util.fail(400, 'at is a time written "YYYY-MM-DD HH:MM", e.g. ' + util.today() + ' 14:05.', 'invalid_param', { param: 'at' });
  const d = new Date(m[1] + 'T' + m[2] + ':' + m[3] + ':00');
  if (d.getTime() > Date.now() + 60000) throw util.fail(400, 'An entry cannot be dated in the future.', 'invalid_param', { param: 'at' });
  return d.toISOString().replace('T', ' ');
}

/** What an entry is about: {"kind":"step","id":..} or {"kind":"run","id":..} of this experiment. */
function refFor(ctx, util, p, e) {
  if (!util.has(p, 'ref')) return null;
  const raw = util.obj(p, 'ref');
  if (!raw || Object.keys(raw).length === 0) return null;
  util.keysOnly(raw, ['kind', 'id'], 'ref');
  if (raw.kind === 'step') {
    if (!(util.jsonOf(e, 'steps') || []).some((s) => s.id === raw.id)) throw util.fail(404, 'No step ' + raw.id + ' in this experiment.', 'not_found');
    return { kind: 'step', id: String(raw.id) };
  }
  if (raw.kind === 'run') {
    const r = core().need(ctx.app, 'exp_runs', String(raw.id || ''), 'run');
    if (r.getString('experiment') !== e.id) throw util.fail(400, 'That run belongs to another experiment.', 'invalid_param');
    return { kind: 'run', id: r.id };
  }
  throw util.fail(400, 'ref is {"kind":"step","id":"<step>"} or {"kind":"run","id":"<run>"}.', 'invalid_param', { param: 'ref' });
}

/** exp.log: an entry in the journal, about a step or a run when given, with files (people upload "files"; your AI agent gives "paths"). */
function log(ctx, p) {
  const util = u();
  const app = ctx.app;
  const e = expOf(ctx, util.req(p, 'experiment'));
  const text = util.text(p, 'text', 20000, '');
  const kind = util.oneOf(p, 'kind', LOG_KINDS, 'note');
  const files = ctx.e ? util.uploadedAll(ctx.e, 'files') : [];
  const paths = util.has(p, 'paths') ? util.list(p, 'paths') || [] : [];
  for (const path of paths) files.push(util.localFile(ctx, String(path), 'paths').file);
  if (text === '' && files.length === 0) throw util.fail(400, 'Write something or attach a file.', 'missing_param', { param: 'text' });
  if (files.length > 20) throw util.fail(400, 'At most 20 files in one entry.', 'too_many');
  const ref = refFor(ctx, util, p, e);
  const l = util.newRecord(app, 'exp_log');
  l.set('experiment', e.id);
  l.set('kind', kind);
  l.set('text', text);
  if (files.length > 0) l.set('files', files);
  if (ref !== null) l.set('ref', ref);
  l.set('at', atFor(util, p));
  l.set('actor', ctx.actor);
  app.save(l);
  act().write(app, ctx, { label: 'Logged ' + LOG_WORD[kind] + ' in ' + code(e.getInt('number')), target: 'exp_log', record: l.id, project: e.getString('project') });
  return { entry: logOut(app, e, l, ctx.isAgent) };
}

function entryOf(ctx, id) {
  const l = core().need(ctx.app, 'exp_log', id, 'journal entry');
  const e = expOf(ctx, l.getString('experiment'));
  return { l: l, e: e };
}

/** exp.correct: correct a journal entry. The original stays in the entry's history with the reason; the app's own entries stay as written. */
function correct(ctx, p) {
  const util = u();
  const { l, e } = entryOf(ctx, util.req(p, 'entry'));
  if (l.getString('kind') === 'system') throw util.fail(409, 'Entries the app wrote (status, steps, runs) stay as written.', 'conflict');
  if (l.getString('struck') !== '') throw util.fail(409, 'This entry is struck out; write a new one instead.', 'conflict');
  const reason = util.oneOf(p, 'reason', REASONS, '');
  if (reason === '') throw util.fail(400, 'Give the reason for the correction: ' + REASONS.join(', ') + '.', 'missing_param', { param: 'reason' });
  const text = util.text(p, 'text', 20000, l.getString('text'));
  const kind = util.oneOf(p, 'kind', LOG_KINDS, l.getString('kind'));
  if (text === l.getString('text') && kind === l.getString('kind')) return { entry: logOut(ctx.app, e, l, ctx.isAgent) };
  if (text === '' && (l.getStringSlice('files') || []).length === 0) throw util.fail(400, 'An entry needs text or a file.', 'invalid_param', { param: 'text' });
  const edits = util.jsonOf(l, 'edits') || [];
  edits.push({ action: 'corrected', text: l.getString('text'), kind: l.getString('kind'), reason: reason, at: now(), actor: ctx.actor });
  l.set('edits', edits);
  l.set('text', text);
  l.set('kind', kind);
  ctx.app.save(l);
  act().write(ctx.app, ctx, { label: 'Corrected a journal entry in ' + code(e.getInt('number')), target: 'exp_log', record: l.id, project: e.getString('project') });
  return { entry: logOut(ctx.app, e, l, ctx.isAgent) };
}

/** exp.strike: strike a journal entry through with a reason. It stays in the journal, legible; nothing is erased. */
function strike(ctx, p) {
  const util = u();
  const { l, e } = entryOf(ctx, util.req(p, 'entry'));
  if (l.getString('kind') === 'system') throw util.fail(409, 'Entries the app wrote (status, steps, runs) stay in the journal.', 'conflict');
  const reason = squash(util.text(p, 'reason', 1000, ''));
  if (reason === '') throw util.fail(400, 'Say why the entry is struck out.', 'missing_param', { param: 'reason' });
  if (l.getString('struck') !== '') return { entry: logOut(ctx.app, e, l, ctx.isAgent) };
  const edits = util.jsonOf(l, 'edits') || [];
  edits.push({ action: 'struck', reason: reason, at: now(), actor: ctx.actor });
  l.set('edits', edits);
  l.set('struck', reason);
  l.set('struck_at', now());
  ctx.app.save(l);
  act().write(ctx.app, ctx, { label: 'Struck out a journal entry in ' + code(e.getInt('number')), target: 'exp_log', record: l.id, project: e.getString('project') });
  return { entry: logOut(ctx.app, e, l, ctx.isAgent) };
}

/** exp.file: a file attached to a journal entry (screens show it; your AI agent gets its file_path). */
function file(ctx, p) {
  const util = u();
  const { l } = entryOf(ctx, util.req(p, 'entry'));
  const name = util.req(p, 'name');
  if ((l.getStringSlice('files') || []).indexOf(name) < 0) throw util.fail(404, 'No file "' + name + '" on this entry.', 'not_found');
  if (ctx.isAgent) return { name: shownName(name), file_path: $filepath.join(ctx.app.dataDir(), 'storage', l.baseFilesPath(), name) };
  const mime = MIME[extOf(name)] || 'application/octet-stream';
  // Pictures and PDFs open in the page; everything else downloads.
  const inline = /^image\//.test(mime) || mime === 'application/pdf';
  return require(`${__hooks}/lib_files.js`).streamName(ctx, l, name, mime, shownName(name), 'private, max-age=86400, immutable', inline);
}

/** exp.conclude: the outcome, what the data show, and next steps. Your AI agent's conclusion stays proposed until a person keeps it. */
function conclude(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = expOf(ctx, util.req(p, 'experiment')).id;
  const e = locked(app, id, (tx, e) => {
    const before = snapshot(e);
    if (util.has(p, 'summary')) e.set('summary', util.text(p, 'summary', 20000, ''));
    if (util.has(p, 'next_steps')) e.set('next_steps', util.text(p, 'next_steps', 10000, ''));
    if (util.has(p, 'outcome')) {
      const v = util.str(p, 'outcome', '');
      if (v !== '' && OUTCOMES.indexOf(v) < 0) throw util.fail(400, 'outcome is one of ' + OUTCOMES.join(', ') + ' ("" clears it).', 'invalid_param', { param: 'outcome' });
      e.set('outcome', v);
    }
    e.set('conclusion_by', e.getString('summary') === '' && e.getString('outcome') === '' && e.getString('next_steps') === '' ? '' : ctx.isAgent ? 'agent' : 'person');
    tx.save(e);
    const v = e.getString('outcome');
    if (v !== before.outcome || ctx.isAgent) sysLog(tx, ctx, id, (ctx.isAgent ? 'Your AI agent proposed a conclusion' : 'Outcome set') + (v !== '' ? ': ' + OUTCOME_WORD[v] : ''));
    act().write(tx, ctx, { label: 'Wrote the conclusion of ' + code(e.getInt('number')), target: 'experiments', record: id, project: e.getString('project'), undo: { fn: 'lib_exp.undoUpdate', args: { experiment: id, before: before } } });
    return e;
  });
  return { experiment: expOut(app, e) };
}

/* ------------------------------------------------------------ templates */

function templateOf(ctx, id) {
  const t = core().need(ctx.app, 'exp_templates', id, 'template');
  if (ctx.isAgent && t.getString('project') !== '') core().guardProjectId(ctx, t.getString('project'));
  return t;
}

function templateOut(t) {
  const util = u();
  const steps = util.jsonOf(t, 'steps') || [];
  const vars = util.jsonOf(t, 'variables') || [];
  return { id: t.id, name: t.getString('name'), kind: t.getString('kind'), aim: t.getString('aim'), hypothesis: t.getString('hypothesis'), variables: vars, steps: steps, materials: util.jsonOf(t, 'materials') || [], tags: util.jsonOf(t, 'tags') || [], counts: { variables: vars.length, steps: steps.length }, updated: t.getString('updated') };
}

/** exp.templates: protocols kept for reuse, in every project. */
function templates(ctx) {
  const util = u();
  const hidden = ctx.isAgent ? ctx.app.findRecordsByFilter('projects', "confidentiality = 'confidential'", '', 0, 0).map((r) => r.id) : [];
  const rows = ctx.app.findRecordsByFilter('exp_templates', '', 'name', 0, 0).filter((t) => hidden.indexOf(t.getString('project')) < 0);
  return { templates: rows.map(templateOut), total: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM exp_templates', {}) };
}

/** exp.save-template: keep an experiment's plan and protocol as a template (no runs, no journal). */
function saveTemplate(ctx, p) {
  const util = u();
  const e = expOf(ctx, util.req(p, 'experiment'));
  const name = squash(util.text(p, 'name', 300, '')) || e.getString('title');
  const t = util.newRecord(ctx.app, 'exp_templates');
  t.set('name', name);
  t.set('project', e.getString('project'));
  t.set('kind', e.getString('kind'));
  t.set('aim', e.getString('aim'));
  t.set('hypothesis', e.getString('hypothesis'));
  t.set('variables', util.jsonOf(e, 'variables') || []);
  t.set('steps', (util.jsonOf(e, 'steps') || []).map((s) => ({ id: s.id, text: s.text, minutes: s.minutes || 0 })));
  t.set('materials', util.jsonOf(e, 'materials') || []);
  t.set('tags', util.jsonOf(e, 'tags') || []);
  t.set('actor', ctx.actor);
  ctx.app.save(t);
  act().write(ctx.app, ctx, { label: 'Saved "' + name.slice(0, 80) + '" as a template', target: 'exp_templates', record: t.id, project: e.getString('project'), undo: { fn: 'lib_exp.undoTemplate', args: { template: t.id } } });
  return { template: templateOut(t) };
}

function undoTemplate(ctx, args) {
  const t = u().byId(ctx.app, 'exp_templates', args.template);
  if (t !== null) ctx.app.delete(t);
}

/** exp.delete-template: remove a template (experiments made from it keep their copy). */
function removeTemplate(ctx, p) {
  const t = templateOf(ctx, u().req(p, 'template'));
  ctx.app.delete(t);
  act().write(ctx.app, ctx, { label: 'Removed the template "' + t.getString('name').slice(0, 80) + '"', target: 'exp_templates', record: t.id });
  return { deleted: true };
}

module.exports = {
  KINDS: KINDS,
  list: list,
  get: get,
  runs: runs,
  entries: entries,
  results: results,
  exportCsv: exportCsv,
  create: create,
  undoCreate: undoCreate,
  repeat: repeat,
  update: update,
  undoUpdate: undoUpdate,
  step: step,
  remove: remove,
  addRuns: addRuns,
  undoRuns: undoRuns,
  planRuns: planRuns,
  updateRun: updateRun,
  undoRun: undoRun,
  removeRuns: removeRuns,
  undoRemoveRuns: undoRemoveRuns,
  log: log,
  correct: correct,
  strike: strike,
  file: file,
  conclude: conclude,
  templates: templates,
  saveTemplate: saveTemplate,
  undoTemplate: undoTemplate,
  removeTemplate: removeTemplate,
  code: code,
};
