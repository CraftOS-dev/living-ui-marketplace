/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 */

// resumes.duplicate — duplicate a resume record by id
routerAdd('POST', '/api/ops/resumes/duplicate', (e) => {
  const body = e.requestInfo().body || {};
  const id = body.id;
  if (!id) {
    return e.json(400, { error: 'Missing required field: id' });
  }

  const record = e.app.findRecordById('resume_state', id);
  if (!record) {
    return e.json(404, { error: 'Resume not found' });
  }

  const collection = e.app.findCollectionByNameOrId('resume_state');
  const clone = new Record(collection);
  clone.set('title', `${record.get('title')} (Copy)`);
  clone.set('data', record.get('data'));
  clone.set('user_id', record.get('user_id'));
  e.app.save(clone);

  return e.json(200, {
    success: true,
    id: clone.id,
    title: clone.get('title')
  });
});
