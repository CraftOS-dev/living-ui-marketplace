/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 — one server (docs/SYSTEM-V4-PLAN.md §0.1): NetSentry looks after the server it runs on, and
 * nothing else. Existing data is moved onto that, once, at upgrade. Nothing is deleted except the
 * schedules of checks that no longer exist; everything else keeps a note saying what happened.
 *
 * - domains, subdomains and IP addresses people added to watch → retired, their open issues resolved;
 * - issues from checks v4 removed (outside watching, other machines on the network) → resolved;
 * - "a program started accepting connections" (HOST-004) → resolved "Moved to Activity" (v4 lists it
 *   there to review, as v2 already did for new programs and users);
 * - the schedules (sources) of removed collectors → deleted (they would only fail);
 * - `help_requests`: questions a person asked the agent from Home, and its answers (§5.1 "Ask the agent").
 */
migrate(
  (app) => {
    const now = new Date().toISOString().replace('T', ' ');
    const OUTSIDE_RULES = ['EXP-001', 'EXP-002', 'EXP-003', 'DNS-001', 'DNS-002', 'MAIL-001', 'CT-001', 'CT-002', 'TLS-001', 'REG-001', 'REP-001', 'WEB-001', 'WEB-003', 'WEB-004'];
    const GONE_CHECKS = ['NS-UNMONITORED-MACHINE', 'NS-MODEL-DISAGREES'];
    const GONE_COLLECTORS = ['dns', 'ct', 'rdap', 'internetdb', 'reputation', 'web', 'host.networks', 'probe.discovery'];

    const outside = {};
    for (const a of app.findRecordsByFilter('assets', 'kind != "host"', '', 0, 0)) {
      outside[a.id] = true;
      if (a.getString('status') !== 'retired') {
        a.set('status', 'retired');
        app.save(a);
      }
    }
    for (const f of app.findRecordsByFilter('findings', 'status = "open" || status = "acknowledged"', '', 0, 0)) {
      const rule = f.getString('rule_id');
      let note = '';
      if (outside[f.getString('asset')] || OUTSIDE_RULES.indexOf(rule) >= 0) note = 'NetSentry now looks after the server it runs on only (v4); outside websites and addresses are no longer watched.';
      else if (GONE_CHECKS.indexOf(rule) >= 0) note = 'NetSentry now looks after one server (v4); this check was about other machines on the network.';
      else if (rule === 'HOST-004') note = 'Moved to Activity: v4 lists a new program accepting connections as something to review, not an issue.';
      if (!note) continue;
      f.set('status', 'resolved');
      f.set('resolved_at', now);
      f.set('status_note', note);
      f.set('status_by', 'upgrade to v4');
      app.save(f);
    }
    for (const s of app.findRecordsByFilter('sources', 'id != ""', '', 0, 0)) {
      if (GONE_COLLECTORS.indexOf(s.getString('collector')) >= 0 || outside[s.getString('target')]) app.delete(s);
    }

    const PEOPLE = '@request.auth.collectionName = "users"';
    app.save(new Collection({
      type: 'base',
      name: 'help_requests',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'question', type: 'text', required: true, max: 1000 },
        { name: 'asked_by', type: 'text', max: 200 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['waiting', 'answered', 'withdrawn'] },
        { name: 'answer', type: 'text', max: 8000 },
        // remediation ids the agent prepared for a person to confirm
        { name: 'changes', type: 'json', maxSize: 4000 },
        { name: 'answered_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_help_requests_status ON help_requests (status, created)'],
    }));
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('help_requests'));
    } catch {
      /* already gone */
    }
    // The retired assets and resolved issues keep their notes; re-adding them is a person's choice.
  },
);
