/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: the guide, what is on screen, the dashboard, setup, settings
 * and the AI agent's policy, the activity log (undo, redo, revert a run),
 * questions and jobs for the AI agent, exchange rates and search.
 */

routerAdd('POST', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));

routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).context(app)));

routerAdd('GET', '/api/ops/app/summary', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_reports.js`).summary(app)));

routerAdd('GET', '/api/ops/app/dashboard', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_reports.js`).dashboard(app, p)));

// What the person is looking at (the UI reports it; kept in memory, not logged).
routerAdd('POST', '/api/ops/app/ui', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ui = {};
    ui.view = u.str(p, 'view', '').slice(0, 30);
    ui.selection = u.has(p, 'selection') ? u.obj(p, 'selection') || null : null;
    ui.filters = u.has(p, 'filters') ? u.obj(p, 'filters') || {} : {};
    ui.at = Date.now();
    app.store().set('cr_ui', JSON.stringify(ui));
    return { ok: true };
  }),
);

routerAdd('GET', '/api/ops/search/all', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_query.js`).search(app, u.req(p, 'q'), u.int(p, 'limit', 6, 1, 50));
  }),
);

/* ------------------------------------------------------------------- setup */

routerAdd('GET', '/api/ops/setup/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const setup = require(`${__hooks}/lib_setup.js`);
    return {
      settings: setup.serialize(setup.row(app)),
      currencies: require(`${__hooks}/lib_money.js`).list(),
      templates: Object.keys(setup.PIPELINES).map((k) => ({ kind: k, name: setup.PIPELINES[k].name, stages: setup.PIPELINES[k].stages.map((s) => s[0]) })),
    };
  }),
);

routerAdd('POST', '/api/ops/setup/apply', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const who = u.actor(e);
    const currency = u.str(p, 'home_currency', 'USD').toUpperCase();
    if (!money.known(currency)) throw u.fail(400, 'Unknown currency ' + currency);
    const kinds = (u.list(p, 'pipelines', true) || ['sales']).map((k) => String(k).trim().toLowerCase()).filter((k) => k !== '');
    for (const k of kinds) if (!setup.PIPELINES[k]) throw u.fail(400, 'pipelines are from: ' + Object.keys(setup.PIPELINES).join(', '));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'setup.apply', (t) => {
      const s = setup.row(t);
      s.set('workspace', u.squash(u.str(p, 'workspace', '')).slice(0, 120));
      s.set('owner_name', u.squash(u.str(p, 'owner_name', '')).slice(0, 80));
      s.set('home_currency', currency);
      s.set('keep_in_touch_default', u.int(p, 'keep_in_touch_default', 0, 0, 3650));
      s.set('setup_done', true);
      t.save(s);
      const existing = t.findRecordsByFilter('pipelines', 'id != ""', '', 0, 0);
      let pos = existing.length;
      for (const k of kinds) if (!existing.some((x) => x.getString('kind') === k)) setup.createPipeline(t, k, '', currency, pos++);
      return { summary: 'Set up the CRM' + (s.getString('workspace') ? ' for ' + s.getString('workspace') : ''), type: 'settings', id: s.id, undoable: false, result: { settings: setup.serialize(s) } };
    });
  }),
);

routerAdd('POST', '/api/ops/settings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    return act.run(app, who, 'settings.update', (t) => {
      const s = setup.row(t);
      const before = setup.serialize(s);
      if (u.has(p, 'workspace')) s.set('workspace', u.squash(u.str(p, 'workspace', '')).slice(0, 120));
      if (u.has(p, 'owner_name')) s.set('owner_name', u.squash(u.str(p, 'owner_name', '')).slice(0, 80));
      if (u.has(p, 'keep_in_touch_default')) s.set('keep_in_touch_default', u.int(p, 'keep_in_touch_default', 0, 0, 3650));
      if (u.has(p, 'home_currency')) {
        const c = u.str(p, 'home_currency', '').toUpperCase();
        if (c !== s.getString('home_currency')) {
          if (!require(`${__hooks}/lib_money.js`).known(c)) throw u.fail(400, 'Unknown currency ' + c);
          if (t.findRecordsByFilter('deals', "status != 'open' && deleted = ''", '', 1, 0).length > 0) throw u.fail(409, 'Won and lost deals keep their value in ' + s.getString('home_currency') + '; the home currency cannot change now');
          s.set('home_currency', c);
        }
      }
      t.save(s);
      const after = setup.serialize(s);
      const changes = act.diff(before, after).filter((c) => c.field !== 'policy' && c.field !== 'policy_kinds');
      return { summary: 'Changed settings: ' + (changes.map((c) => c.field.replace(/_/g, ' ')).join(', ') || 'nothing'), type: 'settings', id: s.id, changes: changes, merge: true, result: { settings: after } };
    });
  }),
);

routerAdd('POST', '/api/ops/policy/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person changes what you are allowed to do');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'policy.update', (t) => {
      const s = setup.row(t);
      const pol = setup.policy(s);
      const auto = u.has(p, 'autonomy') ? u.obj(p, 'autonomy') || {} : {};
      for (const k of Object.keys(setup.POLICY_KINDS)) {
        if (u.has(p, k)) auto[k] = u.oneOf(p, k, ['auto', 'propose'], 'propose');
        if (auto[k] !== undefined) {
          if (auto[k] !== 'auto' && auto[k] !== 'propose') throw u.fail(400, k + ' is auto or propose');
          pol.autonomy[k] = auto[k];
        }
      }
      for (const k of ['auto_research', 'meeting_review', 'daily_brief']) if (u.has(p, k)) pol[k] = u.bool(p, k, false);
      if (u.has(p, 'brief_hour')) pol.brief_hour = u.int(p, 'brief_hour', 8, 0, 23);
      if (u.has(p, 'house_rules')) pol.house_rules = u.text(p, 'house_rules', '').slice(0, 4000);
      s.set('policy', pol);
      t.save(s);
      return { summary: 'Changed what the AI agent may do', type: 'settings', id: s.id, merge: true, result: { policy: pol } };
    });
  }),
);

/* ---------------------------------------------------------------- activity */

routerAdd('GET', '/api/ops/activity/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return {
      activity: require(`${__hooks}/lib_activity.js`).list(app, {
        actor: u.oneOf(p, 'actor', ['user', 'agent', 'import', 'system'], ''),
        run: u.str(p, 'run', ''),
        target: u.str(p, 'target', ''),
        limit: u.int(p, 'limit', 100, 1, 500),
        offset: u.int(p, 'offset', 0, 0, 1000000),
      }),
    };
  }),
);

routerAdd('POST', '/api/ops/activity/undo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    let rec = null;
    if (u.has(p, 'entry')) rec = act.mustGet(app, u.str(p, 'entry', ''));
    else {
      rec = act.latest(app, who.actor === 'agent' ? 'agent' : 'user', false);
      if (!rec) throw u.fail(404, 'Nothing to undo');
    }
    if (who.actor === 'agent' && rec.getString('actor') !== 'agent') throw u.fail(403, 'You can undo your own changes; the person undoes theirs');
    return { entry: act.undo(app, rec, who) };
  }),
);

routerAdd('POST', '/api/ops/activity/redo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    let rec = null;
    if (u.has(p, 'entry')) rec = act.mustGet(app, u.str(p, 'entry', ''));
    else {
      rec = act.latest(app, who.actor === 'agent' ? 'agent' : 'user', true);
      if (!rec) throw u.fail(404, 'Nothing to redo');
    }
    return { entry: act.redo(app, rec, who) };
  }),
);

routerAdd('GET', '/api/ops/activity/runs', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { runs: require(`${__hooks}/lib_activity.js`).runs(app, u.int(p, 'limit', 20, 1, 100)) };
  }),
);

routerAdd('POST', '/api/ops/activity/revert_run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_activity.js`).revertRun(app, u.req(p, 'run'), u.actor(e));
  }),
);

/* -------------------------------------------------------------------- asks */

routerAdd('POST', '/api/ops/asks/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const kind = u.oneOf(p, 'kind', ['question', 'job', 'explain', 'brief'], 'question');
    const q = u.text(p, 'question', '');
    if (q === '' && kind !== 'brief') throw u.fail(400, 'question is required');
    const ctx = u.obj(p, 'context') || require(`${__hooks}/lib_guide.js`).context(app);
    let rec = null;
    app.runInTransaction((tx) => {
      rec = require(`${__hooks}/lib_agent.js`).ask(tx, kind, q || 'Prepare my day: what matters today, what to follow up, what is slipping.', ctx);
    });
    const fired = agent.nudge(app, 'asks');
    return { ask: agent.serializeAsk(rec), asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
  }),
);

routerAdd('GET', '/api/ops/asks/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const st = u.oneOf(p, 'status', ['waiting', 'working', 'done', 'failed'], '');
    const rows = app.findRecordsByFilter('asks', st ? 'status = {:s}' : 'id != ""', '-created', u.int(p, 'limit', 50, 1, 200), 0, { s: st });
    return { asks: rows.map((r) => require(`${__hooks}/lib_agent.js`).serializeAsk(r)) };
  }),
);

routerAdd('GET', '/api/ops/asks/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    return { ask: agent.serializeAsk(agent.mustAsk(app, u.req(p, 'ask'))) };
  }),
);

routerAdd('POST', '/api/ops/asks/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const rec = agent.mustAsk(app, u.req(p, 'ask'));
    agent.start(app, 'asks', rec);
    rec.set('run', u.actor(e).run);
    app.save(rec);
    return { ask: agent.serializeAsk(rec) };
  }),
);

routerAdd('POST', '/api/ops/asks/answer', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const rec = agent.mustAsk(app, u.req(p, 'ask'));
    if (rec.getString('status') === 'done') throw u.fail(409, 'Already answered');
    const answer = u.text(p, 'answer', '');
    if (answer === '') throw u.fail(400, 'answer is required');
    const links = u.list(p, 'links') || [];
    rec.set('answer', answer.slice(0, 20000));
    rec.set('links', links.slice(0, 40).map((l) => ({ type: String((l && l.type) || ''), id: String((l && l.id) || ''), label: String((l && l.label) || '').slice(0, 120) })));
    rec.set('status', 'done');
    rec.set('error', '');
    app.save(rec);
    return { ask: agent.serializeAsk(rec) };
  }),
);

routerAdd('POST', '/api/ops/asks/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const rec = agent.mustAsk(app, u.req(p, 'ask'));
    rec.set('status', 'failed');
    rec.set('error', u.text(p, 'reason', 'Could not answer').slice(0, 1000));
    app.save(rec);
    return { ask: agent.serializeAsk(rec) };
  }),
);

routerAdd('POST', '/api/ops/asks/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rec = require(`${__hooks}/lib_agent.js`).mustAsk(app, u.req(p, 'ask'));
    app.delete(rec);
    return { deleted: true };
  }),
);

/* --------------------------------------------------------------- currencies */

routerAdd('GET', '/api/ops/fx/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const fx = require(`${__hooks}/lib_fx.js`);
    return { home: fx.home(app), in_use: fx.inUse(app), rates: fx.list(app, u.str(p, 'currency', ''), u.int(p, 'limit', 200, 1, 2000)) };
  }),
);

routerAdd('POST', '/api/ops/fx/set', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const fx = require(`${__hooks}/lib_fx.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.set', (t) => {
      const r = fx.set(t, u.req(p, 'currency'), u.str(p, 'date', ''), u.req(p, 'rate'), 'manual');
      return { summary: '1 ' + r.getString('currency') + ' = ' + r.getString('rate') + ' ' + fx.home(t) + ' on ' + r.getString('date'), type: 'fx_rates', id: r.id, result: { rate: fx.serialize(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/fx/fetch', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const fx = require(`${__hooks}/lib_fx.js`);
    const who = u.actor(e);
    const want = u.list(p, 'currencies', true) || [];
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.fetch', (t) => {
      const r = fx.fetchEcb(t, want);
      return { summary: r.stored > 0 ? 'Fetched ' + r.stored + ' exchange rate' + (r.stored === 1 ? '' : 's') + ' from the European Central Bank' : '', type: 'fx_rates', result: r };
    });
  }),
);

routerAdd('POST', '/api/ops/fx/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const rec = u.byId(app, 'fx_rates', u.req(p, 'rate'));
    if (!rec) throw u.fail(404, 'No rate ' + u.str(p, 'rate', ''));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.delete', (t) => {
      const r = t.findRecordById('fx_rates', rec.id);
      t.delete(r);
      return { summary: 'Removed the ' + r.getString('currency') + ' rate of ' + r.getString('date'), type: 'fx_rates', id: r.id, result: { deleted: true } };
    });
  }),
);
