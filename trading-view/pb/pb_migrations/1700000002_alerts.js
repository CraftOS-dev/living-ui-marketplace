/// <reference path="../pb_data/types.d.ts" />
/**
 * Price alerts: checked against live quotes while the app is open;
 * triggered alerts keep their trigger time as history.
 */
migrate(
  (app) => {
    const alerts = new Collection({
      type: 'base',
      name: 'alerts',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'symbol', type: 'text', required: true, max: 12 },
        { name: 'condition', type: 'select', maxSelect: 1, values: ['above', 'below'] },
        { name: 'price', type: 'number', required: true },
        { name: 'triggered', type: 'bool' },
        { name: 'triggered_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(alerts);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('alerts'));
  },
);
