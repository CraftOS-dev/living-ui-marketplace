/// <reference path="../pb_data/types.d.ts" />
/**
 * Every operation: the UI and the agent's agent-app CLI call the same routes
 * (operations.json lists them), so a rule enforced here holds for both.
 * Handlers run in isolated VMs and require() what they need.
 */

/* --------------------------------------------------------------- app */

routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app, p), 'app.guide', ['topic']));
routerAdd('GET', '/api/ops/app/state', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).state(app), 'app.state', []));
routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).context(app), 'app.context', []));
routerAdd('POST', '/api/ops/app/ui', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).ui(app, e, p), 'app.ui', undefined));

/* ---------------------------------------------------------- settings */

routerAdd('GET', '/api/ops/settings/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsGet(app), 'settings.get', []));
routerAdd('POST', '/api/ops/settings/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsUpdate(app, e, p), 'settings.update', undefined));

/* ------------------------------------------------------------- voice */

routerAdd('GET', '/api/ops/voice/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_voice.js`).get(app), 'voice.get', []));
routerAdd('POST', '/api/ops/voice/test', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_voice.js`).test(app, e, p), 'voice.test', undefined));

/* ------------------------------------------------------------ health */

routerAdd('GET', '/api/ops/health/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_health.js`).get(app), 'health.get', []));
routerAdd('POST', '/api/ops/health/checkin', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_health.js`).checkin(app, e, p), 'health.checkin', undefined));

/* ------------------------------------------------------------- songs */

routerAdd('GET', '/api/ops/songs/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).list(app, p, e), 'songs.list', ['q', 'level', 'kind', 'status', 'language', 'archived']));
routerAdd('GET', '/api/ops/songs/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).get(app, p, e), 'songs.get', ['song', 'abc']));
routerAdd('POST', '/api/ops/songs/check', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).check(app, p, e), 'songs.check', ['abc', 'level', 'sections', 'song']));
routerAdd('POST', '/api/ops/songs/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).add(app, e, p), 'songs.add', ['abc', 'level', 'kind', 'sections', 'message', 'note', 'gloss', 'tags', 'title', 'duplicate']));
routerAdd('POST', '/api/ops/songs/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).update(app, e, p), 'songs.update', ['song', 'note', 'abc', 'sections', 'title', 'level', 'gloss', 'tags', 'composer', 'kind']));
routerAdd('GET', '/api/ops/songs/words', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_words.js`).view(app, p), 'songs.words', ['song', 'bars', 'verse']));
routerAdd('POST', '/api/ops/songs/shift-words', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_words.js`).shift(app, e, p), 'songs.shift-words', ['song', 'bar', 'note', 'by', 'verse', 'through']));
routerAdd('POST', '/api/ops/songs/set-words', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_words.js`).set(app, e, p), 'songs.set-words', ['song', 'bars', 'text', 'verse']));
routerAdd('POST', '/api/ops/songs/open', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).open(app, e, p), 'songs.open', undefined));
routerAdd('POST', '/api/ops/songs/transpose', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).transpose(app, e, p), 'songs.transpose', undefined));
routerAdd('POST', '/api/ops/songs/backing', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).backing(app, e, p), 'songs.backing', undefined), $apis.bodyLimit(88 << 20));
routerAdd('POST', '/api/ops/songs/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).setArchived(app, e, p, true), 'songs.remove', undefined));
routerAdd('POST', '/api/ops/songs/restore', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).setArchived(app, e, p, false), 'songs.restore', undefined));
routerAdd('POST', '/api/ops/songs/reset', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_songs.js`).reset(app, e, p), 'songs.reset', undefined));

/* -------------------------------------------------------------- runs */

routerAdd('POST', '/api/ops/runs/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).save(app, e, p), 'runs.save', undefined));
routerAdd('GET', '/api/ops/runs/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).list(app, p), 'runs.list', ['days', 'song', 'limit']));
routerAdd('GET', '/api/ops/runs/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).get(app, p), 'runs.get', ['run', 'track']));
routerAdd('POST', '/api/ops/runs/dispute', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).dispute(app, e, p), 'runs.dispute', undefined));
routerAdd('POST', '/api/ops/runs/track', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).track(app, e, p), 'runs.track', undefined));
routerAdd('POST', '/api/ops/runs/forget-audio', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).forgetAudio(app, e), 'runs.forget-audio', undefined));

/* ---------------------------------------------------------- sessions */

routerAdd('GET', '/api/ops/sessions/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).sessionsList(app, p), 'sessions.list', ['limit']));
routerAdd('GET', '/api/ops/sessions/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).sessionGet(app, p), 'sessions.get', ['session']));
routerAdd('POST', '/api/ops/sessions/end', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).end(app, e, p), 'sessions.end', undefined));
routerAdd('POST', '/api/ops/sessions/review', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).review(app, e, p), 'sessions.review', ['session', 'text']));

/* ------------------------------------------------------------ review */

routerAdd('GET', '/api/ops/review/pack', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_runs.js`).pack(app, p), 'review.pack', ['session']));

/* ------------------------------------------------------------- coach */

routerAdd('GET', '/api/ops/coach/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).list(app, p, e), 'coach.list', []));
routerAdd('GET', '/api/ops/coach/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).get(app, p), 'coach.get', ['message']));
routerAdd('POST', '/api/ops/coach/send', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).send(app, e, p), 'coach.send', undefined));
routerAdd('POST', '/api/ops/coach/reply', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).reply(app, e, p), 'coach.reply', ['message', 'text', 'new', 'failed']));
routerAdd('POST', '/api/ops/coach/unsend', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).unsend(app, e, p), 'coach.unsend', ['message']));
routerAdd('POST', '/api/ops/coach/read', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).read(app, e), 'coach.read', undefined));
routerAdd('POST', '/api/ops/coach/retry', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_coach.js`).retry(app, e, p), 'coach.retry', undefined));

/* -------------------------------------------------------------- plan */

routerAdd('GET', '/api/ops/plan/today', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).today(app, p), 'plan.today', ['day']));
routerAdd('POST', '/api/ops/plan/start', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).start(app, e), 'plan.start', undefined));
routerAdd('POST', '/api/ops/plan/done', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).done(app, e, p), 'plan.done', undefined));
routerAdd('POST', '/api/ops/plan/set', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).set(app, e, p), 'plan.set', ['blocks', 'note', 'day']));
routerAdd('POST', '/api/ops/plan/reset', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_plan.js`).reset(app, e, p), 'plan.reset', undefined));

/* ------------------------------------------------------------- stats */

routerAdd('GET', '/api/ops/stats/home', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stats.js`).home(app), 'stats.home', []));
routerAdd('GET', '/api/ops/stats/song', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stats.js`).song(app, p), 'stats.song', ['song']));
routerAdd('GET', '/api/ops/stats/voice', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stats.js`).voice(app), 'stats.voice', []));

/* ------------------------------------------------------------- learn */

routerAdd('GET', '/api/ops/learn/state', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).state(app, p, e), 'learn.state', []));
routerAdd('POST', '/api/ops/learn/lesson', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).lessonDone(app, e, p), 'learn.lesson', undefined));

/* ------------------------------------------------------------ drills */

routerAdd('POST', '/api/ops/drills/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).drillSave(app, e, p), 'drills.save', undefined));
routerAdd('GET', '/api/ops/drills/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).drillList(app, p), 'drills.list', ['days']));

/* --------------------------------------------------------------- abc */

routerAdd('POST', '/api/ops/abc/parse', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_learn.js`).parse(app, p), 'abc.parse', ['abc']));
