/// <reference path="../pb_data/types.d.ts" />
/**
 * Portal visibility. External accounts (licensee, committee_member,
 * reviewer) see only records whose `portal_users` include them, and that
 * field is derived here, never typed by hand:
 *
 *   parties.portal_users            set by an admin (who logs in for this company)
 *   agreements                      counterparty + agent
 *   committees                      every member's party
 *   grants                          windows: the committee; others: the agreement
 *   products                        licensee + agreement
 *   approvals                       product + assigned outside reviewers
 *   seal_orders, royalty_reports    agreement (+ licensee)
 *   consent_requests, distributions committee
 *   documents                       whichever of those records it is attached to
 */

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

function partyUsers(app, partyId) {
  const u = u_();
  const p = partyId ? u.byId(app, 'parties', partyId) : null;
  return p ? u.ids(p, 'portal_users') : [];
}

function merge() {
  const out = [];
  for (let i = 0; i < arguments.length; i++) {
    const list = arguments[i] || [];
    for (const x of list) if (x && out.indexOf(x) < 0) out.push(x);
  }
  return out.sort();
}

function same(a, b) {
  return a.slice().sort().join(',') === b.slice().sort().join(',');
}

/** Set portal_users when it changed; returns true if saved. */
function apply(app, rec, users) {
  const u = u_();
  const cur = u.ids(rec, 'portal_users');
  if (same(cur, users)) return false;
  rec.set('portal_users', users);
  app.save(rec);
  return true;
}

function forRecord(app, coll, rec) {
  const u = u_();
  switch (coll) {
    case 'agreements':
      return merge(partyUsers(app, rec.getString('counterparty')), partyUsers(app, rec.getString('agent')));
    case 'committees': {
      let out = [];
      for (const m of u.findMany(app, 'committee_members', 'committee = {:c} && status != "exited"', '', 0, { c: rec.id })) {
        out = merge(out, partyUsers(app, m.getString('party')));
      }
      return out;
    }
    case 'grants': {
      const a = u.byId(app, 'agreements', rec.getString('agreement'));
      if (a === null) return [];
      if (rec.getString('kind') === 'window' && a.getString('committee')) {
        const c = u.byId(app, 'committees', a.getString('committee'));
        return c ? u.ids(c, 'portal_users') : [];
      }
      return u.ids(a, 'portal_users');
    }
    case 'products': {
      const a = rec.getString('agreement') ? u.byId(app, 'agreements', rec.getString('agreement')) : null;
      return merge(partyUsers(app, rec.getString('licensee')), a ? u.ids(a, 'portal_users') : []);
    }
    case 'approvals': {
      const p = u.byId(app, 'products', rec.getString('product'));
      return merge(p ? u.ids(p, 'portal_users') : [], u.ids(rec, 'assigned_reviewers'));
    }
    case 'seal_orders': {
      const a = rec.getString('agreement') ? u.byId(app, 'agreements', rec.getString('agreement')) : null;
      return merge(partyUsers(app, rec.getString('licensee')), a ? u.ids(a, 'portal_users') : []);
    }
    case 'royalty_reports': {
      const a = u.byId(app, 'agreements', rec.getString('agreement'));
      return a ? u.ids(a, 'portal_users') : [];
    }
    case 'consent_requests':
    case 'distributions': {
      const c = u.byId(app, 'committees', rec.getString('committee'));
      return c ? u.ids(c, 'portal_users') : [];
    }
    case 'documents': {
      let out = [];
      const links = [
        ['agreement', 'agreements'],
        ['product', 'products'],
        ['approval', 'approvals'],
        ['committee', 'committees'],
      ];
      for (const l of links) {
        const id = rec.getString(l[0]);
        if (!id) continue;
        const r = u.byId(app, l[1], id);
        if (r) out = merge(out, u.ids(r, 'portal_users'));
      }
      return out;
    }
    default:
      return null;
  }
}

/** Recompute one record's portal_users. */
function refresh(app, coll, rec) {
  const users = forRecord(app, coll, rec);
  if (users === null) return false;
  return apply(app, rec, users);
}

function refreshById(app, coll, id) {
  const u = u_();
  const rec = id ? u.byId(app, coll, id) : null;
  return rec ? refresh(app, coll, rec) : false;
}

/** Cascade after a parent changed: children follow. */
function cascade(app, coll, rec) {
  const u = u_();
  if (coll === 'agreements') {
    for (const g of u.findMany(app, 'grants', 'agreement = {:a}', '', 0, { a: rec.id })) refresh(app, 'grants', g);
    for (const p of u.findMany(app, 'products', 'agreement = {:a}', '', 0, { a: rec.id })) {
      refresh(app, 'products', p);
      cascade(app, 'products', p);
    }
    for (const s of u.findMany(app, 'seal_orders', 'agreement = {:a}', '', 0, { a: rec.id })) refresh(app, 'seal_orders', s);
    for (const r of u.findMany(app, 'royalty_reports', 'agreement = {:a}', '', 0, { a: rec.id })) refresh(app, 'royalty_reports', r);
    for (const d of u.findMany(app, 'documents', 'agreement = {:a}', '', 0, { a: rec.id })) refresh(app, 'documents', d);
  } else if (coll === 'products') {
    for (const a of u.findMany(app, 'approvals', 'product = {:p}', '', 0, { p: rec.id })) {
      refresh(app, 'approvals', a);
      for (const d of u.findMany(app, 'documents', 'approval = {:a}', '', 0, { a: a.id })) refresh(app, 'documents', d);
    }
    for (const s of u.findMany(app, 'seal_orders', 'product = {:p}', '', 0, { p: rec.id })) refresh(app, 'seal_orders', s);
    for (const d of u.findMany(app, 'documents', 'product = {:p}', '', 0, { p: rec.id })) refresh(app, 'documents', d);
  } else if (coll === 'committees') {
    for (const x of u.findMany(app, 'consent_requests', 'committee = {:c}', '', 0, { c: rec.id })) refresh(app, 'consent_requests', x);
    for (const x of u.findMany(app, 'distributions', 'committee = {:c}', '', 0, { c: rec.id })) refresh(app, 'distributions', x);
    for (const d of u.findMany(app, 'documents', 'committee = {:c}', '', 0, { c: rec.id })) refresh(app, 'documents', d);
    for (const a of u.findMany(app, 'agreements', 'committee = {:c} && agreement_type = "committee"', '', 0, { c: rec.id })) {
      for (const g of u.findMany(app, 'grants', 'agreement = {:a} && kind = "window"', '', 0, { a: a.id })) refresh(app, 'grants', g);
    }
  } else if (coll === 'approvals') {
    for (const d of u.findMany(app, 'documents', 'approval = {:a}', '', 0, { a: rec.id })) refresh(app, 'documents', d);
  }
}

/** A party's portal accounts changed: every record that derives from it follows. */
function partyChanged(app, partyId) {
  const u = u_();
  for (const a of u.findMany(app, 'agreements', 'counterparty = {:p} || agent = {:p}', '', 0, { p: partyId })) {
    if (refresh(app, 'agreements', a) || true) cascade(app, 'agreements', a);
  }
  for (const m of u.findMany(app, 'committee_members', 'party = {:p}', '', 0, { p: partyId })) {
    const c = u.byId(app, 'committees', m.getString('committee'));
    if (c) {
      refresh(app, 'committees', c);
      cascade(app, 'committees', c);
    }
  }
  for (const p of u.findMany(app, 'products', 'licensee = {:p}', '', 0, { p: partyId })) {
    refresh(app, 'products', p);
    cascade(app, 'products', p);
  }
  for (const s of u.findMany(app, 'seal_orders', 'licensee = {:p}', '', 0, { p: partyId })) refresh(app, 'seal_orders', s);
}

/** The parties an external account acts for. */
function partiesOfUser(app, userId) {
  const u = u_();
  return u.findMany(app, 'parties', 'portal_users.id ?= {:u}', '', 0, { u: userId });
}

module.exports = {
  refresh: refresh,
  refreshById: refreshById,
  cascade: cascade,
  partyChanged: partyChanged,
  partiesOfUser: partiesOfUser,
  forRecord: forRecord,
};
