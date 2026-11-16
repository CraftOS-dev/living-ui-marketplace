/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS reports schema (home-reports module).
 *
 * - report_cache: the per-person figures of the reports that read the time
 *   and leave engines (absence and overtime by month, leave balances on a
 *   day), computed company-wide once and kept with a fingerprint of their
 *   inputs. A report filters and adds them up at read time; the figures are
 *   computed again when the fingerprint changes (a closed month), or after
 *   20 minutes for the month that is still running. The warm-up job keeps
 *   the current month and today's balances ready. Nothing here is a source
 *   of truth: deleting a row only means it is computed again.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const c = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'report_cache',
          fields: [
            { name: 'key', type: 'text', required: true, max: 120 },
            { name: 'kind', type: 'select', maxSelect: 1, values: ['absence_month', 'leave_balances'], required: true },
            { name: 'period', type: 'text', max: 40 },
            { name: 'fingerprint', type: 'text', max: 4000 },
            { name: 'data', type: 'json', maxSize: 8000000 },
            { name: 'rows', type: 'number', onlyInt: true },
            { name: 'computed_at', type: 'text', max: 40 },
            { name: 'ms', type: 'number', onlyInt: true },
            { name: 'created', type: 'autodate', onCreate: true },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ],
          indexes: ['CREATE UNIQUE INDEX idx_report_cache_key ON report_cache (key)'],
        },
        closed,
      ),
    );
    app.save(c);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('report_cache'));
    } catch {
      /* already gone */
    }
  },
);
