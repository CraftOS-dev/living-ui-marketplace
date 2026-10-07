/// <reference path="../pb_data/types.d.ts" />
/**
 * speaker_names: the name of every voice the last detections found, by its
 * detection label ({"Person 1": "Person 1", "Person 2": "Aiko"}). Renaming a
 * speaker changes the value, so the name survives a later re-detection.
 */
migrate(
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.add(new JSONField({ name: 'speaker_names', maxSize: 65536 }));
    app.save(notes);
  },
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.removeByName('speaker_names');
    app.save(notes);
  },
);
