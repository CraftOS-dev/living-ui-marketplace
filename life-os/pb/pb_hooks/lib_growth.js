/// <reference path="../pb_data/types.d.ts" />
/**
 * Growth: a bookshelf (want to read, reading with the page you are on,
 * read with the day you finished) and the things being learned (a course,
 * a skill, a language) with progress and a "practised today" tap. A
 * reading goal counts the books finished by itself (lib_goals).
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

function bookOut(r) {
  const pages = r.getInt('pages');
  return { id: r.id, title: r.getString('title'), author: r.getString('author'), status: r.getString('status'), pages: pages, page: r.getInt('page'), progress: r.getString('status') === 'done' ? 1 : pages > 0 ? Math.min(1, r.getInt('page') / pages) : 0, started_on: r.getString('started_on'), finished_on: r.getString('finished_on'), look: r.getInt('look'), rating: r.getInt('rating'), actor: r.getString('actor') };
}

function afterBooks(app) {
  require(`${__hooks}/lib_goals.js`).recomputeMeasure(app, 'books');
}

function readBook(ctx, p, r, creating) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  if (creating || util.has(p, 'title')) r.set('title', C.name(p, 'title', 200));
  if (util.has(p, 'author')) r.set('author', C.name(p, 'author', 120, ''));
  if (util.has(p, 'pages')) r.set('pages', util.int(p, 'pages', 0, 0, 20000));
  if (util.has(p, 'page')) r.set('page', util.int(p, 'page', 0, 0, 20000));
  if (util.has(p, 'rating')) r.set('rating', util.int(p, 'rating', 0, 0, 5));
  if (util.has(p, 'look')) r.set('look', util.int(p, 'look', 0, 0, 7));
  else if (creating) r.set('look', Math.floor(Math.random() * 8));
  const was = r.getString('status');
  if (creating || util.has(p, 'status')) r.set('status', util.oneOf(p, 'status', ['want', 'reading', 'done'], creating ? 'want' : was));
  // A page past the last one finishes the book.
  if (r.getInt('pages') > 0 && r.getInt('page') >= r.getInt('pages') && r.getString('status') !== 'want') r.set('status', 'done');
  if (r.getInt('page') > 0 && r.getString('status') === 'want') r.set('status', 'reading');
  const now = r.getString('status');
  if (now === 'reading' && r.getString('started_on') === '') r.set('started_on', today);
  if (now === 'done' && was !== 'done') r.set('finished_on', util.day(p, 'finished_on', today));
  if (now !== 'done') r.set('finished_on', '');
  if (creating) r.set('rank', C.nextRank(ctx.app, 'books'));
}

const books = rec().crud({
  collection: 'books',
  param: 'book',
  one: 'book',
  noun: (r) => '"' + r.getString('title') + '"',
  fields: ['title', 'author', 'status', 'pages', 'page', 'started_on', 'finished_on', 'look', 'rating', 'rank'],
  read: readBook,
  out: (app, r) => bookOut(r),
  sort: 'rank,created',
  where: (ctx, p) => {
    const st = u().oneOf(p, 'status', ['want', 'reading', 'done'], '');
    return { filter: st !== '' ? 'status = {:s}' : '', bind: { s: st } };
  },
  after: afterBooks,
  afterName: 'lib_growth.afterBooks',
});

/** books.shelf: the shelf in three rows, and how many were read this year. */
function shelf(ctx) {
  const C = core();
  const year = C.today(ctx.app).slice(0, 4);
  const all = ctx.app.findRecordsByFilter('books', '', 'rank,created', 0, 0).map(bookOut);
  return {
    reading: all.filter((b) => b.status === 'reading'),
    want: all.filter((b) => b.status === 'want'),
    done: all.filter((b) => b.status === 'done').sort((a, b) => (a.finished_on < b.finished_on ? 1 : -1)),
    read_this_year: all.filter((b) => b.status === 'done' && b.finished_on.slice(0, 4) === year).length,
  };
}

/* ------------------------------------------------------------ learning */

function learningOut(app, r) {
  const C = core();
  const last = r.getString('last_practiced');
  return { id: r.id, name: r.getString('name'), kind: r.getString('kind'), progress: r.getInt('progress'), last_practiced: last, days_since: last === '' ? null : C.between(last, C.today(app)), minutes: r.getInt('minutes'), note: r.getString('note'), archived: r.getBool('archived'), actor: r.getString('actor') };
}

function readLearning(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'name')) r.set('name', C.name(p, 'name', 120));
  if (creating || util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', ['course', 'skill', 'language'], creating ? 'skill' : r.getString('kind')));
  if (util.has(p, 'progress')) r.set('progress', util.int(p, 'progress', 0, 0, 100));
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 500, ''));
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  if (creating) r.set('rank', C.nextRank(ctx.app, 'learning'));
}

const learning = rec().crud({
  collection: 'learning',
  param: 'item',
  one: 'item',
  listKey: 'learning',
  noun: (r) => '"' + r.getString('name') + '"',
  fields: ['name', 'kind', 'progress', 'last_practiced', 'minutes', 'note', 'archived', 'rank'],
  read: readLearning,
  out: learningOut,
  sort: 'archived,rank,created',
});

/** learning.practice: practised today (minutes add up). */
function practice(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'item');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'learning', id, 'learning item');
    const before = rec().snapshot(r, ['last_practiced', 'minutes', 'progress']);
    r.set('last_practiced', util.day(p, 'date', C.today(t)));
    r.set('minutes', r.getInt('minutes') + util.int(p, 'minutes', 15, 0, 600));
    if (util.has(p, 'progress')) r.set('progress', util.int(p, 'progress', 0, 0, 100));
    t.save(r);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: 'Practised ' + r.getString('name'), target: 'learning', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'learning', id: r.id, fields: before } } });
  });
  return { item: learningOut(ctx.app, ctx.app.findRecordById('learning', id)) };
}

module.exports = {
  bookOut: bookOut,
  afterBooks: afterBooks,
  bookList: books.list,
  bookAdd: books.create,
  bookUpdate: books.update,
  bookRemove: books.remove,
  shelf: shelf,
  learningList: learning.list,
  learningAdd: learning.create,
  learningUpdate: learning.update,
  learningRemove: learning.remove,
  practice: practice,
};
