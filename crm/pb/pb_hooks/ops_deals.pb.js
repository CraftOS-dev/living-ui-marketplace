/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations on deals in their pipelines: move (drag on the board), close
 * won or lost, reopen, people on a deal; pipelines and their stages. The AI
 * agent's moves, closes and reopens come back as proposals unless the
 * person made them automatic.
 */

routerAdd('POST', '/api/ops/deals/move', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const review = require(`${__hooks}/lib_review.js`);
    const who = u.actor(e);
    const meta = review.metaOf(p);
    const d0 = recs.resolve(app, 'deals', u.str(p, 'deal', '') || u.req(p, 'id'));
    let res = null;
    require(`${__hooks}/lib_activity.js`).run(app, who, 'deals.move', (t) => {
      const d = recs.resolve(t, 'deals', d0.id);
      const from = d.getString('stage');
      res = deals.move(t, who, d, u.str(p, 'stage', ''), { before: u.has(p, 'before') ? u.str(p, 'before', '') : undefined, lost_reason: u.str(p, 'lost_reason', ''), meta: meta });
      const st = u.byId(t, 'stages', d.getString('stage'));
      const fromSt = u.byId(t, 'stages', from);
      return { summary: res.proposal ? '' : from !== d.getString('stage') ? 'Moved ' + d.getString('name') + ' from ' + (fromSt ? fromSt.getString('name') : '?') + ' to ' + (st ? st.getString('name') : '?') : 'Reordered ' + d.getString('name'), type: 'deals', id: d.id };
    });
    return { proposed: !!res.proposal, proposal: res.proposal ? review.serialize(app, res.proposal) : null, deal: require(`${__hooks}/lib_query.js`).one(app, 'deals', recs.resolve(app, 'deals', d0.id)) };
  }),
);

routerAdd('POST', '/api/ops/deals/close', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const review = require(`${__hooks}/lib_review.js`);
    const who = u.actor(e);
    const outcome = u.oneOf(p, 'outcome', ['won', 'lost'], '');
    if (outcome === '') throw u.fail(400, 'outcome is won or lost');
    const d0 = recs.resolve(app, 'deals', u.str(p, 'deal', '') || u.req(p, 'id'));
    let res = null;
    require(`${__hooks}/lib_activity.js`).run(app, who, 'deals.close', (t) => {
      const d = recs.resolve(t, 'deals', d0.id);
      res = deals.close(t, who, d, outcome, u.str(p, 'reason', '') || u.str(p, 'lost_reason', ''), review.metaOf(p));
      return { summary: res.proposal ? '' : 'Marked ' + d.getString('name') + ' ' + outcome, type: 'deals', id: d.id };
    });
    return { proposed: !!res.proposal, proposal: res.proposal ? review.serialize(app, res.proposal) : null, deal: require(`${__hooks}/lib_query.js`).one(app, 'deals', recs.resolve(app, 'deals', d0.id)) };
  }),
);

routerAdd('POST', '/api/ops/deals/reopen', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const review = require(`${__hooks}/lib_review.js`);
    const who = u.actor(e);
    const d0 = recs.resolve(app, 'deals', u.str(p, 'deal', '') || u.req(p, 'id'));
    let res = null;
    require(`${__hooks}/lib_activity.js`).run(app, who, 'deals.reopen', (t) => {
      const d = recs.resolve(t, 'deals', d0.id);
      res = deals.reopen(t, who, d, u.str(p, 'stage', ''), review.metaOf(p));
      return { summary: res.proposal ? '' : 'Reopened ' + d.getString('name'), type: 'deals', id: d.id };
    });
    return { proposed: !!res.proposal, proposal: res.proposal ? review.serialize(app, res.proposal) : null, deal: require(`${__hooks}/lib_query.js`).one(app, 'deals', recs.resolve(app, 'deals', d0.id)) };
  }),
);

routerAdd('POST', '/api/ops/deals/add_person', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const who = u.actor(e);
    const d0 = recs.resolve(app, 'deals', u.req(p, 'deal'));
    const people = u.has(p, 'people') ? u.list(p, 'people', true) : [u.req(p, 'person')];
    require(`${__hooks}/lib_activity.js`).run(app, who, 'deals.add_person', (t) => {
      const d = recs.resolve(t, 'deals', d0.id);
      require(`${__hooks}/lib_deals.js`).addPeople(t, who, d, people, u.str(p, 'role', ''));
      return { summary: 'Added ' + people.length + ' to ' + d.getString('name'), type: 'deals', id: d.id };
    });
    return require(`${__hooks}/lib_ops.js`).get(app, 'deals', d0.id);
  }),
);

routerAdd('POST', '/api/ops/deals/remove_person', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const recs = require(`${__hooks}/lib_records.js`);
    const who = u.actor(e);
    const d0 = recs.resolve(app, 'deals', u.req(p, 'deal'));
    const person = recs.resolve(app, 'people', u.req(p, 'person'));
    require(`${__hooks}/lib_activity.js`).run(app, who, 'deals.remove_person', (t) => {
      for (const r of t.findRecordsByFilter('deal_people', 'deal = {:d} && person = {:p}', '', 0, 0, { d: d0.id, p: person.id })) t.delete(r);
      return { summary: 'Took ' + recs.personName(person) + ' off ' + d0.getString('name'), type: 'deals', id: d0.id };
    });
    return require(`${__hooks}/lib_ops.js`).get(app, 'deals', d0.id);
  }),
);

/* -------------------------------------------------------------- pipelines */

routerAdd('GET', '/api/ops/pipelines/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { pipelines: require(`${__hooks}/lib_deals.js`).pipelines(app, u.bool(p, 'archived', false)) };
  }),
);

routerAdd('POST', '/api/ops/pipelines/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const fx = require(`${__hooks}/lib_fx.js`);
    const who = u.actor(e);
    const kind = u.oneOf(p, 'kind', ['sales', 'fundraising', 'hiring', 'partnerships', 'other'], 'other');
    const name = u.squash(u.str(p, 'name', '')).slice(0, 80);
    const currency = u.str(p, 'currency', '').toUpperCase() || fx.home(app);
    if (!require(`${__hooks}/lib_money.js`).known(currency)) throw u.fail(400, 'Unknown currency ' + currency);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'pipelines.create', (t) => {
      const pos = t.findRecordsByFilter('pipelines', 'id != ""', '', 0, 0).length;
      const pl = setup.createPipeline(t, kind, name, currency, pos);
      if (u.has(p, 'target')) {
        pl.set('target', require(`${__hooks}/lib_money.js`).parse(u.str(p, 'target', '0') || '0', currency, 'target'));
        t.save(pl);
      }
      return { summary: 'Added the pipeline ' + pl.getString('name'), type: 'pipelines', id: pl.id, result: { pipeline: require(`${__hooks}/lib_deals.js`).serializePipeline(t, pl) } };
    });
  }),
);

routerAdd('POST', '/api/ops/pipelines/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const who = u.actor(e);
    const pl0 = deals.pipelineByRef(app, u.req(p, 'pipeline'));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'pipelines.update', (t) => {
      const pl = t.findRecordById('pipelines', pl0.id);
      if (u.has(p, 'name')) {
        const n = u.squash(u.str(p, 'name', '')).slice(0, 80);
        if (n === '') throw u.fail(400, 'name cannot be empty');
        pl.set('name', n);
      }
      if (u.has(p, 'currency')) {
        const c = u.str(p, 'currency', '').toUpperCase();
        if (!require(`${__hooks}/lib_money.js`).known(c)) throw u.fail(400, 'Unknown currency ' + c);
        pl.set('currency', c);
      }
      if (u.has(p, 'target')) pl.set('target', require(`${__hooks}/lib_money.js`).parse(u.str(p, 'target', '0') || '0', pl.getString('currency'), 'target'));
      if (u.has(p, 'archived')) pl.set('archived', u.bool(p, 'archived', false));
      if (u.has(p, 'position')) pl.set('position', u.int(p, 'position', 0, 0, 1000));
      t.save(pl);
      return { summary: 'Changed the pipeline ' + pl.getString('name'), type: 'pipelines', id: pl.id, merge: true, result: { pipeline: deals.serializePipeline(t, pl) } };
    });
  }),
);

routerAdd('POST', '/api/ops/pipelines/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person deletes pipelines');
    const pl0 = deals.pipelineByRef(app, u.req(p, 'pipeline'));
    const n = app.countRecords('deals', $dbx.hashExp({ pipeline: pl0.id }));
    if (n > 0) throw u.fail(409, pl0.getString('name') + ' still has ' + n + ' deal' + (n === 1 ? '' : 's') + '; archive it instead, or move them first');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'pipelines.delete', (t) => {
      const pl = t.findRecordById('pipelines', pl0.id);
      for (const s of deals.stagesOf(t, pl.id)) t.delete(s);
      t.delete(pl);
      return { summary: 'Deleted the pipeline ' + pl.getString('name'), type: 'pipelines', id: pl.id, result: { deleted: true } };
    });
  }),
);

/* ----------------------------------------------------------------- stages */

routerAdd('POST', '/api/ops/stages/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const who = u.actor(e);
    const pl = deals.pipelineByRef(app, u.req(p, 'pipeline'));
    const name = u.squash(u.str(p, 'name', '')).slice(0, 60);
    if (name === '') throw u.fail(400, 'name is required');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'stages.create', (t) => {
      const list = deals.stagesOf(t, pl.id);
      const kind = u.oneOf(p, 'kind', ['open', 'won', 'lost'], 'open');
      // New open stages go before the won and lost columns.
      const firstClosed = list.findIndex((s) => s.getString('kind') !== 'open');
      const at = u.has(p, 'position') ? u.int(p, 'position', 0, 0, 100) : kind === 'open' && firstClosed >= 0 ? firstClosed : list.length;
      for (const s of list) if (s.getInt('position') >= at) {
        s.set('position', s.getInt('position') + 1);
        t.save(s);
      }
      const r = new Record(t.findCollectionByNameOrId('stages'));
      r.set('pipeline', pl.id);
      r.set('name', name);
      r.set('position', at);
      r.set('kind', kind);
      r.set('probability', u.num(p, 'probability', kind === 'won' ? 100 : kind === 'lost' ? 0 : 50, 0, 100));
      r.set('rot_days', u.int(p, 'rot_days', kind === 'open' ? 14 : 0, 0, 3650));
      r.set('target_days', u.int(p, 'target_days', 0, 0, 3650));
      r.set('color', u.str(p, 'color', kind === 'open' ? 'c' + ((list.length % 8) + 1) : kind).slice(0, 20));
      t.save(r);
      return { summary: 'Added the stage ' + name + ' to ' + pl.getString('name'), type: 'stages', id: r.id, result: { stage: deals.serializeStage(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/stages/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const who = u.actor(e);
    const st0 = u.byId(app, 'stages', u.req(p, 'stage'));
    if (!st0) throw u.fail(404, 'No stage ' + u.str(p, 'stage', ''));
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'stages.update', (t) => {
      const st = t.findRecordById('stages', st0.id);
      if (u.has(p, 'name')) {
        const n = u.squash(u.str(p, 'name', '')).slice(0, 60);
        if (n === '') throw u.fail(400, 'name cannot be empty');
        st.set('name', n);
      }
      if (u.has(p, 'kind')) {
        const k = u.oneOf(p, 'kind', ['open', 'won', 'lost'], 'open');
        if (k !== st.getString('kind') && t.countRecords('deals', $dbx.hashExp({ stage: st.id, deleted: '' })) > 0) throw u.fail(409, 'Move the deals out of ' + st.getString('name') + ' before changing whether it is won, lost or open');
        st.set('kind', k);
      }
      if (u.has(p, 'probability')) st.set('probability', u.num(p, 'probability', 0, 0, 100));
      if (u.has(p, 'rot_days')) st.set('rot_days', u.int(p, 'rot_days', 0, 0, 3650));
      if (u.has(p, 'target_days')) st.set('target_days', u.int(p, 'target_days', 0, 0, 3650));
      if (u.has(p, 'color')) st.set('color', u.str(p, 'color', '').slice(0, 20));
      t.save(st);
      return { summary: 'Changed the stage ' + st.getString('name'), type: 'stages', id: st.id, merge: true, result: { stage: deals.serializeStage(st) } };
    });
  }),
);

routerAdd('POST', '/api/ops/stages/reorder', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const who = u.actor(e);
    const pl = deals.pipelineByRef(app, u.req(p, 'pipeline'));
    const ids = (u.list(p, 'stages', true) || []).map((x) => String(x).trim());
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'stages.reorder', (t) => {
      const list = deals.stagesOf(t, pl.id);
      if (ids.length !== list.length || list.some((s) => ids.indexOf(s.id) < 0)) throw u.fail(400, 'stages must list every stage of the pipeline once, in the new order');
      ids.forEach((id, i) => {
        const s = list.find((x) => x.id === id);
        if (s.getInt('position') !== i) {
          s.set('position', i);
          t.save(s);
        }
      });
      return { summary: 'Reordered the stages of ' + pl.getString('name'), type: 'pipelines', id: pl.id, result: { pipeline: deals.serializePipeline(t, pl) } };
    });
  }),
);

routerAdd('POST', '/api/ops/stages/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const deals = require(`${__hooks}/lib_deals.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Only the person deletes stages');
    const st0 = u.byId(app, 'stages', u.req(p, 'stage'));
    if (!st0) throw u.fail(404, 'No stage ' + u.str(p, 'stage', ''));
    const n = app.countRecords('deals', $dbx.hashExp({ stage: st0.id }));
    const moveTo = u.str(p, 'move_to', '');
    if (n > 0 && moveTo === '') throw u.fail(409, st0.getString('name') + ' has ' + n + ' deal' + (n === 1 ? '' : 's') + '; pass move_to (another stage) to move them first');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'stages.delete', (t) => {
      const st = t.findRecordById('stages', st0.id);
      if (n > 0) {
        const to = deals.stageIn(t, st.getString('pipeline'), moveTo);
        if (to.id === st.id) throw u.fail(400, 'move_to must be another stage');
        for (const d of t.findRecordsByFilter('deals', 'stage = {:s}', '', 0, 0, { s: st.id })) deals.setStage(t, who, d, to, {});
      }
      t.delete(st);
      return { summary: 'Deleted the stage ' + st.getString('name'), type: 'stages', id: st.id, result: { deleted: true } };
    });
  }),
);
