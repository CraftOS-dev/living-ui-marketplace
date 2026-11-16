/// <reference path="../pb_data/types.d.ts" />
/**
 * Cashing in leave across a void and replace of a pay run:
 * - reserved_for: the replacement run that pays a cash-in released from a
 *   voided run (lib_leave.payInputs leaves it out; payroll's replacement pays
 *   it from the copy it made at void).
 * - pay_history: every payment and release [{ event: paid | released, payrun, replaced_by, at, note }].
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('leave_encash_requests');
    c.fields.add(new TextField({ name: 'reserved_for', max: 30 }));
    c.fields.add(new JSONField({ name: 'pay_history', maxSize: 20000 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('leave_encash_requests');
    for (const n of ['reserved_for', 'pay_history']) {
      try {
        c.fields.removeByName(n);
      } catch {
        /* already gone */
      }
    }
    app.save(c);
  },
);
