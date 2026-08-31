/// <reference path="../pb_data/types.d.ts" />
/**
 * Resume Maker schema: state storage for active resumes and configuration.
 */
migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'resume_state',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'key', type: 'text', required: true, max: 255 },
        { name: 'data', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('resume_state');
    app.delete(collection);
  },
);
