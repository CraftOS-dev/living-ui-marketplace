/// <reference path="../pb_data/types.d.ts" />
/**
 * lib_agent.js: the logic behind the agent operations in agent_ops.pb.js.
 *
 * The View never calls this. Its own data layer is the browser shim
 * frontend/src/app/services/apiAdapter.ts: it turns the V1 UI's REST calls into
 * PocketBase record calls and computes streaks, rates, heatmap cells and the
 * dashboard in the browser. Each function here that the UI also has is a port
 * of that shim (or of the component it names), cited above the function, so an
 * agent writes the same records and reads the same numbers a person sees.
 *
 * Loaded with require() inside each route handler: PocketBase JSVM handlers
 * run in isolated VMs. Query results are Go slices: always Array.from() them
 * before sorting or reversing.
 */

/* ------------------------------------------------------------ constants */

// frontend/src/app/lib/icons.ts HABIT_COLORS: the only colours the UI can pick.
const HABIT_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#737373',
];

// frontend/src/app/lib/icons.ts ICON_NAMES (sorted): the icon picker's 89 names.
// habits.icon holds up to 40 characters (pb_migrations/1700000002), so all fit.
const ICON_NAMES = [
  'Activity', 'AlarmClock', 'Apple', 'Ban', 'Banana', 'Bath', 'Bed', 'BellRing',
  'Bike', 'Book', 'Brain', 'Briefcase', 'Brush', 'Calendar', 'CheckCircle2',
  'ChefHat', 'Cigarette', 'Circle', 'Coffee', 'Compass', 'Croissant', 'Crown', 'Dog',
  'Droplet', 'Dumbbell', 'Edit3', 'Feather', 'Flame', 'Flower2', 'Footprints',
  'Gamepad2', 'Gem', 'Gift', 'GlassWater', 'Globe2', 'GraduationCap', 'Guitar',
  'Hammer', 'Hand', 'HandCoins', 'Headphones', 'Heart', 'HeartPulse', 'Home',
  'IceCream', 'Languages', 'Laptop', 'Leaf', 'Lightbulb', 'MessagesSquare', 'Mic',
  'Microscope', 'Moon', 'MountainSnow', 'Music', 'Notebook', 'Paintbrush', 'Palette',
  'Pencil', 'Pizza', 'Plane', 'Plus', 'Salad', 'Scale', 'ScrollText', 'ShieldCheck',
  'ShoppingBag', 'ShowerHead', 'Smile', 'Sofa', 'Sparkles', 'Sprout', 'Stethoscope',
  'Sun', 'SunMedium', 'Target', 'Tent', 'Timer', 'ToyBrick', 'TreeDeciduous',
  'Trophy', 'Tv', 'Umbrella', 'Wallet', 'Waves', 'Wifi', 'Wind', 'Wine', 'Zap',
];

// HabitFormModal.tsx TYPE_OPTIONS: the four types a person can pick.
const HABIT_TYPES = ['binary', 'count', 'duration', 'negative'];

// HabitFormModal.tsx initialForm(): a new habit starts with HABIT_COLORS[5].
const DEFAULT_HABIT_COLOR = HABIT_COLORS[5];
// CategoryManagerModal.tsx: the new-category colour starts at HABIT_COLORS[6].
const DEFAULT_CATEGORY_COLOR = HABIT_COLORS[6];
// HabitFormModal.tsx initialForm(): a new habit starts with 'CheckCircle2'.
const DEFAULT_ICON = 'CheckCircle2';

// HabitDetailPanel.tsx: getHeatmap(habit.id, 365); handleHabitGet: buildStats(…, 30, …).
const HEATMAP_DAYS = 365;
const STATS_WINDOW = 30;
// FullHeatmap shows the last 365 days ending today: the only days a person can edit.
const EDITABLE_DAYS = 365;

const MS_PER_DAY = 86400000;

const RELOAD_NOTE = 'The open app shows this change after the person reloads it.';

/* --------------------------------------------------------------- plumbing */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Readable text of any error: JS errors, PocketBase (Go) errors, strings. */
function msg(err) {
  if (err === null || err === undefined) return 'unknown error';
  let text = '';
  if (typeof err === 'string') text = err;
  else {
    try {
      if (err.message) text = String(err.message);
    } catch (_) {
      text = '';
    }
    if (text === '') text = String(err);
  }
  // PocketBase validation errors read "name: Must be no more than 200 character(s).."
  return text.replace(/\.\.$/, '.');
}

/**
 * Run fn(params, app) and answer JSON in this app's shape: 200 with the result,
 * or e.json(status, { error }) like ops.pb.js. Errors are returned, never thrown.
 */
function handle(e, fn) {
  const p = {};
  try {
    const info = e.requestInfo();
    const query = info.query || {};
    for (const k of Object.keys(query)) p[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) p[k] = body[k];
  } catch (err) {
    return e.json(400, { error: 'Could not read the request: ' + msg(err) });
  }
  try {
    const out = fn(p, e.app);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    const status = err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error('[habit-tracker] agent op failed: ' + msg(err));
    return e.json(status, { error: msg(err) });
  }
}

/* ---------------------------------------------------------- param readers */

function has(p, name) {
  return p[name] !== undefined && p[name] !== null;
}

function str(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = p[name];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw fail(400, name + ' must be text');
}

function reqStr(p, name) {
  const v = str(p, name, '').trim();
  if (v === '') throw fail(400, name + ' is required');
  return v;
}

/** A number, or undefined when absent/blank. Numeric text is accepted. */
function num(p, name) {
  if (!has(p, name)) return undefined;
  const v = p[name];
  if (typeof v === 'string' && v.trim() === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  if (Number.isNaN(n) || !Number.isFinite(n)) throw fail(400, name + ' must be a number');
  return n;
}

function bool(p, name, dflt) {
  if (!has(p, name) || p[name] === '') return dflt;
  const v = p[name];
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  if (v === false || v === 'false' || v === '0' || v === 0) return false;
  throw fail(400, name + ' must be true or false');
}

/** A list of ids: a real list, a JSON list in text, or comma-separated text. */
function idList(p, name) {
  if (!has(p, name)) throw fail(400, name + ' is required (a JSON list of ids, e.g. ["id1","id2"])');
  let v = p[name];
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.charAt(0) === '[') {
      try {
        v = JSON.parse(t);
      } catch (_) {
        throw fail(400, name + ' must be a JSON list of ids, e.g. ["id1","id2"]');
      }
    } else {
      v = t === '' ? [] : t.split(',');
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.length === 'number') v = Array.from(v);
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list of ids');
  return v.map((x) => String(x).trim()).filter((x) => x !== '');
}

/** One of a fixed list; matches case-insensitively and returns the listed spelling. */
function choice(p, name, values, dflt, why) {
  if (!has(p, name) || String(p[name]).trim() === '') return dflt;
  const v = String(p[name]).trim().toLowerCase();
  for (const x of values) if (x.toLowerCase() === v) return x;
  throw fail(400, name + ' must be one of: ' + values.join(', ') + (why ? ' (' + why + ')' : ''));
}

function colorParam(p, dflt) {
  return choice(p, 'color', HABIT_COLORS, dflt, 'the colour palette the app offers');
}

function iconParam(p, dflt) {
  return choice(p, 'icon', ICON_NAMES, dflt, 'the icons the app\'s icon picker offers');
}

/** A day the UI can edit: YYYY-MM-DD within the last 365 days, today included. */
function dayParam(p, today) {
  if (!has(p, 'day') || String(p.day).trim() === '') return today;
  const day = String(p.day).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isoFromOrd(ord(day)) !== day) {
    throw fail(400, 'day must be a calendar date YYYY-MM-DD, e.g. ' + today);
  }
  const t0 = ord(today);
  const o = ord(day);
  if (o > t0) throw fail(400, 'day ' + day + ' is in the future; the app can only log days up to today (' + today + ')');
  if (o < t0 - (EDITABLE_DAYS - 1)) {
    throw fail(400, 'day ' + day + ' is outside the app\'s 365-day heatmap; the earliest day it can edit is ' + isoFromOrd(t0 - (EDITABLE_DAYS - 1)));
  }
  return day;
}

/* --------------------------------------------- dates (apiAdapter.ts ports) */

// apiAdapter.ts pad()
function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

// apiAdapter.ts todayIso(): the LOCAL calendar day, as lib/dates.ts todayIso()
// in the browser. On the server it is the local day of the machine running the
// app, which is the person's machine in the normal (loopback) setup.
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// apiAdapter.ts ord(): calendar day → UTC day ordinal (DST-proof arithmetic).
function ord(iso) {
  const parts = String(iso).split('-').map(Number);
  const y = parts[0] === undefined ? 1970 : parts[0];
  const m = parts[1] === undefined ? 1 : parts[1];
  const d = parts[2] === undefined ? 1 : parts[2];
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

// apiAdapter.ts isoFromOrd()
function isoFromOrd(n) {
  const dt = new Date(n * MS_PER_DAY);
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
}

// apiAdapter.ts round4()
function round4(x) {
  return Math.round(x * 10000) / 10000;
}

// apiAdapter.ts clamp()
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/* ------------------------------------------------- records → REST shapes */
// The adapter works on PocketBase's REST JSON. These build the same plain
// objects from hook Records so the ported functions below run unchanged.

function habitPlain(r) {
  return {
    id: r.id,
    name: r.getString('name'),
    description: r.getString('description'),
    type: r.getString('type'),
    kind: r.getString('kind'),
    target: r.getFloat('target'),
    unit: r.getString('unit'),
    color: r.getString('color'),
    icon: r.getString('icon'),
    category: r.getString('category'),
    order: r.getFloat('order'),
    archived: r.getBool('archived'),
    created: r.getString('created'),
  };
}

function entryPlain(r) {
  return {
    id: r.id,
    habit: r.getString('habit'),
    day: r.getString('day'),
    value: r.getFloat('value'),
    note: r.getString('note'),
  };
}

function categoryPlain(r) {
  return {
    id: r.id,
    name: r.getString('name'),
    color: r.getString('color'),
    order: r.getFloat('order'),
    created: r.getString('created'),
  };
}

/* ------------------------------------- habit types (apiAdapter.ts ports) */

// apiAdapter.ts toPbType(): count/duration → quantity; binary/negative → binary.
function toPbType(v1Type) {
  const t = String(v1Type === undefined || v1Type === null ? 'binary' : v1Type);
  return t === 'count' || t === 'duration' ? 'quantity' : 'binary';
}

// apiAdapter.ts toKind(): the exact form type, stored in habits.kind.
function toKind(v1Type) {
  const t = String(v1Type === undefined || v1Type === null ? 'binary' : v1Type);
  return HABIT_TYPES.indexOf(t) >= 0 ? t : 'binary';
}

// apiAdapter.ts toV1Type(): the stored kind when it agrees with the stored type;
// otherwise (no kind yet, or a record write that changed only type) quantity →
// count and binary → binary.
function toV1Type(rec) {
  const kind = String(rec.kind === undefined || rec.kind === null ? '' : rec.kind);
  const stored = habitNumeric(rec) ? 'quantity' : 'binary';
  if (HABIT_TYPES.indexOf(kind) >= 0 && toPbType(kind) === stored) return kind;
  return stored === 'quantity' ? 'count' : 'binary';
}

/* -------------------------------- completion (apiAdapter.ts ports, verbatim) */

// apiAdapter.ts habitNumeric()
function habitNumeric(rec) {
  return String(rec.type === undefined || rec.type === null ? 'binary' : rec.type) === 'quantity';
}

// apiAdapter.ts habitTarget()
function habitTarget(rec) {
  const t = rec.target;
  return t === undefined || t === null || t === '' ? 0 : Number(t);
}

// apiAdapter.ts isCompleted()
function isCompleted(rec, value) {
  if (!habitNumeric(rec)) return (value || 0) > 0;
  const target = habitTarget(rec);
  if (target <= 0) return (value || 0) > 0;
  return (value || 0) >= target;
}

// apiAdapter.ts intensity()
function intensity(rec, value) {
  if (value === undefined || value === null || value <= 0) return 0;
  if (!habitNumeric(rec)) return 1;
  const target = habitTarget(rec);
  if (target <= 0) return value > 0 ? 1 : 0;
  const ratio = value / target;
  return ratio >= 1 ? 1 : round4(ratio);
}

/* --------------------------- streaks and stats (apiAdapter.ts ports, verbatim) */

// apiAdapter.ts normsOf()
function normsOf(entryRecs) {
  return entryRecs.map((r) => ({ day: String(r.day === undefined || r.day === null ? '' : r.day), value: Number(r.value === undefined || r.value === null ? 0 : r.value) }));
}

// apiAdapter.ts completedDays()
function completedDays(rec, norms) {
  const s = new Set();
  for (const n of norms) if (n.day && isCompleted(rec, n.value)) s.add(n.day);
  return s;
}

// apiAdapter.ts currentStreak(): anchored on today, else yesterday, else 0.
function currentStreak(rec, norms, today) {
  const completed = completedDays(rec, norms);
  if (completed.size === 0) return 0;
  const t0 = ord(today);
  let anchor;
  if (completed.has(today)) anchor = t0;
  else if (completed.has(isoFromOrd(t0 - 1))) anchor = t0 - 1;
  else return 0;
  let streak = 0;
  let cursor = anchor;
  while (completed.has(isoFromOrd(cursor))) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

// apiAdapter.ts bestStreak()
function bestStreak(rec, norms) {
  const ords = Array.from(completedDays(rec, norms)).map(ord).sort((a, b) => a - b);
  if (ords.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < ords.length; i += 1) {
    if (ords[i] - ords[i - 1] === 1) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

// apiAdapter.ts completionRate()
function completionRate(rec, norms, window, today) {
  if (window <= 0) return 0;
  const t0 = ord(today);
  const start = t0 - (window - 1);
  const completed = completedDays(rec, norms);
  let n = 0;
  for (const day of completed) {
    const o = ord(day);
    if (o >= start && o <= t0) n += 1;
  }
  return round4(n / window);
}

// apiAdapter.ts trend()
function trend(rec, norms, window, today) {
  const t0 = ord(today);
  const byDay = new Map();
  for (const n of norms) byDay.set(n.day, n.value);
  const out = [];
  for (let n = window - 1; n >= 0; n -= 1) {
    const day = isoFromOrd(t0 - n);
    const value = byDay.has(day) ? byDay.get(day) : 0;
    out.push({ date: day, value: value, completed: isCompleted(rec, value), intensity: intensity(rec, value) });
  }
  return out;
}

// apiAdapter.ts totalCompletions()
function totalCompletions(rec, norms) {
  let n = 0;
  for (const nm of norms) if (isCompleted(rec, nm.value)) n += 1;
  return n;
}

// apiAdapter.ts buildStats()
function buildStats(rec, norms, window, today) {
  return {
    currentStreak: currentStreak(rec, norms, today),
    bestStreak: bestStreak(rec, norms),
    completionRate: completionRate(rec, norms, window, today),
    trend: trend(rec, norms, window, today),
    totalCompletions: totalCompletions(rec, norms),
  };
}

/* ------------------------------------- ordering (apiAdapter.ts ports) */

// apiAdapter.ts sortHabits(): by order, then created. (localeCompare on the
// created timestamps there; plain comparison gives the same order for them.)
function sortHabits(rows) {
  return Array.from(rows).sort((a, b) => {
    const d = Number(a.order || 0) - Number(b.order || 0);
    if (d !== 0) return d;
    const ca = String(a.created || '');
    const cb = String(b.created || '');
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

// apiAdapter.ts handleCategoriesList(): 'sort=order,created'.
function sortCategories(rows) {
  return sortHabits(rows);
}

/* -------------------------------------------- output shapes (ports) */

// apiAdapter.ts toCategory()
function categoryOut(rec) {
  return {
    id: rec.id,
    name: String(rec.name === undefined || rec.name === null ? '' : rec.name),
    color: String(rec.color === undefined || rec.color === null ? '#737373' : rec.color),
    order: Number(rec.order || 0),
  };
}

// apiAdapter.ts toEntry(): value, note (null when empty), completed.
function entryOut(rec, habit) {
  const value = Number(rec.value || 0);
  return {
    day: String(rec.day || ''),
    value: value,
    note: rec.note ? String(rec.note) : null,
    completed: habit ? isCompleted(habit, value) : value > 0,
  };
}

// apiAdapter.ts toHabitBase(): target 0 → null, unit '' → null, type as the UI shows it.
function habitOut(rec, catById) {
  const target = rec.target === undefined || rec.target === null || rec.target === '' || Number(rec.target) === 0 ? null : Number(rec.target);
  const catRaw = rec.category || '';
  const cat = catRaw && catById ? catById.get(catRaw) : undefined;
  return {
    id: rec.id,
    name: String(rec.name === undefined || rec.name === null ? '' : rec.name),
    description: rec.description ? String(rec.description) : null,
    type: toV1Type(rec),
    stored_type: rec.type ? String(rec.type) : 'binary',
    target: target,
    unit: rec.unit ? String(rec.unit) : null,
    color: String(rec.color === undefined || rec.color === null ? '#737373' : rec.color),
    icon: String(rec.icon === undefined || rec.icon === null ? 'Circle' : rec.icon),
    category_id: catRaw || null,
    category_name: cat ? cat.name : null,
    order: Number(rec.order || 0),
    archived: Boolean(rec.archived),
  };
}

// apiAdapter.ts toHabitWithToday(): base + today's entry + current streak.
function habitWithToday(rec, entryRecs, catById, today) {
  const base = habitOut(rec, catById);
  let todayRec = null;
  for (const e of entryRecs) {
    if (String(e.day || '') === today) {
      todayRec = e;
      break;
    }
  }
  base.today = todayRec ? entryOut(todayRec, rec) : null;
  base.current_streak = currentStreak(rec, normsOf(entryRecs), today);
  return base;
}

// HabitDetailPanel.tsx day editor label: completed / partial / — ("none").
function dayStatus(habit, value) {
  if (isCompleted(habit, value)) return 'completed';
  return value > 0 ? 'partial' : 'none';
}

/* ----------------------------------------------------------- loaders */

function allPlain(app, collection, toPlain) {
  return Array.from(app.findAllRecords(collection)).map(toPlain);
}

function entriesOf(app, habitId) {
  return Array.from(app.findRecordsByFilter('entries', 'habit = {:h}', '', 0, 0, { h: habitId })).map(entryPlain);
}

// apiAdapter.ts loadHabitContext(): entries grouped by habit.
function groupEntries(entries) {
  const byHabit = new Map();
  for (const e of entries) {
    if (!e.habit) continue;
    const arr = byHabit.get(e.habit);
    if (arr) arr.push(e);
    else byHabit.set(e.habit, [e]);
  }
  return byHabit;
}

function categoryMap(app) {
  const m = new Map();
  for (const c of allPlain(app, 'categories', categoryPlain)) m.set(c.id, c);
  return m;
}

function habitRecord(app, p) {
  const id = reqStr(p, 'habit_id');
  try {
    return app.findRecordById('habits', id);
  } catch (_) {
    throw fail(404, 'No habit "' + id + '". app.state lists the habits and their ids.');
  }
}

function categoryRecord(app, id) {
  try {
    return app.findRecordById('categories', id);
  } catch (_) {
    throw fail(404, 'No category "' + id + '". app.state lists the categories and their ids.');
  }
}

function notArchived(habit) {
  if (habit.archived) {
    throw fail(409, 'Habit "' + habit.name + '" is archived; the app hides archived habits. Bring it back first with habits.archive --archived false.');
  }
}

function countAll(app, collection) {
  try {
    return Number(app.countRecords(collection));
  } catch (_) {
    return Array.from(app.findAllRecords(collection)).length;
  }
}

function saveOr400(app, rec) {
  try {
    app.save(rec);
  } catch (err) {
    throw fail(400, msg(err));
  }
}

/* -------------------------------------------------------------- app */

const GUIDE = {
  app: 'Habit Tracker: one person\'s daily habits. The main screen is a today-focused habit list with category filter chips and a dashboard (done today, this week\'s completion, active streaks, top streak); each habit has a detail panel with its streaks, 30-day rate, total completions, a 365-day heatmap, a 30-day trend and a per-day editor (value and note).',
  objects: {
    categories: 'Groups for habits: name and a palette colour. Shown as filter chips in list order. Deleting one leaves its habits Uncategorized (they and their history are kept).',
    habits: 'A tracked habit: name, description, type, per-day target and unit (count/duration), colour, icon, category, list position, archived.',
    entries: 'One per habit per day: day (YYYY-MM-DD), value, optional note.',
  },
  habit_types: {
    binary: 'Done / not done. A day is 1 (done) or 0.',
    negative: '"Avoid": a habit to break. Works like binary (1 = avoided that day); the app shows a ban icon until the day is done. Stored as type binary, kind negative.',
    count: 'Count up to a per-day target (e.g. 8 glasses). The day\'s value is the count. Stored as type quantity, kind count.',
    duration: 'Minutes per day against a target. Works like count, but the app\'s row button sets the day to the target or back to 0. Stored as type quantity, kind duration.',
  },
  rules: {
    completed: 'binary: value above 0. count/duration: value at or above the target (above 0 when there is no target).',
    partial: 'count/duration with a value above 0 but below the target.',
    current_streak: 'Consecutive completed days ending today, or ending yesterday while today is not done yet; otherwise 0.',
    best_streak: 'The longest run of consecutive completed days.',
    completion_rate_30d: 'Completed days in the last 30 days (today included) divided by 30.',
    total_completions: 'All completed days ever.',
    weekly_rate: 'Completed habit-days in the last 7 days divided by 7 × the number of active habits.',
    active_streaks: 'Active habits whose current streak is 7 days or more.',
    archived: 'Archived habits are hidden from the list and left out of the dashboard; their history is kept. habits.archive --archived false brings one back.',
  },
  days: 'Days are calendar days written YYYY-MM-DD. "today" is the local date of the machine that runs the app (the person\'s own machine in the normal setup); every result says which today it used, and there is no other date override. Operations that log a day take --day YYYY-MM-DD (default today) within the last 365 days, today included: the days the app\'s heatmap can edit. Future days are refused.',
  values: 'binary/negative days take 0 or 1. count/duration days take any number of 0 or more (decimals allowed). A note can be set on any day; an empty note clears it.',
  colors: HABIT_COLORS,
  icons: ICON_NAMES,
  screen: 'The open app does not refresh by itself. After you change anything, tell the person the change shows once they reload the app.',
  recipes: [
    'See the main screen: app.state (--search text and --category_id filter the list like the app; --include_archived true also lists archived habits).',
    'Find a habit id by name: app.state --search water.',
    'Check in today: entries.mark --habit_id {id} --done true (undo: --done false).',
    'Log a count: entries.add --habit_id {id} --amount 2 (a negative amount subtracts; never below 0).',
    'Set an exact value or backfill a day: entries.set --habit_id {id} --day 2026-01-31 --value 6.',
    'Note on a day: entries.set --habit_id {id} --day {day} --note "text" (an empty note clears it).',
    'One habit\'s stats and 30-day trend: habits.get --habit_id {id}. Its day-by-day history: habits.history --habit_id {id} --days 30.',
    'Add a habit: habits.create --name Meditate --type duration --target 10 --icon Timer. Change one: habits.update --habit_id {id} --target 12.',
    'Archive or bring back: habits.archive --habit_id {id} --archived true (or false).',
    'Reorder the list: habits.reorder --habit_ids \'["id1","id2"]\' (pass every active habit, top first).',
    'Categories: categories.create --name Health; rename or recolour by updating the category record (name, color); categories.delete leaves its habits Uncategorized.',
    'Destructive (the person approves): habits.delete (a habit and all its history), habits.clear-entries (a habit\'s history only), categories.delete.',
  ],
};

function guide() {
  return Object.assign({ today: todayIso() }, GUIDE);
}

/**
 * The main screen in one call. Ports AppController.refresh(): GET /api/habits
 * (apiAdapter handleHabitsList), GET /api/categories (handleCategoriesList),
 * GET /api/dashboard (handleDashboard); DashboardSidebar's top streak; and
 * MainView's visibleHabits filter (search + category chip).
 */
function state(app, p) {
  const search = str(p, 'search', '');
  const categoryId = str(p, 'category_id', '').trim();
  const includeArchived = bool(p, 'include_archived', false);
  const today = todayIso();

  const cats = sortCategories(allPlain(app, 'categories', categoryPlain));
  const catById = new Map();
  for (const c of cats) catById.set(c.id, c);
  if (categoryId !== '' && !catById.has(categoryId)) {
    throw fail(404, 'No category "' + categoryId + '". The categories are listed in app.state.');
  }

  const habits = allPlain(app, 'habits', habitPlain);
  const entriesByHabit = groupEntries(allPlain(app, 'entries', entryPlain));

  // handleHabitsList(): archived are left out unless include_archived.
  const listed = sortHabits(includeArchived ? habits : habits.filter((r) => r.archived !== true));
  const rows = listed.map((rec) => habitWithToday(rec, entriesByHabit.get(rec.id) || [], catById, today));

  // MainView.tsx visibleHabits: category chip, then case-insensitive name search.
  const q = search.trim().toLowerCase();
  const visible = rows.filter((h) => {
    if (categoryId !== '' && (h.category_id || null) !== categoryId) return false;
    if (!q) return true;
    return h.name.toLowerCase().indexOf(q) >= 0;
  });

  // handleDashboard() over active habits; percentages as the sidebar rounds them.
  const d = dashboard(habits, entriesByHabit, today);
  const ratio = d.todayTotal > 0 ? d.todayCompleted / d.todayTotal : 0;

  // DashboardSidebar.tsx: the longest current streak among the listed active
  // habits; the first one in list order wins; shown only when above 0.
  const active = rows.filter((h) => !h.archived);
  let longest = 0;
  for (const h of active) longest = Math.max(longest, h.current_streak || 0);
  let top = null;
  for (const h of active) {
    if ((h.current_streak || 0) === longest && longest > 0) {
      top = { habit_id: h.id, name: h.name, days: longest };
      break;
    }
  }

  return {
    today: today,
    summary: {
      today_completed: d.todayCompleted,
      today_total: d.todayTotal,
      today_percent: Math.round(ratio * 100),
      weekly_rate: d.weeklyRate,
      weekly_percent: Math.round(d.weeklyRate * 100),
      active_streaks: d.activeStreaks,
    },
    top_streak: top,
    categories: cats.map(categoryOut),
    habits: visible,
    shown: visible.length,
    total: rows.length,
  };
}

// apiAdapter.ts handleDashboard()
function dashboard(habits, entriesByHabit, today) {
  const active = habits.filter((h) => h.archived !== true);
  if (active.length === 0) {
    return { todayCompleted: 0, todayTotal: 0, weeklyRate: 0, activeStreaks: 0 };
  }
  const t0 = ord(today);
  let todayCompleted = 0;
  let weekCompleted = 0;
  let activeStreaks = 0;
  const weekSlots = 7 * active.length;
  for (const h of active) {
    const recs = entriesByHabit.get(h.id) || [];
    const byDay = new Map();
    for (const r of recs) byDay.set(String(r.day || ''), Number(r.value || 0));
    if (byDay.has(today) && isCompleted(h, byDay.get(today))) todayCompleted += 1;
    for (let n = 0; n < 7; n += 1) {
      const day = isoFromOrd(t0 - n);
      if (byDay.has(day) && isCompleted(h, byDay.get(day))) weekCompleted += 1;
    }
    if (currentStreak(h, normsOf(recs), today) >= 7) activeStreaks += 1;
  }
  return {
    todayCompleted: todayCompleted,
    todayTotal: active.length,
    weeklyRate: weekSlots ? round4(weekCompleted / weekSlots) : 0,
    activeStreaks: activeStreaks,
  };
}

/* ----------------------------------------------------------- habits: reads */

/**
 * The detail panel. Ports apiAdapter.ts handleHabitGet(): toHabitWithToday +
 * buildStats(…, 30, today), formatted as HabitDetailPanel's tiles and TrendChart.
 */
function habitGet(app, p) {
  const rec = habitPlain(habitRecord(app, p));
  const today = todayIso();
  const entries = entriesOf(app, rec.id);
  const base = habitWithToday(rec, entries, categoryMap(app), today);
  const stats = buildStats(rec, normsOf(entries), STATS_WINDOW, today);
  base.best_streak = stats.bestStreak;
  base.completion_rate_30d = stats.completionRate;
  base.completion_percent_30d = Math.round(stats.completionRate * 100);
  base.total_completions = stats.totalCompletions;
  base.trend_30d = stats.trend;
  base.trend_completed_days = stats.trend.filter((t) => t.completed).length;
  base.today_date = today;
  return base;
}

/**
 * The heatmap. Ports apiAdapter.ts handleHabitHeatmap() (days clamped 7–730,
 * default 365). By default only days with a value or a note are listed.
 */
function habitHistory(app, p) {
  const rec = habitPlain(habitRecord(app, p));
  const raw = num(p, 'days');
  const days = clamp(Number(raw === undefined ? HEATMAP_DAYS : raw) || HEATMAP_DAYS, 7, 730);
  const allDays = bool(p, 'all_days', false);
  const byDay = new Map();
  for (const r of entriesOf(app, rec.id)) byDay.set(String(r.day || ''), r);
  const today = todayIso();
  const t0 = ord(today);
  const cells = [];
  for (let n = days - 1; n >= 0; n -= 1) {
    const day = isoFromOrd(t0 - n);
    const e = byDay.get(day);
    const value = e ? Number(e.value || 0) : 0;
    cells.push({
      date: day,
      value: value,
      completed: isCompleted(rec, value),
      intensity: intensity(rec, value),
      note: e && e.note ? String(e.note) : null,
    });
  }
  const logged = cells.filter((c) => c.value > 0 || c.note !== null);
  return {
    habit_id: rec.id,
    habit_name: rec.name,
    color: String(rec.color === undefined || rec.color === null ? '#737373' : rec.color),
    today: today,
    days: days,
    from: cells.length ? cells[0].date : today,
    to: today,
    logged_days: logged.length,
    completed_days: cells.filter((c) => c.completed).length,
    cells: allDays ? cells : logged,
  };
}

/* ---------------------------------------------------------- habits: writes */

// HabitFormModal.tsx initialForm(habit): the edit form starts from the habit as
// the app reads it (apiAdapter toHabitBase; type from toV1Type).
function initialForm(h) {
  return {
    name: h.name,
    description: h.description || '',
    type: h.type,
    target: h.target !== null && h.target !== undefined ? String(h.target) : '',
    unit: h.unit || '',
    color: h.color,
    icon: h.icon,
    category_id: h.category_id || null,
  };
}

// HabitFormModal.tsx validate()
function validateForm(form) {
  if (!String(form.name).trim()) throw fail(400, 'Name is required');
  if (form.type === 'count' || form.type === 'duration') {
    const n = Number(form.target);
    if (!form.target || Number.isNaN(n) || n <= 0) {
      throw fail(400, 'Target must be a positive number (count and duration habits need --target)');
    }
  }
}

// HabitFormModal.tsx submit(): the payload the form sends.
function formPayload(form) {
  const quantity = form.type === 'count' || form.type === 'duration';
  return {
    name: String(form.name).trim(),
    description: String(form.description).trim() || null,
    type: form.type,
    target: quantity ? Number(form.target) : null,
    unit: quantity ? String(form.unit).trim() || (form.type === 'duration' ? 'min' : 'reps') : null,
    color: form.color,
    icon: form.icon,
    category_id: form.category_id,
  };
}

/** Read the form fields an agent passed onto a form state. */
function applyParams(app, form, p) {
  if (has(p, 'name')) form.name = str(p, 'name', '');
  if (has(p, 'description')) form.description = str(p, 'description', '');
  if (has(p, 'type') && String(p.type).trim() !== '') form.type = choice(p, 'type', HABIT_TYPES, form.type);
  if (has(p, 'target')) {
    const t = num(p, 'target');
    form.target = t === undefined ? '' : String(t);
  }
  if (has(p, 'unit')) form.unit = str(p, 'unit', '');
  if (has(p, 'color') && String(p.color).trim() !== '') form.color = colorParam(p, form.color);
  if (has(p, 'icon') && String(p.icon).trim() !== '') form.icon = iconParam(p, form.icon);
  if (has(p, 'category_id')) {
    const c = str(p, 'category_id', '').trim();
    if (c === '' || c.toLowerCase() === 'none') {
      form.category_id = null;
    } else {
      categoryRecord(app, c);
      form.category_id = c;
    }
  }
}

/**
 * habits.create. Ports HabitFormModal submit() (create) and then
 * apiAdapter.ts handleHabitCreate(): type → binary|quantity, order = count of
 * all habits, archived false, target only for count/duration.
 */
function habitCreate(app, p) {
  const form = {
    name: '',
    description: '',
    type: 'binary',
    target: '',
    unit: '',
    color: DEFAULT_HABIT_COLOR,
    icon: DEFAULT_ICON,
    category_id: null,
  };
  applyParams(app, form, p);
  validateForm(form);
  const body = formPayload(form);

  // apiAdapter.ts handleHabitCreate()
  const count = countAll(app, 'habits');
  const rec = new Record(app.findCollectionByNameOrId('habits'));
  rec.set('name', body.name);
  rec.set('description', body.description === null ? '' : body.description);
  rec.set('type', toPbType(body.type));
  rec.set('kind', toKind(body.type));
  rec.set('unit', body.unit === null ? '' : body.unit);
  rec.set('color', body.color);
  rec.set('icon', body.icon);
  rec.set('order', count);
  rec.set('archived', false);
  if (body.target !== null && body.target !== '') rec.set('target', Number(body.target));
  if (body.category_id) rec.set('category', body.category_id);
  saveOr400(app, rec);

  const out = habitOut(habitPlain(rec), categoryMap(app));
  out.screen = RELOAD_NOTE;
  return out;
}

/**
 * habits.update. Ports the edit path of HabitFormModal submit() (the form
 * re-sends every field from its state) and apiAdapter.ts handleHabitUpdate().
 */
function habitUpdate(app, p) {
  const rec = habitRecord(app, p);
  const current = habitOut(habitPlain(rec), null);
  notArchived(current);
  const fields = ['name', 'description', 'type', 'target', 'unit', 'color', 'icon', 'category_id'];
  if (!fields.some((f) => has(p, f))) throw fail(400, 'Pass at least one of: ' + fields.join(', '));

  const form = initialForm(current);
  applyParams(app, form, p);
  validateForm(form);
  const body = formPayload(form);

  // apiAdapter.ts handleHabitUpdate(): every field of the form's payload.
  rec.set('name', body.name);
  rec.set('description', body.description === null ? '' : body.description);
  rec.set('type', toPbType(body.type));
  rec.set('kind', toKind(body.type));
  rec.set('target', body.target === null || body.target === '' ? 0 : Number(body.target));
  rec.set('unit', body.unit === null ? '' : body.unit);
  rec.set('color', body.color);
  rec.set('icon', body.icon);
  rec.set('category', body.category_id === null ? '' : body.category_id);
  saveOr400(app, rec);

  const out = habitOut(habitPlain(rec), categoryMap(app));
  out.screen = RELOAD_NOTE;
  return out;
}

/** habits.archive. Ports HabitFormModal archive() → updateHabit(id, { archived }). */
function habitArchive(app, p) {
  const rec = habitRecord(app, p);
  const archived = bool(p, 'archived', true);
  const before = rec.getBool('archived');
  if (before !== archived) {
    rec.set('archived', archived);
    saveOr400(app, rec);
  }
  return { id: rec.id, name: rec.getString('name'), archived: archived, changed: before !== archived, screen: RELOAD_NOTE };
}

/**
 * habits.reorder. Ports HabitList drop → AppController.reorderHabits →
 * apiAdapter.ts handleHabitsReorder(): order = position for each listed id;
 * habits not listed keep their order.
 */
function habitReorder(app, p) {
  const ids = idList(p, 'habit_ids');
  if (ids.length === 0) throw fail(400, 'habit_ids is empty; pass every active habit id in the order you want');
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw fail(400, 'habit_ids lists "' + id + '" twice');
    seen.add(id);
    try {
      app.findRecordById('habits', id);
    } catch (_) {
      throw fail(404, 'No habit "' + id + '". app.state lists the habits and their ids.');
    }
  }
  try {
    app.runInTransaction((tx) => {
      for (let i = 0; i < ids.length; i += 1) {
        const r = tx.findRecordById('habits', ids[i]);
        r.set('order', i);
        tx.save(r);
      }
    });
  } catch (err) {
    throw fail(400, msg(err));
  }
  const active = sortHabits(allPlain(app, 'habits', habitPlain).filter((h) => h.archived !== true));
  return {
    count: ids.length,
    order: active.map((h) => ({ id: h.id, name: h.name, order: Number(h.order || 0) })),
    screen: RELOAD_NOTE,
  };
}

/** habits.delete. Ports HabitFormModal remove() → handleHabitDelete(); entries cascade. */
function habitDelete(app, p) {
  const rec = habitRecord(app, p);
  const name = rec.getString('name');
  const entries = entriesOf(app, rec.id).length;
  try {
    app.delete(rec);
  } catch (err) {
    throw fail(400, msg(err));
  }
  return { deleted: rec.id, name: name, entries_removed: entries, screen: RELOAD_NOTE };
}

/* ---------------------------------------------------------------- entries */

/**
 * apiAdapter.ts handleEntryUpsert(): find the (habit, day) row; create it with
 * value (default 0) and note (default ''), or patch only the fields given.
 * decide(before) returns the fields to write, or null to write nothing. Runs in
 * a transaction; a create racing the app's own upsert (UNIQUE habit+day) is
 * retried once, which turns it into an update.
 */
function upsertEntry(app, habitId, day, decide) {
  let result = null;
  const attempt = () => {
    result = null;
    app.runInTransaction((tx) => {
      let rec = null;
      try {
        rec = tx.findFirstRecordByFilter('entries', 'habit = {:h} && day = {:d}', { h: habitId, d: day });
      } catch (_) {
        rec = null;
      }
      const before = rec ? entryPlain(rec) : null;
      const patch = decide(before);
      if (!patch) {
        result = { before: before, after: before, changed: false };
        return;
      }
      if (!rec) {
        rec = new Record(tx.findCollectionByNameOrId('entries'));
        rec.set('habit', habitId);
        rec.set('day', day);
        rec.set('value', patch.value !== undefined && patch.value !== null ? Number(patch.value) : 0);
        rec.set('note', patch.note !== undefined && patch.note !== null ? String(patch.note) : '');
      } else {
        if (patch.value !== undefined && patch.value !== null) rec.set('value', Number(patch.value));
        if (patch.note !== undefined && patch.note !== null) rec.set('note', String(patch.note));
      }
      tx.save(rec);
      result = { before: before, after: entryPlain(rec), changed: true };
    });
  };
  try {
    attempt();
  } catch (err) {
    if (!/UNIQUE/i.test(msg(err))) throw fail(400, msg(err));
    try {
      attempt();
    } catch (err2) {
      throw fail(400, msg(err2));
    }
  }
  return result;
}

/** The answer of every entry write: the day as the day editor shows it. */
function entryResult(app, habit, day, res, today, extra) {
  const after = res.after;
  const value = after ? Number(after.value || 0) : 0;
  const out = {
    habit_id: habit.id,
    habit_name: habit.name,
    day: day,
    value: value,
    note: after && after.note ? after.note : null,
    completed: isCompleted(habit, value),
    status: dayStatus(habit, value),
    changed: res.changed,
    current_streak: currentStreak(habit, normsOf(entriesOf(app, habit.id)), today),
    today: today,
  };
  if (extra) Object.assign(out, extra);
  out.screen = RELOAD_NOTE;
  return out;
}

/**
 * entries.set. Ports HabitDetailPanel onCommitCellValue (value: rejects NaN and
 * negatives, no write when unchanged), onSaveNote (note, with the day's value)
 * and the 0/1 writes of the binary controls, all through upsertEntry().
 */
function entrySet(app, p) {
  const habit = habitPlain(habitRecord(app, p));
  notArchived(habit);
  const today = todayIso();
  const day = dayParam(p, today);
  const value = num(p, 'value');
  const hasNote = has(p, 'note');
  const note = hasNote ? str(p, 'note', '') : undefined;
  if (value === undefined && !hasNote) throw fail(400, 'Pass value and/or note');
  if (value !== undefined) {
    if (value < 0) throw fail(400, 'value must be 0 or more');
    if (!habitNumeric(habit) && value !== 0 && value !== 1) {
      throw fail(400, 'A ' + toV1Type(habit) + ' habit takes value 0 (not done) or 1 (done); or use entries.mark');
    }
  }
  const res = upsertEntry(app, habit.id, day, (before) => {
    if (!before) {
      // onCommitCellValue: typing the value an empty day already shows (0) writes nothing.
      if (!hasNote && value === 0) return null;
      return { value: value === undefined ? 0 : value, note: hasNote ? note : undefined };
    }
    const patch = {};
    let any = false;
    if (value !== undefined && value !== before.value) {
      patch.value = value;
      any = true;
    }
    if (hasNote && note !== before.note) {
      patch.note = note;
      any = true;
    }
    return any ? patch : null;
  });
  return entryResult(app, habit, day, res, today, null);
}

/**
 * entries.mark. Ports AppController.toggleToday() and HabitDetailPanel
 * onToggleCell(): not done → 0; done → 1 (binary/negative) or the target
 * (count: target ?? 1; duration: target ?? 30, as its row button writes).
 * Explicit done/not done instead of a flip: nothing is written when the day is
 * already in that state.
 */
function entryMark(app, p) {
  const habit = habitPlain(habitRecord(app, p));
  notArchived(habit);
  if (!has(p, 'done') || p.done === '') throw fail(400, 'done is required (true or false)');
  const done = bool(p, 'done', true);
  const today = todayIso();
  const day = dayParam(p, today);
  const base = habitOut(habit, null);
  const res = upsertEntry(app, habit.id, day, (before) => {
    const current = before ? before.value : 0;
    if (isCompleted(habit, current) === done) return null;
    if (!done) return { value: 0 };
    if (!habitNumeric(habit)) return { value: 1 };
    return { value: base.target === null ? (base.type === 'duration' ? 30 : 1) : base.target };
  });
  return entryResult(app, habit, day, res, today, null);
}

/**
 * entries.add. Ports the row's +/− buttons (HabitList onIncrement):
 * next = max(0, value + delta), written through upsertEntry() in the same
 * transaction as the read.
 */
function entryAdd(app, p) {
  const habit = habitPlain(habitRecord(app, p));
  notArchived(habit);
  if (!habitNumeric(habit)) {
    throw fail(400, 'A ' + toV1Type(habit) + ' habit has no count to add to; use entries.mark --done true|false');
  }
  const raw = num(p, 'amount');
  const amount = raw === undefined ? 1 : raw;
  if (amount === 0) throw fail(400, 'amount must not be 0');
  const today = todayIso();
  const day = dayParam(p, today);
  let previous = 0;
  const res = upsertEntry(app, habit.id, day, (before) => {
    const current = before ? before.value : 0;
    previous = current;
    const next = Math.max(0, current + amount);
    if (next === current) return null;
    return { value: next };
  });
  return entryResult(app, habit, day, res, today, { previous: previous });
}

/* ------------------------------------------------------------- categories */

/**
 * categories.create. Ports CategoryManagerModal create() and apiAdapter.ts
 * handleCategoryCreate(): trimmed name required, order = number of categories.
 */
function categoryCreate(app, p) {
  const name = str(p, 'name', '').trim();
  if (!name) throw fail(400, 'name required');
  const color = colorParam(p, DEFAULT_CATEGORY_COLOR);
  const count = countAll(app, 'categories');
  const rec = new Record(app.findCollectionByNameOrId('categories'));
  rec.set('name', name);
  rec.set('color', color);
  rec.set('order', count);
  saveOr400(app, rec);
  const out = categoryOut(categoryPlain(rec));
  out.screen = RELOAD_NOTE;
  return out;
}

/**
 * categories.delete. Ports CategoryManagerModal remove() → handleCategoryDelete():
 * the category is deleted and PocketBase empties the (non-cascade) category
 * relation on its habits, which become Uncategorized.
 */
function categoryDelete(app, p) {
  const id = reqStr(p, 'category_id');
  const rec = categoryRecord(app, id);
  const name = rec.getString('name');
  const habits = Array.from(app.findRecordsByFilter('habits', 'category = {:c}', '', 0, 0, { c: id })).length;
  try {
    app.delete(rec);
  } catch (err) {
    throw fail(400, msg(err));
  }
  return { deleted: id, name: name, habits_uncategorized: habits, screen: RELOAD_NOTE };
}

module.exports = {
  handle: handle,
  guide: guide,
  state: state,
  habitGet: habitGet,
  habitHistory: habitHistory,
  habitCreate: habitCreate,
  habitUpdate: habitUpdate,
  habitArchive: habitArchive,
  habitReorder: habitReorder,
  habitDelete: habitDelete,
  entrySet: entrySet,
  entryMark: entryMark,
  entryAdd: entryAdd,
  categoryCreate: categoryCreate,
  categoryDelete: categoryDelete,
};
