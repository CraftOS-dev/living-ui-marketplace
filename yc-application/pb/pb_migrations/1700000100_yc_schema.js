/// <reference path="../pb_data/types.d.ts" />
/**
 * The YC application schema.
 *
 *   settings   one row: the batch, the deadline, where the application is in
 *              the pipeline, the whole-application review and the fill log
 *   founders   the team (structured facts the checks and the odds read)
 *   answers    every text answer of the YC form, one row per question key,
 *              including each founder's profile answers (fp.<founder>.<field>)
 *   sources    links and files your AI agent reads to fill the application
 *   messages   what the founders told your AI agent, and its replies
 *   activity   who changed what
 *
 * Every collection is closed to the raw API (rules null): screens and your AI
 * agent read and write through the operations in pb_hooks (cat_*.js), which
 * keep the checks, the review queue and the activity trail in step.
 */
migrate(
  (app) => {
    const created = { name: 'created', type: 'autodate', onCreate: true };
    const updated = { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true };
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };

    const settings = new Collection(
      Object.assign({}, closed, {
        type: 'base',
        name: 'settings',
        fields: [
          { name: 'batch', type: 'text', max: 60 },
          { name: 'deadline', type: 'text', max: 40 },
          { name: 'deadline_note', type: 'text', max: 300 },
          { name: 'status', type: 'text', max: 20 },
          { name: 'submitted_at', type: 'text', max: 40 },
          { name: 'interview_at', type: 'text', max: 40 },
          { name: 'decided_at', type: 'text', max: 40 },
          { name: 'recommended', type: 'bool' },
          { name: 'confirms', type: 'json', maxSize: 4000 },
          { name: 'gather_state', type: 'text', max: 20 },
          { name: 'gather_request', type: 'text', max: 40 },
          { name: 'gather_at', type: 'text', max: 40 },
          { name: 'gather_summary', type: 'text', max: 4000 },
          { name: 'fill_state', type: 'text', max: 20 },
          { name: 'fill_request', type: 'text', max: 40 },
          { name: 'fill_at', type: 'text', max: 40 },
          { name: 'fill_log', type: 'json', maxSize: 200000 },
          { name: 'review', type: 'json', maxSize: 200000 },
          { name: 'review_state', type: 'text', max: 20 },
          { name: 'review_hash', type: 'text', max: 40 },
          { name: 'review_at', type: 'text', max: 40 },
          { name: 'sent', type: 'json', maxSize: 2000000 },
          created,
          updated,
        ],
      }),
    );
    app.save(settings);

    const founders = new Collection(
      Object.assign({}, closed, {
        type: 'base',
        name: 'founders',
        fields: [
          { name: 'name', type: 'text', required: true, max: 120 },
          { name: 'role', type: 'text', max: 60 },
          { name: 'email', type: 'text', max: 200 },
          { name: 'linkedin', type: 'text', max: 400 },
          { name: 'github', type: 'text', max: 400 },
          { name: 'x', type: 'text', max: 400 },
          { name: 'website', type: 'text', max: 400 },
          { name: 'location', type: 'text', max: 120 },
          { name: 'education', type: 'text', max: 2000 },
          { name: 'work', type: 'text', max: 4000 },
          // 'yes', 'no', or '' while nobody has said: unknown is not "no".
          { name: 'technical', type: 'text', max: 3 },
          { name: 'full_time', type: 'text', max: 3 },
          { name: 'equity', type: 'number' },
          { name: 'origin', type: 'text', max: 10 },
          { name: 'confirmed', type: 'bool' },
          { name: 'need', type: 'text', max: 600 },
          { name: 'sort', type: 'number' },
          created,
          updated,
        ],
      }),
    );
    app.save(founders);

    const answers = new Collection(
      Object.assign({}, closed, {
        type: 'base',
        name: 'answers',
        fields: [
          { name: 'key', type: 'text', required: true, max: 80 },
          { name: 'value', type: 'text', max: 60000 },
          { name: 'origin', type: 'text', max: 10 },
          { name: 'confirmed', type: 'bool' },
          { name: 'suggestion', type: 'text', max: 60000 },
          { name: 'suggestion_why', type: 'text', max: 600 },
          { name: 'source', type: 'text', max: 600 },
          { name: 'need', type: 'text', max: 600 },
          { name: 'judge', type: 'json', maxSize: 100000 },
          { name: 'judge_state', type: 'text', max: 20 },
          { name: 'judged_hash', type: 'text', max: 40 },
          { name: 'judged_at', type: 'text', max: 40 },
          { name: 'edited_at', type: 'text', max: 40 },
          created,
          updated,
        ],
        indexes: ['CREATE UNIQUE INDEX idx_answers_key ON answers (key)', 'CREATE INDEX idx_answers_judge ON answers (judge_state)'],
      }),
    );
    app.save(answers);

    const sources = new Collection(
      Object.assign({}, closed, {
        type: 'base',
        name: 'sources',
        fields: [
          { name: 'kind', type: 'text', max: 20 },
          { name: 'url', type: 'text', max: 1000 },
          { name: 'file', type: 'file', maxSelect: 1, maxSize: 52428800 },
          { name: 'title', type: 'text', max: 300 },
          { name: 'founder', type: 'text', max: 40 },
          { name: 'state', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 8000 },
          { name: 'error', type: 'text', max: 600 },
          { name: 'origin', type: 'text', max: 10 },
          created,
          updated,
        ],
      }),
    );
    app.save(sources);

    const messages = new Collection(
      Object.assign({}, closed, {
        type: 'base',
        name: 'messages',
        fields: [
          { name: 'role', type: 'text', max: 10 },
          { name: 'text', type: 'text', max: 8000 },
          { name: 'state', type: 'text', max: 20 },
          { name: 'request', type: 'text', max: 40 },
          { name: 'reply_to', type: 'text', max: 40 },
          created,
          updated,
        ],
      }),
    );
    app.save(messages);

    const activity = new Collection(
      Object.assign({}, closed, {
        type: 'base',
        name: 'activity',
        fields: [
          { name: 'actor', type: 'text', max: 10 },
          { name: 'text', type: 'text', max: 600 },
          { name: 'target', type: 'text', max: 120 },
          created,
        ],
        indexes: ['CREATE INDEX idx_activity_created ON activity (created)'],
      }),
    );
    app.save(activity);

    // The one settings row. Winter 2027 closes November 2, 2026 at 8pm PT
    // (ycombinator.com/apply, read 2026-10-26); 8pm PST is 04:00 UTC the next day.
    const row = new Record(settings);
    row.set('id', 'ycsettings00001');
    row.set('batch', 'Winter 2027');
    row.set('deadline', '2026-11-03T04:00:00.000Z');
    row.set('deadline_note', 'Winter 2027: November 2 at 8pm PT (ycombinator.com/apply)');
    row.set('status', 'preparing');
    row.set('confirms', {});
    row.set('gather_state', 'idle');
    row.set('fill_state', 'idle');
    row.set('fill_log', []);
    row.set('review', {});
    row.set('review_state', 'none');
    row.set('sent', {});
    app.save(row);
  },
  (app) => {
    for (const name of ['activity', 'messages', 'sources', 'answers', 'founders', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
