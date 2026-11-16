/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS leave schema (leave module).
 *
 * - leave_types: the kinds of absence per entity (code unique per entity),
 *   with a lucide icon name and a meaning colour of the theme.
 * - leave_policies: entitlement rules per type; `history` keeps dated
 *   versions [{ from, rules, by, at }] so a change applies from a day and
 *   closed periods keep their numbers. `rules` mirrors the latest version.
 * - leave_policy_assignments: which policy an employment follows from a day
 *   (effective-dated: the greatest effective_from <= D is in effect).
 * - leave_ledger: every movement of a balance (grant, accrual, take, adjust,
 *   carryover, expire, encash, comp_off). A balance is the sum of its rows;
 *   balances are never stored. Planned rows (grants, accruals, period close,
 *   expiries) carry a `key` so the daily run writes each one once and only
 *   corrections after that.
 * - leave_requests, leave_encash_requests, leave_comp_offs: what people ask
 *   for, each decided through a kernel approval (kinds leave_request,
 *   leave_encash, comp_off).
 * - leave_blocks: locked dates (entity and department, allow list).
 * - leave_sync: the daily run log per entity and local day.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const MMDD = '^((0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))?$';
    const CC = '^([A-Z]{2})?$';
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name, extra) => Object.assign({ name: name, type: 'number' }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const day = (name, required) => ({ name: name, type: 'text', max: 10, pattern: DAY, required: required === true });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const DOCS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const file = (name, max, mimes) => ({ name: name, type: 'file', maxSelect: 1, maxSize: max, mimeTypes: mimes, thumbs: [], protected: true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const STATUS = ['pending', 'approved', 'rejected', 'cancelled', 'withdrawn', 'cancelling'];

    make(
      'leave_types',
      [
        req('code', 40),
        req('name', 120),
        rel('entity', 'entities'),
        cc('country'),
        bool('paid'),
        sel('unit', ['day', 'hour'], true),
        sel('color', ['rh', 'lh', 'good', 'warn', 'bad', 'ink'], true),
        txt('icon', 40),
        bool('allow_half'),
        bool('allow_hours'),
        bool('allow_negative'),
        num('max_negative', { min: 0 }),
        int('attachment_after_days', { min: 0 }),
        int('min_notice_days', { min: 0 }),
        int('max_consecutive_days', { min: 0 }),
        bool('counts_holidays'),
        bool('counts_weekends'),
        bool('statutory'),
        txt('gender_specific', 20),
        bool('encashable'),
        bool('comp_off'),
        sel('visibility', ['type', 'away']),
        txt('pay_code', 40),
        txt('note', 2000),
        int('sort'),
        sel('source', ['builtin', 'person', 'agent']),
        bool('archived'),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_leave_types_code ON leave_types (entity, code)", 'CREATE INDEX idx_leave_types_entity ON leave_types (entity, archived, sort)'],
    );

    make(
      'leave_policies',
      [
        req('name', 120),
        rel('entity', 'entities'),
        cc('country'),
        { name: 'period_start', type: 'text', max: 5, pattern: MMDD },
        json('rules', 100000),
        json('history', 500000),
        txt('note', 2000),
        bool('builtin'),
        bool('archived'),
      ].concat(stamps),
      ['CREATE INDEX idx_leave_policies_entity ON leave_policies (entity, archived)'],
    );

    make(
      'leave_policy_assignments',
      [rel('employment', 'employments', { required: true }), rel('policy', 'leave_policies', { required: true }), day('effective_from', true), txt('note', 600), rel('by', 'members')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_leave_assign_day ON leave_policy_assignments (employment, effective_from)', 'CREATE INDEX idx_leave_assign_policy ON leave_policy_assignments (policy)'],
    );

    make(
      'leave_requests',
      [
        rel('employment', 'employments', { required: true }),
        rel('type', 'leave_types', { required: true }),
        day('start', true),
        day('end', true),
        sel('start_half', ['am', 'pm']),
        sel('end_half', ['am', 'pm']),
        num('hours', { min: 0 }),
        num('days', { min: 0 }),
        num('amount', { min: 0 }),
        sel('unit', ['day', 'hour']),
        json('day_list', 100000),
        txt('reason', 2000),
        file('attachment', 10000000, DOCS),
        sel('status', STATUS, true),
        rel('approval', 'approvals'),
        rel('cancel_approval', 'approvals'),
        day('cancel_from'),
        txt('cancel_reason', 2000),
        txt('decided_note', 2000),
        txt('decided_at', 40),
        rel('requested_by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
        json('warnings', 20000),
        bool('recorded'),
      ].concat(stamps),
      [
        'CREATE INDEX idx_leave_requests_emp ON leave_requests (employment, `start`)',
        'CREATE INDEX idx_leave_requests_status ON leave_requests (status, `start`)',
        'CREATE INDEX idx_leave_requests_days ON leave_requests (`start`, `end`)',
      ],
    );

    make(
      'leave_ledger',
      [
        rel('employment', 'employments', { required: true }),
        rel('type', 'leave_types', { required: true }),
        day('day', true),
        num('amount'),
        sel('kind', ['grant', 'accrual', 'take', 'adjust', 'carryover', 'expire', 'encash', 'comp_off'], true),
        txt('key', 120),
        day('expires'),
        txt('ref', 60),
        txt('note', 600),
        sel('actor', ['person', 'agent', 'system']),
        rel('member', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_leave_ledger_emp ON leave_ledger (employment, type, day)', 'CREATE INDEX idx_leave_ledger_key ON leave_ledger (employment, type, key)', 'CREATE INDEX idx_leave_ledger_ref ON leave_ledger (ref)'],
    );

    make(
      'leave_blocks',
      [rel('entity', 'entities'), rel('department', 'departments'), day('from', true), day('to', true), req('reason', 300), json('allow', 20000), json('types', 4000), rel('created_by', 'members')].concat(stamps),
      ['CREATE INDEX idx_leave_blocks_days ON leave_blocks (`from`, `to`)'],
    );

    make(
      'leave_encash_requests',
      [
        rel('employment', 'employments', { required: true }),
        rel('type', 'leave_types', { required: true }),
        num('days', { min: 0 }),
        txt('reason', 2000),
        sel('status', ['pending', 'approved', 'rejected', 'withdrawn', 'paid'], true),
        rel('approval', 'approvals'),
        day('pay_on'),
        txt('payrun', 30),
        txt('paid_at', 40),
        txt('decided_note', 2000),
        rel('requested_by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
      ].concat(stamps),
      ['CREATE INDEX idx_leave_encash_emp ON leave_encash_requests (employment, status)', 'CREATE INDEX idx_leave_encash_pay ON leave_encash_requests (status, pay_on)'],
    );

    make(
      'leave_comp_offs',
      [
        rel('employment', 'employments', { required: true }),
        rel('type', 'leave_types', { required: true }),
        day('worked_day', true),
        num('hours', { min: 0 }),
        num('days', { min: 0 }),
        txt('reason', 2000),
        sel('status', ['pending', 'approved', 'rejected', 'withdrawn'], true),
        rel('approval', 'approvals'),
        day('expires'),
        txt('decided_note', 2000),
        rel('requested_by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
      ].concat(stamps),
      ['CREATE INDEX idx_leave_comp_emp ON leave_comp_offs (employment, worked_day)'],
    );

    make(
      'leave_sync',
      [rel('entity', 'entities'), day('day', true), int('employments'), int('rows'), int('errors'), int('ms'), txt('note', 2000)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_leave_sync_day ON leave_sync (entity, day)'],
    );

    const flows = app.findCollectionByNameOrId('approval_flows');
    const seedFlow = (kind, steps, note) => {
      const r = new Record(flows);
      r.set('kind', kind);
      r.set('steps', steps);
      r.set('auto', {});
      r.set('active', true);
      r.set('note', note);
      app.save(r);
    };
    seedFlow('leave_request', [{ type: 'manager' }], 'Leave requests and cancellations go to the manager.');
    seedFlow('comp_off', [{ type: 'manager' }], 'Compensatory leave for days worked goes to the manager.');
    seedFlow('leave_encash', [{ type: 'manager' }, { type: 'role', role: 'hr_admin' }], 'Cashing in leave goes to the manager, then HR (it becomes pay).');
  },
  (app) => {
    try {
      for (const r of app.findRecordsByFilter('approval_flows', "kind = 'leave_request' || kind = 'comp_off' || kind = 'leave_encash'", '', 0, 0)) app.delete(r);
    } catch {
      /* already gone */
    }
    for (const n of ['leave_sync', 'leave_comp_offs', 'leave_encash_requests', 'leave_blocks', 'leave_ledger', 'leave_requests', 'leave_policy_assignments', 'leave_policies', 'leave_types']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
