/// <reference path="../pb_data/types.d.ts" />
/**
 * Attendee recognition by CraftBot's AI (no name lists, no patterns).
 *
 *   people_found    every participant the AI has recognized in the transcript
 *   people_removed  names the user took off the attendee list; recognition
 *                   never adds them back (an explicit Auto-scan clears it)
 *   people_status   the scan queue (queued / processing / done / failed)
 *   people_scanned  how many transcript segments the scans have covered, so a
 *                   live recording is scanned in increments, not from the top
 */
migrate(
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.add(new JSONField({ name: 'people_found', maxSize: 262144 }));
    notes.fields.add(new JSONField({ name: 'people_removed', maxSize: 262144 }));
    notes.fields.add(new SelectField({ name: 'people_status', values: ['queued', 'processing', 'done', 'failed'], maxSelect: 1 }));
    notes.fields.add(new NumberField({ name: 'people_scanned', onlyInt: true }));
    app.save(notes);
  },
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    for (const name of ['people_found', 'people_removed', 'people_status', 'people_scanned']) notes.fields.removeByName(name);
    app.save(notes);
  },
);
