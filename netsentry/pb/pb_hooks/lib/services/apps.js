/**
 * Apps (plan §13–15): what a person decides about an app — who should reach
 * it (intent), what to call it, how important it is. Every change is audited
 * and re-evaluates the machine at once, so the verdicts follow the decision.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const { OpError } = require('../core/util.js');
const { reachWords } = require('../v2/intent.js');

const REACH = ['this_machine', 'local_network', 'local_plus_private_remote', 'specific_networks', 'internet'];
const IMPORTANCE = ['low', 'normal', 'critical'];

function requireApp(app, id) {
  const a = repo.byId(app, 'apps', id);
  if (!a) throw new OpError(404, 'App not found.');
  return a;
}

function reevaluate(app, appRec) {
  const asset = repo.byId(app, 'assets', appRec.getString('asset'));
  if (asset) require('./v2.js').evaluateAndAlert(app, asset.id);
}

function setIntent(app, actor, p) {
  if (REACH.indexOf(p.reach) < 0) throw new OpError(400, `reach must be one of ${REACH.join(', ')}.`);
  if (actor.type === 'agent' && p.reach === 'internet') throw new OpError(403, 'Only a person can say an app is meant for the whole internet.');
  const a = requireApp(app, p.app_id);
  const fields = { app: a.id, reach: p.reach, source: 'person', set_by: actor.label || actor.type, set_at: repo.nowIso() };
  const ex = repo.first(app, 'intents', 'app = {:a}', { a: a.id });
  if (ex) repo.update(app, ex, fields);
  else repo.create(app, 'intents', Object.assign({ sign_in_required: true }, fields));
  const name = a.getString('label') || a.getString('display_name');
  audit.append(app, actor, 'app.intent_set', { collection: 'apps', id: a.id }, `Who should reach ${name}: ${reachWords(p.reach)}`, null);
  reevaluate(app, a);
  return { ok: true, message: `Saved: ${name} — ${reachWords(p.reach)}.` };
}

function update(app, actor, p) {
  const a = requireApp(app, p.app_id);
  const fields = {};
  if (p.label !== undefined) fields.label = String(p.label).trim().slice(0, 120);
  if (p.importance !== undefined) {
    if (IMPORTANCE.indexOf(p.importance) < 0) throw new OpError(400, 'importance must be low, normal or critical.');
    fields.importance = p.importance;
  }
  if (p.owner !== undefined) fields.owner = String(p.owner).trim().slice(0, 200);
  if (p.ignored !== undefined && actor.type === 'agent') throw new OpError(403, 'Only a person can stop NetSentry checking an app.');
  if (p.ignored !== undefined) fields.status = p.ignored === true || p.ignored === 'true' ? 'ignored' : 'active';
  if (!Object.keys(fields).length) throw new OpError(400, 'Nothing to change.');
  repo.update(app, a, fields);
  audit.append(app, actor, 'app.updated', { collection: 'apps', id: a.id }, `Updated ${a.getString('label') || a.getString('display_name')}`, fields);
  reevaluate(app, a);
  return { ok: true };
}

module.exports = { setIntent, update };
