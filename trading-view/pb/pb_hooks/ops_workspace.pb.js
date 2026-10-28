/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: workspaces (tabs), their widgets and link channels, and chart
 * widget settings. Changes are logged with their undo (lib_activity).
 */

/* -------------------------------------------------------------- workspaces */

routerAdd('GET', '/api/ops/workspaces/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ws = require(`${__hooks}/lib_workspace.js`);
    ws.ensureSeed(app);
    const counts = {};
    for (const w of app.findRecordsByFilter('widgets', 'id != ""', '', 0, 0)) counts[w.getString('workspace')] = (counts[w.getString('workspace')] || 0) + 1;
    const rows = app.findRecordsByFilter('workspaces', 'id != ""', 'sort,created', 0, 0);
    const settings = ws.serializeSettings(ws.settingsRow(app));
    let active = settings.active_workspace;
    if (!rows.some((r) => r.id === active)) active = rows.length > 0 ? rows[0].id : '';
    return {
      active: active,
      workspaces: rows.map((r) => Object.assign(ws.serializeWorkspace(r, null), { widgets: counts[r.id] || 0 })),
      settings: settings,
    };
  }),
);

routerAdd('GET', '/api/ops/workspaces/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    ws.ensureSeed(app);
    const rec = ws.mustWorkspace(app, u.str(p, 'workspace', ''));
    const widgets = ws.widgetsOf(app, rec.id);
    const out = ws.serializeWorkspace(rec, widgets);
    out.widgets = out.widgets.map((w, i) => Object.assign(w, { shows: ws.resolve(app, widgets[i], rec) }));
    return { workspace: out };
  }),
);

routerAdd('POST', '/api/ops/workspaces/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    ws.ensureSeed(app);
    const template = u.oneOf(p, 'template', Object.keys(ws.TEMPLATES), 'blank');
    const name = u.squash(u.str(p, 'name', '')).slice(0, 80) || ws.TEMPLATES[template].name;
    let sort = 0;
    for (const r of app.findRecordsByFilter('workspaces', 'id != ""', '', 0, 0)) sort = Math.max(sort, r.getInt('sort') + 1);
    let rec = null;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_workspace.js`);
      rec = lib.fromTemplate(tx, template, name, sort, lib.listIds(tx));
      if (u.bool(p, 'activate', true)) {
        const s = lib.settingsRow(tx);
        s.set('active_workspace', rec.id);
        tx.save(s);
      }
    });
    act.record(app, { who: who, op: 'workspaces.create', summary: 'Created the workspace "' + name + '"', type: 'workspace', id: rec.id, undo: [{ do: 'delete', c: 'workspaces', id: rec.id }] });
    const widgets = ws.widgetsOf(app, rec.id);
    return { workspace: ws.serializeWorkspace(rec, widgets) };
  }),
);

routerAdd('POST', '/api/ops/workspaces/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ws.mustWorkspace(app, u.req(p, 'workspace'));
    const before = act.pick(rec, ['name', 'locked']);
    if (u.has(p, 'name')) {
      const name = u.squash(u.str(p, 'name', '')).slice(0, 80);
      if (name === '') throw u.fail(400, 'name cannot be empty');
      rec.set('name', name);
    }
    if (u.has(p, 'locked')) rec.set('locked', u.bool(p, 'locked', false));
    app.save(rec);
    act.record(app, { who: u.actor(e), op: 'workspaces.update', summary: 'Edited the workspace "' + rec.getString('name') + '"', type: 'workspace', id: rec.id, undo: [{ do: 'restore', c: 'workspaces', id: rec.id, fields: before }], merge: true });
    return { workspace: ws.serializeWorkspace(rec, null) };
  }),
);

routerAdd('POST', '/api/ops/workspaces/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ws.mustWorkspace(app, u.req(p, 'workspace'));
    const all = app.findRecordsByFilter('workspaces', 'id != ""', 'sort,created', 0, 0);
    if (all.length <= 1) throw u.fail(409, 'Keep at least one workspace');
    const undo = [{ do: 'recreate', c: 'workspaces', data: act.snapshot(rec) }];
    for (const w of ws.widgetsOf(app, rec.id)) undo.push({ do: 'recreate', c: 'widgets', data: act.snapshot(w) });
    const name = rec.getString('name');
    app.delete(rec);
    const s = ws.settingsRow(app);
    if (s.getString('active_workspace') === rec.id) {
      const next = all.find((r) => r.id !== rec.id);
      s.set('active_workspace', next ? next.id : '');
      app.save(s);
    }
    act.record(app, { who: u.actor(e), op: 'workspaces.delete', summary: 'Deleted the workspace "' + name + '"', type: 'workspace', id: rec.id, undo: undo });
    return { deleted: true, active: s.getString('active_workspace') };
  }),
);

routerAdd('POST', '/api/ops/workspaces/duplicate', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const src = ws.mustWorkspace(app, u.req(p, 'workspace'));
    const name = u.squash(u.str(p, 'name', '')).slice(0, 80) || (src.getString('name') + ' copy').slice(0, 80);
    let sort = 0;
    for (const r of app.findRecordsByFilter('workspaces', 'id != ""', '', 0, 0)) sort = Math.max(sort, r.getInt('sort') + 1);
    let rec = null;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_workspace.js`);
      const util = require(`${__hooks}/lib_util.js`);
      rec = new Record(tx.findCollectionByNameOrId('workspaces'));
      rec.set('name', name);
      rec.set('sort', sort);
      rec.set('links', util.json(src, 'links', {}));
      rec.set('locked', false);
      tx.save(rec);
      for (const w of lib.widgetsOf(tx, src.id)) {
        const c = new Record(tx.findCollectionByNameOrId('widgets'));
        for (const k of ['type', 'link', 'x', 'y', 'w', 'h']) c.set(k, w.get(k));
        c.set('config', util.json(w, 'config', {}));
        c.set('workspace', rec.id);
        tx.save(c);
      }
      const s = lib.settingsRow(tx);
      s.set('active_workspace', rec.id);
      tx.save(s);
    });
    act.record(app, { who: u.actor(e), op: 'workspaces.duplicate', summary: 'Duplicated "' + src.getString('name') + '" as "' + name + '"', type: 'workspace', id: rec.id, undo: [{ do: 'delete', c: 'workspaces', id: rec.id }] });
    return { workspace: ws.serializeWorkspace(rec, ws.widgetsOf(app, rec.id)) };
  }),
);

routerAdd('POST', '/api/ops/workspaces/activate', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const rec = ws.mustWorkspace(app, u.req(p, 'workspace'));
    const s = ws.settingsRow(app);
    s.set('active_workspace', rec.id);
    app.save(s);
    return { active: rec.id, name: rec.getString('name') };
  }),
);

routerAdd('POST', '/api/ops/workspaces/reorder', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const order = u.list(p, 'order', true);
    if (!order || order.length === 0) throw u.fail(400, 'order is required: the workspace ids in their new order');
    const undo = [];
    app.runInTransaction((tx) => {
      for (let i = 0; i < order.length; i++) {
        const r = tx.findRecordById('workspaces', String(order[i]));
        if (r.getInt('sort') === i) continue;
        undo.push({ do: 'restore', c: 'workspaces', id: r.id, fields: { sort: r.getInt('sort') } });
        r.set('sort', i);
        tx.save(r);
      }
    });
    if (undo.length > 0) act.record(app, { who: u.actor(e), op: 'workspaces.reorder', summary: 'Reordered the workspaces', type: 'workspace', undo: undo });
    return { ok: true };
  }),
);

/** Show a symbol (and optionally an interval) on a link channel: every widget on it follows. */
routerAdd('POST', '/api/ops/workspaces/focus', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ws.mustWorkspace(app, u.str(p, 'workspace', ''));
    const channel = u.oneOf(p, 'channel', ws.CHANNELS, '1');
    const symRaw = u.str(p, 'symbol', '');
    const ivRaw = u.str(p, 'interval', '');
    if (symRaw === '' && ivRaw === '') throw u.fail(400, 'Give a symbol, an interval or both');
    const links = u.json(rec, 'links', {}) || {};
    const before = { links: JSON.parse(JSON.stringify(links)) };
    const ch = Object.assign({ symbol: 'AAPL', interval: '1D' }, links[channel] || {});
    if (symRaw !== '') ch.symbol = m.meta(app, symRaw).symbol;
    if (ivRaw !== '') ch.interval = m.interval(ivRaw);
    links[channel] = ch;
    rec.set('links', links);
    app.save(rec);
    act.record(app, {
      who: u.actor(e),
      op: 'workspaces.focus',
      summary: 'Showed ' + ch.symbol + ' (' + ch.interval + ') on link ' + channel + ' of "' + rec.getString('name') + '"',
      type: 'workspace',
      id: rec.id + ':' + channel,
      symbol: ch.symbol,
      undo: [{ do: 'restore', c: 'workspaces', id: rec.id, fields: before }],
      merge: true,
    });
    return { workspace: rec.id, channel: channel, symbol: ch.symbol, interval: ch.interval };
  }),
);

/* ----------------------------------------------------------------- widgets */

routerAdd('POST', '/api/ops/widgets/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ws.mustWorkspace(app, u.str(p, 'workspace', ''));
    const type = u.oneOf(p, 'type', ws.TYPES, '');
    if (type === '') throw u.fail(400, 'type is required: one of ' + ws.TYPES.join(', '));
    const symbolic = ['chart', 'chartgrid', 'details', 'news', 'analyst', 'watchlist', 'screener', 'heatmap'].indexOf(type) >= 0;
    const link = u.has(p, 'link') ? u.str(p, 'link', '') : symbolic ? '1' : '';
    if (link !== '' && ws.CHANNELS.indexOf(link) < 0) throw u.fail(400, 'link must be empty (own symbol) or a channel 1 to 6');
    const config = Object.assign({}, ws.WIDGETS[type].config, u.obj(p, 'config') || {});
    if (u.has(p, 'symbol')) config.symbol = u.str(p, 'symbol', '');
    if (u.has(p, 'interval')) config.interval = u.str(p, 'interval', '');
    if (type === 'chart' || type === 'chartgrid') Object.assign(config, ws.chartPatch(app, config));
    else if (config.symbol) config.symbol = require(`${__hooks}/lib_market.js`).normalize(config.symbol);
    if (type === 'watchlist' && config.list) config.list = require(`${__hooks}/lib_watch.js`).mustList(app, String(config.list)).id;
    const def = ws.WIDGETS[type];
    const b = ws.box(type, u.num(p, 'x', 0, 0, 1000), u.has(p, 'y') ? u.num(p, 'y', 0, 0, 1000) : ws.bottom(app, rec.id), u.num(p, 'w', def.w, 1, 24), u.num(p, 'h', def.h, 1, 200));
    const w = new Record(app.findCollectionByNameOrId('widgets'));
    w.set('workspace', rec.id);
    w.set('type', type);
    w.set('link', link);
    w.set('x', b.x);
    w.set('y', b.y);
    w.set('w', b.w);
    w.set('h', b.h);
    w.set('config', config);
    app.save(w);
    act.record(app, { who: u.actor(e), op: 'widgets.add', summary: 'Added a ' + type + ' widget to "' + rec.getString('name') + '"', type: 'widget', id: w.id, undo: [{ do: 'delete', c: 'widgets', id: w.id }] });
    return { widget: Object.assign(ws.serializeWidget(w), { shows: ws.resolve(app, w, rec) }) };
  }),
);

routerAdd('POST', '/api/ops/widgets/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const w = ws.mustWidget(app, u.req(p, 'widget'));
    const before = act.pick(w, ['link', 'config']);
    const type = w.getString('type');
    if (u.has(p, 'link')) {
      const link = u.str(p, 'link', '');
      if (link !== '' && ws.CHANNELS.indexOf(link) < 0) throw u.fail(400, 'link must be empty (own symbol) or a channel 1 to 6');
      w.set('link', link);
    }
    const config = Object.assign({}, u.json(w, 'config', {}) || {});
    const patch = Object.assign({}, u.obj(p, 'config') || {});
    if (u.has(p, 'symbol')) patch.symbol = u.str(p, 'symbol', '');
    if (u.has(p, 'interval')) patch.interval = u.str(p, 'interval', '');
    if (type === 'chart' || type === 'chartgrid') Object.assign(patch, ws.chartPatch(app, patch));
    else if (patch.symbol) patch.symbol = require(`${__hooks}/lib_market.js`).normalize(patch.symbol);
    if (type === 'watchlist' && patch.list) patch.list = require(`${__hooks}/lib_watch.js`).mustList(app, String(patch.list)).id;
    Object.assign(config, patch);
    w.set('config', config);
    app.save(w);
    const keys = Object.keys(patch);
    act.record(app, {
      who: u.actor(e),
      op: 'widgets.update',
      summary: 'Changed the ' + type + ' widget' + (keys.length > 0 ? ' (' + keys.join(', ') + ')' : ''),
      type: 'widget',
      id: w.id,
      symbol: config.symbol || '',
      undo: [{ do: 'restore', c: 'widgets', id: w.id, fields: before }],
      merge: true,
    });
    return { widget: Object.assign(ws.serializeWidget(w), { shows: ws.resolve(app, w, null) }) };
  }),
);

routerAdd('POST', '/api/ops/widgets/layout', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ws.mustWorkspace(app, u.str(p, 'workspace', ''));
    const items = u.list(p, 'items', false);
    if (!items || items.length === 0) throw u.fail(400, 'items is required: [{"id":"<widget>","x":0,"y":0,"w":12,"h":10}, ...]');
    const undo = [];
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_workspace.js`);
      for (const it of items) {
        if (!it || !it.id) continue;
        let w = null;
        try {
          w = tx.findRecordById('widgets', String(it.id));
        } catch {
          w = null;
        }
        if (!w || w.getString('workspace') !== rec.id) continue;
        const b = lib.box(w.getString('type'), it.x, it.y, it.w, it.h);
        if (b.x === w.getInt('x') && b.y === w.getInt('y') && b.w === w.getInt('w') && b.h === w.getInt('h')) continue;
        undo.push({ do: 'restore', c: 'widgets', id: w.id, fields: { x: w.getInt('x'), y: w.getInt('y'), w: w.getInt('w'), h: w.getInt('h') } });
        w.set('x', b.x);
        w.set('y', b.y);
        w.set('w', b.w);
        w.set('h', b.h);
        tx.save(w);
      }
    });
    if (undo.length > 0) act.record(app, { who: u.actor(e), op: 'widgets.layout', summary: 'Rearranged "' + rec.getString('name') + '"', type: 'workspace', id: rec.id, undo: undo, merge: true });
    return { moved: undo.length };
  }),
);

routerAdd('POST', '/api/ops/widgets/remove', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const w = ws.mustWidget(app, u.req(p, 'widget'));
    const snap = act.snapshot(w);
    app.delete(w);
    act.record(app, { who: u.actor(e), op: 'widgets.remove', summary: 'Removed a ' + snap.type + ' widget', type: 'widget', id: w.id, undo: [{ do: 'recreate', c: 'widgets', data: snap }] });
    return { removed: true };
  }),
);

/* ------------------------------------------------------------------ charts */

/**
 * Change what a chart shows. On a linked chart a new symbol or interval
 * goes to its channel (every linked widget follows) unless own=true, which
 * gives the chart its own symbol.
 */
routerAdd('POST', '/api/ops/charts/set', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    const w = ws.chartWidget(app, u.str(p, 'widget', ''), u.str(p, 'workspace', ''));
    const wsRec = app.findRecordById('workspaces', w.getString('workspace'));
    const own = u.bool(p, 'own', false);
    const link = own ? '' : w.getString('link');
    const before = act.pick(w, ['link', 'config']);
    const beforeWs = { links: u.json(wsRec, 'links', {}) || {} };
    const config = Object.assign({}, u.json(w, 'config', {}) || {});
    const patch = {};
    for (const k of ['type', 'scale', 'layout']) if (u.has(p, k)) patch[k] = u.str(p, k, '');
    if (u.has(p, 'ext')) patch.ext = u.bool(p, 'ext', false);
    if (u.has(p, 'compare')) patch.compare = u.list(p, 'compare', true);
    const clean = ws.chartPatch(app, patch);
    let symbol = u.str(p, 'symbol', '');
    let interval = u.str(p, 'interval', '');
    if (symbol !== '') symbol = m.meta(app, symbol).symbol;
    if (interval !== '') interval = m.interval(interval);
    let channelChanged = false;
    if (link !== '' && (symbol !== '' || interval !== '')) {
      const links = u.json(wsRec, 'links', {}) || {};
      const ch = Object.assign({ symbol: 'AAPL', interval: '1D' }, links[link] || {});
      if (symbol !== '') ch.symbol = symbol;
      if (interval !== '' && !config.interval_own) ch.interval = interval;
      if (interval !== '' && config.interval_own) clean.interval = interval;
      links[link] = ch;
      wsRec.set('links', links);
      app.save(wsRec);
      channelChanged = true;
    } else {
      if (symbol !== '') clean.symbol = symbol;
      if (interval !== '') clean.interval = interval;
      if (own) {
        const shows = ws.resolve(app, w, wsRec);
        if (!clean.symbol) clean.symbol = shows.symbol;
        if (!clean.interval) clean.interval = shows.interval;
      }
    }
    Object.assign(config, clean);
    w.set('config', config);
    w.set('link', link);
    app.save(w);
    const shows = ws.resolve(app, w, wsRec);
    const undo = [{ do: 'restore', c: 'widgets', id: w.id, fields: before }];
    if (channelChanged) undo.push({ do: 'restore', c: 'workspaces', id: wsRec.id, fields: beforeWs });
    const what = [];
    if (symbol !== '') what.push(symbol);
    if (interval !== '') what.push(interval);
    for (const k of Object.keys(clean)) if (k !== 'symbol' && k !== 'interval') what.push(k + ' ' + JSON.stringify(clean[k]));
    act.record(app, { who: who, op: 'charts.set', summary: 'Set the chart to ' + what.join(', '), type: 'widget', id: w.id, symbol: shows.symbol, undo: undo, merge: true });
    return { widget: Object.assign(ws.serializeWidget(w), { shows: shows }) };
  }),
);

routerAdd('POST', '/api/ops/charts/add_indicator', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const ta = require(`${__hooks}/lib_ta.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const w = ws.chartWidget(app, u.str(p, 'widget', ''), u.str(p, 'workspace', ''));
    const id = u.req(p, 'indicator').toLowerCase();
    if (!ta.find(id)) throw u.fail(400, 'Unknown indicator "' + id + '"; one of: ' + ta.CATALOGUE.map((d) => d.id).join(', '));
    const before = act.pick(w, ['config']);
    const config = Object.assign({}, u.json(w, 'config', {}) || {});
    const list = (config.indicators || []).slice();
    if (list.length >= 16) throw u.fail(409, 'A chart holds at most 16 indicators');
    const item = { id: id, params: ta.params(id, u.obj(p, 'params') || {}), hidden: u.bool(p, 'hidden', false), color: u.str(p, 'color', '') };
    list.push(item);
    config.indicators = list;
    w.set('config', config);
    app.save(w);
    const shows = ws.resolve(app, w, null);
    act.record(app, { who: u.actor(e), op: 'charts.add_indicator', summary: 'Added ' + ta.label(id, item.params) + ' to the ' + shows.symbol + ' chart', type: 'widget', id: w.id, symbol: shows.symbol, undo: [{ do: 'restore', c: 'widgets', id: w.id, fields: before }] });
    return { widget: Object.assign(ws.serializeWidget(w), { shows: shows }), added: item };
  }),
);

routerAdd('POST', '/api/ops/charts/remove_indicator', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const ta = require(`${__hooks}/lib_ta.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const w = ws.chartWidget(app, u.str(p, 'widget', ''), u.str(p, 'workspace', ''));
    const before = act.pick(w, ['config']);
    const config = Object.assign({}, u.json(w, 'config', {}) || {});
    const list = (config.indicators || []).slice();
    let idx = u.int(p, 'index', -1, -1, 100);
    if (idx < 0) {
      const id = u.req(p, 'indicator').toLowerCase();
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].id === id) {
          idx = i;
          break;
        }
      }
      if (idx < 0) throw u.fail(404, 'This chart has no ' + id + ' indicator');
    }
    if (idx >= list.length) throw u.fail(404, 'This chart has ' + list.length + ' indicators; index ' + idx + ' does not exist');
    const removed = list.splice(idx, 1)[0];
    config.indicators = list;
    w.set('config', config);
    app.save(w);
    const shows = ws.resolve(app, w, null);
    act.record(app, { who: u.actor(e), op: 'charts.remove_indicator', summary: 'Removed ' + ta.label(removed.id, removed.params || {}) + ' from the ' + shows.symbol + ' chart', type: 'widget', id: w.id, symbol: shows.symbol, undo: [{ do: 'restore', c: 'widgets', id: w.id, fields: before }] });
    return { widget: Object.assign(ws.serializeWidget(w), { shows: shows }), removed: removed };
  }),
);
