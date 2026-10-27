/// <reference path="../pb_data/types.d.ts" />
/**
 * Home: chores that come round (every so many days, by room; "done" is one
 * tap and the next time is worked out) and the shopping list.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}
let rec_ = null;
function rec() {
  return rec_ || (rec_ = require(`${__hooks}/lib_rec.js`));
}

const ROOMS = ['kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'outside', 'other'];

function choreOut(app, r) {
  const C = core();
  const today = C.today(app);
  const last = r.getString('last_done');
  const every = r.getInt('every_days');
  const next = last === '' ? today : C.addDays(last, every);
  return { id: r.id, name: r.getString('name'), room: r.getString('room'), every_days: every, last_done: last, next_due: next, due_in: C.between(today, next), actor: r.getString('actor') };
}

function readChore(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'name')) r.set('name', C.name(p, 'name', 120));
  if (creating || util.has(p, 'room')) r.set('room', util.oneOf(p, 'room', ROOMS, creating ? 'other' : r.getString('room')));
  if (creating || util.has(p, 'every_days')) r.set('every_days', util.int(p, 'every_days', 7, 1, 365));
  if (util.has(p, 'last_done')) r.set('last_done', util.day(p, 'last_done', ''));
  if (creating) r.set('rank', C.nextRank(ctx.app, 'chores'));
}

const chores = rec().crud({
  collection: 'chores',
  param: 'chore',
  one: 'chore',
  noun: (r) => 'the chore "' + r.getString('name') + '"',
  fields: ['name', 'room', 'every_days', 'last_done', 'rank'],
  read: readChore,
  out: choreOut,
  sort: 'rank,created',
});

/** chores.list: every chore, the ones due first. */
function choreList(ctx) {
  const list = ctx.app.findRecordsByFilter('chores', '', 'rank,created', 0, 0).map((r) => choreOut(ctx.app, r));
  list.sort((a, b) => a.due_in - b.due_in);
  return { chores: list };
}

/** chores.done: done today (or on --date); the next time moves on. */
function choreDone(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'chore');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'chores', id, 'chore');
    const before = rec().snapshot(r, ['last_done']);
    r.set('last_done', util.bool(p, 'done', true) ? util.day(p, 'date', C.today(t)) : '');
    t.save(r);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: 'Did "' + r.getString('name') + '"', target: 'chores', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'chores', id: r.id, fields: before } } });
  });
  return { chore: choreOut(ctx.app, ctx.app.findRecordById('chores', id)) };
}

/* ------------------------------------------------------------ shopping */

function itemOut(r) {
  return { id: r.id, text: r.getString('text'), done: r.getBool('done'), done_at: r.getString('done_at'), actor: r.getString('actor') };
}

/** shopping.list: what to buy (bought ones last; the day job clears them after a week). */
function shopList(ctx) {
  return { items: ctx.app.findRecordsByFilter('shopping_items', '', 'done,rank,created', 0, 0).map(itemOut) };
}

/** The day job: bought things leave the list after a week. */
function tidy(app) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  app.findRecordsByFilter('shopping_items', "done = true && done_at != '' && done_at < {:c}", '', 0, 0, { c: cutoff }).forEach((r) => app.delete(app.findRecordById('shopping_items', r.id)));
}

/** shopping.add: one thing, or several (one per line). */
function shopAdd(ctx, p) {
  const util = u();
  const C = core();
  const raw = util.text(p, 'text', 2000, '');
  const lines = raw.split('\n').map((x) => util.squash(x)).filter((x) => x !== '');
  if (lines.length === 0) throw util.fail(400, 'text is required, e.g. --text "Milk"', 'missing_param', { param: 'text' });
  const ids = rec().tx(ctx.app, (t) => {
    const made = [];
    lines.slice(0, 50).forEach((line) => {
      if (C.hasEmoji(line)) throw util.fail(400, 'No emoji in the list, please.', 'emoji_not_allowed', { param: 'text' });
      const r = util.newRecord(t, 'shopping_items');
      r.set('text', line.slice(0, 120));
      r.set('done', false);
      r.set('rank', C.nextRank(t, 'shopping_items'));
      r.set('actor', ctx.actor);
      t.save(r);
      made.push(r.id);
    });
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: 'Added ' + (made.length === 1 ? '"' + lines[0] + '"' : made.length + ' things') + ' to the shopping list', target: 'shopping_items', record: made[0], undo: { fn: 'lib_house.undoShopAdd', args: { ids: made } } });
    return made;
  });
  return { items: ids.map((id) => itemOut(ctx.app.findRecordById('shopping_items', id))) };
}

function undoShopAdd(ctx, args) {
  for (const id of args.ids || []) {
    const r = u().byId(ctx.app, 'shopping_items', id);
    if (r !== null) ctx.app.delete(r);
  }
}

/** shopping.check: bought (or not after all). */
function shopCheck(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'item');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'shopping_items', id, 'shopping item');
    const before = rec().snapshot(r, ['done', 'done_at']);
    const done = util.bool(p, 'done', !r.getBool('done'));
    r.set('done', done);
    r.set('done_at', done ? util.nowIso() : '');
    t.save(r);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: (done ? 'Bought "' : 'Still to buy: "') + r.getString('text') + '"', target: 'shopping_items', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'shopping_items', id: r.id, fields: before } } });
  });
  return { item: itemOut(ctx.app.findRecordById('shopping_items', id)) };
}

/** shopping.clear: take the bought things off the list. */
function shopClear(ctx) {
  const util = u();
  const done = ctx.app.findRecordsByFilter('shopping_items', 'done = true', '', 0, 0);
  rec().tx(ctx.app, (t) => {
    const saved = done.map((r) => ({ id: r.id, fields: rec().snapshot(r, ['text', 'done', 'done_at', 'rank', 'actor']) }));
    done.forEach((r) => t.delete(t.findRecordById('shopping_items', r.id)));
    if (saved.length > 0) require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: 'Cleared ' + saved.length + ' bought things', target: 'shopping_items', undo: { fn: 'lib_house.undoClear', args: { saved: saved } } });
  });
  void util;
  return { cleared: done.length };
}

function undoClear(ctx, args) {
  for (const s of args.saved || []) rec().undoRemove(ctx, { collection: 'shopping_items', id: s.id, fields: s.fields });
}

const shopping = rec().crud({
  collection: 'shopping_items',
  param: 'item',
  one: 'item',
  noun: (r) => '"' + r.getString('text') + '"',
  fields: ['text', 'done', 'done_at', 'rank'],
  read: (ctx, p, r) => {
    if (u().has(p, 'text')) r.set('text', core().name(p, 'text', 120));
  },
  out: (app, r) => itemOut(r),
});

module.exports = {
  ROOMS: ROOMS,
  choreList: choreList,
  choreAdd: chores.create,
  choreUpdate: chores.update,
  choreRemove: chores.remove,
  choreDone: choreDone,
  shopList: shopList,
  tidy: tidy,
  shopAdd: shopAdd,
  undoShopAdd: undoShopAdd,
  shopCheck: shopCheck,
  shopClear: shopClear,
  undoClear: undoClear,
  shopUpdate: shopping.update,
  shopRemove: shopping.remove,
};
