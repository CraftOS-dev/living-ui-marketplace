/// <reference path="../pb_data/types.d.ts" />
/**
 * v2 release (plan §28, P6): move v1 data onto the v2 model once, at upgrade.
 * At runtime this already happens on each machine's next report; doing it here
 * means a machine whose monitor is offline doesn't keep showing the old issues
 * next to their v2 replacements (found testing the upgrade on a copy of real v1 data).
 *
 * - v1 host rules a v2 check replaced → resolved "Replaced by the newer check"
 *   (the list is services/v2.js SUPERSEDED at release time);
 * - v1 activity rules (new programs, logins, connections) → resolved "Moved to
 *   Activity": v2 records these as things to review, not as issues.
 * Nothing is deleted; the notes say what happened.
 */
migrate(
  (app) => {
    const SUPERSEDED = {
      'HOST-003': 'HST-SSH-PASSWORD', 'DEV-002': 'HST-FIREWALL-OFF', 'HOST-007': 'UPD-OS-SECURITY', 'RES-002': 'NS-MONITOR-SILENT',
      'CLD-001': 'CLD-ADMIN-PORT-OPEN', 'CLD-005': 'CLD-VOLUME-UNENCRYPTED', 'CLD-006': 'CLD-IMDS-V1',
    };
    const ACTIVITY = ['HOST-006', 'HOST-008', 'HOST-009', 'NET-007'];
    const now = new Date().toISOString().replace('T', ' ');
    const hostIds = {};
    for (const a of app.findRecordsByFilter('assets', 'kind = "host"', '', 0, 0)) hostIds[a.id] = true;
    const open = app.findRecordsByFilter('findings', 'status = "open" || status = "acknowledged"', '', 0, 0);
    for (const f of open) {
      if (!hostIds[f.getString('asset')]) continue;
      const rule = f.getString('rule_id');
      let note = '';
      if (SUPERSEDED[rule]) note = `Replaced by the newer check ${SUPERSEDED[rule]} (NetSentry v2).`;
      else if (ACTIVITY.indexOf(rule) >= 0) note = 'Moved to Activity: NetSentry v2 lists this as something to review, not an issue.';
      if (!note) continue;
      f.set('status', 'resolved');
      f.set('resolved_at', now);
      f.set('status_note', note);
      f.set('status_by', 'upgrade to v2');
      app.save(f);
    }
  },
  () => {
    // Nothing to undo: the old issues were resolved with a note, not changed or deleted.
  },
);
