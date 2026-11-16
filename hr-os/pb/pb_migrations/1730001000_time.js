/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS time module: shift types and patterns, the shift schedule (draft
 * and published), shift requests and swaps, punches (web, phone, kiosk,
 * corrections), kiosk tablets and personal kiosk PINs, attendance per day,
 * attendance requests (regularisation), weekly timesheets, overtime rules
 * per entity and overtime pre-approval requests.
 *
 * Every collection is closed to the raw API (all rules null); screens and
 * your AI agent use the time operations (cat_time_*.js).
 *
 * Days: 'YYYY-MM-DD' text in the employment's local time zone. Times of
 * day: 'HH:MM'. Punch instants: PocketBase dates (UTC). Minutes are whole
 * numbers.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const HHMM = '^(([01]\\d|2[0-3]):[0-5]\\d)?$';
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
    const hhmm = (name, required) => ({ name: name, type: 'text', max: 5, pattern: HHMM, required: required === true });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const date = (name) => ({ name: name, type: 'date' });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };

    /* ---------------------------------------------------------- shifts */

    make(
      'shift_types',
      [
        rel('entity', 'entities', { required: true }),
        req('name', 80),
        txt('code', 12),
        hhmm('start', true),
        hhmm('end', true),
        int('break_min', { min: 0, max: 600 }),
        sel('color', ['grey', 'blue', 'teal', 'ink']),
        bool('overnight'),
        int('grace_in_min', { min: 0, max: 240 }),
        int('grace_out_min', { min: 0, max: 240 }),
        int('half_day_below_min', { min: 0, max: 1440 }),
        int('absent_below_min', { min: 0, max: 1440 }),
        bool('auto_attendance'),
        rel('location', 'locations'),
        int('sort', { min: 0, max: 10000 }),
        bool('archived'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_shift_types_name ON shift_types (entity, name COLLATE NOCASE)'],
    );

    make(
      'shift_patterns',
      [
        rel('entity', 'entities', { required: true }),
        req('name', 80),
        int('cycle', { min: 1, max: 56 }),
        json('days', 4000),
        txt('note', 400),
        bool('archived'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_shift_patterns_name ON shift_patterns (entity, name COLLATE NOCASE)'],
    );

    make(
      'shift_assignments',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('day', true),
        rel('shift_type', 'shift_types', { required: true }),
        rel('location', 'locations'),
        sel('status', ['draft', 'published', 'removed'], true),
        json('published', 2000),
        sel('source', ['manual', 'pattern', 'copy', 'request', 'agent']),
        txt('note', 400),
        rel('changed_by', 'members'),
        date('published_at'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_shift_assign_day ON shift_assignments (employment, day)', 'CREATE INDEX idx_shift_assign_status ON shift_assignments (day, status)'],
    );

    make(
      'shift_requests',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        sel('kind', ['change', 'swap'], true),
        day('from_day', true),
        day('to_day'),
        rel('shift_type', 'shift_types'),
        rel('swap_with', 'employments'),
        day('swap_day'),
        txt('reason', 2000),
        sel('status', ['awaiting_peer', 'pending', 'approved', 'rejected', 'declined', 'cancelled'], true),
        rel('approval', 'approvals'),
        rel('requester', 'members'),
        txt('peer_note', 1000),
        txt('decided_note', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_shift_requests_emp ON shift_requests (employment, status)', 'CREATE INDEX idx_shift_requests_peer ON shift_requests (swap_with, status)'],
    );

    /* ----------------------------------------------------------- kiosk */

    make(
      'kiosk_devices',
      [
        rel('location', 'locations', { required: true, cascadeDelete: true }),
        req('name', 80),
        req('token_hash', 64),
        rel('created_by', 'members'),
        date('last_seen'),
        bool('revoked'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_kiosk_devices_token ON kiosk_devices (token_hash)', 'CREATE INDEX idx_kiosk_devices_location ON kiosk_devices (location)'],
    );

    // Personal kiosk PINs: bcrypt passwords of hidden auth records (never readable through the API).
    const pins = new Collection({
      type: 'auth',
      name: 'kiosk_pins',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: null,
      manageRule: null,
      passwordAuth: { enabled: false, identityFields: ['email'] },
      fields: [rel('employee', 'employees', { required: true, cascadeDelete: true }), rel('set_by', 'members'), date('set_at'), int('fails', { min: 0 }), date('locked_until')].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_kiosk_pins_employee ON kiosk_pins (employee)'],
    });
    app.save(pins);

    /* ---------------------------------------------------------- punches */

    make(
      'checkins',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        date('at'),
        day('day', true),
        sel('kind', ['in', 'out', 'break_start', 'break_end'], true),
        sel('source', ['web', 'phone', 'kiosk', 'import', 'agent', 'manual', 'request'], true),
        rel('location', 'locations'),
        num('lat', { min: -90, max: 90 }),
        num('lng', { min: -180, max: 180 }),
        int('accuracy_m', { min: 0 }),
        int('distance_m', { min: 0 }),
        bool('flagged'),
        json('flags', 2000),
        txt('note', 500),
        txt('device', 120),
        rel('by_member', 'members'),
        bool('voided'),
        txt('void_reason', 500),
        rel('voided_by', 'members'),
        date('voided_at'),
      ].concat(stamps),
      ['CREATE INDEX idx_checkins_emp_at ON checkins (employment, at)', 'CREATE INDEX idx_checkins_day ON checkins (day)'],
    );
    const ck = app.findCollectionByNameOrId('checkins');
    ck.fields.add(new RelationField({ name: 'replaces', collectionId: ck.id, maxSelect: 1, cascadeDelete: false }));
    app.save(ck);

    /* ------------------------------------------------------- attendance */

    make(
      'attendance',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('day', true),
        sel('status', ['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'remote', 'on_duty'], true),
        sel('day_kind', ['work', 'rest', 'holiday']),
        rel('shift_type', 'shift_types'),
        date('first_in'),
        date('last_out'),
        int('worked_min', { min: 0 }),
        int('break_min', { min: 0 }),
        int('expected_min', { min: 0 }),
        int('late_min', { min: 0 }),
        int('early_min', { min: 0 }),
        int('overtime_min', { min: 0 }),
        int('night_min', { min: 0 }),
        txt('leave_type', 40),
        txt('leave_half', 2),
        int('leave_min', { min: 0 }),
        sel('source', ['auto', 'manual', 'request', 'import'], true),
        bool('locked'),
        txt('payrun', 30),
        json('flags', 2000),
        txt('note', 1000),
        date('computed_at'),
        rel('by_member', 'members'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_attendance_day ON attendance (employment, day)', 'CREATE INDEX idx_attendance_status ON attendance (day, status)', "CREATE INDEX idx_attendance_payrun ON attendance (payrun) WHERE payrun != ''"],
    );

    make(
      'attendance_requests',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        sel('kind', ['missed_punch', 'remote', 'on_duty', 'correction'], true),
        day('from_day', true),
        day('to_day'),
        bool('half_day'),
        hhmm('in_time'),
        hhmm('out_time'),
        int('break_min', { min: 0, max: 600 }),
        txt('reason', 2000),
        sel('status', ['pending', 'approved', 'rejected', 'cancelled'], true),
        rel('approval', 'approvals'),
        rel('requester', 'members'),
        txt('decided_note', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_attendance_requests_emp ON attendance_requests (employment, status)'],
    );

    /* ------------------------------------------------------- timesheets */

    make(
      'timesheets',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('period_start', true),
        day('period_end', true),
        sel('status', ['draft', 'submitted', 'approved', 'rejected'], true),
        sel('basis', ['attendance', 'manual']),
        int('regular_min', { min: 0 }),
        int('overtime_min', { min: 0 }),
        int('leave_min', { min: 0 }),
        int('holiday_min', { min: 0 }),
        int('total_min', { min: 0 }),
        json('exceptions', 20000),
        txt('note', 2000),
        rel('approval', 'approvals'),
        date('submitted_at'),
        date('decided_at'),
        txt('decided_note', 2000),
        bool('locked'),
        txt('payrun', 30),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_timesheets_period ON timesheets (employment, period_start)', 'CREATE INDEX idx_timesheets_status ON timesheets (status, period_start)'],
    );

    make(
      'timesheet_entries',
      [
        rel('timesheet', 'timesheets', { required: true, cascadeDelete: true }),
        day('day', true),
        sel('kind', ['regular', 'overtime', 'leave', 'holiday'], true),
        int('minutes', { min: 0, max: 1440 }),
        txt('project', 120),
        txt('task', 120),
        txt('note', 500),
        sel('source', ['attendance', 'person', 'agent'], true),
        int('sort', { min: 0, max: 100000 }),
      ].concat(stamps),
      ['CREATE INDEX idx_timesheet_entries ON timesheet_entries (timesheet, day)'],
    );

    /* --------------------------------------------------------- overtime */

    make(
      'overtime_rules',
      [
        rel('entity', 'entities', { required: true }),
        req('name', 120),
        cc('country'),
        json('rules', 20000),
        json('settings', 4000),
        json('caps', 4000),
        json('applies', 4000),
        bool('active'),
        sel('source', ['builtin', 'person', 'agent']),
        txt('notes', 4000),
      ].concat(stamps),
      ['CREATE INDEX idx_overtime_rules_entity ON overtime_rules (entity, active)'],
    );

    make(
      'overtime_requests',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('day', true),
        int('minutes', { min: 1, max: 1440 }),
        int('approved_min', { min: 0, max: 1440 }),
        txt('reason', 2000),
        sel('status', ['pending', 'approved', 'rejected', 'cancelled'], true),
        rel('approval', 'approvals'),
        rel('requester', 'members'),
        txt('decided_note', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_overtime_requests_emp ON overtime_requests (employment, day)'],
    );

    /* ------------------------------------------- default approval flows */

    const flows = app.findCollectionByNameOrId('approval_flows');
    for (const kind of ['attendance_request', 'shift_request', 'timesheet', 'overtime']) {
      const r = new Record(flows);
      r.set('kind', kind);
      r.set('steps', [{ type: 'manager' }]);
      r.set('auto', {});
      r.set('active', true);
      r.set('note', 'Default: the person\'s manager decides (administrators when there is none).');
      app.save(r);
    }
  },
  (app) => {
    for (const kind of ['attendance_request', 'shift_request', 'timesheet', 'overtime']) {
      for (const r of app.findRecordsByFilter('approval_flows', 'kind = {:k}', '', 0, 0, { k: kind })) app.delete(r);
    }
    for (const n of ['overtime_requests', 'overtime_rules', 'timesheet_entries', 'timesheets', 'attendance_requests', 'attendance', 'checkins', 'kiosk_pins', 'kiosk_devices', 'shift_requests', 'shift_assignments', 'shift_patterns', 'shift_types']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
