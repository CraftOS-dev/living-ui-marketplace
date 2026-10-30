/// <reference path="../pb_data/types.d.ts" />
/**
 * Every operation: the app (signed-in people) and the agents' agent-app CLI
 * call the same routes (operations.json lists them), so a rule enforced
 * here holds for both. Handlers run in isolated VMs and require() what they
 * need.
 */

/* ------------------------------------------------------------------- app */

routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app, e)));
routerAdd('GET', '/api/ops/app/status', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).status(app, e, p)));
routerAdd('GET', '/api/ops/app/state', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).state(app, e, p)));
routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).context(app, e, p)));
routerAdd('POST', '/api/ops/app/ui', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).ui(app, e, p)));
routerAdd('GET', '/api/ops/settings/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsGet(app, e, p)));
routerAdd('POST', '/api/ops/settings/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsUpdate(app, e, p)));

/* ------------------------------------------------------------------ team */

routerAdd('GET', '/api/ops/me/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).me(app, e, p)));
routerAdd('POST', '/api/ops/me/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).meUpdate(app, e, p)));
routerAdd('GET', '/api/ops/people/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).peopleList(app, e, p)));
routerAdd('POST', '/api/ops/people/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).peopleUpdate(app, e, p)));
routerAdd('GET', '/api/ops/agents/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).agentsList(app, e, p)));
routerAdd('POST', '/api/ops/agents/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).agentsUpdate(app, e, p)));
routerAdd('POST', '/api/ops/agents/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_team.js`).agentsRemove(app, e, p)));

/* ---------------------------------------------------------------- boards */

routerAdd('GET', '/api/ops/boards/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).list(app, p, e)));
routerAdd('GET', '/api/ops/boards/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).get(app, p, e)));
routerAdd('GET', '/api/ops/boards/templates', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).templates(app, e, p)));
routerAdd('POST', '/api/ops/boards/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).create(app, e, p)));
routerAdd('POST', '/api/ops/boards/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).update(app, e, p)));
routerAdd('POST', '/api/ops/boards/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).remove(app, e, p)));
routerAdd('POST', '/api/ops/columns/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).columnAdd(app, e, p)));
routerAdd('POST', '/api/ops/columns/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).columnUpdate(app, e, p)));
routerAdd('POST', '/api/ops/columns/move', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).columnMove(app, e, p)));
routerAdd('POST', '/api/ops/columns/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).columnRemove(app, e, p)));
routerAdd('POST', '/api/ops/labels/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).labelSave(app, e, p)));
routerAdd('POST', '/api/ops/labels/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_boards.js`).labelRemove(app, e, p)));
routerAdd('GET', '/api/ops/rules/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_auto.js`).list(app, p, e)));
routerAdd('POST', '/api/ops/rules/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_auto.js`).save(app, e, p)));
routerAdd('POST', '/api/ops/rules/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_auto.js`).remove(app, e, p)));

/* ----------------------------------------------------------------- cards */

routerAdd('GET', '/api/ops/cards/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).list(app, p, e)));
routerAdd('GET', '/api/ops/cards/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).get(app, p, e)));
routerAdd('POST', '/api/ops/cards/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).add(app, e, p)));
routerAdd('POST', '/api/ops/cards/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).update(app, e, p)));
routerAdd('POST', '/api/ops/cards/move', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).move(app, e, p)));
routerAdd('POST', '/api/ops/cards/assign', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).assign(app, e, p)));
routerAdd('POST', '/api/ops/cards/comment', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).comment(app, e, p)));
routerAdd('POST', '/api/ops/cards/check', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).check(app, e, p)));
routerAdd('POST', '/api/ops/cards/block', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).block(app, e, p, true)));
routerAdd('POST', '/api/ops/cards/unblock', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).block(app, e, p, false)));
routerAdd('POST', '/api/ops/cards/archive', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).archive(app, e, p, true)));
routerAdd('POST', '/api/ops/cards/restore', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).archive(app, e, p, false)));
routerAdd('POST', '/api/ops/cards/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).remove(app, e, p)));
routerAdd('POST', '/api/ops/cards/accept', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).accept(app, e, p)));
routerAdd('POST', '/api/ops/cards/answer', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).answer(app, e, p)));
routerAdd('POST', '/api/ops/cards/approve_plan', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).approvePlan(app, e, p)));
routerAdd('POST', '/api/ops/cards/stop', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).stop(app, e, p)));
routerAdd('POST', '/api/ops/cards/retry', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).retry(app, e, p)));

/* ---------------------------------------------------------------- review */

routerAdd('GET', '/api/ops/review/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).reviewList(app, p, e)));
routerAdd('POST', '/api/ops/review/approve', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).approve(app, e, p)));
routerAdd('POST', '/api/ops/review/changes', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).changes(app, e, p)));
routerAdd('POST', '/api/ops/review/reject', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_cards.js`).reject(app, e, p)));

/* ------------------------------------------------------------------ work */

routerAdd('GET', '/api/ops/work/queue', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).queue(app, e, p)));
routerAdd('POST', '/api/ops/work/next', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).next(app, e, p)));
routerAdd('POST', '/api/ops/work/heartbeat', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).heartbeat(app, e, p)));
routerAdd('POST', '/api/ops/work/log', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).log(app, e, p)));
routerAdd('POST', '/api/ops/work/plan', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).plan(app, e, p)));
routerAdd('POST', '/api/ops/work/ask', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).ask(app, e, p)));
routerAdd('POST', '/api/ops/work/submit', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).submit(app, e, p)));
routerAdd('POST', '/api/ops/work/return', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).giveBack(app, e, p)));
routerAdd('POST', '/api/ops/work/fail', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).fail(app, e, p)));
routerAdd('POST', '/api/ops/work/release', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).release(app, e, p)));
routerAdd('POST', '/api/ops/work/resume', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).resume(app, e, p)));

/* ------------------------------------------------- inbox, insights, log */

routerAdd('GET', '/api/ops/inbox/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).inbox(app, e, p)));
routerAdd('POST', '/api/ops/inbox/seen', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).inboxSeen(app, e, p)));
routerAdd('GET', '/api/ops/insights/flow', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).flow(app, e, p)));
routerAdd('GET', '/api/ops/activity/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).activity(app, e, p)));
routerAdd('POST', '/api/ops/activity/revert', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).revert(app, e, p)));
routerAdd('POST', '/api/ops/activity/undo', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).undo(app, e, p)));
