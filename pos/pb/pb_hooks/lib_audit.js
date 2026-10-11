/// <reference path="../pb_data/types.d.ts" />
/**
 * The audit trail: every sale, refund, override, void, cash movement, shift,
 * failed PIN and change to products, settings and staff, with who did it
 * (a person, your AI agent, or the app) and who approved it. Append only.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

const KINDS = [
  'sale', 'refund', 'exchange', 'override', 'ticket_void', 'shift_open', 'shift_close', 'cash_move', 'login_failed', 'pin_locked',
  'staff_change', 'settings_change', 'catalog_change', 'stock_change', 'customer_change', 'approval', 'reprint', 'receipt_email', 'ticket_draft', 'import',
];

/** Kinds grouped the way the Activity page filters them. */
const GROUPS = {
  money: ['sale', 'refund', 'exchange', 'cash_move', 'shift_open', 'shift_close'],
  exceptions: ['override', 'ticket_void', 'login_failed', 'pin_locked', 'approval', 'reprint'],
  changes: ['staff_change', 'settings_change', 'catalog_change', 'stock_change', 'customer_change', 'import'],
  agent: [],
};

function list(app, p) {
  const util = u();
  const group = util.oneOf(p, 'group', ['all', 'money', 'exceptions', 'changes', 'agent'], 'all');
  const kind = util.oneOf(p, 'kind', [''].concat(KINDS), '');
  const from = util.day(p, 'from', '');
  const to = util.day(p, 'to', '');
  const limit = util.int(p, 'limit', 50, 1, 500);
  const offset = util.int(p, 'offset', 0, 0, 1000000);
  const where = [];
  const bind = {};
  if (kind !== '') {
    where.push('a.kind = {:k}');
    bind.k = kind;
  } else if (group === 'agent') {
    where.push("a.actor = 'agent'");
  } else if (group !== 'all') {
    where.push('a.kind IN (' + GROUPS[group].map((k, i) => '{:g' + i + '}').join(',') + ')');
    GROUPS[group].forEach((k, i) => {
      bind['g' + i] = k;
    });
  }
  // Days are local; the stored time is UTC, so compare against local midnight in UTC.
  if (from !== '') {
    where.push('a.created >= {:from}');
    bind.from = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))).toISOString().replace('T', ' ');
  }
  if (to !== '') {
    const next = util.addDays(to, 1);
    where.push('a.created < {:to}');
    bind.to = new Date(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, Number(next.slice(8, 10))).toISOString().replace('T', ' ');
  }
  const staff = util.str(p, 'staff', '');
  if (staff !== '') {
    where.push('(a.staff = {:st} OR a.approver = {:st})');
    bind.st = require(`${__hooks}/lib_core.js`).staff(app, staff).id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push('(LOWER(a.summary) LIKE {:q} OR LOWER(a.ref) LIKE {:q})');
    bind.q = '%' + q.toLowerCase() + '%';
  }
  const sql =
    "SELECT a.id AS id, a.kind AS kind, a.actor AS actor, IFNULL(s.name, '') AS staff, IFNULL(ap.name, '') AS approver, IFNULL(r.code, '') AS register, a.ref AS ref, a.summary AS summary, a.created AS created FROM audit a LEFT JOIN staff s ON s.id = a.staff LEFT JOIN staff ap ON ap.id = a.approver LEFT JOIN registers r ON r.id = a.register" +
    (where.length > 0 ? ' WHERE ' + where.join(' AND ') : '');
  const total = util.scalarSql(app, 'SELECT COUNT(*) AS v FROM (' + sql + ')', bind);
  const rowsOut = util.rows(app, sql + ' ORDER BY a.created DESC LIMIT ' + limit + ' OFFSET ' + offset, { id: '', kind: '', actor: '', staff: '', approver: '', register: '', ref: '', summary: '', created: '' }, bind);
  return { events: rowsOut, total: total, offset: offset, kinds: KINDS };
}

module.exports = { KINDS: KINDS, list: list };
