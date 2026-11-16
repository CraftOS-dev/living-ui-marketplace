/// <reference path="../pb_data/types.d.ts" />
/**
 * Skills (Frappe skill, employee skill map, designation skill): the skill
 * library (name, category, what each level 1 to 5 means, the level a job
 * title expects) and the team skills matrix (people by skills, each cell
 * the person's level, whether a manager verified it, and the level their
 * job title expects).
 *
 * A person's skills are the kernel's employee_skills rows (skill = the
 * library name as text, level 1 to 5, verified_by): people set their own
 * through employee-skills.set and a manager or HR verifies with
 * --verified true. The library's name is the join key (case-insensitive),
 * so a skill used by people keeps its name.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function core() {
  return L('lib_performance');
}

function usage(app, name) {
  return u().one(app, 'SELECT COUNT(*) AS n, CAST(COALESCE(ROUND(AVG(level), 1) * 10, 0) AS INTEGER) AS avg10, COALESCE(SUM(CASE WHEN verified_by != \'\' THEN 1 ELSE 0 END), 0) AS verified FROM employee_skills WHERE LOWER(skill) = LOWER({:s})', { n: 0, avg10: 0, verified: 0 }, { s: name }) || { n: 0, avg10: 0, verified: 0 };
}

function view(app, r, withUsage) {
  const util = u();
  const out = {
    id: r.id,
    name: r.getString('name'),
    category: r.getString('category'),
    description: r.getString('description'),
    levels: util.jsonOf(r, 'levels', []) || [],
    expected: util.jsonOf(r, 'expected', []) || [],
    archived: r.getBool('archived'),
  };
  if (withUsage) {
    const us = usage(app, out.name);
    out.people = us.n;
    out.avg_level = us.avg10 / 10;
    out.verified = us.verified;
  }
  return out;
}

function ref(app, refv) {
  return u().byIdOrName(app, 'skills', refv, 'name', 'skills.list');
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  if (!util.bool(p, 'archived', false)) where.push('archived = FALSE');
  const cat = util.str(p, 'category', '');
  if (cat !== '') {
    where.push('category = {:c}');
    bind.c = cat;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(name LIKE {:q} ESCAPE '\\' OR description LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const rows = util.rows(app, 'SELECT id FROM skills' + (where.length > 0 ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY category COLLATE NOCASE, name COLLATE NOCASE LIMIT 1000', { id: '' }, bind);
  const skills = rows.map((r) => view(app, app.findRecordById('skills', r.id), true));
  const categories = util.rows(app, "SELECT category, COUNT(*) AS n FROM skills WHERE archived = FALSE AND category != '' GROUP BY category ORDER BY category COLLATE NOCASE", { category: '', n: 0 });
  const unlisted = util.rows(app, 'SELECT es.skill AS name, COUNT(*) AS n FROM employee_skills es WHERE NOT EXISTS (SELECT 1 FROM skills s WHERE LOWER(s.name) = LOWER(es.skill)) GROUP BY LOWER(es.skill) ORDER BY n DESC LIMIT 30', { name: '', n: 0 });
  return { skills: skills, categories: categories.map((c) => ({ name: c.category, count: c.n })), unlisted: unlisted.map((x) => ({ name: x.name, people: x.n })), can_edit: !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'edit') };
}

function readLevels(p) {
  const util = u();
  const raw = util.list(p, 'levels');
  if (raw === undefined) return undefined;
  if (raw.length > 5) throw util.fail(400, 'levels: up to five descriptions, level 1 first.', 'invalid_param', { param: 'levels' });
  return raw.map((x) => util.clip(util.squash(x), 200));
}

function readExpected(ctx, p) {
  const util = u();
  const raw = util.list(p, 'expected');
  if (raw === undefined) return undefined;
  if (raw.length > 200) throw util.fail(400, 'expected: at most 200 job titles.', 'invalid_param', { param: 'expected' });
  const seen = {};
  const out = [];
  raw.forEach((x, i) => {
    util.keysOnly(x, ['job_title', 'level'], 'expected item ' + (i + 1));
    const jt = L('lib_org').kindRef(ctx.app, 'title', String(x.job_title || ''));
    const lv = Number(x.level);
    if (!Number.isInteger(lv) || lv < 1 || lv > 5) throw util.fail(400, 'expected item ' + (i + 1) + ': level is 1 to 5.', 'invalid_param', { param: 'expected' });
    if (seen[jt.id]) return;
    seen[jt.id] = true;
    out.push({ job_title: jt.id, job_title_name: jt.getString('name'), level: lv });
  });
  return out;
}

function save(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  const isNew = rec.isNew();
  const before = isNew ? null : view(app, rec, false);
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(util.req(p, 'name', 'Python'));
    if (name.length > 120) throw util.fail(400, 'name is too long (at most 120 characters)', 'invalid_param', { param: 'name' });
    if (!isNew && name.toLowerCase() !== rec.getString('name').toLowerCase() && usage(app, rec.getString('name')).n > 0) throw util.fail(409, usage(app, rec.getString('name')).n + ' people have "' + rec.getString('name') + '"; a skill in use keeps its name. Add the new skill and archive this one.', 'in_use');
    const clash = util.findOne(app, 'skills', 'name = {:n} && id != {:id}', { n: name, id: rec.id || '-' });
    if (clash !== null || util.count(app, 'SELECT COUNT(*) AS n FROM skills WHERE LOWER(name) = LOWER({:n}) AND id != {:id}', { n: name, id: rec.id || '-' }) > 0) throw util.fail(409, 'The library already has "' + name + '".', 'conflict');
    rec.set('name', name);
  }
  if (util.has(p, 'category')) rec.set('category', util.clip(util.squash(util.str(p, 'category', '')), 80));
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 1000, ''));
  const lv = readLevels(p);
  if (lv !== undefined) rec.set('levels', lv);
  else if (isNew) rec.set('levels', []);
  const ex = readExpected(ctx, p);
  if (ex !== undefined) rec.set('expected', ex);
  else if (isNew) rec.set('expected', []);
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'skills', record: rec.id, summary: (isNew ? 'Added' : 'Changed') + ' the skill ' + rec.getString('name'), before: before, after: view(app, rec, false) });
  return { skill: view(app, rec, true) };
}

function add(ctx, p) {
  const util = u();
  const names = util.list(p, 'names');
  if (names !== undefined) {
    if (names.length > 100) throw util.fail(400, 'Add at most 100 skills at once.', 'too_many');
    const out = [];
    for (const n of names) {
      const name = util.squash(String(n || ''));
      if (name === '' || util.count(ctx.app, 'SELECT COUNT(*) AS n FROM skills WHERE LOWER(name) = LOWER({:n})', { n: name }) > 0) continue;
      out.push(save(ctx, { name: name, category: util.str(p, 'category', '') }, util.newRecord(ctx.app, 'skills')).skill);
    }
    L('lib_audit').note(ctx, { collection: 'skills', summary: 'Added ' + out.length + ' skills to the library' });
    return { skills: out };
  }
  return save(ctx, p, util.newRecord(ctx.app, 'skills'));
}

function update(ctx, p) {
  return save(ctx, p, ref(ctx.app, u().req(p, 'skill')));
}

function remove(ctx, p) {
  const util = u();
  const rec = ref(ctx.app, util.req(p, 'skill'));
  const n = usage(ctx.app, rec.getString('name')).n;
  if (n > 0) throw util.fail(409, n + ' people have this skill; archive it instead (skills.update --archived true).', 'in_use');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'skills', record: rec.id, summary: 'Deleted the skill ' + rec.getString('name') });
  return { deleted: true };
}

/** A person's skills with the library's category and the level their job title expects. */
function skillsOf(ctx, employeeId) {
  const util = u();
  const app = ctx.app;
  const pr = core().person(ctx, employeeId);
  const jt = pr ? pr.job_title : '';
  const lib = {};
  for (const r of util.findMany(app, 'skills', '1=1', '', 0)) lib[r.getString('name').toLowerCase()] = r;
  const out = util.findMany(app, 'employee_skills', 'employee = {:e}', 'skill', 0, { e: employeeId }).map((r) => {
    const s = lib[r.getString('skill').toLowerCase()];
    const exp = s ? (util.jsonOf(s, 'expected', []) || []).filter((x) => x.job_title === jt)[0] : undefined;
    return { id: r.id, skill: r.getString('skill'), library: s ? s.id : '', category: s ? s.getString('category') : '', level: r.getInt('level'), verified: r.getString('verified_by') !== '', verified_by: core().memberName(app, r.getString('verified_by')), expected: exp ? exp.level : 0, note: r.getString('note') };
  });
  const expectedMissing = [];
  if (jt !== '') {
    const have = {};
    for (const x of out) have[x.skill.toLowerCase()] = true;
    for (const k of Object.keys(lib)) {
      const s = lib[k];
      if (s.getBool('archived') || have[k]) continue;
      const exp = (util.jsonOf(s, 'expected', []) || []).filter((x) => x.job_title === jt)[0];
      if (exp) expectedMissing.push({ skill: s.getString('name'), library: s.id, category: s.getString('category'), expected: exp.level });
    }
  }
  return { skills: out, expected_missing: expectedMissing };
}

/** The skills matrix: people (team, department or everyone the caller sees) by library skills. */
function matrix(ctx, p) {
  const util = u();
  const app = ctx.app;
  const scope = util.oneOf(p, 'scope', ['team', 'department', 'all', 'me'], '');
  const auth = L('lib_auth');
  const hr = ctx.isAgent || auth.can(ctx, 'performance', 'view');
  const team = Object.keys(core().teamOf(ctx));
  const mode = scope !== '' ? scope : team.length > 0 ? 'team' : hr ? 'all' : 'me';
  let ids;
  if (mode === 'me') ids = ctx.employeeId ? [ctx.employeeId] : [];
  else if (mode === 'team') ids = (ctx.employeeId ? [ctx.employeeId] : []).concat(team);
  else {
    const vis = core().visibleIds(ctx);
    const day = util.today(app);
    const bind = { d: day };
    let sql = "SELECT DISTINCT m.employee AS employee FROM employments m JOIN employees e ON e.id = m.employee WHERE m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d}) AND e.archived = FALSE AND " + core().inList('m.employee', vis, bind, 'v');
    const dep = util.str(p, 'department', '');
    if (dep !== '' || mode === 'department') {
      const d = dep !== '' ? L('lib_org').kindRef(app, 'department', dep).id : (core().person(ctx, ctx.employeeId) || { department: '-' }).department;
      sql += ' AND EXISTS (SELECT 1 FROM job_records j WHERE j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:d} ORDER BY j2.effective_from DESC LIMIT 1) AND j.department = {:dep})';
      bind.dep = d;
    }
    const ent = util.str(p, 'entity', '');
    if (ent !== '') {
      sql += ' AND m.entity = {:ent}';
      bind.ent = L('lib_org').entityRef(app, ent).id;
    }
    ids = util.rows(app, sql + ' LIMIT 1000', { employee: '' }, bind).map((r) => r.employee);
    if (!hr) ids = ids.filter((x) => x === ctx.employeeId || team.indexOf(x) >= 0);
  }
  const pg = util.page(p, 100, 300);
  const people = ids
    .map((id) => core().person(ctx, id))
    .filter((x) => x !== null)
    .sort((a, b) => (a.department_name === b.department_name ? (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1) : a.department_name < b.department_name ? -1 : 1));
  const total = people.length;
  const page = people.slice(pg.offset, pg.offset + pg.limit);
  const cat = util.str(p, 'category', '');
  const lib = util.findMany(app, 'skills', 'archived = false' + (cat !== '' ? ' && category = {:c}' : ''), 'category,name', 0, { c: cat });
  const byName = {};
  for (const s of lib) byName[s.getString('name').toLowerCase()] = s;
  const rows = page.map((pr) => {
    const cells = {};
    for (const es of util.findMany(app, 'employee_skills', 'employee = {:e}', '', 0, { e: pr.id })) {
      const s = byName[es.getString('skill').toLowerCase()];
      if (!s) continue;
      cells[s.id] = { level: es.getInt('level'), verified: es.getString('verified_by') !== '', entry: es.id };
    }
    for (const s of lib) {
      const exp = (util.jsonOf(s, 'expected', []) || []).filter((x) => x.job_title === pr.job_title)[0];
      if (exp) {
        if (cells[s.id] === undefined) cells[s.id] = { level: 0, verified: false, entry: '' };
        cells[s.id].expected = exp.level;
      }
    }
    const rel = core().relation(ctx, pr.id);
    return { employee: { id: pr.id, number: pr.number, name: pr.name, title: pr.title, department_name: pr.department_name, photo: pr.photo }, cells: cells, gaps: Object.keys(cells).filter((k) => cells[k].expected && cells[k].level < cells[k].expected).length, can_verify: !ctx.isAgent && !rel.self && (rel.team || core().atLeast(rel.hr, 'edit')), can_edit: !ctx.isAgent && (rel.self || rel.team || core().atLeast(rel.hr, 'edit')) };
  });
  const shownAll = util.bool(p, 'all_skills', false);
  const used = {};
  for (const r of rows) for (const k of Object.keys(r.cells)) used[k] = true;
  const skills = lib
    .filter((s) => shownAll || used[s.id])
    .map((s) => {
      let n = 0;
      let sum = 0;
      for (const r of rows)
        if (r.cells[s.id] && r.cells[s.id].level > 0) {
          n++;
          sum += r.cells[s.id].level;
        }
      return { id: s.id, name: s.getString('name'), category: s.getString('category'), description: s.getString('description'), levels: util.jsonOf(s, 'levels', []) || [], holders: n, avg_level: n > 0 ? Math.round((sum / n) * 10) / 10 : 0 };
    });
  return { scope: mode, people: rows, skills: skills, total: total, limit: pg.limit, offset: pg.offset, library_size: lib.length };
}

function exportCsv(ctx, p) {
  const util = u();
  const m = matrix(ctx, Object.assign({}, p, { limit: 300 }));
  const rows = [['number', 'name', 'department'].concat(m.skills.map((s) => s.name))];
  for (const r of m.people) rows.push([r.employee.number, r.employee.name, r.employee.department_name].concat(m.skills.map((s) => (r.cells[s.id] && r.cells[s.id].level > 0 ? r.cells[s.id].level + (r.cells[s.id].verified ? 'v' : '') : ''))));
  L('lib_audit').write(ctx, { op: 'skills.export', collection: 'employee_skills', summary: 'Exported the skills matrix (' + m.people.length + ' people) to CSV' });
  return { filename: 'skills-' + util.today(ctx.app) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

module.exports = { view: view, list: list, add: add, update: update, remove: remove, skillsOf: skillsOf, matrix: matrix, exportCsv: exportCsv };
