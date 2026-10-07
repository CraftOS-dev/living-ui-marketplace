/// <reference path="../pb_data/types.d.ts" />
/**
 * The app works with any AI agent, not one product: what the agent adds is
 * marked `agent` (expenses.source, receipts.added_by).
 */
migrate(
  (app) => {
    const expenses = app.findCollectionByNameOrId('expenses');
    expenses.fields.getByName('source').values = ['app', 'agent', 'receipt', 'csv', 'recurring'];
    app.save(expenses);
    const receipts = app.findCollectionByNameOrId('receipts');
    receipts.fields.getByName('added_by').values = ['app', 'agent'];
    app.save(receipts);
  },
  (app) => {
    const expenses = app.findCollectionByNameOrId('expenses');
    expenses.fields.getByName('source').values = ['app', 'craftbot', 'receipt', 'csv', 'recurring'];
    app.save(expenses);
    const receipts = app.findCollectionByNameOrId('receipts');
    receipts.fields.getByName('added_by').values = ['app', 'craftbot'];
    app.save(receipts);
  },
);
