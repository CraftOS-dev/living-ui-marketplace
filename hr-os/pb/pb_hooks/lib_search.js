/// <reference path="../pb_data/types.d.ts" />
/**
 * Ctrl-K search across people, organisation, pay runs, leave requests,
 * expense claims and candidates, within what the caller may see. Modules
 * register nothing: the kernel reads the known collections by name (and
 * skips one that does not exist, which happens only in a scratch copy
 * without that module).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function query(ctx, p) {
  const u = L('lib_util');
  const auth = L('lib_auth');
  const app = ctx.app;
  const q = u.squash(u.str(p, 'q', ''));
  if (q.length < 2) return { q: q, results: [] };
  const per = u.int(p, 'limit', 6, 1, 20);
  const like = u.like(q);
  const out = [];
  // subtitle is plain text for the CLI; facts carry the days, amounts and states screens format.
  const add = (group, id, title, subtitle, link, facts) => out.push({ group: group, id: id, title: title, subtitle: subtitle, link: link, facts: facts || [] });

  const dir = L('lib_people').directory(ctx, { q: q, status: 'all', limit: per });
  for (const x of dir.people) add('people', x.employee, x.name, [x.number, x.title, x.department_name, x.entity_name].filter((s) => s).join(' · '), '#/people/' + x.number, [{ type: 'text', key: 'number', value: x.number }, { type: 'text', key: 'title', value: x.title }, { type: 'text', key: 'department', value: x.department_name }, { type: 'text', key: 'entity', value: x.entity_name }, { type: 'state', key: 'status', value: x.employment_status }].filter((f) => f.value));

  if (auth.can(ctx, 'people', 'view') || ctx.isAgent) {
    for (const r of u.rows(app, "SELECT id, name, code FROM departments WHERE archived = FALSE AND (name LIKE {:q} ESCAPE '\\' OR code LIKE {:q} ESCAPE '\\') ORDER BY name LIMIT " + per, { id: '', name: '', code: '' }, { q: like })) add('departments', r.id, r.name, r.code, '#/people?department=' + r.id);
    for (const r of u.rows(app, "SELECT id, name, country FROM entities WHERE name LIKE {:q} ESCAPE '\\' OR legal_name LIKE {:q} ESCAPE '\\' ORDER BY name LIMIT " + per, { id: '', name: '', country: '' }, { q: like })) if (auth.inScope(ctx, r.id)) add('entities', r.id, r.name, r.country, '#/settings/entities/' + r.id);
  }

  if (app.hasTable('payruns') && (ctx.isAgent || auth.can(ctx, 'payroll', 'view'))) {
    const rows = u.rows(app, "SELECT p.id AS id, p.kind AS kind, p.status AS status, p.period_start AS ps, p.period_end AS pe, p.entity AS entity, COALESCE(n.name, '') AS en FROM payruns p LEFT JOIN entities n ON n.id = p.entity WHERE n.name LIKE {:q} ESCAPE '\\' OR p.period_start LIKE {:q} ESCAPE '\\' OR p.period_end LIKE {:q} ESCAPE '\\' OR p.kind LIKE {:q} ESCAPE '\\' ORDER BY p.period_end DESC LIMIT " + per, { id: '', kind: '', status: '', ps: '', pe: '', entity: '', en: '' }, { q: like });
    for (const r of rows) if (auth.inScope(ctx, r.entity)) add('payruns', r.id, r.en, r.ps + ' to ' + r.pe + ' · ' + r.kind + ' · ' + r.status, '#/payroll/runs/' + r.id, [{ type: 'range', key: 'period', from: r.ps, to: r.pe }, { type: 'text', key: 'kind', value: r.kind }, { type: 'state', key: 'status', value: r.status }]);
  }

  const ownOrModule = (module, table, sql, shape, map) => {
    if (!app.hasTable(table)) return;
    const own = ctx.isAgent || auth.can(ctx, module, 'view') ? '' : ' AND e.id = {:self}';
    for (const r of u.rows(app, sql.replace('{{own}}', own) + ' LIMIT ' + per, shape, { q: like, self: auth.selfEmployee(ctx) || '-' })) map(r);
  };
  ownOrModule(
    'leave',
    'leave_requests',
    "SELECT r.id AS id, [[r.start]] AS sd, [[r.end]] AS ed, r.status AS status, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name FROM leave_requests r JOIN employments m ON m.id = r.employment JOIN employees e ON e.id = m.employee WHERE (e.legal_name LIKE {:q} ESCAPE '\\' OR e.preferred_name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\' OR r.reason LIKE {:q} ESCAPE '\\'){{own}} ORDER BY [[r.start]] DESC",
    { id: '', sd: '', ed: '', status: '', number: '', name: '' },
    (r) => add('leave', r.id, r.name, r.sd + (r.ed !== r.sd ? ' to ' + r.ed : '') + ' · ' + r.status, '#/leave/requests/' + r.id, [{ type: 'range', key: 'days', from: r.sd, to: r.ed || r.sd }, { type: 'state', key: 'status', value: r.status }]),
  );
  ownOrModule(
    'expenses',
    'claims',
    "SELECT r.id AS id, r.title AS title, r.status AS status, r.currency AS currency, r.total_minor AS total, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name FROM claims r JOIN employments m ON m.id = r.employment JOIN employees e ON e.id = m.employee WHERE (r.title LIKE {:q} ESCAPE '\\' OR e.legal_name LIKE {:q} ESCAPE '\\' OR e.preferred_name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\'){{own}} ORDER BY r.created DESC",
    { id: '', title: '', status: '', currency: '', total: 0, name: '' },
    (r) => add('claims', r.id, r.title || 'Expense claim', r.name + ' · ' + r.status, '#/expenses/claims/' + r.id, [{ type: 'text', key: 'person', value: r.name }].concat(/^[A-Z]{3}$/.test(r.currency) ? [{ type: 'money', key: 'total', amount_minor: r.total, currency: r.currency }] : []).concat([{ type: 'state', key: 'status', value: r.status }])),
  );

  if (app.hasTable('candidates') && (ctx.isAgent || auth.can(ctx, 'hiring', 'view'))) {
    for (const r of u.rows(app, "SELECT id, name, email FROM candidates WHERE name LIKE {:q} ESCAPE '\\' OR email LIKE {:q} ESCAPE '\\' ORDER BY name LIMIT " + per, { id: '', name: '', email: '' }, { q: like })) add('candidates', r.id, r.name, r.email, '#/hiring/candidates/' + r.id);
  }
  return { q: q, results: out };
}

module.exports = { query: query };
