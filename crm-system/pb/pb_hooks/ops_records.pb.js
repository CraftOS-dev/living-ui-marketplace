/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations on people, companies and deals: list (filters, presets,
 * saved views), get (with what the record page shows), create, upsert
 * (people by email, companies by domain), update, delete (to the trash),
 * restore, merge and bulk actions; timelines, duplicates and the trash.
 * The logic lives in lib_ops.js / lib_records.js; handlers run in isolated
 * VMs, so each route is written out.
 */
/* ------------------------------------------------------------ people */
routerAdd('GET', '/api/ops/people/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).list(app, 'people', p)));
routerAdd('GET', '/api/ops/people/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_ops.js`).get(app, 'people', u.str(p, 'id', '') || u.req(p, 'person'));
  }),
);
routerAdd('POST', '/api/ops/people/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).create(app, e, 'people', p)));
routerAdd('POST', '/api/ops/people/upsert', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).upsert(app, e, 'people', p)));
routerAdd('POST', '/api/ops/people/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).update(app, e, 'people', p)));
routerAdd('POST', '/api/ops/people/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).remove(app, e, 'people', p)));
routerAdd('POST', '/api/ops/people/restore', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).restore(app, e, 'people', p)));
routerAdd('POST', '/api/ops/people/merge', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).merge(app, e, 'people', p)));
routerAdd('POST', '/api/ops/people/bulk', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).bulk(app, e, 'people', p)));
routerAdd('GET', '/api/ops/people/export', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const res = require(`${__hooks}/lib_ops.js`).list(app, 'people', Object.assign({}, p, { limit: '5000' }));
    const cols = (u.list(p, 'columns', true) || []).map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
    const dflt = { people: ['name', 'email', 'phones', 'title', 'company_name', 'location', 'linkedin', 'source', 'tags', 'strength', 'last_interaction', 'next_touch'], companies: ['name', 'domain', 'industry', 'size', 'location', 'linkedin', 'source', 'tags', 'people', 'open_deals', 'last_interaction'], deals: ['name', 'pipeline_name', 'stage_name', 'status', 'value', 'currency', 'home_value', 'probability', 'expected_close', 'closed_at', 'company_name', 'source', 'next_step', 'lost_reason', 'tags'] }['people'];
    const columns = cols.length > 0 ? cols : dflt.map((k) => ({ key: k, label: k }));
    return { filename: 'people.csv', csv: require(`${__hooks}/lib_import.js`).toCsv(res['people'], columns), count: res.total };
  }),
);
routerAdd('POST', '/api/ops/people/research', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_ops.js`).bulk(app, e, 'people', Object.assign({}, p, { action: 'research', ids: u.has(p, 'ids') ? p.ids : u.req(p, 'id') }));
  }),
);

/* --------------------------------------------------------- companies */
routerAdd('GET', '/api/ops/companies/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).list(app, 'companies', p)));
routerAdd('GET', '/api/ops/companies/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_ops.js`).get(app, 'companies', u.str(p, 'id', '') || u.req(p, 'company'));
  }),
);
routerAdd('POST', '/api/ops/companies/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).create(app, e, 'companies', p)));
routerAdd('POST', '/api/ops/companies/upsert', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).upsert(app, e, 'companies', p)));
routerAdd('POST', '/api/ops/companies/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).update(app, e, 'companies', p)));
routerAdd('POST', '/api/ops/companies/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).remove(app, e, 'companies', p)));
routerAdd('POST', '/api/ops/companies/restore', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).restore(app, e, 'companies', p)));
routerAdd('POST', '/api/ops/companies/merge', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).merge(app, e, 'companies', p)));
routerAdd('POST', '/api/ops/companies/bulk', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).bulk(app, e, 'companies', p)));
routerAdd('GET', '/api/ops/companies/export', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const res = require(`${__hooks}/lib_ops.js`).list(app, 'companies', Object.assign({}, p, { limit: '5000' }));
    const cols = (u.list(p, 'columns', true) || []).map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
    const dflt = { people: ['name', 'email', 'phones', 'title', 'company_name', 'location', 'linkedin', 'source', 'tags', 'strength', 'last_interaction', 'next_touch'], companies: ['name', 'domain', 'industry', 'size', 'location', 'linkedin', 'source', 'tags', 'people', 'open_deals', 'last_interaction'], deals: ['name', 'pipeline_name', 'stage_name', 'status', 'value', 'currency', 'home_value', 'probability', 'expected_close', 'closed_at', 'company_name', 'source', 'next_step', 'lost_reason', 'tags'] }['companies'];
    const columns = cols.length > 0 ? cols : dflt.map((k) => ({ key: k, label: k }));
    return { filename: 'companies.csv', csv: require(`${__hooks}/lib_import.js`).toCsv(res['companies'], columns), count: res.total };
  }),
);
routerAdd('POST', '/api/ops/companies/research', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_ops.js`).bulk(app, e, 'companies', Object.assign({}, p, { action: 'research', ids: u.has(p, 'ids') ? p.ids : u.req(p, 'id') }));
  }),
);

/* ------------------------------------------------------------- deals */
routerAdd('GET', '/api/ops/deals/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).list(app, 'deals', p)));
routerAdd('GET', '/api/ops/deals/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_ops.js`).get(app, 'deals', u.str(p, 'id', '') || u.req(p, 'deal'));
  }),
);
routerAdd('POST', '/api/ops/deals/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).create(app, e, 'deals', p)));
routerAdd('POST', '/api/ops/deals/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).update(app, e, 'deals', p)));
routerAdd('POST', '/api/ops/deals/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).remove(app, e, 'deals', p)));
routerAdd('POST', '/api/ops/deals/restore', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).restore(app, e, 'deals', p)));
routerAdd('POST', '/api/ops/deals/merge', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).merge(app, e, 'deals', p)));
routerAdd('POST', '/api/ops/deals/bulk', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_ops.js`).bulk(app, e, 'deals', p)));
routerAdd('GET', '/api/ops/deals/export', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const res = require(`${__hooks}/lib_ops.js`).list(app, 'deals', Object.assign({}, p, { limit: '5000' }));
    const cols = (u.list(p, 'columns', true) || []).map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
    const dflt = { people: ['name', 'email', 'phones', 'title', 'company_name', 'location', 'linkedin', 'source', 'tags', 'strength', 'last_interaction', 'next_touch'], companies: ['name', 'domain', 'industry', 'size', 'location', 'linkedin', 'source', 'tags', 'people', 'open_deals', 'last_interaction'], deals: ['name', 'pipeline_name', 'stage_name', 'status', 'value', 'currency', 'home_value', 'probability', 'expected_close', 'closed_at', 'company_name', 'source', 'next_step', 'lost_reason', 'tags'] }['deals'];
    const columns = cols.length > 0 ? cols : dflt.map((k) => ({ key: k, label: k }));
    return { filename: 'deals.csv', csv: require(`${__hooks}/lib_import.js`).toCsv(res['deals'], columns), count: res.total };
  }),
);

/* ---------------------------------------------------------- timelines */

routerAdd('GET', '/api/ops/timeline/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies', 'deals'], '');
    if (object === '') throw u.fail(400, 'object is people, companies or deals');
    const rec = require(`${__hooks}/lib_records.js`).resolve(app, object, u.req(p, 'id'), { deleted: true });
    return { items: require(`${__hooks}/lib_timeline.js`).timeline(app, object, rec, u.int(p, 'limit', 200, 1, 1000)) };
  }),
);

/* --------------------------------------------------------- duplicates */

routerAdd('GET', '/api/ops/dupes/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies'], 'people');
    return { object: object, pairs: require(`${__hooks}/lib_data.js`).dupes(app, object, u.int(p, 'limit', 100, 1, 500)) };
  }),
);

routerAdd('POST', '/api/ops/dupes/dismiss', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies'], 'people');
    const a = u.req(p, 'a');
    const b = u.req(p, 'b');
    return require(`${__hooks}/lib_activity.js`).run(app, u.actor(e), 'dupes.dismiss', (t) => {
      require(`${__hooks}/lib_data.js`).dismiss(t, object, a, b);
      return { summary: 'Marked two ' + object + ' as not duplicates', type: object, id: a, result: { dismissed: true } };
    });
  }),
);

/* -------------------------------------------------------------- trash */

routerAdd('GET', '/api/ops/trash/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const q = require(`${__hooks}/lib_query.js`);
    const out = {};
    for (const o of ['people', 'companies', 'deals']) out[o] = q.list(app, o, { deleted: true, sort: 'deleted', dir: 'desc', limit: 500 }).rows;
    return out;
  }),
);
