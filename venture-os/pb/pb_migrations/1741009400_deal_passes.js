/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS fix 6 (qa-cli RULING CLI-03): one pass flow for every deal.
 *
 * - `passes.deal`: the deal a pass closed. A deal passed from the deal page
 *   (passes.create, or your AI agent's passes.request a person accepted)
 *   writes a pass like an Inbox pass does, with its reason, criterion,
 *   revisit and the pass email job; `item` stays empty when the deal never
 *   came through the Inbox.
 * - `passes.item` is no longer required (a deal pass may have no item).
 */
migrate(
  (app) => {
    const passes = app.findCollectionByNameOrId('passes');
    const item = passes.fields.getByName('item');
    if (item) item.required = false;
    if (!passes.fields.getByName('deal')) passes.fields.add(new RelationField({ name: 'deal', maxSelect: 1, collectionId: app.findCollectionByNameOrId('deals').id, cascadeDelete: false, required: false }));
    passes.addIndex('idx_passes_deal', false, 'deal', '');
    app.save(passes);
  },
  (app) => {
    const passes = app.findCollectionByNameOrId('passes');
    passes.removeIndex('idx_passes_deal');
    if (passes.fields.getByName('deal')) passes.fields.removeByName('deal');
    const item = passes.fields.getByName('item');
    if (item) item.required = true;
    app.save(passes);
  },
);
