/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: the guide, setup and settings, the activity log, questions
 * for the AI agent and export. Every change runs in one transaction and is
 * logged with its undo (lib_activity.run).
 */

routerAdd('POST', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));

routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).context(app)));

routerAdd('GET', '/api/ops/app/summary', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_reports.js`).summary(app)));

routerAdd('GET', '/api/ops/app/dashboard', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_dashboard.js`).dashboard(app, { range: u.oneOf(p, 'range', ['this_month', 'last_month', 'this_quarter', 'ytd', 'last_12_months'], 'this_month') });
  }),
);

// What the person is looking at (the UI reports it; kept in memory, not logged).
routerAdd('POST', '/api/ops/app/ui', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ui = {};
    ui.view = u.str(p, 'view', '').slice(0, 30);
    ui.selection = u.has(p, 'selection') ? u.obj(p, 'selection') || null : null;
    ui.filters = u.has(p, 'filters') ? u.obj(p, 'filters') || {} : {};
    ui.at = Date.now();
    app.store().set('lf_ui', JSON.stringify(ui));
    return { ok: true };
  }),
);

/* ------------------------------------------------------------------- setup */

routerAdd('GET', '/api/ops/setup/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const setup = require(`${__hooks}/lib_setup.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const regions = Object.keys(setup.REGIONS).map((k) => ({ id: k, name: setup.REGIONS[k].name, codes: setup.REGIONS[k].codes.map((c) => ({ code: c[0], name: c[1], rate: c[2] })) }));
    return { settings: setup.serialize(setup.row(app)), regions: regions, currencies: money.list(), accounts: app.findRecordsByFilter('accounts', 'id != ""', '', 1, 0).length };
  }),
);

routerAdd('POST', '/api/ops/setup/apply', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const who = u.actor(e);
    const entity = u.oneOf(p, 'entity', ['business', 'personal', 'both'], 'both');
    const currency = u.str(p, 'home_currency', 'USD').toUpperCase();
    if (!money.known(currency)) throw u.fail(400, 'Unknown currency ' + currency);
    const region = u.oneOf(p, 'region', Object.keys(setup.REGIONS), 'none');
    const fy = u.int(p, 'fiscal_year_start', 1, 1, 12);
    const name = u.squash(u.str(p, 'business_name', '')).slice(0, 120);
    const has = app.findRecordsByFilter('transactions', 'id != ""', '', 1, 0).length > 0;
    const before = setup.row(app);
    if (has && before.getString('home_currency') !== currency) throw u.fail(409, 'The books already have entries in ' + before.getString('home_currency') + '; the home currency cannot change now');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'setup.apply', (t) => {
      const s = setup.row(t);
      s.set('business_name', name);
      s.set('entity', entity);
      s.set('home_currency', currency);
      s.set('region', region);
      s.set('fiscal_year_start', fy);
      s.set('setup_done', true);
      t.save(s);
      setup.seed(t, entity, currency, region);
      return { summary: 'Set up the books' + (name ? ' for ' + name : '') + ' (' + entity + ', ' + currency + ', ' + setup.REGIONS[region].name + ')', type: 'settings', id: s.id, undoable: false, result: { settings: setup.serialize(s) } };
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
      const texts = { business_name: 120, invoice_prefix: 12, credit_prefix: 12, business_address: 500, business_email: 200, business_tax_id: 60, invoice_footer: 1000 };
      for (const k of Object.keys(texts)) if (u.has(p, k)) s.set(k, u.text(p, k, '').slice(0, texts[k]));
      if (u.has(p, 'entity')) s.set('entity', u.oneOf(p, 'entity', ['business', 'personal', 'both'], 'both'));
      if (u.has(p, 'fiscal_year_start')) s.set('fiscal_year_start', u.int(p, 'fiscal_year_start', 1, 1, 12));
      if (u.has(p, 'rounding')) s.set('rounding', u.oneOf(p, 'rounding', ['line', 'document'], 'line'));
      if (u.has(p, 'invoice_next')) s.set('invoice_next', u.int(p, 'invoice_next', 1, 1, 100000000));
      if (u.has(p, 'credit_next')) s.set('credit_next', u.int(p, 'credit_next', 1, 1, 100000000));
      if (u.has(p, 'payment_terms')) s.set('payment_terms', u.int(p, 'payment_terms', 14, 0, 365));
      if (u.has(p, 'agent_categorize')) s.set('agent_categorize', u.bool(p, 'agent_categorize', true));
      if (u.has(p, 'region')) {
        const region = u.oneOf(p, 'region', Object.keys(setup.REGIONS), 'none');
        s.set('region', region);
        setup.seed(t, s.getString('entity') || 'both', s.getString('home_currency') || 'USD', region);
      }
      if (u.has(p, 'home_currency')) {
        const c = u.str(p, 'home_currency', '').toUpperCase();
        if (c !== s.getString('home_currency')) {
          if (t.findRecordsByFilter('transactions', 'id != ""', '', 1, 0).length > 0) throw u.fail(409, 'The home currency cannot change once the books have entries');
          if (!require(`${__hooks}/lib_money.js`).known(c)) throw u.fail(400, 'Unknown currency ' + c);
          s.set('home_currency', c);
        }
      }
      t.save(s);
      const after = setup.serialize(s);
      const changes = act.diff(before, after).filter((c) => c.field !== 'policy' && c.field !== 'ui');
      return { summary: 'Changed settings: ' + (changes.map((c) => c.field.replace(/_/g, ' ')).join(', ') || 'nothing'), type: 'settings', id: s.id, changes: changes, merge: true, result: { settings: after } };
    });
  }),
);

routerAdd('POST', '/api/ops/policy/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person changes what you are allowed to do');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'policy.update', (t) => {
      const s = setup.row(t);
      const pol = setup.policy(s);
      if (u.has(p, 'agent_auto_post')) pol.agent_auto_post = u.bool(p, 'agent_auto_post', false);
      if (u.has(p, 'ceiling')) {
        const c = u.str(p, 'ceiling', '');
        if (c !== '') money.parse(c, s.getString('home_currency') || 'USD', 'ceiling');
        pol.ceiling = c;
      }
      if (u.has(p, 'auto_methods')) {
        const m = (u.list(p, 'auto_methods', true) || []).map((x) => String(x).trim()).filter((x) => x !== '');
        for (const x of m) if (['match', 'transfer', 'document', 'memory'].indexOf(x) < 0) throw u.fail(400, 'auto_methods are from: match, transfer, document, memory');
        pol.auto_methods = m;
      }
      if (u.has(p, 'house_rules')) pol.house_rules = u.text(p, 'house_rules', '').slice(0, 4000);
      s.set('policy', pol);
      t.save(s);
      return { summary: 'Changed what the AI agent may do', type: 'settings', id: s.id, merge: true, result: { policy: pol } };
    });
  }),
);

routerAdd('POST', '/api/ops/locks/set', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person moves lock dates');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'locks.set', (t) => {
      const s = setup.row(t);
      const parts = [];
      for (const k of ['lock_date', 'agent_lock_date', 'tax_lock_date']) {
        if (!u.has(p, k)) continue;
        const v = u.str(p, k, '');
        s.set(k, v === '' ? '' : dates.parse(v, k));
        parts.push(k.replace(/_/g, ' ') + ' ' + (v === '' ? 'cleared' : s.getString(k)));
      }
      t.save(s);
      return { summary: 'Lock dates: ' + (parts.join(', ') || 'unchanged'), type: 'settings', id: s.id, result: { settings: setup.serialize(s) } };
    });
  }),
);

/* ---------------------------------------------------------------- activity */

routerAdd('GET', '/api/ops/activity/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return {
      activity: require(`${__hooks}/lib_activity.js`).list(app, {
        actor: u.oneOf(p, 'actor', ['user', 'agent', 'rule', 'import', 'recurring', 'system'], ''),
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
    const kind = u.oneOf(p, 'kind', ['question', 'explain', 'review'], 'question');
    const q = u.text(p, 'question', '');
    if (q === '' && kind === 'question') throw u.fail(400, 'question is required');
    const ctx = u.obj(p, 'context') || require(`${__hooks}/lib_guide.js`).context(app);
    let rec = null;
    app.runInTransaction((tx) => {
      rec = require(`${__hooks}/lib_agent.js`).ask(tx, kind, q, ctx);
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

/* ------------------------------------------------------------------ export */

routerAdd('GET', '/api/ops/export/books', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const from = u.str(p, 'from', '');
    const to = u.str(p, 'to', '');
    return require(`${__hooks}/lib_export.js`).exportBooks(app, u.oneOf(p, 'format', ['beancount', 'hledger', 'csv'], 'beancount'), from ? dates.parse(from, 'from') : '', to ? dates.parse(to, 'to') : '');
  }),
);
