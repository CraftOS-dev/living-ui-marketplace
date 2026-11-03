/// <reference path="../pb_data/types.d.ts" />
/**
 * Piano Coach: learning beyond the pieces.
 *
 *   lessons  one row per finished lesson of the curriculum (key, score,
 *            attempts, when)
 *   skills   one row per skill the drills train (note reading, intervals,
 *            chords, ear, rhythm, technique, sight-reading …): mastery
 *            0..1, attempts, speed, the adaptive level, per-key bests
 *   drills   one row per drill session: what was trained, how many items,
 *            how many right, how fast, for how long (it counts as practice
 *            time and belongs to the session)
 */
migrate(
  (app) => {
    const OPEN = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };
    const sessions = app.findCollectionByNameOrId('sessions');

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
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
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
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
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
    for (const name of ['drills', 'skills', 'lessons']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
