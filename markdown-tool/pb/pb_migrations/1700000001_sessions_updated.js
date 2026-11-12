/// <reference path="../pb_data/types.d.ts" />
/**
 * The editor session gets an `updated` autodate, so the session's `updatedAt`
 * (apiAdapter.ts toSessionDict, V1's EditorSession.updated_at) says when the
 * editor last saved it. The first migration's Collection constructor added
 * no autodate fields.
 */
migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId('sessions');
    sessions.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
    app.save(sessions);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId('sessions');
    sessions.fields.removeByName('updated');
    app.save(sessions);
  },
);
