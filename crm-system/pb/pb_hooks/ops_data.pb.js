/// <reference path="../pb_data/types.d.ts" />
/**
 * Lists, saved views, custom fields and CSV import.
 */

/* ------------------------------------------------------------------ lists */

routerAdd('GET', '/api/ops/lists/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies'], '');
    const rows = app.findRecordsByFilter('lists', object ? 'object = {:o}' : 'id != ""', 'position,name', 0, 0, { o: object });
    return { lists: rows.map((r) => require(`${__hooks}/lib_data.js`).serializeList(app, r)) };
  }),
);

routerAdd('POST', '/api/ops/lists/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const name = u.squash(u.str(p, 'name', '')).slice(0, 80);
    if (name === '') throw u.fail(400, 'name is required');
    const object = u.oneOf(p, 'object', ['people', 'companies'], 'people');
    if (u.findOne(app, 'lists', 'name = {:n} && object = {:o}', { n: name, o: object })) throw u.fail(409, 'There is already a list ' + name);
    const id = require(`${__hooks}/lib_activity.js`).run(app, who, 'lists.create', (t) => {
      const r = new Record(t.findCollectionByNameOrId('lists'));
      r.set('name', name);
      r.set('object', object);
      r.set('color', u.str(p, 'color', 'c' + ((t.findRecordsByFilter('lists', 'id != ""', '', 0, 0).length % 8) + 1)).slice(0, 20));
      r.set('description', u.text(p, 'description', '').slice(0, 300));
      r.set('position', t.findRecordsByFilter('lists', 'id != ""', '', 0, 0).length);
      t.save(r);
      if (u.has(p, 'ids')) require(`${__hooks}/lib_ops.js`).addToList(t, r.id, (u.list(p, 'ids', true) || []).map((x) => require(`${__hooks}/lib_records.js`).resolve(t, object, String(x)).id));
      return { summary: 'Added the list ' + name, type: 'lists', id: r.id, result: r.id };
    });
    return { list: require(`${__hooks}/lib_data.js`).serializeList(app, app.findRecordById('lists', id)) };
  }),
);

routerAdd('POST', '/api/ops/lists/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const l0 = u.byId(app, 'lists', u.req(p, 'list'));
    if (!l0) throw u.fail(404, 'No list ' + u.str(p, 'list', ''));
    require(`${__hooks}/lib_activity.js`).run(app, who, 'lists.update', (t) => {
      const l = t.findRecordById('lists', l0.id);
      if (u.has(p, 'name')) {
        const n = u.squash(u.str(p, 'name', '')).slice(0, 80);
        if (n === '') throw u.fail(400, 'name cannot be empty');
        l.set('name', n);
      }
      if (u.has(p, 'color')) l.set('color', u.str(p, 'color', '').slice(0, 20));
      if (u.has(p, 'description')) l.set('description', u.text(p, 'description', '').slice(0, 300));
      if (u.has(p, 'position')) l.set('position', u.int(p, 'position', 0, 0, 1000));
      t.save(l);
      return { summary: 'Changed the list ' + l.getString('name'), type: 'lists', id: l.id, merge: true };
    });
    return { list: require(`${__hooks}/lib_data.js`).serializeList(app, app.findRecordById('lists', l0.id)) };
  }),
);

routerAdd('POST', '/api/ops/lists/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person deletes lists');
    const l0 = u.byId(app, 'lists', u.req(p, 'list'));
    if (!l0) throw u.fail(404, 'No list ' + u.str(p, 'list', ''));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'lists.delete', (t) => {
      const l = t.findRecordById('lists', l0.id);
      for (const en of t.findRecordsByFilter('list_entries', 'list = {:l}', '', 0, 0, { l: l.id })) t.delete(en);
      t.delete(l);
      return { summary: 'Deleted the list ' + l.getString('name') + ' (the people and companies stay)', type: 'lists', id: l.id, result: { deleted: true } };
    });
  }),
);

routerAdd('POST', '/api/ops/lists/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const l0 = u.byId(app, 'lists', u.req(p, 'list')) || u.findOne(app, 'lists', 'name = {:n}', { n: u.str(p, 'list', '') });
    if (!l0) throw u.fail(404, 'No list ' + u.str(p, 'list', ''));
    const object = l0.getString('object') || 'people';
    const ids = (u.list(p, 'ids', true) || []).map((x) => require(`${__hooks}/lib_records.js`).resolve(app, object, String(x)).id);
    if (ids.length === 0) throw u.fail(400, 'ids is required');
    const n = require(`${__hooks}/lib_activity.js`).run(app, who, 'lists.add', (t) => {
      const r = require(`${__hooks}/lib_ops.js`).addToList(t, l0.id, ids);
      return { summary: r.added > 0 ? 'Added ' + r.added + ' to ' + l0.getString('name') : '', type: 'lists', id: l0.id, result: r.added };
    });
    return { added: n, list: require(`${__hooks}/lib_data.js`).serializeList(app, l0) };
  }),
);

routerAdd('POST', '/api/ops/lists/remove', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const l0 = u.byId(app, 'lists', u.req(p, 'list'));
    if (!l0) throw u.fail(404, 'No list ' + u.str(p, 'list', ''));
    const f = l0.getString('object') === 'companies' ? 'company' : 'person';
    const ids = (u.list(p, 'ids', true) || []).map((x) => String(x).trim());
    const n = require(`${__hooks}/lib_activity.js`).run(app, who, 'lists.remove', (t) => {
      let k = 0;
      for (const id of ids)
        for (const en of t.findRecordsByFilter('list_entries', 'list = {:l} && ' + f + ' = {:r}', '', 0, 0, { l: l0.id, r: id })) {
          t.delete(en);
          k++;
        }
      return { summary: k > 0 ? 'Removed ' + k + ' from ' + l0.getString('name') : '', type: 'lists', id: l0.id, result: k };
    });
    return { removed: n };
  }),
);

/* ------------------------------------------------------------------ views */

routerAdd('GET', '/api/ops/views/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies', 'deals'], '');
    const rows = app.findRecordsByFilter('views', object ? 'object = {:o}' : 'id != ""', 'position,name', 0, 0, { o: object });
    return { views: rows.map((r) => require(`${__hooks}/lib_data.js`).serializeView(r)) };
  }),
);

routerAdd('POST', '/api/ops/views/save', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const filters = u.has(p, 'filters') ? u.list(p, 'filters') || [] : [];
    require(`${__hooks}/lib_query.js`).validate(filters);
    const existing = u.str(p, 'view', '') !== '' ? u.byId(app, 'views', u.str(p, 'view', '')) : null;
    if (u.str(p, 'view', '') !== '' && !existing) throw u.fail(404, 'No view ' + u.str(p, 'view', ''));
    const id = require(`${__hooks}/lib_activity.js`).run(app, who, 'views.save', (t) => {
      const v = existing ? t.findRecordById('views', existing.id) : new Record(t.findCollectionByNameOrId('views'));
      if (!existing) {
        v.set('object', u.oneOf(p, 'object', ['people', 'companies', 'deals'], 'people'));
        v.set('position', t.findRecordsByFilter('views', 'id != ""', '', 0, 0).length);
      }
      if (u.has(p, 'name') || !existing) {
        const n = u.squash(u.str(p, 'name', '')).slice(0, 80);
        if (n === '') throw u.fail(400, 'name is required');
        v.set('name', n);
      }
      if (u.has(p, 'filters') || !existing) v.set('filters', filters);
      if (u.has(p, 'match') || !existing) v.set('match', u.oneOf(p, 'match', ['all', 'any'], 'all'));
      if (u.has(p, 'sort')) v.set('sort', u.str(p, 'sort', '').slice(0, 40));
      if (u.has(p, 'dir')) v.set('dir', u.oneOf(p, 'dir', ['asc', 'desc'], 'asc'));
      if (u.has(p, 'columns')) v.set('columns', u.list(p, 'columns', true) || []);
      if (u.has(p, 'mode')) v.set('mode', u.oneOf(p, 'mode', ['table', 'board'], 'table'));
      if (u.has(p, 'pipeline')) v.set('pipeline', u.str(p, 'pipeline', '').slice(0, 15));
      t.save(v);
      return { summary: (existing ? 'Changed' : 'Saved') + ' the view ' + v.getString('name'), type: 'views', id: v.id, result: v.id, merge: true };
    });
    return { view: require(`${__hooks}/lib_data.js`).serializeView(app.findRecordById('views', id)) };
  }),
);

routerAdd('POST', '/api/ops/views/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const v0 = u.byId(app, 'views', u.req(p, 'view'));
    if (!v0) throw u.fail(404, 'No view ' + u.str(p, 'view', ''));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'views.delete', (t) => {
      const v = t.findRecordById('views', v0.id);
      t.delete(v);
      return { summary: 'Deleted the view ' + v.getString('name'), type: 'views', id: v.id, result: { deleted: true } };
    });
  }),
);

/* ----------------------------------------------------------------- fields */

routerAdd('GET', '/api/ops/fields/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies', 'deals'], '');
    const rows = app.findRecordsByFilter('fields', object ? 'object = {:o}' : 'id != ""', 'object,position,label', 0, 0, { o: object });
    const builtin = {};
    for (const o of ['people', 'companies', 'deals']) builtin[o] = recs.OBJECTS[o].fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options || [] }));
    return { fields: rows.map((r) => require(`${__hooks}/lib_data.js`).serializeField(r)), builtin: builtin };
  }),
);

routerAdd('POST', '/api/ops/fields/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const who = u.actor(e);
    const object = u.oneOf(p, 'object', ['people', 'companies', 'deals'], '');
    if (object === '') throw u.fail(400, 'object is people, companies or deals');
    const label = u.squash(u.str(p, 'label', '')).slice(0, 60);
    if (label === '') throw u.fail(400, 'label is required');
    const key = (u.str(p, 'key', '') || label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (key === '') throw u.fail(400, 'key must have letters or digits');
    if (recs.OBJECTS[object].fields.some((f) => f.key === key)) throw u.fail(409, key + ' is a built-in field');
    if (u.findOne(app, 'fields', 'object = {:o} && key = {:k}', { o: object, k: key })) throw u.fail(409, 'There is already a field ' + key);
    const type = u.oneOf(p, 'type', ['text', 'number', 'currency', 'date', 'select', 'multi_select', 'checkbox', 'url', 'rating'], 'text');
    const options = (u.list(p, 'options', true) || []).map((x) => String(typeof x === 'object' && x ? x.value : x).trim()).filter((x) => x !== '');
    if ((type === 'select' || type === 'multi_select') && options.length === 0) throw u.fail(400, 'A ' + type + ' field needs options');
    const id = require(`${__hooks}/lib_activity.js`).run(app, who, 'fields.create', (t) => {
      const r = new Record(t.findCollectionByNameOrId('fields'));
      r.set('object', object);
      r.set('key', key);
      r.set('label', label);
      r.set('type', type);
      r.set('options', options);
      r.set('ai_prompt', u.text(p, 'ai_prompt', '').slice(0, 1000));
      r.set('position', t.findRecordsByFilter('fields', 'object = {:o}', '', 0, 0, { o: object }).length);
      t.save(r);
      return { summary: 'Added the field ' + label + ' to ' + object, type: 'fields', id: r.id, result: r.id };
    });
    return { field: require(`${__hooks}/lib_data.js`).serializeField(app.findRecordById('fields', id)) };
  }),
);

routerAdd('POST', '/api/ops/fields/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const f0 = u.byId(app, 'fields', u.req(p, 'field'));
    if (!f0) throw u.fail(404, 'No field ' + u.str(p, 'field', ''));
    require(`${__hooks}/lib_activity.js`).run(app, who, 'fields.update', (t) => {
      const f = t.findRecordById('fields', f0.id);
      if (u.has(p, 'label')) {
        const l = u.squash(u.str(p, 'label', '')).slice(0, 60);
        if (l === '') throw u.fail(400, 'label cannot be empty');
        f.set('label', l);
      }
      if (u.has(p, 'options')) f.set('options', (u.list(p, 'options', true) || []).map((x) => String(x).trim()).filter((x) => x !== ''));
      if (u.has(p, 'ai_prompt')) f.set('ai_prompt', u.text(p, 'ai_prompt', '').slice(0, 1000));
      if (u.has(p, 'position')) f.set('position', u.int(p, 'position', 0, 0, 1000));
      t.save(f);
      return { summary: 'Changed the field ' + f.getString('label'), type: 'fields', id: f.id, merge: true };
    });
    return { field: require(`${__hooks}/lib_data.js`).serializeField(app.findRecordById('fields', f0.id)) };
  }),
);

routerAdd('POST', '/api/ops/fields/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person deletes fields');
    const f0 = u.byId(app, 'fields', u.req(p, 'field'));
    if (!f0) throw u.fail(404, 'No field ' + u.str(p, 'field', ''));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fields.delete', (t) => {
      const f = t.findRecordById('fields', f0.id);
      t.delete(f);
      return { summary: 'Deleted the field ' + f.getString('label') + ' (its values are kept and come back if you add the field again)', type: 'fields', id: f.id, result: { deleted: true } };
    });
  }),
);

/* ----------------------------------------------------------------- import */

routerAdd('POST', '/api/ops/import/preview', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const object = u.oneOf(p, 'object', ['people', 'companies', 'deals'], 'people');
    const mapping = u.has(p, 'mapping') ? (u.list(p, 'mapping') || []).map((x) => String(x || '')) : null;
    return require(`${__hooks}/lib_import.js`).preview(app, object, u.text(p, 'csv', ''), mapping);
  }),
);

routerAdd('POST', '/api/ops/import/apply', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const object = u.oneOf(p, 'object', ['people', 'companies', 'deals'], 'people');
    const mapping = u.has(p, 'mapping') ? (u.list(p, 'mapping') || []).map((x) => String(x || '')) : null;
    const name = u.str(p, 'file_name', '').slice(0, 120);
    const res = require(`${__hooks}/lib_activity.js`).run(app, who, 'import.apply', (t) => {
      const r = require(`${__hooks}/lib_import.js`).apply(t, object, u.text(p, 'csv', ''), mapping, { overwrite: who.actor !== 'agent' && u.bool(p, 'overwrite', false), list: u.str(p, 'list', '') });
      return { summary: 'Imported ' + object + (name ? ' from ' + name : '') + ': ' + r.created + ' new, ' + r.updated + ' updated' + (r.skipped ? ', ' + r.skipped + ' skipped' : ''), type: object, result: r };
    });
    if (object !== 'deals') require(`${__hooks}/lib_ops.js`).maybeResearch(app, who, object, (res.ids || []).slice(0, 200));
    delete res.ids;
    return res;
  }),
);
