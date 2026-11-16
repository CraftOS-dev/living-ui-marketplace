/// <reference path="../pb_data/types.d.ts" />
/**
 * TEST KIT (kernel-records tests only, never shipped): test doors for
 * code that runs as the app itself (cron, mail sweeps).
 */

/** lib_files.fromPath as the app does after download_gmail_attachment. */
function fromPath(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const sys = Object.assign(require(`${__hooks}/lib_auth.js`).systemCtx(ctx.app), { app: ctx.app });
  const deal = u.str(p, 'deal', '');
  const company = u.str(p, 'company', '');
  const owner = deal !== '' ? { owner_collection: 'deals', owner_id: deal } : { owner_collection: 'companies', owner_id: company };
  return { file: require(`${__hooks}/lib_files.js`).fromPath(sys, Object.assign(owner, { path: u.req(p, 'path'), name: u.str(p, 'name', ''), origin: 'email', source_ref: 'msg-test-1' })) };
}

function log(ctx, name, payload) {
  const store = ctx.app.store();
  let list = [];
  try {
    list = JSON.parse(store.get('vo_test_events') || '[]');
  } catch {
    list = [];
  }
  list.push({ name: name, payload: payload });
  store.set('vo_test_events', JSON.stringify(list));
}

function events(ctx, p) {
  const store = ctx.app.store();
  let list = [];
  try {
    list = JSON.parse(store.get('vo_test_events') || '[]');
  } catch {
    list = [];
  }
  if (p && (p.clear === true || p.clear === 'true')) store.set('vo_test_events', '[]');
  return { events: list };
}

/** A person's NDA ask about a deal as a module makes it (fix 8: trigger diligence_answers, nda on, with the deal's id). */
function ask(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const deal = require(`${__hooks}/lib_auth.js`).dealRef(ctx.app, u.req(p, 'deal'));
  if (deal === null) throw u.fail(404, 'No deal ' + p.deal, 'not_found');
  for (const t of Object.keys(require(`${__hooks}/lib_events.js`).triggers())) ctx.app.store().remove('trig_rate:' + t);
  return { request: require(`${__hooks}/lib_agent.js`).ask(ctx.app, 'diligence_answers', deal, {}, { by: ctx.memberId || '' }), deal: deal.id };
}

/** Open many deals through lib_deals.create, spread over the stages and days in stage. */
function bulkDeals(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const D = require(`${__hooks}/lib_deals.js`);
  const n = u.int(p, 'count', 10, 1, 2000);
  const stages = D.stagesOf(D.pipelineOf(ctx.app, 'deal_flow'));
  for (let i = 0; i < n; i++) {
    const d = D.create(ctx, { company: { name: 'Bulk ' + i, domain: 'bulk' + i + '.example' }, round: { type: 'seed', raise_minor: 100000000 + i }, check_minor: 5000000, currency: 'USD' });
    const r = ctx.app.findRecordById('deals', d.id);
    r.set('stage', stages[i % (stages.length - 1)].key);
    r.set('stage_entered_at', new Date(Date.now() - (i % 40) * 86400000).toISOString());
    ctx.app.save(r);
  }
  return { created: n };
}

module.exports = {
  bulkDeals: bulkDeals,
  ask: ask,
  fromPath: fromPath,
  events: events,
  onPersonCreated: (ctx, p) => log(ctx, 'person.created', p),
  onCompanyCreated: (ctx, p) => log(ctx, 'company.created', p),
  onRecordMerged: (ctx, p) => log(ctx, 'record.merged', p),
  onDealCreated: (ctx, p) => log(ctx, 'deal.created', p),
  onDealMoved: (ctx, p) => log(ctx, 'deal.moved', p),
  onDealClosed: (ctx, p) => log(ctx, 'deal.closed', p),
  onFileAdded: (ctx, p) => log(ctx, 'file.added', p),
  onFileTextReady: (ctx, p) => log(ctx, 'file.text_ready', p),
};
