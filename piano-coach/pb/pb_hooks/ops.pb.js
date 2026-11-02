/// <reference path="../pb_data/types.d.ts" />
/**
 * Every operation: the UI and the agent's agent-app CLI call the same routes
 * (operations.json lists them), so a rule enforced here holds for both.
 * Handlers run in isolated VMs and require() what they need.
 */

/* --------------------------------------------------------------- app */

routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));
routerAdd('GET', '/api/ops/app/state', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).state(app)));
routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).context(app)));
routerAdd('POST', '/api/ops/app/ui', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).ui(app, e, p)));

/* ---------------------------------------------------------- settings */

routerAdd('GET', '/api/ops/settings/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsGet(app)));
routerAdd('POST', '/api/ops/settings/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsUpdate(app, e, p)));

/* ------------------------------------------------------------- songs */

routerAdd('GET', '/api/ops/songs/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).list(app, p, e)));
routerAdd('GET', '/api/ops/songs/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).get(app, p, e)));
routerAdd('POST', '/api/ops/songs/check', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).check(app, p)));
routerAdd('POST', '/api/ops/songs/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).add(app, e, p)));
routerAdd('POST', '/api/ops/songs/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).update(app, e, p)));
routerAdd('POST', '/api/ops/songs/open', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).open(app, e, p)));
routerAdd('POST', '/api/ops/songs/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).setArchived(app, e, p, true)));
routerAdd('POST', '/api/ops/songs/restore', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).setArchived(app, e, p, false)));
routerAdd('POST', '/api/ops/songs/reset', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).reset(app, e, p)));

/* -------------------------------------------------------------- runs */

routerAdd('POST', '/api/ops/runs/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).save(app, e, p)));
routerAdd('GET', '/api/ops/runs/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).list(app, p)));

/* ---------------------------------------------------------- sessions */

routerAdd('GET', '/api/ops/sessions/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).sessionsList(app, p)));
routerAdd('GET', '/api/ops/sessions/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).sessionGet(app, p)));
routerAdd('POST', '/api/ops/sessions/end', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).end(app, e, p)));
routerAdd('POST', '/api/ops/sessions/review', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).review(app, e, p)));

/* ------------------------------------------------------------ review */

routerAdd('GET', '/api/ops/review/pack', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).pack(app, p)));

/* ------------------------------------------------------------- coach */

routerAdd('GET', '/api/ops/coach/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).list(app, p, e)));
routerAdd('GET', '/api/ops/coach/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).get(app, p)));
routerAdd('POST', '/api/ops/coach/send', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).send(app, e, p)));
routerAdd('POST', '/api/ops/coach/reply', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).reply(app, e, p)));
routerAdd('POST', '/api/ops/coach/read', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).read(app, e)));
routerAdd('POST', '/api/ops/coach/retry', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).retry(app, e, p)));

/* -------------------------------------------------------------- plan */

routerAdd('GET', '/api/ops/plan/today', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).today(app, p)));
routerAdd('POST', '/api/ops/plan/start', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).start(app, e, p)));
routerAdd('POST', '/api/ops/plan/done', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).done(app, e, p)));
routerAdd('POST', '/api/ops/plan/set', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).set(app, e, p)));
routerAdd('POST', '/api/ops/plan/reset', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).reset(app, e, p)));

/* ------------------------------------------------------------- stats */

routerAdd('GET', '/api/ops/stats/home', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stats.js`).home(app)));
routerAdd('GET', '/api/ops/stats/song', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stats.js`).song(app, p)));

/* ------------------------------------------------------------- learn */

routerAdd('GET', '/api/ops/learn/state', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).state(app, p, e)));
routerAdd('POST', '/api/ops/learn/lesson', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).lessonDone(app, e, p)));
routerAdd('POST', '/api/ops/drills/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).drillSave(app, e, p)));
routerAdd('GET', '/api/ops/drills/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).drillList(app, p)));
routerAdd('POST', '/api/ops/abc/parse', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).parse(app, p)));
