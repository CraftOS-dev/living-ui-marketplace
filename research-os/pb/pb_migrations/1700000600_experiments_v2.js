/// <reference path="../pb_data/types.d.ts" />
/**
 * Experiments, second design (reports/Experiments redesign.md):
 *
 *   experiments  progress and outcome are two things now: status gains Paused
 *                and loses Failed (failure is an outcome), the hypothesis
 *                verdict becomes the outcome (Supports, Refutes,
 *                Inconclusive, Failed); plus tags, planned dates, pinned,
 *                next steps, and the experiment it repeats (parent)
 *   exp_log      a journal entry says what it is about (a step or a run),
 *                keeps its corrections (the original stays), and is struck
 *                through with a reason instead of being erased; Change
 *                becomes Deviation
 *   exp_templates  protocols used again and again, usable in every project
 */
migrate(
  (app) => {
    const e = app.findCollectionByNameOrId('experiments');
    e.fields.getByName('status').values = ['planned', 'running', 'paused', 'done', 'cancelled'];
    e.fields.removeByName('verdict');
    e.fields.add(new SelectField({ name: 'outcome', maxSelect: 1, values: ['supports', 'refutes', 'inconclusive', 'failed'] }));
    e.fields.add(new TextField({ name: 'next_steps', max: 10000 }));
    e.fields.add(new JSONField({ name: 'tags', maxSize: 4000 }));
    e.fields.add(new TextField({ name: 'planned_start', max: 10, pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' }));
    e.fields.add(new TextField({ name: 'planned_end', max: 10, pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' }));
    e.fields.add(new BoolField({ name: 'pinned' }));
    e.fields.add(new RelationField({ name: 'parent', maxSelect: 1, collectionId: e.id, cascadeDelete: false }));
    e.addIndex('idx_exp_parent', false, 'parent', '');
    app.save(e);

    const l = app.findCollectionByNameOrId('exp_log');
    l.fields.getByName('kind').values = ['note', 'observation', 'result', 'deviation', 'issue', 'system'];
    l.fields.add(new JSONField({ name: 'ref', maxSize: 400 }));
    l.fields.add(new JSONField({ name: 'edits', maxSize: 400000 }));
    l.fields.add(new TextField({ name: 'struck', max: 1000 }));
    l.fields.add(new TextField({ name: 'struck_at', max: 40 }));
    app.save(l);

    app.save(
      new Collection({
        type: 'base',
        name: 'exp_templates',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'name', type: 'text', required: true, max: 300 },
          { name: 'project', type: 'relation', maxSelect: 1, collectionId: app.findCollectionByNameOrId('projects').id, cascadeDelete: false },
          { name: 'kind', type: 'select', maxSelect: 1, required: true, values: ['lab', 'chemistry', 'computational', 'study', 'field', 'other'] },
          { name: 'aim', type: 'text', max: 4000 },
          { name: 'hypothesis', type: 'text', max: 4000 },
          { name: 'variables', type: 'json', maxSize: 200000 },
          { name: 'steps', type: 'json', maxSize: 200000 },
          { name: 'materials', type: 'json', maxSize: 100000 },
          { name: 'tags', type: 'json', maxSize: 4000 },
          { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent', 'system'] },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_tpl_name ON exp_templates (name)'],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('exp_templates'));
    const l = app.findCollectionByNameOrId('exp_log');
    for (const f of ['ref', 'edits', 'struck', 'struck_at']) l.fields.removeByName(f);
    l.fields.getByName('kind').values = ['note', 'observation', 'result', 'issue', 'change', 'system'];
    app.save(l);
    const e = app.findCollectionByNameOrId('experiments');
    e.removeIndex('idx_exp_parent');
    for (const f of ['outcome', 'next_steps', 'tags', 'planned_start', 'planned_end', 'pinned', 'parent']) e.fields.removeByName(f);
    e.fields.add(new SelectField({ name: 'verdict', maxSelect: 1, values: ['supports', 'refutes', 'inconclusive'] }));
    e.fields.getByName('status').values = ['planned', 'running', 'done', 'failed', 'cancelled'];
    app.save(e);
  },
);
