/// <reference path="../pb_data/types.d.ts" />
/**
 * A song made from a recording with music also keeps the voice and the
 * music separated from it (on the person's computer, before upload), so
 * practice can play either alone:
 *
 *   backing_voice  the singer alone (Ogg Opus, or WAV where the browser
 *                  cannot write Opus)
 *   backing_music  everything but the singer
 */
migrate(
  (app) => {
    const songs = app.findCollectionByNameOrId('songs');
    songs.fields.add(new FileField({ name: 'backing_voice', maxSelect: 1, maxSize: 83886080 }));
    songs.fields.add(new FileField({ name: 'backing_music', maxSelect: 1, maxSize: 83886080 }));
    app.save(songs);
  },
  (app) => {
    const songs = app.findCollectionByNameOrId('songs');
    songs.fields.removeByName('backing_voice');
    songs.fields.removeByName('backing_music');
    app.save(songs);
  },
);
