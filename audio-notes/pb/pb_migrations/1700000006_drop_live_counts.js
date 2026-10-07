/// <reference path="../pb_data/types.d.ts" />
/**
 * A recording is finished when none of its pieces is left; the piece
 * counters (live_total / live_done) could drift apart and are gone.
 */
migrate(
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.removeByName('live_total');
    notes.fields.removeByName('live_done');
    app.save(notes);
  },
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.add(new NumberField({ name: 'live_total', onlyInt: true }));
    notes.fields.add(new NumberField({ name: 'live_done', onlyInt: true }));
    app.save(notes);
  },
);
