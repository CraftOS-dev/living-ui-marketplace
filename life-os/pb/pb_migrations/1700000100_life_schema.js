/// <reference path="../pb_data/types.d.ts" />
/**
 * Life OS schema.
 *
 * A life as eight areas, each its own little place with its own tools:
 * health (body logs, workouts), money (spending, savings pots, bills),
 * friends and family (people, the times you were in touch, events), work (focus sessions, wins), home (chores, shopping), growth
 * (books, learning), fun (bucket list, trips) and mind (mood and minutes,
 * kept on days and health logs). Goals belong to an area and, where they
 * can, measure themselves from that area's data (a savings pot, books
 * finished, weight). Tasks are cards on a board; habits are logged per day;
 * the journal is free writing with the day's mood and weather.
 *
 * An area is a kind, never a free name: each kind has its own screen, so
 * tasks, goals, habits and projects carry `area` as one of the kinds.
 *
 * Every collection is closed to the raw API (all rules null): people and
 * your AI agent reach the data only through the app's operations
 * (pb_hooks/routes.pb.js -> lib_ops.js). Screens learn about changes from
 * the custom realtime topic "lo", which carries collection names only.
 *
 * Days are plain text YYYY-MM-DD in the person's local calendar; money is a
 * whole number of the currency's minor unit (cents).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    // Nobody signs in to this app (local, one person); close PocketBase's users collection.
    const users = app.findCollectionByNameOrId('users');
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.passwordAuth.enabled = false;
    app.save(users);

    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const ACTORS = ['person', 'agent', 'system'];
    const PRIVACY = ['private', 'shared_with_agent'];
    const KINDS = ['health', 'money', 'relationships', 'work', 'home', 'growth', 'fun', 'mind'];
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name, extra) => Object.assign({ name: name, type: 'number' }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const owned = (name, target) => rel(name, target, { cascadeDelete: true, required: true });
    const day = (name) => txt(name, 10);
    const area = (required) => sel('area', KINDS, required === true);
    const photo = (name) => ({ name: name, type: 'file', maxSelect: 1, maxSize: 15728640, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], thumbs: [], protected: true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };

    /* ---------------------------------------------------------- settings */

    make(
      'settings',
      [
        txt('owner_name', 80),
        bool('onboarded'),
        int('day_starts_hour', { min: 0, max: 6 }),
        sel('week_starts_on', ['monday', 'sunday']),
        sel('units', ['metric', 'imperial']),
        txt('currency', 3),
        int('month_budget', { min: 0 }),
        txt('city', 120),
        txt('region', 120),
        txt('country', 2),
        num('lat'),
        num('lon'),
        txt('timezone', 60),
        json('news_topics', 1000),
        json('home_rows', 1000),
        int('water_goal', { min: 1, max: 30 }),
        num('sleep_goal'),
        int('steps_goal', { min: 0, max: 100000 }),
        sel('reflections_to_agent', ['never', 'when_shared']),
        sel('agent_autonomy', ['as_designed', 'propose_all']),
        txt('quiet_start', 5),
        txt('quiet_end', 5),
        bool('calendar_enabled'),
        txt('calendar_id', 200),
        sel('calendar_state', ['off', 'ok', 'not_connected', 'unreachable']),
        txt('calendar_synced_at', 30),
        txt('calendar_error', 400),
        day('last_day_job'),
      ].concat(stamps),
    );

    /* -------------------------------------------------------- areas, goals */

    make('areas', [sel('kind', KINDS, true), bool('enabled'), int('rank')].concat(stamps), ['CREATE UNIQUE INDEX idx_areas_kind ON areas (kind)']);

    // Savings pots come first: a money goal can measure itself from one.
    make('money_pots', [req('name', 80), int('target', { min: 0 }), int('saved', { min: 0 }), int('look', { min: 0, max: 7 }), int('rank'), txt('done_at', 30), sel('actor', ACTORS)].concat(stamps), ['CREATE INDEX idx_pots_rank ON money_pots (rank)']);

    make(
      'goals',
      [
        req('title', 200),
        area(true),
        sel('state', ['active', 'paused', 'done', 'dropped'], true),
        sel('measure', ['number_up', 'number_down', 'milestones', 'tasks', 'habits', 'pot', 'books', 'weight', 'none'], true),
        txt('unit', 30),
        num('baseline'),
        num('target'),
        num('current'),
        rel('pot', 'money_pots'),
        json('milestones', 40000),
        day('start_date'),
        day('deadline'),
        txt('purpose', 1000),
        num('progress'),
        num('pace'),
        sel('pace_state', ['ahead', 'on_track', 'behind', 'none', 'done']),
        day('last_activity'),
        txt('done_at', 30),
        int('rank'),
        sel('actor', ACTORS),
      ].concat(stamps),
      ['CREATE INDEX idx_goals_area ON goals (area, state, rank)'],
    );

    make('goal_checkins', [owned('goal', 'goals'), day('date'), num('value'), txt('note', 500), sel('actor', ACTORS)].concat(stamps), ['CREATE INDEX idx_checkins_goal ON goal_checkins (goal, date)']);

    /* -------------------------------------------------------------- people */

    make(
      'people',
      [
        req('name', 80),
        sel('circle', ['partner', 'friends', 'family'], true),
        txt('relation', 60),
        txt('birthday', 10),
        int('keep_in_touch_days', { min: 0, max: 400 }),
        day('last_contact'),
        int('look', { min: 0, max: 100000 }),
        json('links', 20000),
        txt('notes', 4000),
        int('rank'),
        bool('archived'),
        sel('actor', ACTORS),
      ].concat(stamps),
      ['CREATE INDEX idx_people_circle ON people (circle, archived)'],
    );

    make(
      'interactions',
      [owned('person', 'people'), day('date'), sel('kind', ['talk', 'message', 'meet', 'gift', 'other'], true), txt('note', 1000), sel('actor', ACTORS)].concat(stamps),
      ['CREATE INDEX idx_inter_person ON interactions (person, date)', 'CREATE INDEX idx_inter_date ON interactions (date)'],
    );

    make(
      'events',
      [req('title', 200), day('date'), txt('time', 5), area(true), txt('place', 200), rel('person', 'people'), sel('actor', ACTORS)].concat(stamps),
      ['CREATE INDEX idx_events_date ON events (date)'],
    );

    /* --------------------------------------------------------- work, tasks */

    make(
      'projects',
      [
        req('title', 200),
        area(false),
        rel('goal', 'goals'),
        sel('state', ['active', 'someday', 'done', 'dropped'], true),
        day('deadline'),
        txt('notes', 8000),
        int('look', { min: 0, max: 7 }),
        int('rank'),
        txt('done_at', 30),
        sel('actor', ACTORS),
      ].concat(stamps),
      ['CREATE INDEX idx_projects_state ON projects (state, rank)'],
    );

    make(
      'tasks',
      [
        req('title', 300),
        txt('notes', 8000),
        area(false),
        rel('project', 'projects'),
        rel('goal', 'goals'),
        rel('person', 'people'),
        sel('state', ['open', 'done'], true),
        sel('stage', ['todo', 'doing']),
        day('do_date'),
        day('due_date'),
        txt('start_time', 5),
        int('duration_min', { min: 0, max: 1440 }),
        bool('someday'),
        bool('top'),
        json('recurrence', 2000),
        txt('series', 15),
        json('checklist', 40000),
        txt('done_at', 30),
        day('done_date'),
        num('rank'),
        sel('actor', ACTORS),
      ].concat(stamps),
      [
        'CREATE INDEX idx_tasks_state_do ON tasks (state, do_date)',
        'CREATE INDEX idx_tasks_done ON tasks (state, done_date)',
        'CREATE INDEX idx_tasks_project ON tasks (project)',
        'CREATE INDEX idx_tasks_goal ON tasks (goal)',
        'CREATE INDEX idx_tasks_area ON tasks (area)',
      ],
    );

    make('focus_sessions', [day('date'), int('minutes', { min: 1, max: 600 }), rel('task', 'tasks'), txt('note', 300), sel('actor', ACTORS)].concat(stamps), ['CREATE INDEX idx_focus_date ON focus_sessions (date)']);

    make('wins', [req('text', 300), day('date'), area(false), sel('actor', ACTORS)].concat(stamps), ['CREATE INDEX idx_wins_date ON wins (date)']);

    /* ------------------------------------------------------------- habits */

    make(
      'habits',
      [
        req('name', 120),
        txt('art', 30),
        area(false),
        rel('goal', 'goals'),
        sel('schedule', ['daily', 'weekdays', 'per_week'], true),
        json('days', 200),
        int('times', { min: 1, max: 7 }),
        int('target', { min: 1, max: 100 }),
        txt('unit', 30),
        sel('time_of_day', ['morning', 'afternoon', 'evening', 'anytime']),
        txt('cue', 200),
        sel('source', ['water', 'mind_min']),
        day('started_on'),
        bool('archived'),
        int('rank'),
        sel('actor', ACTORS),
      ].concat(stamps),
      ['CREATE INDEX idx_habits_rank ON habits (archived, rank)'],
    );

    make(
      'habit_logs',
      [owned('habit', 'habits'), day('date'), int('value', { min: 0, max: 1000 }), sel('state', ['done', 'skipped'], true), txt('note', 300), sel('actor', ACTORS)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_logs_habit_date ON habit_logs (habit, date)', 'CREATE INDEX idx_logs_date ON habit_logs (date)'],
    );

    /* --------------------------------------------------------- body, mind */

    make(
      'days',
      [req('date', 10), int('mood', { min: 0, max: 5 }), int('energy', { min: 0, max: 5 }), txt('agent_note', 1200), txt('agent_note_at', 30)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_days_date ON days (date)'],
    );

    make(
      'health_logs',
      [req('date', 10), int('water', { min: 0, max: 40 }), num('sleep_h', { min: 0, max: 24 }), int('steps', { min: 0, max: 200000 }), num('weight', { min: 0, max: 1000 }), int('mind_min', { min: 0, max: 1440 })].concat(stamps),
      ['CREATE UNIQUE INDEX idx_health_date ON health_logs (date)'],
    );

    make(
      'workouts',
      [day('date'), sel('kind', ['walk', 'run', 'gym', 'yoga', 'bike', 'swim', 'sport', 'dance'], true), int('minutes', { min: 1, max: 600 }), txt('note', 300), sel('actor', ACTORS)].concat(stamps),
      ['CREATE INDEX idx_workouts_date ON workouts (date)'],
    );

    /* -------------------------------------------------------------- money */

    make(
      'money_entries',
      [
        day('date'),
        int('amount', { min: 1 }),
        sel('kind', ['spend', 'income'], true),
        sel('category', ['food', 'groceries', 'transport', 'home', 'bills', 'fun', 'health', 'shopping', 'gifts', 'other', 'salary', 'extra'], true),
        txt('note', 200),
        sel('actor', ACTORS),
      ].concat(stamps),
      ['CREATE INDEX idx_money_date ON money_entries (date)'],
    );

    make(
      'bills',
      [req('name', 80), int('amount', { min: 0 }), int('due_day', { min: 1, max: 31 }), sel('category', ['home', 'bills', 'transport', 'health', 'fun', 'shopping', 'other'], true), txt('paid_month', 7), bool('active'), int('rank'), sel('actor', ACTORS)].concat(stamps),
    );

    /* ------------------------------------------------------- growth, fun */

    make(
      'books',
      [req('title', 200), txt('author', 120), sel('status', ['want', 'reading', 'done'], true), int('pages', { min: 0, max: 20000 }), int('page', { min: 0, max: 20000 }), day('started_on'), day('finished_on'), int('look', { min: 0, max: 7 }), int('rating', { min: 0, max: 5 }), int('rank'), sel('actor', ACTORS)].concat(stamps),
      ['CREATE INDEX idx_books_status ON books (status, rank)'],
    );

    make(
      'learning',
      [req('name', 120), sel('kind', ['course', 'skill', 'language'], true), int('progress', { min: 0, max: 100 }), day('last_practiced'), int('minutes', { min: 0 }), txt('note', 500), bool('archived'), int('rank'), sel('actor', ACTORS)].concat(stamps),
    );

    make('bucket_items', [req('title', 200), sel('kind', ['place', 'experience', 'skill', 'food', 'other'], true), day('done_on'), txt('note', 500), int('rank'), sel('actor', ACTORS)].concat(stamps));

    make('trips', [req('title', 120), txt('place', 120), day('start_date'), day('end_date'), json('checklist', 20000), txt('notes', 4000), sel('actor', ACTORS)].concat(stamps), ['CREATE INDEX idx_trips_start ON trips (start_date)']);

    /* --------------------------------------------------------------- home */

    make('chores', [req('name', 120), sel('room', ['kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'outside', 'other'], true), int('every_days', { min: 1, max: 365 }), day('last_done'), int('rank'), sel('actor', ACTORS)].concat(stamps));

    make('shopping_items', [req('text', 120), bool('done'), txt('done_at', 30), int('rank'), sel('actor', ACTORS)].concat(stamps), ['CREATE INDEX idx_shopping_done ON shopping_items (done, rank)']);

    /* ------------------------------------------------------------ journal */

    make(
      'journal_entries',
      [day('date'), txt('body', 40000), int('mood', { min: 0, max: 5 }), json('weather', 400), json('tags', 400), photo('photo'), sel('privacy', PRIVACY), sel('actor', ACTORS)].concat(stamps),
      ['CREATE INDEX idx_journal_date ON journal_entries (date)'],
    );

    make('recaps', [req('week_start', 10), txt('text', 12000), txt('written_at', 30)].concat(stamps), ['CREATE UNIQUE INDEX idx_recaps_week ON recaps (week_start)']);

    /* ----------------------------------------------------------- routines */

    make(
      'routines',
      [sel('kind', ['morning_note', 'evening_checkin', 'weekly_recap'], true), bool('enabled'), json('days', 200), txt('time', 5), txt('last_due', 16)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_routines_kind ON routines (kind)'],
    );

    make(
      'routine_runs',
      [owned('routine', 'routines'), txt('due_at', 16), sel('state', ['fired', 'quiet', 'missed', 'refused'], true), txt('request', 20), txt('note', 400)].concat(stamps),
      ['CREATE INDEX idx_runs_routine ON routine_runs (routine, due_at)'],
    );

    /* ------------------------------------------------------- your AI agent */

    make(
      'suggestions',
      [
        sel('target_kind', ['tasks', 'habits', 'goals'], true),
        txt('target_id', 15),
        txt('field', 30),
        json('value', 8000),
        txt('why', 1000),
        sel('status', ['open', 'accepted', 'dismissed', 'stale'], true),
        sel('actor', ACTORS),
      ].concat(stamps),
      ['CREATE INDEX idx_sugg_target ON suggestions (target_kind, target_id, status)'],
    );

    make(
      'proposals',
      [
        txt('op', 80),
        json('params', 400000),
        txt('kind', 60),
        txt('title', 400),
        txt('summary', 4000),
        json('preview', 400000),
        txt('why', 8000),
        txt('target_collection', 40),
        txt('target_id', 15),
        txt('target_updated', 40),
        sel('status', ['waiting', 'approved', 'partly_approved', 'rejected', 'returned', 'withdrawn', 'stale'], true),
        txt('decision_note', 4000),
        txt('decided_at', 30),
        json('result', 200000),
      ].concat(stamps),
      ['CREATE INDEX idx_proposals_status ON proposals (status, created)'],
    );

    make(
      'asks',
      [req('question', 4000), sel('about', ['life', 'area', 'goal', 'habit', 'person'], true), txt('target', 15), sel('status', ['waiting', 'working', 'answered', 'failed'], true), txt('answer', 20000), txt('failure', 2000), txt('request', 20)].concat(stamps),
      ['CREATE INDEX idx_asks_status ON asks (status, created)'],
    );

    make(
      'activity',
      [sel('actor', ACTORS, true), txt('op', 80), txt('label', 600), txt('target', 40), txt('record', 20), txt('batch', 40), json('data', 400000), bool('undoable'), bool('undone')].concat(stamps),
      ['CREATE INDEX idx_activity_created ON activity (created)', 'CREATE INDEX idx_activity_record ON activity (record)', 'CREATE INDEX idx_activity_batch ON activity (batch)'],
    );

    /* -------------------------------------------------- calendar (mirror) */

    make(
      'calendar_events',
      [req('external_id', 300), txt('calendar', 200), txt('start', 30), txt('end', 30), bool('all_day'), txt('title', 300), txt('location', 300), day('date'), txt('synced_at', 30)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_cal_ext ON calendar_events (external_id, date)', 'CREATE INDEX idx_cal_date ON calendar_events (date)'],
    );
  },
  (app) => {
    for (const name of [
      'calendar_events', 'activity', 'asks', 'proposals', 'suggestions', 'routine_runs', 'routines', 'recaps', 'journal_entries', 'shopping_items', 'chores', 'trips',
      'bucket_items', 'learning', 'books', 'bills', 'money_entries', 'workouts', 'health_logs', 'days', 'habit_logs', 'habits', 'wins', 'focus_sessions', 'tasks',
      'projects', 'events', 'interactions', 'people', 'goal_checkins', 'goals', 'money_pots', 'areas', 'settings',
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* not there */
      }
    }
  },
);
