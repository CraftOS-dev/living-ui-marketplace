/// <reference path="../pb_data/types.d.ts" />
/**
 * Piano Coach: one person learning piano with their AI agent as coach.
 *
 *   settings  one row: practice goal, how strictly playing is judged, the
 *             input (MIDI piano, computer keyboard, screen keys,
 *             microphone), sound, what the coach may do
 *   songs     the library: ABC notation plus the model parsed from it,
 *             level, sections (phrases practised one at a time), a preview
 *             for the library tiles, the coach's note
 *   progress  one row per song: each section's stage (new, learning,
 *             steady, mastered), best clean tempo and next review date
 *   runs      every pass at the piano: mode, bars, hands, tempo, what was
 *             hit, missed and wrong, timing, per-bar detail
 *   sessions  practice sittings (closed after 20 quiet minutes) and the
 *             coach's review of each
 *   messages  the conversation with the coach: questions, song requests,
 *             replies and session reviews
 *   plans     a day's practice plan: from the app's rules, or proposed by
 *             the coach
 */
migrate(
  (app) => {
    const OPEN = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };

    const settings = new Collection({
      type: 'base',
      name: 'settings',
      ...OPEN,
      fields: [
        { name: 'name', type: 'text', max: 80 },
        { name: 'daily_minutes', type: 'number', min: 5, max: 240, onlyInt: true },
        { name: 'strictness', type: 'select', maxSelect: 1, values: ['lenient', 'normal', 'strict'] },
        { name: 'input', type: 'select', maxSelect: 1, values: ['midi', 'keyboard', 'screen', 'mic'] },
        { name: 'midi_device', type: 'text', max: 200 },
        { name: 'latency_ms', type: 'number', min: -300, max: 500 },
        { name: 'other_hand', type: 'bool' },
        { name: 'metronome', type: 'bool' },
        { name: 'count_in', type: 'bool' },
        { name: 'view', type: 'select', maxSelect: 1, values: ['roll', 'sheet'] },
        { name: 'note_names', type: 'bool' },
        { name: 'volume', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'click_volume', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'coach_reviews', type: 'bool' },
        { name: 'coach_plans', type: 'bool' },
        { name: 'level', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'onboarded', type: 'bool' },
        { name: 'seeded', type: 'bool' },
        { name: 'last_song', type: 'text', max: 15 },
        { name: 'coach_seen', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(settings);

    const songs = new Collection({
      type: 'base',
      name: 'songs',
      ...OPEN,
      fields: [
        { name: 'title', type: 'text', required: true, max: 160 },
        { name: 'composer', type: 'text', max: 160 },
        { name: 'level', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['piece', 'exercise'] },
        { name: 'abc', type: 'text', max: 400000 },
        { name: 'model', type: 'json', maxSize: 8000000 },
        { name: 'preview', type: 'json', maxSize: 40000 },
        { name: 'tempo', type: 'number', min: 20, max: 400 },
        { name: 'bars', type: 'number', onlyInt: true },
        { name: 'seconds', type: 'number' },
        { name: 'key_name', type: 'text', max: 40 },
        { name: 'meter', type: 'text', max: 12 },
        { name: 'hands', type: 'select', maxSelect: 1, values: ['both', 'right', 'left'] },
        { name: 'range', type: 'text', max: 20 },
        { name: 'notes_count', type: 'number', onlyInt: true },
        { name: 'sections', type: 'json', maxSize: 20000 },
        { name: 'tags', type: 'json', maxSize: 4000 },
        { name: 'source', type: 'select', maxSelect: 1, values: ['starter', 'agent', 'you', 'import'] },
        { name: 'starter_key', type: 'text', max: 40 },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'note_at', type: 'date' },
        { name: 'fav', type: 'bool' },
        { name: 'seen', type: 'bool' },
        { name: 'archived', type: 'bool' },
        { name: 'request', type: 'text', max: 15 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_songs_level ON songs (level)'],
    });
    app.save(songs);

    const progress = new Collection({
      type: 'base',
      name: 'progress',
      ...OPEN,
      fields: [
        { name: 'song', type: 'relation', required: true, collectionId: songs.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'sections', type: 'json', maxSize: 60000 },
        { name: 'last_at', type: 'date' },
        { name: 'minutes', type: 'number' },
        { name: 'runs', type: 'number', onlyInt: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_progress_song ON progress (song)'],
    });
    app.save(progress);

    const sessions = new Collection({
      type: 'base',
      name: 'sessions',
      ...OPEN,
      fields: [
        { name: 'day', type: 'text', max: 10 },
        { name: 'started', type: 'date' },
        { name: 'last_at', type: 'date' },
        { name: 'ended', type: 'date' },
        { name: 'minutes', type: 'number' },
        { name: 'runs', type: 'number', onlyInt: true },
        { name: 'songs', type: 'json', maxSize: 20000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['open', 'closed'] },
        { name: 'review', type: 'text', max: 6000 },
        { name: 'review_at', type: 'date' },
        { name: 'review_asked', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_sessions_day ON sessions (day)'],
    });
    app.save(sessions);

    const runs = new Collection({
      type: 'base',
      name: 'runs',
      ...OPEN,
      fields: [
        { name: 'song', type: 'relation', required: true, collectionId: songs.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'session', type: 'relation', collectionId: sessions.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'day', type: 'text', max: 10 },
        { name: 'mode', type: 'select', maxSelect: 1, values: ['listen', 'learn', 'play'] },
        { name: 'from_bar', type: 'number', onlyInt: true },
        { name: 'to_bar', type: 'number', onlyInt: true },
        { name: 'hands', type: 'select', maxSelect: 1, values: ['both', 'right', 'left'] },
        { name: 'tempo_pct', type: 'number', min: 10, max: 200 },
        { name: 'bpm', type: 'number' },
        { name: 'duration_ms', type: 'number' },
        { name: 'expected', type: 'number', onlyInt: true },
        { name: 'hits', type: 'number', onlyInt: true },
        { name: 'wrong', type: 'number', onlyInt: true },
        { name: 'missed', type: 'number', onlyInt: true },
        { name: 'accuracy', type: 'number', min: 0, max: 1 },
        { name: 'timing_mad', type: 'number' },
        { name: 'timing_bias', type: 'number' },
        { name: 'clean', type: 'bool' },
        { name: 'cold', type: 'bool' },
        { name: 'complete', type: 'bool' },
        { name: 'per_bar', type: 'json', maxSize: 400000 },
        { name: 'results', type: 'json', maxSize: 40000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_runs_day ON runs (day)', 'CREATE INDEX idx_runs_song ON runs (song)'],
    });
    app.save(runs);

    const messages = new Collection({
      type: 'base',
      name: 'messages',
      ...OPEN,
      fields: [
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['you', 'coach'] },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['chat', 'request', 'review', 'plan'] },
        { name: 'text', type: 'text', max: 20000 },
        { name: 'song', type: 'text', max: 15 },
        { name: 'session', type: 'text', max: 15 },
        { name: 'reply_to', type: 'text', max: 15 },
        { name: 'context', type: 'json', maxSize: 8000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'answered', 'failed'] },
        { name: 'request_id', type: 'text', max: 15 },
        { name: 'error', type: 'text', max: 1000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(messages);

    const plans = new Collection({
      type: 'base',
      name: 'plans',
      ...OPEN,
      fields: [
        { name: 'day', type: 'text', required: true, max: 10 },
        { name: 'source', type: 'select', maxSelect: 1, values: ['rules', 'coach'] },
        { name: 'blocks', type: 'json', maxSize: 40000 },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['proposed', 'active', 'done'] },
        { name: 'done', type: 'json', maxSize: 4000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_plans_day ON plans (day)'],
    });
    app.save(plans);
  },
  (app) => {
    for (const name of ['plans', 'messages', 'runs', 'sessions', 'progress', 'songs', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
