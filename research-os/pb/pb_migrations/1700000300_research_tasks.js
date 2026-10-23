/// <reference path="../pb_data/types.d.ts" />
/**
 * Research tasks: every project's own to-do list. A task belongs to exactly
 * one project (deleting the project deletes its tasks). Like every other
 * collection it is closed to the raw API; screens and your AI agent reach it
 * through the tasks.* operations (lib_tasks.js).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const c = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'tasks',
          fields: [
            { name: 'project', type: 'relation', maxSelect: 1, required: true, collectionId: app.findCollectionByNameOrId('projects').id, cascadeDelete: true },
            { name: 'title', type: 'text', required: true, max: 400 },
            { name: 'notes', type: 'text', max: 20000 },
            { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['todo', 'doing', 'waiting', 'done'] },
            { name: 'priority', type: 'select', maxSelect: 1, required: true, values: ['none', 'low', 'medium', 'high', 'urgent'] },
            { name: 'due', type: 'text', max: 10, pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' },
            { name: 'assignee', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent'] },
            { name: 'labels', type: 'json', maxSize: 2000 },
            { name: 'checklist', type: 'json', maxSize: 40000 },
            { name: 'links', type: 'json', maxSize: 8000 },
            { name: 'recur', type: 'select', maxSelect: 1, required: true, values: ['none', 'daily', 'weekly', 'monthly'] },
            { name: 'sort', type: 'number' },
            { name: 'done_at', type: 'text', max: 40 },
            { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent', 'system'] },
            { name: 'created', type: 'autodate', onCreate: true },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ],
          indexes: ['CREATE INDEX idx_tasks_project ON tasks (project, status, sort)', "CREATE INDEX idx_tasks_due ON tasks (due) WHERE due != ''", 'CREATE INDEX idx_tasks_status ON tasks (status, done_at)'],
        },
        closed,
      ),
    );
    app.save(c);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('tasks'));
  },
);
