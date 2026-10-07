/// <reference path="../pb_data/types.d.ts" />
/**
 * Notes pipeline schema.
 *
 * `sessions` becomes `notes`: one record per recording, upload or pasted
 * transcript. Audio is transcribed on this machine (engine/: ffmpeg +
 * whisper.cpp) by the background worker, then CraftBot's LLM writes the
 * structured notes. The worker owns the two status fields (empty = that
 * step never ran); everything a person types is plain data.
 *
 * Removed: audio_url, share_token, is_shared (never used), audio_format
 * (the stored file carries its type), key_highlights (free-form section
 * blobs; replaced by key_points + decisions as string lists), and the
 * comma-joined attendees text (replaced by a string list).
 */
migrate(
  (app) => {
    const notes = app.findCollectionByNameOrId('sessions');
    notes.name = 'notes';

    notes.fields.getByName('is_starred').name = 'starred';
    notes.fields.getByName('meeting_notes').name = 'my_notes';

    for (const name of ['audio_url', 'share_token', 'is_shared', 'audio_format', 'key_highlights', 'attendees']) {
      notes.fields.removeByName(name);
    }
    app.save(notes);

    const n = app.findCollectionByNameOrId('notes');

    // Limits: a two-hour meeting is ~120k characters of transcript and a few
    // thousand segments; the audio field also takes video files (a meeting
    // recording's soundtrack is transcribed the same way).
    n.fields.getByName('title').max = 200;
    n.fields.getByName('transcript').max = 2000000;
    n.fields.getByName('overview').max = 20000;
    n.fields.getByName('summary').max = 20000;
    n.fields.getByName('my_notes').max = 200000;
    n.fields.getByName('audio').maxSize = 2147483648;

    // true while the title is one the app made up ("Recording, 6 Oct 10:26",
    // a file name); the AI may replace it. Any edit by a person clears it.
    n.fields.add(new BoolField({ name: 'title_auto' }));
    n.fields.add(new SelectField({ name: 'source', values: ['recording', 'upload', 'import', 'text'], maxSelect: 1 }));
    n.fields.add(new TextField({ name: 'language', max: 10 }));
    n.fields.add(new TextField({ name: 'detected_language', max: 10 }));
    n.fields.add(
      new SelectField({
        name: 'transcript_status',
        values: ['queued', 'processing', 'done', 'no_speech', 'failed'],
        maxSelect: 1,
      }),
    );
    n.fields.add(new TextField({ name: 'transcript_error', max: 2000 }));
    n.fields.add(new JSONField({ name: 'segments', maxSize: 16777216 }));
    n.fields.add(
      new SelectField({
        name: 'notes_status',
        values: ['queued', 'processing', 'done', 'failed'],
        maxSelect: 1,
      }),
    );
    n.fields.add(new TextField({ name: 'notes_error', max: 2000 }));
    n.fields.add(new JSONField({ name: 'key_points', maxSize: 1048576 }));
    n.fields.add(new JSONField({ name: 'decisions', maxSize: 1048576 }));
    n.fields.add(new JSONField({ name: 'attendees', maxSize: 262144 }));
    app.save(n);
  },
  (app) => {
    const n = app.findCollectionByNameOrId('notes');
    for (const name of [
      'title_auto',
      'source',
      'language',
      'detected_language',
      'transcript_status',
      'transcript_error',
      'segments',
      'notes_status',
      'notes_error',
      'key_points',
      'decisions',
      'attendees',
    ]) {
      n.fields.removeByName(name);
    }
    n.name = 'sessions';
    n.fields.getByName('starred').name = 'is_starred';
    n.fields.getByName('my_notes').name = 'meeting_notes';
    app.save(n);

    const s = app.findCollectionByNameOrId('sessions');
    s.fields.add(new TextField({ name: 'attendees', max: 500 }));
    s.fields.add(new TextField({ name: 'audio_format', max: 50 }));
    s.fields.add(new TextField({ name: 'audio_url', max: 10000 }));
    s.fields.add(new TextField({ name: 'key_highlights', max: 50000 }));
    s.fields.add(new TextField({ name: 'share_token', max: 100 }));
    s.fields.add(new BoolField({ name: 'is_shared' }));
    app.save(s);
  },
);
