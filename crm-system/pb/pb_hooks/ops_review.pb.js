/// <reference path="../pb_data/types.d.ts" />
/**
 * Review: the AI agent's proposals. Only the person decides them; the agent
 * may withdraw its own pending proposals.
 */

routerAdd('GET', '/api/ops/proposals/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const review = require(`${__hooks}/lib_review.js`);
    return {
      proposals: review.list(app, {
        status: u.oneOf(p, 'status', ['pending', 'accepted', 'edited', 'rejected'], ''),
        target: u.str(p, 'target', ''),
        kind: u.str(p, 'kind', ''),
        limit: u.int(p, 'limit', 200, 1, 1000),
      }),
    };
  }),
);

routerAdd('GET', '/api/ops/proposals/stats', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => ({ kinds: require(`${__hooks}/lib_review.js`).stats(app) })));

routerAdd('POST', '/api/ops/proposals/decide', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const review = require(`${__hooks}/lib_review.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'The person decides your proposals');
    const decision = u.oneOf(p, 'decision', ['accept', 'reject'], '');
    if (decision === '') throw u.fail(400, 'decision is accept or reject');
    const ids = u.has(p, 'proposals') ? (u.list(p, 'proposals', true) || []).map((x) => String(x).trim()) : [u.req(p, 'proposal')];
    const edits = u.has(p, 'edits') ? u.obj(p, 'edits') || {} : {};
    const out = { decided: [], failed: [] };
    for (const id of ids) {
      const rec0 = u.byId(app, 'proposals', id);
      if (!rec0) {
        out.failed.push({ id: id, error: 'No proposal ' + id });
        continue;
      }
      try {
        require(`${__hooks}/lib_activity.js`).run(app, who, 'proposals.decide', (t) => {
          const rec = t.findRecordById('proposals', id);
          review.decide(t, who, rec, decision, ids.length === 1 ? edits : {});
          const st = rec.getString('status');
          return { summary: (st === 'rejected' ? 'Rejected' : st === 'edited' ? 'Accepted with edits' : 'Accepted') + " the AI agent's proposal: " + rec.getString('title'), type: rec.getString('object'), id: rec.getString('target') };
        });
        out.decided.push(review.serialize(app, app.findRecordById('proposals', id)));
      } catch (err) {
        if (!err || !err.status) throw err;
        out.failed.push({ id: id, error: String(err.message || err) });
      }
    }
    if (ids.length === 1 && out.failed.length === 1) throw u.fail(409, out.failed[0].error);
    // An accepted email goes to the agent to send.
    if (out.decided.some((d) => d.kind === 'email' && d.status !== 'rejected')) require(`${__hooks}/lib_agent.js`).nudge(app, 'emails');
    return out;
  }),
);

routerAdd('POST', '/api/ops/proposals/withdraw', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rec = u.byId(app, 'proposals', u.req(p, 'proposal'));
    if (!rec) throw u.fail(404, 'No proposal ' + u.str(p, 'proposal', ''));
    if (rec.getString('status') !== 'pending') throw u.fail(409, 'Already decided');
    app.delete(rec);
    return { withdrawn: true };
  }),
);
