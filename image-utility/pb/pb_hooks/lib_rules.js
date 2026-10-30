/// <reference path="../pb_data/types.d.ts" />
/**
 * The operations to use instead of writing a collection directly.
 */

const OPS_ONLY = {
  settings: 'settings.update',
  images: 'images.import, images.update, images.duplicate or images.delete',
  edits: 'edits.add, edits.update, edits.move, edits.remove, edits.apply, edits.copy or edits.reset',
  changes: 'history.undo, history.redo or history.revert (edits are journaled by the edit operations)',
  proposals: 'proposals.accept or proposals.reject (the AI agent proposes through the edit operations)',
  exports: 'export.create (and exports.delete)',
  presets: 'presets.save or presets.delete',
  batches: 'batches.create, batches.run, batches.cancel, batches.retry or batches.delete',
  assets: 'assets.add or assets.delete',
  requests: 'requests.create and requests.update',
};

/** Refuse a direct API write to a collection that changes only through operations. */
function refuse(rec) {
  const name = rec.collection().name;
  throw new BadRequestError('"' + name + '" records change only through the app\'s operations, which keep each image\'s edits, its history and its previews in step. Use ' + (OPS_ONLY[name] || 'the app operations') + ' (see app.guide).');
}

module.exports = { OPS_ONLY: OPS_ONLY, refuse: refuse };
