/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared lookups and rules: the settings row, finding records by id or
 * identifier, confidentiality, labels for papers, and the highlight colors.
 */

const HUES = ['yellow', 'red', 'green', 'blue', 'violet', 'orange', 'teal', 'gray'];
const JUDGED = ['agent_proposed', 'researcher_confirmed', 'researcher_rejected', 'superseded'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/* ------------------------------------------------------------ settings */

function settings(app) {
  const r = app.findRecordsByFilter('settings', '', 'created', 1, 0);
  if (r.length === 0) throw u().fail(500, 'The settings row is missing.', 'error');
  return r[0];
}

function slots(app) {
  const raw = u().jsonOf(settings(app), 'highlight_slots');
  const out = [];
  for (let i = 1; i <= 8; i++) {
    const s = Array.isArray(raw) ? raw.find((x) => x && x.slot === i) : null;
    out.push({ slot: i, hue: s && HUES.indexOf(s.hue) >= 0 ? s.hue : HUES[i - 1], meaning: s && typeof s.meaning === 'string' ? s.meaning : '' });
  }
  return out;
}

function policy(app) {
  const p = u().jsonOf(settings(app), 'agent_policy') || {};
  return {
    node_cap: typeof p.node_cap === 'number' ? p.node_cap : 300,
    auto_identify: p.auto_identify !== false,
    auto_ocr: p.auto_ocr !== false,
    auto_oa: p.auto_oa !== false,
  };
}

/* ------------------------------------------------------------- records */

/** A record by id, or a 404 that names the collection. */
function need(app, collection, id, label) {
  const util = u();
  const rec = util.byId(app, collection, String(id || ''));
  if (rec === null) throw util.fail(404, 'No ' + (label || collection.replace(/s$/, '')) + ' with id "' + id + '".', 'not_found', { collection: collection, id: id });
  return rec;
}

/**
 * A paper by id, DOI (10.x/...), arXiv ID (arxiv:2401.01234), PubMed ID
 * (pmid:123) or citekey. Trashed papers are found too (callers check).
 */
function work(app, ref) {
  const util = u();
  const s = String(ref || '').trim();
  if (s === '') throw util.fail(400, 'Name the paper: its id, DOI, arxiv:<id>, pmid:<id> or citekey.', 'missing_param', { param: 'work' });
  const byId = util.byId(app, 'works', s);
  if (byId !== null) return byId;
  const ident = require(`${__hooks}/lib_ident.js`).parse(s);
  if (ident !== null) {
    const col = ident.kind === 'doi' ? 'doi' : ident.kind === 'arxiv' ? 'arxiv_id' : ident.kind === 'pmid' ? 'pmid' : ident.kind === 'isbn' ? 'isbn' : ident.kind === 'openalex' ? 'openalex_id' : ident.kind === 'pmcid' ? 'pmcid' : '';
    if (col !== '') {
      const hit = util.findOne(app, 'works', col + ' = {:v}', { v: ident.value });
      if (hit !== null) return hit;
    }
  }
  const byKey = util.findOne(app, 'works', 'citekey = {:v}', { v: s });
  if (byKey !== null) return byKey;
  throw util.fail(404, 'No paper "' + s + '" in the library. Give its id, DOI, arxiv:<id>, pmid:<id> or citekey (works.list finds them).', 'not_found', { collection: 'works', ref: s });
}

/** A project by id or exact name (case-insensitive). */
function project(app, ref) {
  const util = u();
  const s = String(ref || '').trim();
  if (s === '') throw util.fail(400, 'Name the project (its id or name).', 'missing_param', { param: 'project' });
  const byId = util.byId(app, 'projects', s);
  if (byId !== null) return byId;
  const r = util.rows(app, 'SELECT id FROM projects WHERE LOWER(name) = LOWER({:n}) LIMIT 2', { id: '' }, { n: s });
  if (r.length === 1) return app.findRecordById('projects', r[0].id);
  if (r.length > 1) throw util.fail(409, 'More than one project is called "' + s + '"; give its id.', 'ambiguous');
  throw util.fail(404, 'No project "' + s + '". projects.list shows them.', 'not_found', { collection: 'projects', ref: s });
}

/* ------------------------------------------------------- confidentiality */

/** Refuse your AI agent on a confidential project. */
function guardProject(ctx, proj) {
  if (ctx.isAgent && proj.getString('confidentiality') === 'confidential') {
    throw u().fail(403, 'This project is confidential: your AI agent cannot read or change it. A person works on it in the app.', 'confidential_project', { project: proj.id });
  }
}

function guardProjectId(ctx, projectId) {
  if (!ctx.isAgent || projectId === '') return;
  const p = u().byId(ctx.app, 'projects', projectId);
  if (p !== null) guardProject(ctx, p);
}

/** True when a paper belongs to a confidential project (your AI agent may not see it). */
function workHidden(app, workId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM project_works pw JOIN projects p ON p.id = pw.project WHERE pw.work = {:w} AND p.confidentiality = 'confidential'", { w: workId }) > 0;
}

function guardWork(ctx, w) {
  if (ctx.isAgent && workHidden(ctx.app, w.id)) {
    throw u().fail(403, 'This paper belongs to a confidential project: your AI agent cannot read or change it.', 'confidential_project', { work: w.id });
  }
}

/** SQL that keeps confidential papers out of your AI agent's lists (alias of the works table). */
function hiddenSql(ctx, alias) {
  if (!ctx.isAgent) return '';
  return " AND NOT EXISTS (SELECT 1 FROM project_works cpw JOIN projects cp ON cp.id = cpw.project WHERE cpw.work = " + alias + ".id AND cp.confidentiality = 'confidential')";
}

/* --------------------------------------------------------------- labels */

function authorsOf(w) {
  const a = u().jsonOf(w, 'authors');
  return Array.isArray(a) ? a : [];
}

/** A family name for display: the family name, or an organization's whole name (literal). */
function familyOf(a) {
  if (!a) return '';
  if (typeof a.family === 'string' && a.family !== '') return a.family;
  return String(a.literal || '').trim();
}

/** "Vaswani", "Vaswani and Shazeer", "Vaswani et al." */
function authorsShort(authors) {
  const list = Array.isArray(authors) ? authors : [];
  if (list.length === 0) return '';
  if (list.length === 1) return familyOf(list[0]);
  if (list.length === 2) return familyOf(list[0]) + ' and ' + familyOf(list[1]);
  return familyOf(list[0]) + ' et al.';
}

/** "Vaswani et al. 2017" (or the title when there are no authors). */
function workLabel(w) {
  const a = authorsShort(authorsOf(w));
  const y = w.getInt('year');
  const head = a !== '' ? a : w.getString('title').slice(0, 60);
  return head + (y > 0 ? ' ' + y : '');
}

/** Whether a paper can be cited: its identifier resolved, or a person entered it. */
function citable(w) {
  const r = w.getString('resolution');
  return r === 'resolved' || (r === 'manual' && w.getString('identity') === 'researcher_confirmed');
}

/** The current PDF of a paper (null when it has none). */
function currentFile(app, workId) {
  const r = app.findRecordsByFilter('files', 'work = {:w} && current = true', '-version', 1, 0, { w: workId });
  return r.length > 0 ? r[0] : null;
}

/** The status a judged record gets from this caller. */
function judgedStatus(ctx) {
  return ctx.isAgent ? 'agent_proposed' : 'researcher_confirmed';
}

module.exports = {
  HUES: HUES,
  JUDGED: JUDGED,
  settings: settings,
  slots: slots,
  policy: policy,
  need: need,
  work: work,
  project: project,
  guardProject: guardProject,
  guardProjectId: guardProjectId,
  workHidden: workHidden,
  guardWork: guardWork,
  hiddenSql: hiddenSql,
  authorsOf: authorsOf,
  familyOf: familyOf,
  authorsShort: authorsShort,
  workLabel: workLabel,
  citable: citable,
  currentFile: currentFile,
  judgedStatus: judgedStatus,
};
