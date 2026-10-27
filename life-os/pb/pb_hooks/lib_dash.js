/// <reference path="../pb_data/types.d.ts" />
/**
 * Home: today at a glance in one call. Today's cards, the habits to tap,
 * the body, the money left, who to reach, what is coming up in the next
 * week (calendar, plans, bills, trips, birthdays), the latest moment from
 * the journal, the goals in motion, and nudges worked out from all of it
 * (a birthday in three days, a bill due Friday, rain this afternoon).
 * Weather and news load beside it (lib_world), so Home never waits on them.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}

function partOf(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** Nudges from the person's own data (never invented): what deserves a look today. */
function nudges(app, today, on, people, bills, trips) {
  const C = core();
  const out = [];
  if (on.relationships) {
    people.birthdays
      .filter((p) => p.next_birthday.in_days <= 7)
      .slice(0, 2)
      .forEach((p) => out.push({ kind: 'birthday', area: p.area, text: p.next_birthday.in_days === 0 ? 'It is ' + p.name + "'s birthday today" + (p.next_birthday.age ? ' (' + p.next_birthday.age + ')' : '') : p.name + "'s birthday is " + (p.next_birthday.in_days === 1 ? 'tomorrow' : 'in ' + p.next_birthday.in_days + ' days'), person: { id: p.id, name: p.name, look: p.look } }));
    const due = people.due[0];
    if (due) out.push({ kind: 'reach', area: due.area, text: due.days_since === null ? 'You have not noted talking to ' + due.name + ' yet' : 'It has been ' + (due.days_since >= 14 ? Math.round(due.days_since / 7) + ' weeks' : due.days_since + ' days') + ' since you talked to ' + due.name, person: { id: due.id, name: due.name, look: due.look } });
  }
  if (on.money) {
    bills
      .filter((b) => !b.paid && b.in_days <= 3)
      .slice(0, 2)
      .forEach((b) => out.push({ kind: 'bill', area: 'money', ref: { collection: 'bills', id: b.id }, text: b.name + (b.late ? ' is late' : b.in_days === 0 ? ' is due today' : b.in_days === 1 ? ' is due tomorrow' : ' is due in ' + b.in_days + ' days') + (b.amount > 0 ? ' (' + C.money(app, b.amount) + ')' : '') }));
  }
  const hit = app.store().get('lo_weather');
  if (hit && hit.data && hit.data.hours) {
    const wet = hit.data.hours.slice(0, 14).find((h) => h.rain !== null && h.rain >= 60);
    if (wet) out.push({ kind: 'weather', area: '', text: 'Rain is likely around ' + wet.time + '. Take an umbrella.' });
    const d0 = (hit.data.days || [])[0];
    if (d0 && d0.uv !== null && d0.uv >= 7 && !wet) out.push({ kind: 'weather', area: 'health', text: 'Strong sun today (UV ' + Math.round(d0.uv) + '). Sunscreen if you go out.' });
  }
  if (on.fun) {
    const t = trips.find((x) => x.state === 'coming' && x.in_days <= 14);
    if (t) out.push({ kind: 'trip', area: 'fun', ref: { collection: 'trips', id: t.id }, text: t.title + ' in ' + t.in_days + ' day' + (t.in_days === 1 ? '' : 's') + (t.checklist.length > 0 ? ': packed ' + t.packed + ' of ' + t.checklist.length : '') });
  }
  if (on.home) {
    const due = require(`${__hooks}/lib_house.js`).choreList({ app: app }).chores.filter((c) => c.due_in < 0);
    if (due.length > 0) out.push({ kind: 'chores', area: 'home', ref: { collection: 'chores', ids: due.map((c) => c.id) }, text: due.length === 1 ? '"' + due[0].name + '" is overdue' : due.length + ' chores are overdue' });
  }
  return out.slice(0, 5);
}

/** home.summary */
function summary(ctx) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const now = C.now(app);
  const today = now.today;
  const s = C.settings(app);
  const kinds = C.enabledKinds(app);
  const on = {};
  kinds.forEach((k) => (on[k] = true));
  const T = require(`${__hooks}/lib_tasks.js`);
  const H = require(`${__hooks}/lib_habits.js`);
  const P = require(`${__hooks}/lib_people.js`);
  const M = require(`${__hooks}/lib_money.js`);
  const G = require(`${__hooks}/lib_goals.js`);
  const D = require(`${__hooks}/lib_days.js`);
  const J = require(`${__hooks}/lib_journal.js`);
  const F = require(`${__hooks}/lib_fun.js`);

  const todayTasks = app.findRecordsByFilter('tasks', "(state = 'open' && someday = false && do_date != '' && do_date <= {:t}) || (state = 'done' && done_date = {:t})", 'rank,created', 0, 0, { t: today }).map((t) => T.taskOut(app, t, today));
  todayTasks.sort((a, b) => (a.state !== b.state ? (a.state === 'open' ? -1 : 1) : a.top !== b.top ? (a.top ? -1 : 1) : a.rank - b.rank));
  const habits = H.outMany(app, H.listRecords(app, false), today);
  const people = P.nudges(app, 30);
  const bills = on.money ? M.billsFor(app, today.slice(0, 7), today) : [];
  const trips = app.findRecordsByFilter('trips', "start_date >= {:t} || end_date >= {:t}", 'start_date', 5, 0, { t: today }).map((r) => F.tripOut(app, r));

  // Coming up in the next seven days.
  const end = C.addDays(today, 7);
  const coming = [];
  app.findRecordsByFilter('calendar_events', 'date >= {:t} && date <= {:e}', 'date,start', 20, 0, { t: today, e: end }).forEach((e) => coming.push({ kind: 'calendar', date: e.getString('date'), time: e.getBool('all_day') ? '' : String(e.getString('start')).slice(11, 16), title: e.getString('title'), area: '' }));
  app.findRecordsByFilter('events', 'date >= {:t} && date <= {:e}', 'date,time', 20, 0, { t: today, e: end }).forEach((e) => coming.push({ kind: 'plan', id: e.id, date: e.getString('date'), time: e.getString('time'), title: e.getString('title'), area: e.getString('area') }));
  bills.filter((b) => !b.paid && b.due_date >= today && b.due_date <= end).forEach((b) => coming.push({ kind: 'bill', id: b.id, date: b.due_date, time: '', title: b.name, area: 'money', amount: b.amount }));
  people.birthdays.filter((p) => p.next_birthday.in_days <= 7).forEach((p) => coming.push({ kind: 'birthday', id: p.id, date: p.next_birthday.date, time: '', title: p.name + "'s birthday", area: p.area, look: p.look }));
  trips.filter((t) => t.start_date >= today && t.start_date <= end).forEach((t) => coming.push({ kind: 'trip', id: t.id, date: t.start_date, time: '', title: t.title, area: 'fun' }));
  coming.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.time === b.time ? 0 : a.time === '' ? -1 : b.time === '' ? 1 : a.time < b.time ? -1 : 1));

  const health = on.health ? require(`${__hooks}/lib_health.js`).day(ctx, { date: today }) : null;
  const money = on.money ? M.month(ctx, { month: today.slice(0, 7) }) : null;
  // Your AI agent sees only the entries the person shared (and none when Settings say never).
  const shared = ctx.isAgent ? (C.prefs(app).reflections_to_agent === 'never' ? " && id = ''" : " && privacy = 'shared_with_agent'") : '';
  const photo = app.findRecordsByFilter('journal_entries', "photo != ''" + shared, '-date,-created', 1, 0);
  const latest = app.findRecordsByFilter('journal_entries', shared === '' ? '' : shared.slice(4), '-date,-created', 3, 0);
  const counts = util.one(app, "SELECT (SELECT COUNT(*) FROM proposals WHERE status = 'waiting') AS proposals, (SELECT COUNT(*) FROM suggestions WHERE status = 'open') AS suggestions, (SELECT COUNT(*) FROM tasks WHERE state = 'open' AND do_date = '' AND someday = FALSE AND project = '') AS inbox", { proposals: 0, suggestions: 0, inbox: 0 }, {});

  return {
    date: today,
    now: { time: now.time, hour: now.hour, part: partOf(now.hour), weekday: now.weekday },
    season: C.season(app, today),
    owner_name: s.getString('owner_name'),
    onboarded: s.getBool('onboarded'),
    areas: kinds,
    place: { city: s.getString('city'), country: s.getString('country') },
    day: D.dayOut(D.find(app, today), today),
    nudges: nudges(app, today, on, people, bills, trips),
    tasks: todayTasks,
    top_cap: 3,
    habits: habits,
    health: health === null ? null : { log: health.log, goals: health.goals, workouts: health.workouts.length },
    money: money === null ? null : { spent: money.spent, budget: money.budget, left: money.left, per_day_left: money.per_day_left, currency: money.currency, digits: money.digits, by_category: money.by_category.slice(0, 4) },
    people: { due: people.due.slice(0, 8), birthdays: people.birthdays.filter((p) => p.next_birthday.in_days <= 30).slice(0, 4), count: people.count },
    coming: coming.slice(0, 10),
    journal: { photo: photo.length > 0 ? J.out(photo[0]) : null, latest: latest.map(J.out), streak: J.heat(ctx).streak },
    goals: app.findRecordsByFilter('goals', "state = 'active'", 'rank,created', 6, 0).map((g) => G.out(app, g, false)),
    counts: counts === null ? { proposals: 0, suggestions: 0, inbox: 0 } : util.plain([counts])[0],
  };
}

module.exports = { partOf: partOf, nudges: nudges, summary: summary };
