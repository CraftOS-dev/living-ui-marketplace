/// <reference path="../pb_data/types.d.ts" />
/**
 * Live transcription while recording.
 *
 * The recorder cuts the audio at pauses into short 16 kHz WAV pieces and
 * uploads each one as a `live_chunks` record; the live worker transcribes
 * them in order and appends the segments to the note. A note being recorded
 * is `live`; after Stop it is `finishing` until every piece it sent
 * (`live_total`) has been transcribed (`live_done`), then `done` /
 * `no_speech`. Pieces are deleted once transcribed (and with their note).
 */
migrate(
  (app) => {
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.getByName('transcript_status').values = ['queued', 'processing', 'done', 'no_speech', 'failed', 'live', 'finishing'];
    notes.fields.add(new NumberField({ name: 'live_total', onlyInt: true }));
    notes.fields.add(new NumberField({ name: 'live_done', onlyInt: true }));
    app.save(notes);

    const chunks = new Collection({
      type: 'base',
      name: 'live_chunks',
      // authMode none: the app's own page uploads pieces; only the worker
      // (which bypasses rules) changes or deletes them.
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'note', type: 'relation', collectionId: notes.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: 'seq', type: 'number', onlyInt: true },
        { name: 'offset', type: 'number' },
        { name: 'audio', type: 'file', maxSelect: 1, maxSize: 20971520, required: true },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(chunks);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('live_chunks'));
    const notes = app.findCollectionByNameOrId('notes');
    notes.fields.removeByName('live_total');
    notes.fields.removeByName('live_done');
    notes.fields.getByName('transcript_status').values = ['queued', 'processing', 'done', 'no_speech', 'failed'];
    app.save(notes);
  },
);
