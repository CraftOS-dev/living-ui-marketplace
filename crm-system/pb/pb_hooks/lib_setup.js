/// <reference path="../pb_data/types.d.ts" />
/**
 * The settings row, the AI agent's policy and the pipeline templates.
 *
 * Policy: for each kind of change the AI agent may make it directly
 * ('auto') or only propose it ('propose', the default) for the person to
 * accept, edit or reject in Review. Notes, logged interactions, tasks, new
 * records and filling empty fields are always written directly (tagged as
 * the agent's and revertible).
 */

const POLICY_KINDS = {
  update: 'Change a value you entered',
  stage: 'Move a deal to another stage',
  close: 'Mark a deal won or lost, or reopen it',
  deal_value: "Change a deal's value, currency, close date or probability",
  merge: 'Merge duplicates',
  delete: 'Delete people, companies or deals (to the trash)',
  email: 'Send an email',
};

const PIPELINES = {
  sales: {
    name: 'Sales',
    stages: [
      ['Lead', 'open', 10, 14, 7],
      ['Qualified', 'open', 25, 14, 10],
      ['Meeting', 'open', 40, 14, 14],
      ['Proposal', 'open', 60, 10, 14],
      ['Negotiation', 'open', 80, 10, 14],
      ['Won', 'won', 100, 0, 0],
      ['Lost', 'lost', 0, 0, 0],
    ],
  },
  fundraising: {
    name: 'Fundraising',
    stages: [
      ['Target', 'open', 5, 21, 14],
      ['Contacted', 'open', 10, 14, 10],
      ['First meeting', 'open', 25, 14, 14],
      ['Due diligence', 'open', 50, 14, 21],
      ['Term sheet', 'open', 75, 10, 14],
      ['Committed', 'won', 100, 0, 0],
      ['Passed', 'lost', 0, 0, 0],
    ],
  },
  hiring: {
    name: 'Hiring',
    stages: [
      ['Sourced', 'open', 10, 14, 7],
      ['Screen', 'open', 20, 10, 7],
      ['Interview', 'open', 40, 10, 10],
      ['Final round', 'open', 60, 7, 7],
      ['Offer', 'open', 80, 7, 7],
      ['Hired', 'won', 100, 0, 0],
      ['Not a fit', 'lost', 0, 0, 0],
    ],
  },
  partnerships: {
    name: 'Partnerships',
    stages: [
      ['Prospect', 'open', 10, 21, 14],
      ['Intro call', 'open', 25, 14, 14],
      ['Exploring', 'open', 50, 21, 21],
      ['Agreement', 'open', 75, 14, 14],
      ['Live', 'won', 100, 0, 0],
      ['Closed', 'lost', 0, 0, 0],
    ],
  },
};

function row(app) {
  const rows = app.findRecordsByFilter('settings', 'id != ""', '', 1, 0);
  if (rows.length > 0) return rows[0];
  const s = new Record(app.findCollectionByNameOrId('settings'));
  s.set('home_currency', 'USD');
  s.set('policy', defaults());
  app.save(s);
  return s;
}

function defaults() {
  const autonomy = {};
  for (const k of Object.keys(POLICY_KINDS)) autonomy[k] = 'propose';
  return { autonomy: autonomy, auto_research: false, meeting_review: true, daily_brief: false, brief_hour: 8, house_rules: '' };
}

function policy(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const p = u.json(rec, 'policy', null) || {};
  const d = defaults();
  const out = Object.assign({}, d, p);
  out.autonomy = Object.assign({}, d.autonomy, p.autonomy || {});
  for (const k of Object.keys(out.autonomy)) if (out.autonomy[k] !== 'auto') out.autonomy[k] = 'propose';
  return out;
}

function serialize(rec) {
  return {
    id: rec.id,
    workspace: rec.getString('workspace'),
    owner_name: rec.getString('owner_name'),
    home_currency: rec.getString('home_currency') || 'USD',
    keep_in_touch_default: rec.getInt('keep_in_touch_default'),
    policy: policy(rec),
    policy_kinds: POLICY_KINDS,
    setup_done: rec.getBool('setup_done'),
    brief_last: rec.getString('brief_last'),
  };
}

/** True when an AI agent call of this kind must become a proposal. */
function mustPropose(app, who, kind) {
  if (!who || who.actor !== 'agent') return false;
  return policy(row(app)).autonomy[kind] !== 'auto';
}

/** Create a pipeline from a template (sales, fundraising, hiring, partnerships) or a bare one. */
function createPipeline(t, kind, name, currency, position) {
  const tpl = PIPELINES[kind] || { name: name || 'Pipeline', stages: [['New', 'open', 20, 14, 14], ['In progress', 'open', 50, 14, 14], ['Done', 'won', 100, 0, 0], ['Dropped', 'lost', 0, 0, 0]] };
  const p = new Record(t.findCollectionByNameOrId('pipelines'));
  p.set('name', name || tpl.name);
  p.set('kind', PIPELINES[kind] ? kind : 'other');
  p.set('currency', currency || 'USD');
  p.set('target', 0);
  p.set('position', position);
  p.set('archived', false);
  t.save(p);
  let open = 0;
  tpl.stages.forEach((st, i) => {
    const r = new Record(t.findCollectionByNameOrId('stages'));
    r.set('pipeline', p.id);
    r.set('name', st[0]);
    r.set('position', i);
    r.set('kind', st[1]);
    r.set('probability', st[2]);
    r.set('rot_days', st[3]);
    r.set('target_days', st[4]);
    r.set('color', st[1] === 'open' ? 'c' + ((open++ % 8) + 1) : st[1]);
    t.save(r);
  });
  return p;
}

module.exports = { POLICY_KINDS: POLICY_KINDS, PIPELINES: PIPELINES, row: row, defaults: defaults, policy: policy, serialize: serialize, mustPropose: mustPropose, createPipeline: createPipeline };
