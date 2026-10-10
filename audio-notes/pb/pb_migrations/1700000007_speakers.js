/// <reference path="../pb_data/types.d.ts" />
/**
 * People come from the voices (speaker detection), not from names an AI
 * read in the transcript.
 *
 *   people_error   why the last speaker detection failed ('' when it ran)
 *   speaker_count  how many people speak, when the user knows it (0 = detect)
 *
 * people_scanned (how far the AI had read the transcript) is gone.
 */
migrate(
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.removeByName('people_scanned');
    notes.fields.add(new TextField({ name: 'people_error', max: 2000 }));
    notes.fields.add(new NumberField({ name: 'speaker_count', onlyInt: true, min: 0, max: 20 }));
    app.save(notes);
  },
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.removeByName('people_error');
    notes.fields.removeByName('speaker_count');
    notes.fields.add(new NumberField({ name: 'people_scanned', onlyInt: true }));
    app.save(notes);
  },
);
