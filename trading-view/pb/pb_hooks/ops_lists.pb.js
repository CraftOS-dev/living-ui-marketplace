/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: watchlists and chart drawings. Changes are logged with their
 * undo; the AI agent's drawings are marked as its markup until adopted.
 */

/* -------------------------------------------------------------- watchlists */

routerAdd('GET', '/api/ops/watchlists/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_workspace.js`).ensureSeed(app);
    return { watchlists: require(`${__hooks}/lib_watch.js`).lists(app) };
  }),
);

routerAdd('GET', '/api/ops/watchlists/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    return { watchlist: w.full(app, w.mustList(app, u.req(p, 'list')), u.bool(p, 'quotes', false)) };
  }),
);

routerAdd('POST', '/api/ops/watchlists/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const name = u.squash(u.req(p, 'name')).slice(0, 80);
    const syms = (u.list(p, 'symbols', true) || []).map((s) => m.normalize(s));
    let sort = 0;
    for (const r of app.findRecordsByFilter('watchlists', 'id != ""', '', 0, 0)) sort = Math.max(sort, r.getInt('sort') + 1);
    let rec = null;
    app.runInTransaction((tx) => {
      rec = new Record(tx.findCollectionByNameOrId('watchlists'));
      rec.set('name', name);
      rec.set('sort', sort);
      rec.set('columns', ['last', 'chg', 'chg_pct']);
      tx.save(rec);
      const seen = {};
      let n = 0;
      for (const s of syms) {
        if (seen[s]) continue;
        seen[s] = true;
        const it = new Record(tx.findCollectionByNameOrId('watch_items'));
        it.set('list', rec.id);
        it.set('kind', 'symbol');
        it.set('symbol', s);
        it.set('sort', n++);
        tx.save(it);
      }
    });
    act.record(app, { who: u.actor(e), op: 'watchlists.create', summary: 'Created the watchlist "' + name + '"' + (syms.length > 0 ? ' with ' + syms.length + ' symbols' : ''), type: 'watchlist', id: rec.id, undo: [{ do: 'delete', c: 'watchlists', id: rec.id }] });
    return { watchlist: require(`${__hooks}/lib_watch.js`).full(app, rec, false) };
  }),
);

routerAdd('POST', '/api/ops/watchlists/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = w.mustList(app, u.req(p, 'list'));
    const before = act.pick(rec, ['name', 'columns']);
    if (u.has(p, 'name')) {
      const name = u.squash(u.str(p, 'name', '')).slice(0, 80);
      if (name === '') throw u.fail(400, 'name cannot be empty');
      rec.set('name', name);
    }
    if (u.has(p, 'columns')) {
      const cols = u.list(p, 'columns', true).map((c) => String(c).trim());
      for (const c of cols) if (w.COLUMNS.indexOf(c) < 0) throw u.fail(400, 'columns are: ' + w.COLUMNS.join(', '));
      rec.set('columns', cols);
    }
    app.save(rec);
    act.record(app, { who: u.actor(e), op: 'watchlists.update', summary: 'Edited the watchlist "' + rec.getString('name') + '"', type: 'watchlist', id: rec.id, undo: [{ do: 'restore', c: 'watchlists', id: rec.id, fields: before }], merge: true });
    return { watchlist: w.serializeList(rec) };
  }),
);

routerAdd('POST', '/api/ops/watchlists/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = w.mustList(app, u.req(p, 'list'));
    const undo = [{ do: 'recreate', c: 'watchlists', data: act.snapshot(rec) }];
    for (const it of w.itemsOf(app, rec.id)) undo.push({ do: 'recreate', c: 'watch_items', data: act.snapshot(it) });
    const name = rec.getString('name');
    app.delete(rec);
    act.record(app, { who: u.actor(e), op: 'watchlists.delete', summary: 'Deleted the watchlist "' + name + '"', type: 'watchlist', id: rec.id, undo: undo });
    return { deleted: true };
  }),
);

routerAdd('POST', '/api/ops/watchlists/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = w.mustList(app, u.req(p, 'list'));
    const syms = (u.list(p, 'symbols', true) || []).map((s) => String(s).trim()).filter((s) => s !== '');
    const section = u.squash(u.str(p, 'section', '')).slice(0, 80);
    if (syms.length === 0 && section === '') throw u.fail(400, 'Give symbols (JSON list or comma-separated) and/or a section header');
    const existing = {};
    for (const it of w.itemsOf(app, rec.id)) if (it.getString('kind') === 'symbol') existing[it.getString('symbol')] = true;
    const clean = [];
    for (const s of syms) {
      const sym = syms.length <= 5 ? m.meta(app, s).symbol : m.normalize(s);
      if (!existing[sym] && clean.indexOf(sym) < 0) clean.push(sym);
    }
    let index = u.int(p, 'index', -1, -1, 100000);
    const added = [];
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_watch.js`);
      let sort = lib.nextSort(tx, rec.id);
      const make = (kind, value) => {
        const it = new Record(tx.findCollectionByNameOrId('watch_items'));
        it.set('list', rec.id);
        it.set('kind', kind);
        if (kind === 'symbol') it.set('symbol', value);
        else it.set('label', value);
        it.set('sort', sort++);
        tx.save(it);
        added.push(it);
      };
      if (section !== '') make('section', section);
      for (const s of clean) make('symbol', s);
      if (index >= 0) {
        const rows = lib.itemsOf(tx, rec.id).filter((r) => added.every((a) => a.id !== r.id));
        rows.splice(Math.min(index, rows.length), 0, ...added);
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].getInt('sort') !== i) {
            rows[i].set('sort', i);
            tx.save(rows[i]);
          }
        }
      }
    });
    if (added.length > 0) {
      act.record(app, {
        who: u.actor(e),
        op: 'watchlists.add',
        summary: 'Added ' + (clean.length > 0 ? clean.join(', ') : 'the section "' + section + '"') + ' to "' + rec.getString('name') + '"',
        type: 'watchlist',
        id: rec.id,
        symbol: clean.length === 1 ? clean[0] : '',
        undo: added.map((a) => ({ do: 'delete', c: 'watch_items', id: a.id })),
      });
    }
    return { added: added.map(w.serializeItem), skipped: syms.length - clean.length };
  }),
);

routerAdd('POST', '/api/ops/watchlists/remove', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    let rows = [];
    const ids = u.list(p, 'items', true) || [];
    if (u.has(p, 'item')) ids.push(u.str(p, 'item', ''));
    if (ids.length > 0) rows = ids.map((id) => w.mustItem(app, String(id)));
    else {
      const list = w.mustList(app, u.req(p, 'list'));
      const sym = m.normalize(u.req(p, 'symbol'));
      rows = app.findRecordsByFilter('watch_items', "list = {:l} && kind = 'symbol' && symbol = {:s}", '', 0, 0, { l: list.id, s: sym });
      if (rows.length === 0) throw u.fail(404, sym + ' is not in "' + list.getString('name') + '"');
    }
    const undo = rows.map((r) => ({ do: 'recreate', c: 'watch_items', data: act.snapshot(r) }));
    const names = rows.map((r) => r.getString('symbol') || r.getString('label'));
    for (const r of rows) app.delete(r);
    act.record(app, { who: u.actor(e), op: 'watchlists.remove', summary: 'Removed ' + names.join(', ') + ' from a watchlist', type: 'watchlist', id: rows[0].getString('list'), symbol: names.length === 1 ? names[0] : '', undo: undo });
    return { removed: rows.length };
  }),
);

routerAdd('POST', '/api/ops/watchlists/move', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const it = w.mustItem(app, u.req(p, 'item'));
    const fromList = it.getString('list');
    const toList = u.has(p, 'list') ? w.mustList(app, u.str(p, 'list', '')).id : fromList;
    const index = u.int(p, 'index', 100000, 0, 100000);
    const undo = w.itemsOf(app, fromList).map((r) => ({ do: 'restore', c: 'watch_items', id: r.id, fields: { sort: r.getInt('sort'), list: r.getString('list') } }));
    if (toList !== fromList) {
      if (it.getString('kind') === 'symbol') {
        const dup = app.findRecordsByFilter('watch_items', "list = {:l} && kind = 'symbol' && symbol = {:s}", '', 1, 0, { l: toList, s: it.getString('symbol') });
        if (dup.length > 0) throw u.fail(409, it.getString('symbol') + ' is already in that watchlist');
      }
      for (const r of w.itemsOf(app, toList)) undo.push({ do: 'restore', c: 'watch_items', id: r.id, fields: { sort: r.getInt('sort') } });
    }
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_watch.js`);
      const rec = tx.findRecordById('watch_items', it.id);
      rec.set('list', toList);
      tx.save(rec);
      lib.reorder(tx, toList, rec, index);
      if (toList !== fromList) lib.reorder(tx, fromList, null, 0);
    });
    act.record(app, { who: u.actor(e), op: 'watchlists.move', summary: 'Moved ' + (it.getString('symbol') || it.getString('label')) + ' in a watchlist', type: 'watchlist', id: toList, undo: undo, merge: true });
    return { ok: true };
  }),
);

routerAdd('POST', '/api/ops/watchlists/item', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const w = require(`${__hooks}/lib_watch.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const it = w.mustItem(app, u.req(p, 'item'));
    const before = act.pick(it, ['flag', 'note', 'label']);
    if (u.has(p, 'flag')) it.set('flag', u.oneOf(p, 'flag', w.FLAGS.filter((f) => f !== ''), '') || '');
    if (u.has(p, 'note')) it.set('note', u.text(p, 'note', '').slice(0, 2000));
    if (u.has(p, 'label')) {
      if (it.getString('kind') !== 'section') throw u.fail(400, 'Only a section header has a label');
      const label = u.squash(u.str(p, 'label', '')).slice(0, 80);
      if (label === '') throw u.fail(400, 'label cannot be empty');
      it.set('label', label);
    }
    app.save(it);
    act.record(app, { who: u.actor(e), op: 'watchlists.item', summary: 'Edited ' + (it.getString('symbol') || it.getString('label')) + ' in a watchlist', type: 'watch_item', id: it.id, symbol: it.getString('symbol'), undo: [{ do: 'restore', c: 'watch_items', id: it.id, fields: before }], merge: true });
    return { item: w.serializeItem(it) };
  }),
);

/* ---------------------------------------------------------------- drawings */

routerAdd('GET', '/api/ops/drawings/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const d = require(`${__hooks}/lib_drawings.js`);
    const parts = [];
    const prm = {};
    if (u.has(p, 'symbol')) {
      parts.push('symbol = {:s}');
      prm.s = require(`${__hooks}/lib_market.js`).normalize(u.str(p, 'symbol', ''));
    }
    const by = u.oneOf(p, 'added_by', ['user', 'agent'], '');
    if (by !== '') {
      parts.push('added_by = {:b}');
      prm.b = by;
    }
    if (u.has(p, 'run')) {
      parts.push('run = {:r}');
      prm.r = u.str(p, 'run', '');
    }
    const rows = app.findRecordsByFilter('drawings', parts.join(' && ') || 'id != ""', 'created', u.int(p, 'limit', 500, 1, 2000), 0, prm);
    return { drawings: rows.map(d.serialize) };
  }),
);

routerAdd('POST', '/api/ops/drawings/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const d = require(`${__hooks}/lib_drawings.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    const sym = m.normalize(u.req(p, 'symbol'));
    const tool = u.oneOf(p, 'tool', d.TOOLS, '');
    if (tool === '') throw u.fail(400, 'tool is required: one of ' + d.TOOLS.join(', '));
    let pts = u.list(p, 'points', false);
    if (!pts && u.has(p, 'price') && (tool === 'hline' || tool === 'hray')) pts = [{ t: u.num(p, 'time', Math.floor(Date.now() / 1000), 0, 4102444800), p: u.num(p, 'price', 0, -1e15, 1e15) }];
    const rec = new Record(app.findCollectionByNameOrId('drawings'));
    rec.set('symbol', sym);
    rec.set('tool', tool);
    rec.set('points', d.cleanPoints(tool, pts));
    rec.set('style', d.cleanStyle(u.obj(p, 'style') || (who.actor === 'agent' ? { color: 'accent' } : {})));
    rec.set('text', u.text(p, 'text', '').slice(0, 500));
    rec.set('note', u.text(p, 'note', '').slice(0, 1000));
    rec.set('locked', u.bool(p, 'locked', false));
    rec.set('hidden', false);
    rec.set('added_by', who.actor);
    rec.set('run', who.run);
    app.save(rec);
    act.record(app, { who: who, op: 'drawings.add', summary: 'Drew a ' + tool.replace('_', ' ') + ' on ' + sym + (rec.getString('text') ? ' ("' + rec.getString('text').slice(0, 60) + '")' : ''), type: 'drawing', id: rec.id, symbol: sym, undo: [{ do: 'delete', c: 'drawings', id: rec.id }] });
    return { drawing: d.serialize(rec) };
  }),
);

routerAdd('POST', '/api/ops/drawings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const d = require(`${__hooks}/lib_drawings.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = d.mustGet(app, u.req(p, 'drawing'));
    const before = act.pick(rec, ['points', 'style', 'text', 'note', 'locked', 'hidden']);
    if (rec.getBool('locked') && u.has(p, 'points') && !u.has(p, 'locked')) throw u.fail(409, 'This drawing is locked; unlock it first (locked=false)');
    if (u.has(p, 'points')) rec.set('points', d.cleanPoints(rec.getString('tool'), u.list(p, 'points', false)));
    if (u.has(p, 'style')) rec.set('style', Object.assign({}, u.json(rec, 'style', {}) || {}, d.cleanStyle(u.obj(p, 'style'))));
    if (u.has(p, 'text')) rec.set('text', u.text(p, 'text', '').slice(0, 500));
    if (u.has(p, 'note')) rec.set('note', u.text(p, 'note', '').slice(0, 1000));
    if (u.has(p, 'locked')) rec.set('locked', u.bool(p, 'locked', false));
    if (u.has(p, 'hidden')) rec.set('hidden', u.bool(p, 'hidden', false));
    app.save(rec);
    act.record(app, { who: u.actor(e), op: 'drawings.update', summary: 'Edited a ' + rec.getString('tool').replace('_', ' ') + ' on ' + rec.getString('symbol'), type: 'drawing', id: rec.id, symbol: rec.getString('symbol'), undo: [{ do: 'restore', c: 'drawings', id: rec.id, fields: before }], merge: true });
    return { drawing: d.serialize(rec) };
  }),
);

routerAdd('POST', '/api/ops/drawings/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const d = require(`${__hooks}/lib_drawings.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const ids = u.list(p, 'drawings', true) || [];
    if (u.has(p, 'drawing')) ids.push(u.str(p, 'drawing', ''));
    if (ids.length === 0) throw u.fail(400, 'drawing is required');
    const rows = ids.map((id) => d.mustGet(app, String(id)));
    const undo = rows.map((r) => ({ do: 'recreate', c: 'drawings', data: act.snapshot(r) }));
    for (const r of rows) app.delete(r);
    act.record(app, { who: u.actor(e), op: 'drawings.delete', summary: 'Deleted ' + (rows.length === 1 ? 'a ' + rows[0].getString('tool').replace('_', ' ') : rows.length + ' drawings') + ' on ' + rows[0].getString('symbol'), type: 'drawing', id: rows[0].id, symbol: rows[0].getString('symbol'), undo: undo });
    return { deleted: rows.length };
  }),
);

routerAdd('POST', '/api/ops/drawings/clear', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const sym = m.normalize(u.req(p, 'symbol'));
    const by = u.oneOf(p, 'added_by', ['user', 'agent'], '');
    const rows = app.findRecordsByFilter('drawings', 'symbol = {:s}' + (by ? ' && added_by = {:b}' : ''), '', 0, 0, { s: sym, b: by });
    if (rows.length === 0) return { deleted: 0 };
    const undo = rows.map((r) => ({ do: 'recreate', c: 'drawings', data: act.snapshot(r) }));
    for (const r of rows) app.delete(r);
    act.record(app, { who: u.actor(e), op: 'drawings.clear', summary: 'Cleared ' + rows.length + (by === 'agent' ? ' AI agent' : '') + ' drawings on ' + sym, type: 'drawing', symbol: sym, undo: undo });
    return { deleted: rows.length };
  }),
);

/** Keep the AI agent's markup as the person's own drawings. */
routerAdd('POST', '/api/ops/drawings/adopt', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const parts = ["added_by = 'agent'"];
    const prm = {};
    if (u.has(p, 'drawing')) {
      parts.push('id = {:id}');
      prm.id = u.str(p, 'drawing', '');
    }
    if (u.has(p, 'symbol')) {
      parts.push('symbol = {:s}');
      prm.s = m.normalize(u.str(p, 'symbol', ''));
    }
    if (u.has(p, 'run')) {
      parts.push('run = {:r}');
      prm.r = u.str(p, 'run', '');
    }
    if (parts.length === 1) throw u.fail(400, 'Say which markup to keep: drawing, symbol and/or run');
    const rows = app.findRecordsByFilter('drawings', parts.join(' && '), '', 0, 0, prm);
    const undo = rows.map((r) => ({ do: 'restore', c: 'drawings', id: r.id, fields: { added_by: 'agent', style: u.json(r, 'style', {}) } }));
    for (const r of rows) {
      const st = Object.assign({}, u.json(r, 'style', {}) || {});
      if (st.color === 'accent') st.color = 'ink';
      r.set('added_by', 'user');
      r.set('style', st);
      app.save(r);
    }
    if (rows.length > 0) act.record(app, { who: u.actor(e), op: 'drawings.adopt', summary: 'Kept ' + rows.length + ' AI agent drawing' + (rows.length === 1 ? '' : 's') + ' as your own', type: 'drawing', symbol: rows[0].getString('symbol'), undo: undo });
    return { adopted: rows.length };
  }),
);
