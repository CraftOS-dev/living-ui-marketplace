/// <reference path="../pb_data/types.d.ts" />
/**
 * Fun: the bucket list (places, experiences, skills, food to try; ticked
 * with the day it happened) and trips (a countdown and a packing list).
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

const BUCKET = ['place', 'experience', 'skill', 'food', 'other'];

function bucketOut(r) {
  return { id: r.id, title: r.getString('title'), kind: r.getString('kind'), done_on: r.getString('done_on'), note: r.getString('note'), actor: r.getString('actor') };
}

function readBucket(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'title')) r.set('title', C.name(p, 'title', 200));
  if (creating || util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', BUCKET, creating ? 'experience' : r.getString('kind')));
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 500, ''));
  if (util.has(p, 'done')) r.set('done_on', util.bool(p, 'done', false) ? util.day(p, 'date', C.today(ctx.app)) : '');
  if (creating) r.set('rank', C.nextRank(ctx.app, 'bucket_items'));
}

const bucket = rec().crud({
  collection: 'bucket_items',
  param: 'item',
  one: 'item',
  listKey: 'items',
  noun: (r) => '"' + r.getString('title') + '"' + (r.getString('done_on') !== '' ? ' (done)' : ''),
  fields: ['title', 'kind', 'done_on', 'note', 'rank'],
  read: readBucket,
  out: (app, r) => bucketOut(r),
  sort: 'rank,created',
});

/* --------------------------------------------------------------- trips */

function tripOut(app, r) {
  const C = core();
  const today = C.today(app);
  const start = r.getString('start_date');
  const end = r.getString('end_date') || start;
  const list = u().jsonOf(r, 'checklist') || [];
  return {
    id: r.id,
    title: r.getString('title'),
    place: r.getString('place'),
    start_date: start,
    end_date: r.getString('end_date'),
    in_days: start === '' ? null : C.between(today, start),
    nights: start !== '' && end !== '' ? Math.max(0, C.between(start, end)) : null,
    state: start === '' ? 'idea' : end < today ? 'past' : start <= today ? 'now' : 'coming',
    checklist: list,
    packed: list.filter((x) => x.done).length,
    notes: r.getString('notes'),
    actor: r.getString('actor'),
  };
}

function readTrip(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'title')) r.set('title', C.name(p, 'title', 120));
  if (util.has(p, 'place')) r.set('place', C.name(p, 'place', 120, ''));
  if (util.has(p, 'start_date')) r.set('start_date', util.day(p, 'start_date', ''));
  if (util.has(p, 'end_date')) r.set('end_date', util.day(p, 'end_date', ''));
  if (r.getString('start_date') !== '' && r.getString('end_date') !== '' && r.getString('end_date') < r.getString('start_date')) throw util.fail(400, 'end_date is before start_date.', 'invalid_param', { param: 'end_date' });
  if (util.has(p, 'notes')) r.set('notes', util.text(p, 'notes', 4000, ''));
  if (creating) {
    const basics = ['Passport or ID', 'Chargers', 'Toothbrush', 'Clothes'];
    const extra = util.has(p, 'packing') ? packLines(p, 'packing') : [];
    const all = basics.concat(extra.filter((x) => !basics.some((b) => b.toLowerCase() === x.toLowerCase())));
    r.set('checklist', all.map((t) => ({ id: util.token(8).toLowerCase(), text: t, done: false })));
  }
}

/** Things to pack from a param: a JSON list, or one per line. */
function packLines(p, name) {
  const util = u();
  const raw = p[name];
  const many = typeof raw === 'string' && raw.trim().charAt(0) !== '[' ? raw.split('\n') : util.list(p, name) || [];
  const out = many.map((x) => util.squash(String(x)).slice(0, 120)).filter((x) => x !== '');
  if (out.length === 0) throw util.fail(400, name + ' needs at least one thing to pack.', 'invalid_param', { param: name });
  if (out.length > 60) throw util.fail(400, 'At most 60 things at once.', 'invalid_param', { param: name });
  return out;
}

const trips = rec().crud({
  collection: 'trips',
  param: 'trip',
  one: 'trip',
  noun: (r) => 'the trip "' + r.getString('title') + '"',
  fields: ['title', 'place', 'start_date', 'end_date', 'checklist', 'notes'],
  json: ['checklist'],
  read: readTrip,
  out: tripOut,
  sort: 'start_date,created',
});

/** trips.pack: add lines (--text, one per line), or for one line (--item): tick or untick (--done), rename (--text) or remove (--remove). */
function pack(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'trip');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'trips', id, 'trip');
    const before = rec().snapshot(r, ['checklist'], ['checklist']);
    let list = util.jsonOf(r, 'checklist') || [];
    const item = util.str(p, 'item', '');
    const trip = r.getString('title');
    let label;
    if (item === '') {
      if (!util.has(p, 'text')) throw util.fail(400, 'Give --text to add things (one per line), or --item with --done, --text or --remove for one line.', 'missing_param');
      const added = packLines(p, 'text').filter((x) => !list.some((l) => l.text.toLowerCase() === x.toLowerCase()));
      added.forEach((x) => list.push({ id: util.token(8).toLowerCase(), text: x, done: false }));
      label = added.length === 0 ? 'Nothing new for the packing list for ' + trip : 'Added ' + C.listWords(added) + ' to the packing list for ' + trip;
    } else {
      const line = list.find((x) => x.id === item);
      if (line === undefined) throw util.fail(404, 'No line ' + item + ' on this packing list. Lines: ' + list.map((x) => x.id + ' ' + x.text).join(', '), 'not_found');
      const asks = ['done', 'text', 'remove'].filter((k) => util.has(p, k));
      if (asks.length !== 1) throw util.fail(400, 'For one line give exactly one of --done true|false, --text (a new name) or --remove true.', 'invalid_param', { param: 'item' });
      if (asks[0] === 'remove') {
        if (!util.bool(p, 'remove', false)) throw util.fail(400, '--remove takes true.', 'invalid_param', { param: 'remove' });
        list = list.filter((x) => x.id !== item);
        label = 'Took ' + line.text + ' off the packing list for ' + trip;
      } else if (asks[0] === 'text') {
        const text = C.name(p, 'text', 120);
        list = list.map((x) => (x.id === item ? Object.assign({}, x, { text: text }) : x));
        label = 'Renamed ' + line.text + ' to ' + text + ' on the packing list for ' + trip;
      } else {
        const done = util.bool(p, 'done', false);
        list = list.map((x) => (x.id === item ? Object.assign({}, x, { done: done }) : x));
        label = (done ? 'Packed ' : 'Unpacked ') + line.text + ' for ' + trip;
      }
    }
    r.set('checklist', list);
    t.save(r);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: label, target: 'trips', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'trips', id: r.id, fields: before } } });
  });
  return { trip: tripOut(ctx.app, ctx.app.findRecordById('trips', id)) };
}

module.exports = { BUCKET: BUCKET, bucketList: bucket.list, bucketAdd: bucket.create, bucketUpdate: bucket.update, bucketRemove: bucket.remove, tripOut: tripOut, tripList: trips.list, tripAdd: trips.create, tripUpdate: trips.update, tripRemove: trips.remove, pack: pack };
