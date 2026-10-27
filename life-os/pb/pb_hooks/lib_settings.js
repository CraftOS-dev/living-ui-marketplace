/// <reference path="../pb_data/types.d.ts" />
/**
 * Settings, the frame's status (badges, the areas switched on, the goals
 * and projects for pickers, today's writing prompt), the first run and the
 * export of everything.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}
let act_ = null;
function act() {
  return act_ || (act_ = require(`${__hooks}/lib_activity.js`));
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'INR', 'AUD', 'CAD', 'NZD', 'SGD', 'MYR', 'HKD', 'TWD', 'THB', 'IDR', 'PHP', 'VND', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'ZAR', 'NGN', 'KES', 'AED', 'SAR', 'ILS', 'TRY', 'RUB', 'UAH', 'EGP', 'PKR', 'BDT', 'ISK'];

/** Gentle questions for the journal page, one a day (picked from the date). */
const PROMPTS = [
  'What made you smile today?',
  'What is on your mind right now?',
  'What went better than you expected?',
  'Who made your day a little better?',
  'What would make tomorrow feel good?',
  'What are you looking forward to?',
  'What did you learn today?',
  'What drained you, and what filled you up?',
  'Three small things you are glad of.',
  'What would you tell yourself a year ago?',
  'Where did you feel most like yourself today?',
  'What can wait, and what cannot?',
  'A moment worth remembering from this week.',
  'What are you proud of lately?',
];

function settingsOut(s) {
  return {
    owner_name: s.getString('owner_name'),
    onboarded: s.getBool('onboarded'),
    day_starts_hour: s.getInt('day_starts_hour'),
    week_starts_on: s.getString('week_starts_on') || 'monday',
    units: s.getString('units') || 'metric',
    currency: s.getString('currency') || 'USD',
    month_budget: s.getInt('month_budget'),
    city: s.getString('city'),
    region: s.getString('region'),
    country: s.getString('country'),
    water_goal: s.getInt('water_goal'),
    sleep_goal: s.getFloat('sleep_goal'),
    steps_goal: s.getInt('steps_goal'),
    reflections_to_agent: s.getString('reflections_to_agent') || 'when_shared',
    agent_autonomy: s.getString('agent_autonomy') || 'as_designed',
    quiet_start: s.getString('quiet_start'),
    quiet_end: s.getString('quiet_end'),
    calendar_enabled: s.getBool('calendar_enabled'),
    calendar_id: s.getString('calendar_id') || 'primary',
    home_rows: homeRows(s),
  };
}

/** The rows of Home, in the person's order (all of them, each once). */
const HOME_ROWS = ['today', 'habits', 'goals', 'days', 'news'];

function homeRows(s) {
  const v = u().jsonOf(s, 'home_rows');
  return Array.isArray(v) && v.length === HOME_ROWS.length ? v : HOME_ROWS.slice();
}

/** settings.get */
function get(ctx) {
  return { settings: settingsOut(core().settings(ctx.app)), currencies: CURRENCIES };
}

/** settings.update */
function update(ctx, p) {
  const util = u();
  const C = core();
  ctx.app.runInTransaction((tx) => {
    const s = C.settings(tx);
    if (util.has(p, 'owner_name')) s.set('owner_name', C.name(p, 'owner_name', 80, ''));
    if (util.has(p, 'day_starts_hour')) s.set('day_starts_hour', util.int(p, 'day_starts_hour', 4, 0, 6));
    if (util.has(p, 'week_starts_on')) s.set('week_starts_on', util.oneOf(p, 'week_starts_on', ['monday', 'sunday'], 'monday'));
    if (util.has(p, 'units')) {
      s.set('units', util.oneOf(p, 'units', ['metric', 'imperial'], 'metric'));
      tx.store().remove('lo_weather');
    }
    if (util.has(p, 'currency')) s.set('currency', util.oneOf(p, 'currency', CURRENCIES, 'USD'));
    if (util.has(p, 'month_budget')) {
      const b = C.amount(tx, p, 'month_budget', false);
      s.set('month_budget', b === undefined ? 0 : b);
    }
    if (util.has(p, 'water_goal')) s.set('water_goal', util.int(p, 'water_goal', 8, 1, 30));
    if (util.has(p, 'sleep_goal')) s.set('sleep_goal', util.num(p, 'sleep_goal', 8, 3, 14));
    if (util.has(p, 'steps_goal')) s.set('steps_goal', util.int(p, 'steps_goal', 8000, 0, 100000));
    if (util.has(p, 'reflections_to_agent')) s.set('reflections_to_agent', util.oneOf(p, 'reflections_to_agent', ['never', 'when_shared'], 'when_shared'));
    if (util.has(p, 'agent_autonomy')) s.set('agent_autonomy', util.oneOf(p, 'agent_autonomy', ['as_designed', 'propose_all'], 'as_designed'));
    if (util.has(p, 'quiet_start')) s.set('quiet_start', C.time(p, 'quiet_start', ''));
    if (util.has(p, 'quiet_end')) s.set('quiet_end', C.time(p, 'quiet_end', ''));
    if (util.has(p, 'home_rows')) {
      const rows = (util.list(p, 'home_rows') || []).map(String);
      const ok = rows.length === HOME_ROWS.length && HOME_ROWS.every((k) => rows.indexOf(k) >= 0);
      if (!ok) throw util.fail(400, 'home_rows is every row of Home once, in order: ' + JSON.stringify(HOME_ROWS), 'invalid_param', { param: 'home_rows' });
      s.set('home_rows', rows);
    }
    if (util.has(p, 'calendar_id')) s.set('calendar_id', util.text(p, 'calendar_id', 200, 'primary') || 'primary');
    if (util.has(p, 'calendar_enabled')) {
      const on = util.bool(p, 'calendar_enabled', false);
      s.set('calendar_enabled', on);
      s.set('calendar_state', on ? 'ok' : 'off');
      if (!on) {
        s.set('calendar_synced_at', '');
        tx.findRecordsByFilter('calendar_events', '', '', 0, 0).forEach((r) => tx.delete(r));
      }
    }
    tx.save(s);
    act().write(tx, ctx, { label: 'Changed settings', target: 'settings' });
  });
  if (util.has(p, 'calendar_enabled') && util.bool(p, 'calendar_enabled', false)) {
    ctx.app.store().set('lo_cal_tried', 0);
    try {
      require(`${__hooks}/lib_calendar.js`).sync(ctx.app);
    } catch (err) {
      console.error('[lo] first calendar sync failed:', err);
    }
  }
  return get(ctx);
}

/** app.status: what the frame shows (badges, areas on, pickers, today's prompt). */
function status(ctx) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const now = C.now(app);
  const today = now.today;
  const s = C.settings(app);
  const c = util.one(
    app,
    "SELECT (SELECT COUNT(*) FROM proposals WHERE status = 'waiting') AS proposals, (SELECT COUNT(*) FROM suggestions WHERE status = 'open') AS suggestions, (SELECT COUNT(*) FROM asks WHERE status = 'answered') AS answers, (SELECT COUNT(*) FROM tasks WHERE state = 'open' AND someday = FALSE AND do_date != '' AND do_date <= {:t}) AS today_open, (SELECT COUNT(*) FROM tasks WHERE state = 'open' AND do_date = '' AND someday = FALSE AND project = '') AS inbox",
    { proposals: 0, suggestions: 0, answers: 0, today_open: 0, inbox: 0 },
    { t: today },
  );
  const H = require(`${__hooks}/lib_habits.js`);
  const habits = H.outMany(app, H.listRecords(app, false), today);
  let h = 0;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) % 100003;
  return {
    today: today,
    now: now,
    season: C.season(app, today),
    owner_name: s.getString('owner_name'),
    onboarded: s.getBool('onboarded'),
    areas: C.enabledKinds(app),
    counts: Object.assign(util.plain([c])[0], { habits_due: habits.filter((x) => x.today.due || x.today.done).length, habits_done: habits.filter((x) => x.today.done).length }),
    goals: app.findRecordsByFilter('goals', "state = 'active'", 'rank,created', 0, 0).map((g) => ({ id: g.id, title: g.getString('title'), area: g.getString('area'), progress: g.getFloat('progress') })),
    projects: app.findRecordsByFilter('projects', "state = 'active'", 'rank,created', 0, 0).map((pr) => ({ id: pr.id, title: pr.getString('title'), area: pr.getString('area') })),
    people: app.findRecordsByFilter('people', 'archived = false', 'rank,name', 0, 0).map((pp) => ({ id: pp.id, name: pp.getString('name'), look: pp.getInt('look'), circle: pp.getString('circle') })),
    currency: s.getString('currency') || 'USD',
    digits: C.digits(app),
    units: s.getString('units') || 'metric',
    week_starts_on: C.weekStartsOn(app),
    place: { city: s.getString('city'), country: s.getString('country') },
    prompt: PROMPTS[h % PROMPTS.length],
    calendar: { enabled: s.getBool('calendar_enabled'), state: s.getString('calendar_state') },
  };
}

/**
 * onboarding.complete: the first run in one step: a name, the areas that
 * are the person's, the currency and units, and a few habits picked from
 * suggestions (name and drawing, how often).
 */
function onboard(ctx, p) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const batch = 'ob_' + util.token(8);
  const made = { habits: [] };
  app.runInTransaction((tx) => {
    const bctx = Object.assign({}, ctx, { app: tx, batch: batch });
    const s = C.settings(tx);
    if (util.has(p, 'owner_name')) s.set('owner_name', C.name(p, 'owner_name', 80, ''));
    if (util.has(p, 'currency')) s.set('currency', util.oneOf(p, 'currency', CURRENCIES, 'USD'));
    if (util.has(p, 'units')) s.set('units', util.oneOf(p, 'units', ['metric', 'imperial'], 'metric'));
    if (util.has(p, 'week_starts_on')) s.set('week_starts_on', util.oneOf(p, 'week_starts_on', ['monday', 'sunday'], 'monday'));
    if (util.has(p, 'areas')) {
      const kinds = (util.list(p, 'areas') || []).map(String);
      kinds.forEach((k) => {
        if (C.KINDS.indexOf(k) < 0) throw util.fail(400, 'areas are kinds: ' + C.KINDS.join(', '), 'invalid_param', { param: 'areas' });
      });
      if (kinds.length === 0) throw util.fail(400, 'Pick at least one area of life.', 'invalid_param', { param: 'areas' });
      tx.findRecordsByFilter('areas', '', '', 0, 0).forEach((a) => {
        a.set('enabled', kinds.indexOf(a.getString('kind')) >= 0);
        tx.save(a);
      });
    }
    // A first goal (its area must be one of theirs).
    let goalId = '';
    const g0 = util.obj(p, 'goal') || {};
    if (Object.keys(g0).length > 0) {
      util.keysOnly(g0, ['title', 'area', 'measure', 'target', 'baseline', 'unit', 'deadline', 'purpose'], 'goal');
      const params = {};
      for (const k of ['title', 'area', 'measure', 'target', 'baseline', 'unit', 'deadline', 'purpose']) if (g0[k] !== undefined && g0[k] !== '') params[k] = String(g0[k]);
      goalId = require(`${__hooks}/lib_goals.js`).create(bctx, params).goal.id;
      made.goal = goalId;
    }
    const habits = util.list(p, 'habits') || [];
    habits.slice(0, 12).forEach((h0, i) => {
      util.keysOnly(h0, ['name', 'art', 'area', 'schedule', 'days', 'times', 'target', 'unit', 'time_of_day', 'cue', 'source', 'for_goal'], 'Habit ' + (i + 1));
      const params = { name: String(h0.name || '') };
      for (const k of ['art', 'area', 'schedule', 'times', 'target', 'unit', 'time_of_day', 'cue', 'source']) if (h0[k] !== undefined && h0[k] !== '') params[k] = String(h0[k]);
      if (Array.isArray(h0.days)) params.days = JSON.stringify(h0.days);
      if (h0.for_goal === true && goalId !== '') params.goal = goalId;
      made.habits.push(require(`${__hooks}/lib_habits.js`).create(bctx, params).habit.id);
    });
    // The rhythm: the routines they want, switched on at their usual times.
    const r0 = util.obj(p, 'routines') || {};
    if (Object.keys(r0).length > 0) {
      const R = require(`${__hooks}/lib_routines.js`);
      util.keysOnly(r0, R.KINDS, 'routines');
      tx.findRecordsByFilter('routines', '', '', 0, 0).forEach((r) => {
        if (r0[r.getString('kind')] === undefined) return;
        R.update(bctx, { routine: r.id, enabled: r0[r.getString('kind')] === true });
      });
    }
    s.set('onboarded', true);
    tx.save(s);
    act().write(tx, bctx, { label: 'Set up Life OS', target: 'settings' });
  });
  try {
    require(`${__hooks}/lib_world.js`).detect(app);
  } catch (err) {
    console.error('[lo] place lookup after setup failed:', err);
  }
  return { made: made, batch: batch, status: status(ctx) };
}

/** export.json: every record of the life store (the person's copy). */
function exportAll(ctx) {
  const util = u();
  const app = ctx.app;
  const out = { app: 'Life OS', exported_at: util.nowIso(), collections: {} };
  for (const name of require(`${__hooks}/lib_bus.js`).COLLECTIONS) {
    if (name === 'activity') continue;
    out.collections[name] = app.findRecordsByFilter(name, '', 'created', 0, 0).map((r) => {
      const o = JSON.parse(JSON.stringify(r));
      delete o.collectionId;
      delete o.collectionName;
      return o;
    });
  }
  return out;
}

/** What a settings change by your AI agent will do, for the person to keep or decline. */
function preview(ctx, p) {
  const C = core();
  const s = settingsOut(C.settings(ctx.app));
  const NAMES = { owner_name: 'name', day_starts_hour: 'new day starts at', week_starts_on: 'week starts on', units: 'units', currency: 'currency', month_budget: 'monthly budget', water_goal: 'glasses of water a day', sleep_goal: 'hours of sleep', steps_goal: 'steps a day', reflections_to_agent: 'what your AI agent may read', agent_autonomy: 'what your AI agent may do', quiet_start: 'quiet from', quiet_end: 'quiet until', calendar_enabled: 'calendar', calendar_id: 'calendar', home_rows: "Home's row order" };
  const ROWS = { today: 'Today', habits: 'Habits and you', goals: 'Goals and money', days: 'Coming up, people and weather', news: 'News' };
  const show = (k, v) => {
    if (k === 'home_rows') {
      let list = v;
      if (typeof v === 'string') {
        try {
          list = JSON.parse(v);
        } catch {
          list = [];
        }
      }
      return (Array.isArray(list) ? list : []).map((x, i) => i + 1 + ' ' + (ROWS[x] || x)).join(' · ');
    }
    return String(v);
  };
  const keys = Object.keys(p).filter((k) => NAMES[k]);
  const lines = keys.map((k) => NAMES[k] + ': ' + show(k, s[k]) + ' -> ' + show(k, p[k]));
  return { kind: 'settings', title: 'Change ' + C.listWords(keys.map((k) => NAMES[k]).filter((x, i, a) => a.indexOf(x) === i)), summary: lines.join('; '), preview: { changes: lines } };
}

module.exports = {
  preview: preview, CURRENCIES: CURRENCIES, PROMPTS: PROMPTS, settingsOut: settingsOut, get: get, update: update, status: status, onboard: onboard, exportAll: exportAll };
