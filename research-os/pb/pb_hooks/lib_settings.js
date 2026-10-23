/// <reference path="../pb_data/types.d.ts" />
/**
 * Settings (one row) and the Home summary.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

function out(app) {
  const s = core().settings(app);
  return {
    highlight_slots: core().slots(app),
    citation_style: s.getString('citation_style'),
    contact_email: s.getString('contact_email'),
    agent_policy: core().policy(app),
    welcome_done: s.getBool('welcome_done'),
  };
}

function get(ctx) {
  return { settings: out(ctx.app) };
}

/** settings.update: highlight meanings, citation style, contact email, your AI agent's limits (people only). */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = core().settings(app);
  if (util.has(p, 'highlight_slots')) {
    const list = util.list(p, 'highlight_slots') || [];
    const cur = core().slots(app);
    list.forEach((x, i) => {
      util.keysOnly(x, ['slot', 'meaning', 'hue'], 'Color ' + (i + 1));
      const slot = Number(x.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 8) throw util.fail(400, 'Color ' + (i + 1) + ': slot is 1 to 8.', 'invalid_param');
      const c = cur[slot - 1];
      if (typeof x.meaning === 'string') c.meaning = util.squash(x.meaning).slice(0, 60);
      if (typeof x.hue === 'string') {
        if (core().HUES.indexOf(x.hue) < 0) throw util.fail(400, 'Color ' + (i + 1) + ': hue is one of ' + core().HUES.join(', '), 'invalid_param');
        c.hue = x.hue;
      }
    });
    s.set('highlight_slots', cur);
  }
  if (util.has(p, 'citation_style')) s.set('citation_style', util.oneOf(p, 'citation_style', require(`${__hooks}/lib_cite.js`).STYLES, 'apa'));
  if (util.has(p, 'contact_email')) {
    const e = util.str(p, 'contact_email', '');
    if (e !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw util.fail(400, 'That is not an email address.', 'invalid_param');
    s.set('contact_email', e);
  }
  const pol = core().policy(app);
  if (util.has(p, 'node_cap')) pol.node_cap = util.int(p, 'node_cap', 300, 0, 100000);
  for (const k of ['auto_identify', 'auto_ocr', 'auto_oa']) if (util.has(p, k)) pol[k] = util.bool(p, k, true);
  s.set('agent_policy', pol);
  if (util.has(p, 'welcome_done')) s.set('welcome_done', util.bool(p, 'welcome_done', true));
  app.save(s);
  return { settings: out(app) };
}

/** app.status: the numbers the frame shows (counts on the rail, engine). */
function status(ctx) {
  const util = u();
  const app = ctx.app;
  const ny = require(`${__hooks}/lib_agent.js`).needsYou(ctx, { limit: 0 });
  return {
    needs_you: ny.total,
    needs: ny.counts,
    text_waiting: util.count(app, "SELECT COUNT(*) AS n FROM files WHERE text_state IN ('waiting', 'extracting')"),
    resolving: util.count(app, "SELECT COUNT(*) AS n FROM works WHERE resolution = 'resolving'"),
    projects: util.count(app, "SELECT COUNT(*) AS n FROM projects WHERE state = 'active'"),
    works: util.count(app, 'SELECT COUNT(*) AS n FROM works WHERE trashed = FALSE'),
    new_candidates: util.count(app, "SELECT COUNT(*) AS n FROM candidates WHERE triage = 'new'"),
    today: util.today(),
  };
}

/** home.summary: everything Home shows, in one call. */
function home(ctx) {
  const util = u();
  const app = ctx.app;
  const W = require(`${__hooks}/lib_works.js`);
  const P = require(`${__hooks}/lib_projects.js`);
  const hidden = core().hiddenSql(ctx, 'w');
  const continueIds = util.rows(app, "SELECT w.id AS id FROM works w WHERE w.trashed = FALSE AND w.opened_at != '' AND w.read_state != 'read' AND EXISTS (SELECT 1 FROM files f WHERE f.work = w.id AND f.current = TRUE)" + hidden + ' ORDER BY w.opened_at DESC LIMIT 10', { id: '' }).map((r) => r.id);
  const recentIds = util.rows(app, 'SELECT w.id AS id FROM works w WHERE w.trashed = FALSE' + hidden + ' ORDER BY w.created DESC LIMIT 8', { id: '' }).map((r) => r.id);
  const projects = app.findRecordsByFilter('projects', "state = 'active'" + (ctx.isAgent ? " && confidentiality = 'normal'" : ''), '-pinned,-opened_at,-updated', 6, 0).map((r) => P.out(app, r));
  // activity.project is plain text: activity.list keeps confidential projects from your AI agent.
  const recent = require(`${__hooks}/lib_activity.js`).list(ctx, { limit: 10 }).entries;
  const week = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ');
  const thisWeek = util.one(app, 'SELECT (SELECT COUNT(*) FROM works WHERE created >= {:w} AND trashed = FALSE) AS added, (SELECT COUNT(*) FROM annotations WHERE created >= {:w}) AS highlights, (SELECT COUNT(*) FROM nodes WHERE created >= {:w}) AS nodes, (SELECT COUNT(*) FROM works WHERE read_at >= {:w}) AS read', { added: 0, highlights: 0, nodes: 0, read: 0 }, { w: week.replace(' ', 'T') });
  const candidates = app.findRecordsByFilter('candidates', "triage = 'new' || triage = 'relevant'", '-relevance,-created', 6, 0).map((c) => require(`${__hooks}/lib_discover.js`).candidateOut(app, c));
  return {
    library: W.counts(ctx),
    continue_reading: W.rowsFor(app, continueIds),
    recently_added: W.rowsFor(app, recentIds),
    projects: projects,
    needs_you: require(`${__hooks}/lib_agent.js`).needsYou(ctx, { limit: 0 }),
    recent: recent,
    this_week: util.plain([thisWeek])[0],
    candidates: candidates,
    settings: out(app),
    today: util.today(),
  };
}

module.exports = { out: out, get: get, update: update, status: status, home: home };
