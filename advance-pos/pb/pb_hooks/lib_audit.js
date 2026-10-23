/// <reference path="../pb_data/types.d.ts" />
/**
 * The audit log: one append-only row per sensitive action (voids, removed
 * lines, price changes, discounts, returns, the drawer, sign in and wrong
 * PINs, approvals, staff, permission and settings changes).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/**
 * Record an event. `db` is the app or the transaction in progress; `c` is
 * the acting context (null for an unknown person, as for a wrong PIN).
 */
function log(db, kind, c, fields) {
  const f = fields || {};
  const rec = new Record(db.findCollectionByNameOrId('events'));
  rec.set('kind', kind);
  rec.set('actor', c === null ? 'system' : c.actor || 'staff');
  if (c !== null && c.staffId) rec.set('staff', c.staffId);
  if (f.approver) rec.set('approved_by', f.approver.id);
  rec.set('register', f.register !== undefined ? f.register : c !== null && c.registerId ? c.registerId : '');
  if (f.order) rec.set('order', f.order);
  if (f.amount !== undefined && f.amount !== null) rec.set('amount', Math.round(f.amount));
  rec.set('detail', String(f.detail || '').slice(0, 600));
  if (f.data !== undefined) rec.set('data', f.data);
  db.save(rec);
  return rec;
}

const KINDS = [
  'sign_in',
  'pin_failed',
  'line_removed',
  'order_voided',
  'price_override',
  'discount',
  'tax_exempt',
  'return',
  'payment_voided',
  'no_sale',
  'pay_in',
  'pay_out',
  'shift_open',
  'shift_close',
  'stock',
  'balance',
  'staff',
  'permissions',
  'settings',
  'catalog',
  'delete',
  'clock',
];

/** The audit log, newest first, with names resolved. */
function list(app, p) {
  const util = u();
  const filters = [];
  const bind = {};
  const kind = util.str(p, 'kind', '');
  if (kind !== '') {
    if (KINDS.indexOf(kind) < 0) throw util.fail(400, 'kind must be one of: ' + KINDS.join(', '));
    filters.push('kind = {:k}');
    bind.k = kind;
  }
  const staff = util.str(p, 'staff', '');
  if (staff !== '') {
    filters.push('(staff = {:s} || approved_by = {:s})');
    bind.s = staff;
  }
  const order = util.str(p, 'order', '');
  if (order !== '') {
    filters.push('order = {:o}');
    bind.o = order;
  }
  if (util.str(p, 'from', '') !== '' || util.str(p, 'to', '') !== '') {
    const r = util.range(p, 1);
    filters.push('created >= {:a} && created < {:b}');
    bind.a = util.dbDate(r.start);
    bind.b = util.dbDate(r.end);
  }
  const limit = util.int(p, 'limit', 100, 1, 500);
  const page = util.int(p, 'page', 1, 1, 100000);
  const rows = app.findRecordsByFilter('events', filters.join(' && '), '-created', limit + 1, (page - 1) * limit, bind);
  const names = staffNames(app);
  return {
    events: rows.slice(0, limit).map((r) => ({
      id: r.id,
      kind: r.getString('kind'),
      actor: r.getString('actor'),
      staff: r.getString('staff') === '' ? null : { id: r.getString('staff'), name: names[r.getString('staff')] || 'Removed staff member' },
      approved_by: r.getString('approved_by') === '' ? null : { id: r.getString('approved_by'), name: names[r.getString('approved_by')] || 'Removed staff member' },
      register: r.getString('register'),
      order: r.getString('order'),
      amount: r.get('amount') === null ? null : r.getInt('amount'),
      detail: r.getString('detail'),
      data: util.getJson(r, 'data'),
      created: r.getString('created'),
    })),
    more: rows.length > limit,
    kinds: KINDS,
  };
}

function staffNames(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('staff', '', '', 0, 0)) out[r.id] = r.getString('name');
  return out;
}

module.exports = { log: log, list: list, KINDS: KINDS, staffNames: staffNames };
