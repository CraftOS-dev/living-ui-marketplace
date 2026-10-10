/// <reference path="../pb_data/types.d.ts" />
/**
 * Action items written by the first version of the app,
 * { id, title, completed, assignee?, dueDate? }, become
 * { id, title, assignee, due, done } like every other item. A due date that
 * is not a calendar day ("next week") stays in the title, so nothing is lost.
 *
 * (Installs that ran an earlier copy of 1700000002 also lost the old
 * attendees and highlights there; only a backup taken before the upgrade
 * still has them.)
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(s) {
  if (!DAY.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function current(a) {
  return (
    a !== null &&
    typeof a === 'object' &&
    typeof a.id === 'string' &&
    typeof a.title === 'string' &&
    typeof a.assignee === 'string' &&
    typeof a.due === 'string' &&
    typeof a.done === 'boolean'
  );
}

function convert(items) {
  const out = [];
  const ids = {};
  for (const a of items) {
    if (a === null || typeof a !== 'object') continue;
    let title = typeof a.title === 'string' ? a.title.trim() : '';
    if (title === '') continue;
    const given = typeof a.due === 'string' ? a.due.trim() : typeof a.dueDate === 'string' ? a.dueDate.trim() : '';
    let due = '';
    if (isDay(given.slice(0, 10))) due = given.slice(0, 10);
    else if (given !== '') title += ' (due ' + given + ')';
    let id = typeof a.id === 'string' || typeof a.id === 'number' ? String(a.id) : '';
    if (id === '' || ids[id]) id = $security.randomString(10);
    ids[id] = true;
    out.push({
      id: id,
      title: title,
      assignee: typeof a.assignee === 'string' ? a.assignee.trim() : '',
      due: due,
      done: typeof a.done === 'boolean' ? a.done : a.completed === true,
    });
  }
  return out;
}

migrate(
  (app) => {
    const rows = arrayOf(new DynamicModel({ id: '', action_items: '' }));
    app.db().newQuery("SELECT id, COALESCE(CAST(action_items AS TEXT), '') AS action_items FROM notes").all(rows);
    for (const row of rows) {
      let items;
      let wrapped = false;
      try {
        items = JSON.parse(row.action_items || 'null');
        // The first version could also store the list as a JSON string.
        if (typeof items === 'string') {
          items = JSON.parse(items);
          wrapped = true;
        }
      } catch {
        continue;
      }
      if (!Array.isArray(items) || (!wrapped && items.every(current))) continue;
      // Plain SQL: the note keeps its `updated` time and no hooks run.
      app
        .db()
        .newQuery('UPDATE notes SET action_items = {:items} WHERE id = {:id}')
        .bind({ id: row.id, items: JSON.stringify(convert(items)) })
        .execute();
    }
  },
  () => {
    // Nothing to undo: the schema from 1700000002 on reads this shape.
  },
);
