/// <reference path="../pb_data/types.d.ts" />
/**
 * A record's timeline: interactions, notes, tasks, emails, stage moves and
 * field changes (from the activity log, with who made them), newest first.
 * A company's timeline includes its people's interactions.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function timeline(app, object, rec, limit) {
  const u = U();
  const ix = require(`${__hooks}/lib_interactions.js`);
  const work = require(`${__hooks}/lib_work.js`);
  const id = rec.id;
  const items = [];
  const field = object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal';
  const lim = limit || 200;

  // Interactions.
  let ixFilter = '';
  const prm = { id: id };
  if (object === 'people') ixFilter = 'people ~ {:id}';
  else if (object === 'deals') ixFilter = 'deal = {:id}';
  else {
    const ppl = app.findRecordsByFilter('people', "company = {:id} && deleted = ''", '', 200, 0, { id: id }).map((p) => p.id);
    ixFilter = '(company = {:id}' + ppl.map((p, i) => ' || people ~ {:p' + i + '}').join('') + ')';
    ppl.forEach((p, i) => (prm['p' + i] = p));
  }
  for (const r of app.findRecordsByFilter('interactions', ixFilter, '-at', lim, 0, prm)) items.push({ type: 'interaction', at: r.getString('at'), interaction: ix.serialize(app, r) });

  for (const r of app.findRecordsByFilter('notes', field + ' = {:id}', '-created', lim, 0, { id: id })) items.push({ type: 'note', at: r.getString('created').replace(' ', 'T'), note: work.serializeNote(app, r) });

  for (const r of app.findRecordsByFilter('tasks', field + ' = {:id}', '-created', lim, 0, { id: id })) {
    const t = work.serializeTask(app, r);
    items.push({ type: 'task', at: (t.done_at || t.created).replace(' ', 'T'), task: t });
  }

  if (object !== 'companies')
    for (const r of app.findRecordsByFilter('emails', field + ' = {:id}', '-created', lim, 0, { id: id })) {
      const m = work.serializeEmail(app, r);
      items.push({ type: 'email', at: (m.sent_at || m.created).replace(' ', 'T'), email: m });
    }

  if (object === 'deals') {
    const stages = {};
    for (const s of app.findRecordsByFilter('stages', 'id != ""', '', 0, 0)) stages[s.id] = { name: s.getString('name'), kind: s.getString('kind') };
    for (const r of app.findRecordsByFilter('stage_events', 'deal = {:id}', '-at', lim, 0, { id: id })) {
      const from = stages[r.getString('from_stage')];
      const to = stages[r.getString('to_stage')];
      items.push({ type: 'stage', at: r.getString('at'), stage: { from: from ? from.name : '', to: to ? to.name : '', to_kind: to ? to.kind : 'open', actor: r.getString('actor'), run: r.getString('run') } });
    }
  }

  for (const r of app.findRecordsByFilter('activity', 'target_id = {:id} && undone = false', '-created', lim, 0, { id: id })) {
    const changes = u.json(r, 'changes', null);
    const op = r.getString('op');
    // Field changes, merges, restores and decided proposals; notes, tasks and
    // interactions are items of their own.
    const own = op.indexOf(object + '.') === 0 || op === 'proposals.decide';
    if (!own || (!changes && op.indexOf('merge') < 0 && op.indexOf('restore') < 0 && op.indexOf('.create') < 0 && op !== 'proposals.decide')) continue;
    items.push({ type: 'change', at: r.getString('created').replace(' ', 'T'), change: { id: r.id, op: op, summary: r.getString('summary'), changes: changes || [], actor: r.getString('actor'), run: r.getString('run') } });
  }

  items.sort((a, b) => (String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0));
  return items.slice(0, lim);
}

module.exports = { timeline: timeline };
