/// <reference path="../pb_data/types.d.ts" />
/** Inbox helpers shared by the /api/ops/inbox/* routes. */

/** The subject of an Inbox item: the person's choice, then the item's own link. */
function inboxSubject(app, item, b) {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  let type = String(b.subject_type || '');
  let id = String(b.subject_id || b.matter_id || '');
  if (type === 'trademark' || type === 'design' || (!type && b.matter_id)) type = 'matter';
  if (type && id) return engine.subjectOf(app, type, id);
  const proposal = u.j(item, 'proposal', {});
  const first = proposal.first_decision || {};
  if (first.subject_type && first.subject_id) return engine.subjectOf(app, first.subject_type, first.subject_id);
  const fields = { matter: 'matter', agreement: 'agreement', work: 'work', character: 'character', talent: 'talent', product: 'product', permission: 'permission', committee: 'committee', case: 'case_ref' };
  const st = item.getString('subject_type');
  if (st && fields[st] && item.getString(fields[st])) return engine.subjectOf(app, st, item.getString(fields[st]));
  if (st && proposal.subject_id) return engine.subjectOf(app, st, String(proposal.subject_id));
  for (const t of Object.keys(fields)) if (item.getString(fields[t])) return engine.subjectOf(app, t, item.getString(fields[t]));
  return null;
}

function eventData(u, ev) {
  const data = {};
  if (ev.period_months) data.period_months = Number(ev.period_months);
  if (ev.period_days) data.period_days = Number(ev.period_days);
  if (ev.due_date) data.due_date = u.d10(ev.due_date);
  if (ev.jurisdiction) data.jurisdiction = String(ev.jurisdiction).toUpperCase();
  if (ev.mode) data.mode = String(ev.mode);
  return data;
}

module.exports = { inboxSubject: inboxSubject, eventData: eventData };
