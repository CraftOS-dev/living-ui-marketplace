/// <reference path="../pb_data/types.d.ts" />
/**
 * Scouts: people who send the firm deals. A scout may be a member with the
 * scout role (they add deals through Add deal and see only their own items)
 * or an outside contact whose emails to the deals label are filed as scout
 * submissions. Each scout's items and advances are counted for Settings.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function scoutOut(app, s, counts) {
  const R = L('lib_records');
  const c = counts || { items: 0, advanced: 0, last_at: '' };
  return { id: s.id, name: s.getString('name'), email: s.getString('email'), status: s.getString('status'), note: s.getString('note'), account: R.mini(app, 'members', s.getString('account')), person: R.mini(app, 'people', s.getString('person')), items: c.items, advanced: c.advanced, last_at: c.last_at };
}

function countsOf(app) {
  const out = {};
  for (const r of u().rows(app, "SELECT scout, COUNT(*) AS items, COALESCE(SUM(CASE WHEN status = 'advanced' THEN 1 ELSE 0 END), 0) AS advanced, COALESCE(MAX(received_at), '') AS last_at FROM intake_items WHERE scout != '' AND status != 'merged' GROUP BY scout", { scout: '', items: 0, advanced: 0, last_at: '' })) out[r.scout] = r;
  return out;
}

/** scouts.list: every scout with their items and advances (a scout sees only themselves). */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const status = util.oneOf(p, 'status', ['active', 'paused', 'all'], 'all');
  let rows;
  if (ctx.ownOnly) rows = util.findMany(app, 'scouts', 'account = {:m}', 'name', 1, { m: ctx.memberId });
  else rows = util.findMany(app, 'scouts', status === 'all' ? '1=1' : 'status = {:s}', 'name', 500, { s: status });
  const counts = countsOf(app);
  return { scouts: rows.map((s) => scoutOut(app, s, counts[s.id])) };
}

/** scouts.save: add a scout or change one (name, email, status, note, a member account). */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.ownOnly) throw util.fail(403, 'Scouts cannot manage scouts.', 'not_permitted');
  const id = util.str(p, 'scout', '');
  const s = id !== '' ? util.byId(app, 'scouts', id) : util.newRecord(app, 'scouts');
  if (s === null) throw util.fail(404, 'No scout ' + id + '. Run scouts.list.', 'not_found', { param: 'scout' });
  const isNew = id === '';
  if (util.has(p, 'name') || isNew) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name is required.', 'missing_param', { param: 'name' });
    s.set('name', n);
  }
  if (util.has(p, 'email')) {
    const e = util.str(p, 'email', '').toLowerCase();
    if (e !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw util.fail(400, 'email is not an email address.', 'invalid_param', { param: 'email' });
    if (e !== '') {
      const other = util.findOne(app, 'scouts', 'email = {:e} && id != {:id}', { e: e, id: s.id || '-' });
      if (other !== null) throw util.fail(409, e + ' is already the scout ' + other.getString('name') + '.', 'duplicate', { scout: other.id });
      s.set('person', L('lib_records').upsertPerson(ctx, { email: e, name: s.getString('name') || undefined, origin: 'intake' }).id);
    }
    s.set('email', e);
  }
  if (util.has(p, 'status') || isNew) s.set('status', util.oneOf(p, 'status', ['active', 'paused'], isNew ? 'active' : s.getString('status')));
  if (util.has(p, 'note')) s.set('note', util.text(p, 'note', 1000, ''));
  if (util.has(p, 'account')) {
    const a = util.str(p, 'account', '');
    s.set('account', a === '' ? '' : L('lib_auth').memberRef(app, a).id);
  }
  if (isNew) {
    s.set('actor', ctx.isAgent ? 'agent' : 'person');
    s.set('member', ctx.actor === 'person' ? ctx.memberId : '');
  }
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'scouts', record: s.id, summary: (isNew ? 'Added the scout ' : 'Changed the scout ') + s.getString('name') });
  return scoutOut(app, app.findRecordById('scouts', s.id), countsOf(app)[s.id]);
}

module.exports = { scoutOut: scoutOut, opList: opList, opSave: opSave };
