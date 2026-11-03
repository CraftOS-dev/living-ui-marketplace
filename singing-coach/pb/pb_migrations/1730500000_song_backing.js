/// <reference path="../pb_data/types.d.ts" />
/**
 * A song made from a recording keeps the recording as its backing track:
 *
 *   backing      the audio file the person uploaded (mp3, wav, m4a, ogg,
 *                flac or webm; checked by extension in songs.backing)
 *   backing_map  where the song sits in it: {bpm, beats (seconds of every
 *                beat found), downbeat (the beat that is bar 1, beat 1),
 *                beat_q (quarter notes a beat), bar1_q (where bar 1 starts
 *                in the song, in quarter notes), duration, channels,
 *                source ('mix' or 'voice')}
 */
migrate(
  (app) => {
    const songs = app.findCollectionByNameOrId('songs');
    songs.fields.add(new FileField({ name: 'backing', maxSelect: 1, maxSize: 83886080 }));
    songs.fields.add(new JSONField({ name: 'backing_map', maxSize: 600000 }));
    app.save(songs);
  },
  (app) => {
    const songs = app.findCollectionByNameOrId('songs');
    songs.fields.removeByName('backing');
    songs.fields.removeByName('backing_map');
    app.save(songs);
  },
);
