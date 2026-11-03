/// <reference path="../pb_data/types.d.ts" />
/**
 * Singing Coach: one person learning to sing with their AI agent as coach.
 *
 *   settings  one row: daily goal, how strictly singing is judged, how much
 *             live feedback, syllables, the guide voice and sound, the
 *             microphone and timing, health check-ins, what the coach may do
 *   voice     every range test: lowest and highest notes held, the
 *             comfortable range, voice family, passaggio estimate, sustain
 *   songs     the library: ABC notation with lyrics plus the model parsed
 *             from it, level, language, licence, sections, the coach's note
 *   progress  one row per song: each section's stage (new, learning, steady,
 *             mastered), best clean tempo, next review, the key it is sung in
 *   sessions  practice sittings (closed after 20 quiet minutes), voiced time
 *             and vocal dose, and the coach's review of each
 *   runs      every take: mode, bars, key, tempo, notes on / close / off /
 *             missed, cents bias, timing, steadiness, vibrato, scoops, per
 *             phrase and per note detail
 *   tracks    the pitch track of a take (and its audio, only when the person
 *             keeps recordings), for replay
 *   checkins  how the voice feels: hoarseness, effort, discomfort, lost high
 *             notes, throat clearing, pain
 *   messages  the conversation with the coach
 *   plans     a day's practice plan, from the app's rules or the coach
 *   lessons, skills, drills  the curriculum: finished lessons, drilled skills
 *             with mastery and level, and every drill run
 */
migrate(
  (app) => {
    const OPEN = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };
    const stamp = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    const settings = new Collection({
      type: 'base',
      name: 'settings',
      ...OPEN,
      fields: [
        { name: 'name', type: 'text', max: 80 },
        { name: 'daily_minutes', type: 'number', min: 5, max: 180, onlyInt: true },
        { name: 'session_cap', type: 'number', min: 0, max: 120, onlyInt: true },
        { name: 'strictness', type: 'select', maxSelect: 1, values: ['lenient', 'normal', 'strict'] },
        { name: 'feedback', type: 'select', maxSelect: 1, values: ['auto', 'full', 'after'] },
        { name: 'syllables', type: 'select', maxSelect: 1, values: ['movable', 'fixed', 'numbers', 'letters', 'neutral'] },
        { name: 'minor_do', type: 'select', maxSelect: 1, values: ['la', 'do'] },
        { name: 'clef', type: 'select', maxSelect: 1, values: ['auto', 'treble', 'treble8', 'bass'] },
        { name: 'guide', type: 'select', maxSelect: 1, values: ['voice', 'piano', 'start', 'off'] },
        { name: 'vowel', type: 'select', maxSelect: 1, values: ['oo', 'ah'] },
        { name: 'volume', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'guide_volume', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'accomp_volume', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'click_volume', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'drone', type: 'bool' },
        { name: 'metronome', type: 'bool' },
        { name: 'count_in', type: 'bool' },
        { name: 'view', type: 'select', maxSelect: 1, values: ['lane', 'sheet'] },
        { name: 'output', type: 'select', maxSelect: 1, values: ['wired', 'bluetooth', 'speakers'] },
        { name: 'latency_ms', type: 'number', min: -200, max: 600 },
        { name: 'noise_db', type: 'number', min: -120, max: 0 },
        { name: 'input_device', type: 'text', max: 200 },
        { name: 'under18', type: 'bool' },
        { name: 'checkins', type: 'bool' },
        { name: 'keep_recordings', type: 'bool' },
        { name: 'rest_day', type: 'number', min: -1, max: 6, onlyInt: true },
        { name: 'coach_reviews', type: 'bool' },
        { name: 'coach_plans', type: 'bool' },
        { name: 'level', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'onboarded', type: 'bool' },
        { name: 'seeded', type: 'bool' },
        { name: 'last_song', type: 'text', max: 15 },
        { name: 'coach_seen', type: 'date' },
        ...stamp,
      ],
    });
    app.save(settings);

    const voice = new Collection({
      type: 'base',
      name: 'voice',
      ...OPEN,
      fields: [
        { name: 'kind', type: 'select', maxSelect: 1, values: ['onboarding', 'quick', 'full', 'manual'] },
        { name: 'speaking_hz', type: 'number', min: 0, max: 1000 },
        { name: 'low', type: 'number', min: 0, max: 127 },
        { name: 'high', type: 'number', min: 0, max: 127 },
        { name: 'comf_low', type: 'number', min: 0, max: 127 },
        { name: 'comf_high', type: 'number', min: 0, max: 127 },
        { name: 'family', type: 'select', maxSelect: 1, values: ['high', 'medium', 'low'] },
        { name: 'clef', type: 'select', maxSelect: 1, values: ['treble', 'treble8', 'bass'] },
        { name: 'passaggio', type: 'json', maxSize: 4000 },
        { name: 'breaks', type: 'json', maxSize: 20000 },
        { name: 'sustain_s', type: 'number', min: 0, max: 120 },
        { name: 'note', type: 'text', max: 400 },
        ...stamp,
      ],
    });
    app.save(voice);

    const songs = new Collection({
      type: 'base',
      name: 'songs',
      ...OPEN,
      fields: [
        { name: 'title', type: 'text', required: true, max: 160 },
        { name: 'composer', type: 'text', max: 160 },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['song', 'vocalise'] },
        { name: 'level', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'abc', type: 'text', max: 400000 },
        { name: 'model', type: 'json', maxSize: 8000000 },
        { name: 'preview', type: 'json', maxSize: 40000 },
        { name: 'language', type: 'text', max: 12 },
        { name: 'licence', type: 'select', maxSelect: 1, values: ['pd', 'trad', 'own', 'import'] },
        { name: 'source_note', type: 'text', max: 400 },
        { name: 'voicing', type: 'select', maxSelect: 1, values: ['high', 'medium', 'low', 'any'] },
        { name: 'tempo', type: 'number', min: 20, max: 400 },
        { name: 'bars', type: 'number', onlyInt: true },
        { name: 'seconds', type: 'number' },
        { name: 'key_name', type: 'text', max: 40 },
        { name: 'meter', type: 'text', max: 12 },
        { name: 'low', type: 'number', onlyInt: true },
        { name: 'high', type: 'number', onlyInt: true },
        { name: 'span', type: 'number', onlyInt: true },
        { name: 'median', type: 'number', onlyInt: true },
        { name: 'tessitura', type: 'text', max: 20 },
        { name: 'phrases', type: 'number', onlyInt: true },
        { name: 'longest_phrase_s', type: 'number' },
        { name: 'syllables', type: 'number', onlyInt: true },
        { name: 'verses', type: 'number', onlyInt: true },
        { name: 'first_words', type: 'text', max: 200 },
        { name: 'accompanied', type: 'bool' },
        { name: 'sections', type: 'json', maxSize: 20000 },
        { name: 'tags', type: 'json', maxSize: 4000 },
        { name: 'source', type: 'select', maxSelect: 1, values: ['starter', 'agent', 'you', 'import'] },
        { name: 'starter_key', type: 'text', max: 40 },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'note_at', type: 'date' },
        { name: 'gloss', type: 'text', max: 6000 },
        { name: 'fav', type: 'bool' },
        { name: 'seen', type: 'bool' },
        { name: 'archived', type: 'bool' },
        { name: 'request', type: 'text', max: 15 },
        ...stamp,
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
        { name: 'key_shift', type: 'number', min: -12, max: 12, onlyInt: true },
        { name: 'sections', type: 'json', maxSize: 60000 },
        { name: 'by_key', type: 'json', maxSize: 200000 },
        { name: 'last_at', type: 'date' },
        { name: 'minutes', type: 'number' },
        { name: 'runs', type: 'number', onlyInt: true },
        ...stamp,
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
        { name: 'voiced_s', type: 'number' },
        { name: 'cycles', type: 'number' },
        { name: 'runs', type: 'number', onlyInt: true },
        { name: 'songs', type: 'json', maxSize: 20000 },
        { name: 'warmup_s', type: 'number' },
        { name: 'cooldown_s', type: 'number' },
        { name: 'pain', type: 'bool' },
        { name: 'status', type: 'select', maxSelect: 1, values: ['open', 'closed'] },
        { name: 'review', type: 'text', max: 6000 },
        { name: 'review_at', type: 'date' },
        { name: 'review_asked', type: 'bool' },
        ...stamp,
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
        { name: 'mode', type: 'select', maxSelect: 1, values: ['listen', 'echo', 'sing', 'solo'] },
        { name: 'from_bar', type: 'number', onlyInt: true },
        { name: 'to_bar', type: 'number', onlyInt: true },
        { name: 'verse', type: 'number', onlyInt: true },
        { name: 'key_shift', type: 'number', min: -12, max: 12, onlyInt: true },
        { name: 'tempo_pct', type: 'number', min: 10, max: 200 },
        { name: 'bpm', type: 'number' },
        { name: 'guide', type: 'text', max: 10 },
        { name: 'feedback', type: 'text', max: 10 },
        { name: 'memory', type: 'bool' },
        { name: 'strictness', type: 'text', max: 10 },
        { name: 'duration_ms', type: 'number' },
        { name: 'voiced_ms', type: 'number' },
        { name: 'cycles', type: 'number' },
        { name: 'expected', type: 'number', onlyInt: true },
        { name: 'on_n', type: 'number', onlyInt: true },
        { name: 'close_n', type: 'number', onlyInt: true },
        { name: 'off_n', type: 'number', onlyInt: true },
        { name: 'missed', type: 'number', onlyInt: true },
        { name: 'pitch_pct', type: 'number', min: 0, max: 1 },
        { name: 'on_pct', type: 'number', min: 0, max: 1 },
        { name: 'bias_c', type: 'number' },
        { name: 'mad_c', type: 'number' },
        { name: 'timing_mad', type: 'number' },
        { name: 'timing_bias', type: 'number' },
        { name: 'onset_pct', type: 'number', min: 0, max: 1 },
        { name: 'hold_sd', type: 'number' },
        { name: 'vib_rate', type: 'number' },
        { name: 'vib_extent', type: 'number' },
        { name: 'vib_share', type: 'number' },
        { name: 'scoops', type: 'number', onlyInt: true },
        { name: 'falls', type: 'number', onlyInt: true },
        { name: 'drift_c', type: 'number' },
        { name: 'octave', type: 'number', onlyInt: true },
        { name: 'offset_c', type: 'number' },
        { name: 'clean', type: 'bool' },
        { name: 'cold', type: 'bool' },
        { name: 'complete', type: 'bool' },
        { name: 'per_phrase', type: 'json', maxSize: 100000 },
        { name: 'per_bar', type: 'json', maxSize: 100000 },
        { name: 'per_note', type: 'json', maxSize: 400000 },
        { name: 'map', type: 'json', maxSize: 40000 },
        { name: 'self_estimate', type: 'text', max: 8 },
        { name: 'disputed', type: 'json', maxSize: 20000 },
        { name: 'results', type: 'json', maxSize: 40000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_runs_day ON runs (day)', 'CREATE INDEX idx_runs_song ON runs (song)'],
    });
    app.save(runs);

    const tracks = new Collection({
      type: 'base',
      name: 'tracks',
      ...OPEN,
      fields: [
        { name: 'run', type: 'relation', required: true, collectionId: runs.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'rate', type: 'number' },
        { name: 'frames', type: 'text', max: 6000000 },
        { name: 'audio', type: 'file', maxSelect: 1, maxSize: 20000000, mimeTypes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'video/webm'] },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_tracks_run ON tracks (run)'],
    });
    app.save(tracks);

    const checkins = new Collection({
      type: 'base',
      name: 'checkins',
      ...OPEN,
      fields: [
        { name: 'day', type: 'text', max: 10 },
        { name: 'session', type: 'text', max: 15 },
        { name: 'when', type: 'select', maxSelect: 1, values: ['before', 'after', 'other'] },
        { name: 'hoarse', type: 'number', min: 1, max: 5, onlyInt: true },
        { name: 'effort', type: 'number', min: 1, max: 5, onlyInt: true },
        { name: 'discomfort', type: 'number', min: 1, max: 5, onlyInt: true },
        { name: 'high_loss', type: 'number', min: 1, max: 5, onlyInt: true },
        { name: 'clearing', type: 'number', min: 1, max: 5, onlyInt: true },
        { name: 'pain', type: 'bool' },
        { name: 'sz_ratio', type: 'number', min: 0, max: 10 },
        { name: 'note', type: 'text', max: 600 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_checkins_day ON checkins (day)'],
    });
    app.save(checkins);

    const messages = new Collection({
      type: 'base',
      name: 'messages',
      ...OPEN,
      fields: [
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['you', 'coach'] },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['chat', 'request', 'review', 'plan', 'health'] },
        { name: 'text', type: 'text', max: 20000 },
        { name: 'song', type: 'text', max: 15 },
        { name: 'session', type: 'text', max: 15 },
        { name: 'reply_to', type: 'text', max: 15 },
        { name: 'context', type: 'json', maxSize: 8000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'answered', 'failed'] },
        { name: 'request_id', type: 'text', max: 15 },
        { name: 'error', type: 'text', max: 1000 },
        ...stamp,
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
        ...stamp,
      ],
      indexes: ['CREATE UNIQUE INDEX idx_plans_day ON plans (day)'],
    });
    app.save(plans);

    const lessons = new Collection({
      type: 'base',
      name: 'lessons',
      ...OPEN,
      fields: [
        { name: 'key', type: 'text', required: true, max: 40 },
        { name: 'score', type: 'number', min: 0, max: 1 },
        { name: 'best', type: 'number', min: 0, max: 1 },
        { name: 'attempts', type: 'number', onlyInt: true },
        { name: 'done_at', type: 'date' },
        ...stamp,
      ],
      indexes: ['CREATE UNIQUE INDEX idx_lessons_key ON lessons (key)'],
    });
    app.save(lessons);

    const skills = new Collection({
      type: 'base',
      name: 'skills',
      ...OPEN,
      fields: [
        { name: 'key', type: 'text', required: true, max: 40 },
        { name: 'mastery', type: 'number', min: 0, max: 1 },
        { name: 'attempts', type: 'number', onlyInt: true },
        { name: 'items', type: 'number', onlyInt: true },
        { name: 'correct', type: 'number', onlyInt: true },
        { name: 'avg_ms', type: 'number' },
        { name: 'level', type: 'number', onlyInt: true },
        { name: 'best_level', type: 'number', onlyInt: true },
        { name: 'data', type: 'json', maxSize: 200000 },
        { name: 'history', type: 'json', maxSize: 40000 },
        { name: 'last_at', type: 'date' },
        ...stamp,
      ],
      indexes: ['CREATE UNIQUE INDEX idx_skills_key ON skills (key)'],
    });
    app.save(skills);

    const drills = new Collection({
      type: 'base',
      name: 'drills',
      ...OPEN,
      fields: [
        { name: 'drill', type: 'text', required: true, max: 30 },
        { name: 'skill', type: 'text', max: 40 },
        { name: 'session', type: 'relation', collectionId: sessions.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'day', type: 'text', max: 10 },
        { name: 'items', type: 'number', onlyInt: true },
        { name: 'correct', type: 'number', onlyInt: true },
        { name: 'accuracy', type: 'number', min: 0, max: 1 },
        { name: 'avg_ms', type: 'number' },
        { name: 'duration_ms', type: 'number' },
        { name: 'voiced_ms', type: 'number' },
        { name: 'cycles', type: 'number' },
        { name: 'tempo_pct', type: 'number' },
        { name: 'level', type: 'number', onlyInt: true },
        { name: 'score', type: 'number', min: 0, max: 1 },
        { name: 'title', type: 'text', max: 160 },
        { name: 'detail', type: 'json', maxSize: 40000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_drills_day ON drills (day)', 'CREATE INDEX idx_drills_skill ON drills (skill)'],
    });
    app.save(drills);
  },
  (app) => {
    for (const name of ['drills', 'skills', 'lessons', 'plans', 'messages', 'checkins', 'tracks', 'runs', 'sessions', 'progress', 'songs', 'voice', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
