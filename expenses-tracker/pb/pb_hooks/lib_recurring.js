/// <reference path="../pb_data/types.d.ts" />
/**
 * Recurring expenses (rent, subscriptions): each one adds itself on its due
 * dates. Occurrence n is computed from the start date, never from the last
 * occurrence, so a 31st that clamps to Feb 28 is back on the 31st in March.
 * count_added is advanced in the same transaction as the expenses it
 * created, so a cron and a manual run can never add the same day twice.
 */

const CADENCES = ['weekly', 'monthly', 'yearly'];

function occurrence(start, cadence, n) {
  const u = require(`${__hooks}/lib_util.js`);
  if (cadence === 'weekly') return u.addDays(start, 7 * n);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  const d = Number(start.slice(8, 10));
  let yy = y;
  let mm = m;
  if (cadence === 'monthly') {
    const idx = m - 1 + n;
    yy = y + Math.floor(idx / 12);
    mm = (idx % 12) + 1;
  } else {
    yy = y + n;
  }
  const day = Math.min(d, u.daysInMonth(yy, mm));
  return yy + '-' + u.pad(mm) + '-' + u.pad(day);
}

function serialize(rec, ctx) {
  const money = require(`${__hooks}/lib_money.js`);
  const catId = rec.getString('category');
  const cat = catId !== '' ? ctx.categories[catId] : undefined;
  return {
    id: rec.id,
    note: rec.getString('note'),
    amount: money.toMajor(rec.getInt('amount'), money.exponent(ctx.currency)),
    amount_minor: rec.getInt('amount'),
    currency: ctx.currency,
    category: cat ? cat.name : null,
    category_id: cat ? cat.id : null,
    category_icon: cat ? cat.icon : null,
    cadence: rec.getString('cadence'),
    start_date: rec.getString('start_date'),
    next_date: rec.getString('next_date'),
    count_added: rec.getInt('count_added'),
    active: rec.getBool('active'),
  };
}

/** Add every due occurrence up to `today` for one recurring item. Returns how many were added. */
function runOne(app, id, today) {
  let added = 0;
  app.runInTransaction((txApp) => {
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rec = txApp.findRecordById('recurring', id);
    if (!rec.getBool('active')) return;
    const start = rec.getString('start_date');
    const cadence = rec.getString('cadence');
    let n = rec.getInt('count_added');
    let next = occurrence(start, cadence, n);
    const catId = rec.getString('category');
    let category = null;
    if (catId !== '') {
      try {
        category = txApp.findRecordById('categories', catId);
      } catch {
        category = null;
      }
    }
    let guard = 0;
    while (next <= today && guard < 500) {
      ex.create(txApp, {
        amount: rec.getInt('amount'),
        date: next,
        note: rec.getString('note'),
        category: category,
        source: 'recurring',
        recurring: rec.id,
      });
      n += 1;
      added += 1;
      guard += 1;
      next = occurrence(start, cadence, n);
    }
    rec.set('count_added', n);
    rec.set('next_date', next);
    txApp.save(rec);
  });
  return added;
}

function runDue(app, today) {
  let added = 0;
  for (const r of app.findRecordsByFilter('recurring', 'active = true', 'next_date', 0, 0)) {
    try {
      added += runOne(app, r.id, today);
    } catch (err) {
      console.error('[expenses] recurring ' + r.id + ' failed:', err);
    }
  }
  return added;
}

module.exports = { CADENCES: CADENCES, occurrence: occurrence, serialize: serialize, runOne: runOne, runDue: runDue };
