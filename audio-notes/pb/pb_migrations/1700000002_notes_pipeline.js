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
 * comma-joined attendees text (replaced by a string list). The existing
 * attendees and highlights are read before their columns go and written
 * back as lists.
 */

/** "Ana, Ben" -> ["Ana", "Ben"], without repeats. */
function attendeeList(text) {
  const out = [];
  const seen = {};
  for (const part of text.split(/[,;\n]/)) {
    const name = part.trim();
    if (name === '' || seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = true;
    out.push(name);
  }
  return out;
}

/** One point per line, list markers ("•", "-", "1.") dropped. */
function points(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/^\s*(?:[-*•‣◦]|\d{1,3}[.)])\s+/, '').trim();
    if (t !== '') out.push(t);
  }
  return out;
}

/**
 * key_highlights was a JSON list of sections ({ title, content }) or, in
 * the earliest notes, plain text. A section with its own title ("Risks")
 * prefixes its points with it; the default "Key Highlights" adds nothing.
 */
function keyPoints(text) {
  if (text.trim() === '') return [];
  let sections = null;
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) sections = v;
  } catch {
    /* plain text */
  }
  if (sections === null) return points(text);
  let out = [];
  for (const s of sections) {
    if (typeof s === 'string') {
      out = out.concat(points(s));
      continue;
    }
    if (s === null || typeof s !== 'object') continue;
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    const body = points(typeof s.content === 'string' ? s.content : '');
    const named = title !== '' && !/^key highlights?$/i.test(title);
    if (body.length === 0 && named) out.push(title);
    for (const p of body) out.push(named ? title + ': ' + p : p);
  }
  return out;
}

migrate(
  (app) => {
    const legacy = arrayOf(new DynamicModel({ id: '', attendees: '', key_highlights: '' }));
    app
      .db()
      .newQuery("SELECT id, COALESCE(attendees, '') AS attendees, COALESCE(key_highlights, '') AS key_highlights FROM sessions")
      .all(legacy);

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

    // Plain SQL: the notes keep their `updated` time and no hooks run.
    for (const row of legacy) {
      app
        .db()
        .newQuery('UPDATE notes SET attendees = {:attendees}, key_points = {:key_points} WHERE id = {:id}')
        .bind({
          id: row.id,
          attendees: JSON.stringify(attendeeList(row.attendees)),
          key_points: JSON.stringify(keyPoints(row.key_highlights)),
        })
        .execute();
    }
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
