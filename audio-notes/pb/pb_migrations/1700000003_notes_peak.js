/// <reference path="../pb_data/types.d.ts" />
/**
 * peak_db: the loudest moment of a note's audio in dBFS, measured by ffmpeg
 * when the audio is converted for transcription (0 until measured). A value
 * at the 16-bit floor (-91 dB) means the file is digital silence: nothing
 * reached the recorder, which the app reports as such instead of "no speech".
 */
migrate(
  (app) => {
    const n = app.findCollectionByNameOrId('notes');
    n.fields.add(new NumberField({ name: 'peak_db' }));
    app.save(n);
  },
  (app) => {
    const n = app.findCollectionByNameOrId('notes');
    n.fields.removeByName('peak_db');
    app.save(n);
  },
);
