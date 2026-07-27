/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — helpers must be
 * defined inside the handler (or require()d), never top-level.
 */

// READING A REQUEST BODY — the ONLY correct way in PB hooks:
//   const data = e.requestInfo().body;   // pre-parsed object
// NEVER use e.request.body / toString(e.request.body): that is a Go stream
// and reads as EMPTY, so your param checks will 400 on every request.

// habits.clear-entries — reset one habit's history (all its daily entries).
routerAdd('POST', '/api/ops/habits/clear-entries', (e) => {
  const habitId = String((e.requestInfo().body || {}).habit_id || '');
  if (habitId === '') {
    return e.json(400, { error: 'habit_id is required' });
  }
  const records = e.app.findRecordsByFilter('entries', `habit = "${habitId}"`, '', 0, 0);
  for (const record of records) {
    e.app.delete(record);
  }
  return e.json(200, { cleared: records.length });
});
