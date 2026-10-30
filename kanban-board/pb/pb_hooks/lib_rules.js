/// <reference path="../pb_data/types.d.ts" />
/**
 * The operations to use instead of writing a collection directly.
 */

const OPS_ONLY = {
  settings: 'settings.update',
  boards: 'boards.create, boards.update or boards.delete',
  columns: 'columns.add, columns.update, columns.move or columns.remove',
  labels: 'labels.save or labels.remove',
  cards: 'cards.add, cards.update, cards.move, cards.assign, cards.comment, cards.check and the work.* operations',
  events: 'the operations themselves (every change is logged); activity.revert undoes one',
  runs: 'work.next and the other work.* operations',
  rules: 'rules.save or rules.remove',
};

/** Refuse a direct API write to a collection that changes only through operations. */
function refuse(rec) {
  const name = rec.collection().name;
  throw new BadRequestError('"' + name + '" records change only through the app\'s operations, which keep versions, leases, the activity log and the agent\'s queue in step. Use ' + (OPS_ONLY[name] || 'the app operations') + ' (see app.guide).');
}

module.exports = { OPS_ONLY: OPS_ONLY, refuse: refuse };
