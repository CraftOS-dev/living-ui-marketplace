/// <reference path="../pb_data/types.d.ts" />
/** SCRATCH ONLY (never shipped): handlers of cat_zz_stub.js. */
function refsLog(ctx, p) {
  const d = require(`${__hooks}/lib_deals.js`).ref(ctx.app, p.deal);
  return { ref: { id: $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789'), deal: d.id, kind: p.kind || 'provided', signal: p.signal || 'neutral', person: p.person || '', note: p.note || '' } };
}

function verdict(ctx, p) {
  // Shape of intake's real intake.verdict (lib_intake.opVerdict) as of 2026-11-12.
  const D = require(`${__hooks}/lib_deals.js`);
  const d = D.ref(ctx.app, p.deal);
  D.guard(ctx, d);
  const deal = { id: d.id, number: d.getString('number') };
  if (d.getString('tags').indexOf('demo') < 0) return { deal: deal, item: null, status: '', facts: [], figures: [], checks: [], missing: [], questions: [] };
  const f = (key, label, text, grade, page) => ({ key: key, label: label, text: text, value: text, grade: grade, file: '', file_name: page ? 'acme_seed_deck.pdf' : '', page: page || 0 });
  return {
    deal: deal,
    item: { id: 'stubitem0000001', number: 'IN-0007', name: 'Acme Robotics', one_liner: 'Autonomous picking arms for mid-size warehouses', channel: 'email', received_at: '2026-11-03T14:10:00Z' },
    status: 'advanced',
    facts: [
      f('arr_minor', 'ARR', 'USD 1.2M', 'artifact', 4),
      f('growth_mom_ppm', 'Growth (MoM)', '18% MoM', 'founder_reported', 4),
      f('team_size', 'Team size', '14', 'public', 0),
      f('customers', 'Customers', '42', 'unverifiable', 5),
      f('burn_minor', 'Burn', 'Unknown', 'unknown', 0),
      f('hq_country', 'HQ country', 'US', 'public', 0),
    ],
    figures: [],
    checks: [
      {
        thesis: { id: 'stubthesis00001', name: 'Robotics seed' },
        state: 'met',
        counts: { met: 3, unmet: 1, unknown: 1 },
        required: { met: 2, unmet: 0, unknown: 0, state: 'met' },
        checks: [
          { key: 'stage', label: 'Stage', op: 'in', required: true, status: 'met', reason: null, value: 'seed' },
          { key: 'hq_country', label: 'HQ country', op: 'in', required: true, status: 'met', reason: null, value: 'US' },
          { key: 'arr_minor', label: 'ARR', op: 'gte', required: false, status: 'met', reason: null, value: 120000000 },
          { key: 'technical_founder', label: 'Technical founder', op: 'bool', required: false, status: 'unknown', reason: 'missing', value: null },
          { key: 'business_model', label: 'Business model', op: 'in', required: false, status: 'unmet', reason: null, value: 'hardware' },
        ],
      },
    ],
    missing: [
      { key: 'financials', label: 'Financials' },
      { key: 'cap_table', label: 'Cap table' },
    ],
    questions: ['What is the payback per arm?', 'Who leads the round?'],
  };
}

// Shape of network's real briefs.list / briefs.get (lib_network_work) as of 2026-11-12: one demo brief on the deal tagged demo.
function demoBrief(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = u.rows(app, "SELECT id, number, name, stage FROM deals WHERE tags LIKE '%demo%' AND deleted_at = '' LIMIT 1", { id: '', number: '', name: '', stage: '' });
  if (rows.length === 0) return null;
  const d = rows[0];
  const start = new Date(Date.now() + 26 * 3600000).toISOString();
  return {
    id: 'stubbrief000001',
    state: 'ready',
    steps: { labels: ['Queued', 'Reading', 'Ready'], at: 3 },
    event: { id: 'stubevent000001', title: 'Acme Robotics partner meeting', start_at: start, end_at: new Date(Date.parse(start) + 3600000).toISOString(), company: null, deal: { id: d.id, number: d.number, title: d.name, stage: d.stage }, deal_hidden: false, note_state: 'none', ended: false },
    prepared_at: new Date().toISOString(),
    attendees: [
      { name: 'Jane Rivera', email: 'jane@acme-robotics.com', external: true, strength: { score: 62, band: 'good', best_member: 'Pat Lin' } },
      { name: 'Omar Haddad', email: 'omar@acme-robotics.com', external: true, strength: { score: 18, band: 'weak', best_member: 'Maya Ortiz' } },
    ],
    sections: { who: 'Jane Rivera, CEO, 8 years at Boston Dynamics. Omar Haddad, CTO, built perception at Kiva.', history: 'First call on 10 Nov with Pat; reference from her former manager.', deal: 'First meeting; USD 3M seed on a SAFE.', questions: 'Payback per arm; who leads the round.', news: 'Named in a logistics robotics roundup (Nov 2026).' },
    agent: true,
  };
}

function briefs(ctx, p) {
  const b = demoBrief(ctx.app);
  return { briefs: b ? [{ id: b.id, state: b.state, steps: b.steps, event: b.event, prepared_at: b.prepared_at }] : [], hidden: 0 };
}

function brief(ctx, p) {
  const b = demoBrief(ctx.app);
  if (b === null) throw require(`${__hooks}/lib_util.js`).fail(404, 'No brief.', 'not_found');
  return { brief: b };
}

function emit(ctx, p) {
  const app = ctx.app;
  const sys = require(`${__hooks}/lib_auth.js`).systemCtx(app);
  return { results: require(`${__hooks}/lib_events.js`).emit(sys, p.event, JSON.parse(p.payload)) };
}

function cron(ctx, p) {
  const parts = String(p.fn).split('.');
  return { result: require(`${__hooks}/${parts[0]}.js`)[parts[1]](ctx.app) };
}

function backdate(ctx, p) {
  const app = ctx.app;
  const d = require(`${__hooks}/lib_deals.js`).ref(app, p.deal);
  const at = new Date(Date.now() - Number(p.days) * 86400000).toISOString();
  const u = require(`${__hooks}/lib_util.js`);
  u.exec(app, 'UPDATE deals SET stage_entered_at = {:at} WHERE id = {:id}', { at: at, id: d.id });
  const last = u.rows(app, 'SELECT id FROM stage_events WHERE deal = {:d} ORDER BY at DESC LIMIT 1', { id: '' }, { d: d.id });
  if (last.length > 0) u.exec(app, 'UPDATE stage_events SET at = {:at} WHERE id = {:id}', { at: at, id: last[0].id });
  return { at: at };
}

function compareSave(ctx, p) {
  return { grid: { id: 'stubgrid0000001', deals: JSON.parse(p.deals || '[]') } };
}

module.exports = { compareSave: compareSave, backdate: backdate, refsLog: refsLog, verdict: verdict, briefs: briefs, brief: brief, emit: emit, cron: cron };
