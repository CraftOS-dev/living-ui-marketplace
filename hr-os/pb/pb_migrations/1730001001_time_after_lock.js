/// <reference path="../pb_data/types.d.ts" />
/**
 * Punches are never refused, also on a day a locked pay run already used.
 * Such a day keeps what was paid; beside it the attendance row holds:
 * - after_lock: the day as worked out again after the lock (attendance values), or null
 * - adjusted_after_lock: the day now differs from what was paid (an open adjustment
 *   that payInputs lists for the next run)
 * - adjust_log: the adjustments later runs paid [{ payrun, at, values }]
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('attendance');
    c.fields.add(new JSONField({ name: 'after_lock', maxSize: 4000 }));
    c.fields.add(new BoolField({ name: 'adjusted_after_lock' }));
    c.fields.add(new JSONField({ name: 'adjust_log', maxSize: 20000 }));
    c.addIndex('idx_attendance_adjusted', false, 'employment, day', 'adjusted_after_lock = TRUE');
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('attendance');
    c.removeIndex('idx_attendance_adjusted');
    for (const n of ['after_lock', 'adjusted_after_lock', 'adjust_log']) {
      try {
        c.fields.removeByName(n);
      } catch {
        /* already gone */
      }
    }
    app.save(c);
  },
);
