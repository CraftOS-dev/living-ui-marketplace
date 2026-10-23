/// <reference path="../pb_data/types.d.ts" />
/**
 * The operations to use instead of writing a collection directly.
 */

const OPS_ONLY = {
  settings: 'settings.update',
  parts: 'parts.create, parts.update, parts.duplicate or records.delete',
  parameters: 'params.set (and records.delete --collection parameters)',
  features: 'features.add, features.update, features.move, features.roll-to, edits.batch (and records.delete --collection features)',
  builds: 'builds.run or builds.cancel (builds follow every edit)',
  changes: 'changes.revert (edits are journaled by the edit operations)',
  exports: 'exports.create (and records.delete --collection exports)',
  selections: 'selection.set',
  checks: 'checks.save (and records.delete --collection checks)',
  assets: 'assets.add (and records.delete --collection assets)',
  briefs: 'requests.create and requests.update',
  compares: 'compare.builds',
};

/** Refuse a direct API write to a collection that changes only through operations. */
function refuse(rec) {
  const name = rec.collection().name;
  throw new BadRequestError('"' + name + '" records change only through the app\'s operations, which keep the feature tree, its history and its geometry in step. Use ' + (OPS_ONLY[name] || 'the app operations') + ' (see app.guide).');
}

module.exports = { OPS_ONLY: OPS_ONLY, refuse: refuse };
