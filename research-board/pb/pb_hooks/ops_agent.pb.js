/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: work for the AI agent. Summaries of cards (digests) and
 * reviews of boards; see lib_agent.js for the life cycle. The person asks
 * (request, cancel, clear); the AI agent lists, starts, completes or fails.
 */

/* ---------------------------------------------------------------- digests */

routerAdd('POST', '/api/ops/digests/request', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const rec = cards.mustGet(app, u.req(p, 'card'));
    if (rec.getString('kind') === 'section') throw u.fail(400, 'A section has nothing to summarize');
    const r = require(`${__hooks}/lib_agent.js`).request(app, 'digest', rec);
    return { card: cards.serialize(app, cards.mustGet(app, rec.id), null), asked_agent: r.asked, request: r.request };
  }),
);

routerAdd('POST', '/api/ops/digests/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const rec = cards.mustGet(app, u.req(p, 'card'));
    require(`${__hooks}/lib_agent.js`).cancel(app, 'digest', rec);
    return { card: cards.serialize(app, rec, null) };
  }),
);

routerAdd('POST', '/api/ops/digests/clear', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const rec = cards.mustGet(app, u.req(p, 'card'));
    rec.set('digest', '');
    rec.set('digest_state', '');
    rec.set('digest_error', '');
    app.save(rec);
    return { card: cards.serialize(app, rec, null) };
  }),
);

routerAdd('GET', '/api/ops/digests/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const state = u.oneOf(p, 'state', ['waiting', 'reading', 'failed', 'done'], 'waiting');
    const rows = app.findRecordsByFilter('cards', 'digest_state = {:s} && ' + cards.LIVE, 'digest_at', 200, 0, { s: state });
    const names = {};
    for (const b of app.findRecordsByFilter('boards', '', '', 0, 0)) names[b.id] = b.getString('name');
    return {
      count: rows.length,
      cards: rows.map((r) => {
        const c = cards.serialize(app, r, { paths: true });
        c.board_name = names[c.board] || '';
        return c;
      }),
    };
  }),
);

routerAdd('POST', '/api/ops/digests/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const rec = cards.mustGet(app, u.req(p, 'card'));
    require(`${__hooks}/lib_agent.js`).start(app, 'digest', rec);
    return { card: cards.serialize(app, rec, { paths: true }) };
  }),
);

routerAdd('POST', '/api/ops/digests/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const rec = cards.mustGet(app, u.req(p, 'card'));
    const summary = u.text(p, 'summary', '');
    if (summary === '') throw u.fail(400, 'summary is required: 3 to 6 sentences about the card');
    rec.set('digest', summary.slice(0, 20000));
    rec.set('digest_state', 'done');
    rec.set('digest_error', '');
    rec.set('digest_at', new Date().toISOString());
    // A card added with a placeholder title may get a better one.
    if (u.has(p, 'title')) {
      const t = u.squash(u.str(p, 'title', '')).slice(0, 500);
      if (t !== '') rec.set('title', t);
    }
    if (u.has(p, 'tags')) {
      const now = cards.jsonField(rec, 'tags', []);
      const lower = now.map((t) => String(t).toLowerCase());
      for (const t of cards.cleanTags(u.list(p, 'tags', true))) if (lower.indexOf(t.toLowerCase()) < 0) now.push(t);
      rec.set('tags', now.slice(0, 20));
    }
    app.save(rec);
    return { card: cards.serialize(app, rec, null), message: 'Summary saved on "' + rec.getString('title') + '"' };
  }),
);

routerAdd('POST', '/api/ops/digests/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const cards = require(`${__hooks}/lib_cards.js`);
    const rec = cards.mustGet(app, u.req(p, 'card'));
    const reason = u.squash(u.req(p, 'reason')).slice(0, 1000);
    rec.set('digest_state', 'failed');
    rec.set('digest_error', reason);
    rec.set('digest_at', new Date().toISOString());
    app.save(rec);
    return { card: cards.serialize(app, rec, null) };
  }),
);

/* ---------------------------------------------------------------- reviews */

routerAdd('POST', '/api/ops/reviews/request', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const rec = boards.mustGet(app, u.req(p, 'board'));
    rec.set('review_focus', u.text(p, 'focus', '').slice(0, 1000));
    const r = require(`${__hooks}/lib_agent.js`).request(app, 'review', rec);
    return { board: boards.serialize(boards.mustGet(app, rec.id), null, null), asked_agent: r.asked, request: r.request };
  }),
);

routerAdd('POST', '/api/ops/reviews/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const rec = boards.mustGet(app, u.req(p, 'board'));
    require(`${__hooks}/lib_agent.js`).cancel(app, 'review', rec);
    return { board: boards.serialize(rec, null, null) };
  }),
);

routerAdd('POST', '/api/ops/reviews/dismiss', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const rec = boards.mustGet(app, u.req(p, 'board'));
    const state = rec.getString('review_state');
    if (state === 'waiting' || state === 'working') throw u.fail(409, 'The review is still going; cancel it instead');
    rec.set('review_state', '');
    rec.set('review_note', '');
    app.save(rec);
    return { board: boards.serialize(rec, null, null) };
  }),
);

routerAdd('GET', '/api/ops/reviews/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const state = u.oneOf(p, 'state', ['waiting', 'working', 'failed', 'done'], 'waiting');
    const rows = app.findRecordsByFilter('boards', 'review_state = {:s}', 'review_at', 100, 0, { s: state });
    const ov = boards.overview(
      app,
      rows.map((r) => r.id),
      false,
    );
    return { count: rows.length, boards: rows.map((r) => boards.serialize(r, ov[r.id].counts, null)) };
  }),
);

routerAdd('POST', '/api/ops/reviews/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const rec = boards.mustGet(app, u.req(p, 'board'));
    require(`${__hooks}/lib_agent.js`).start(app, 'review', rec);
    return { board: boards.serialize(rec, null, null), next: 'boards.get --board ' + rec.id + ' --paths true' };
  }),
);

routerAdd('POST', '/api/ops/reviews/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const rec = boards.mustGet(app, u.req(p, 'board'));
    const summary = u.text(p, 'summary', '');
    if (summary === '') throw u.fail(400, 'summary is required: the review in a few short paragraphs');
    rec.set('review_state', 'done');
    rec.set('review_note', summary.slice(0, 4000));
    rec.set('review_at', new Date().toISOString());
    app.save(rec);
    return { board: boards.serialize(rec, null, null), message: 'Review saved on "' + rec.getString('name') + '"' };
  }),
);

routerAdd('POST', '/api/ops/reviews/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const boards = require(`${__hooks}/lib_boards.js`);
    const rec = boards.mustGet(app, u.req(p, 'board'));
    rec.set('review_state', 'failed');
    rec.set('review_note', u.squash(u.req(p, 'reason')).slice(0, 1000));
    rec.set('review_at', new Date().toISOString());
    app.save(rec);
    return { board: boards.serialize(rec, null, null) };
  }),
);
