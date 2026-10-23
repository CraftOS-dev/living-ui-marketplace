/// <reference path="../pb_data/types.d.ts" />
/**
 * Experiments: a project's planned and running experiments of any kind (a
 * bench protocol, a synthesis, a simulation sweep, a study with people, field
 * work). An experiment holds its plan (aim, hypothesis, the variables: the
 * conditions varied, what is held constant, what is measured; protocol steps;
 * materials), its runs (one row per trial, sample, participant or simulation,
 * with a value for each condition and measure), and its log (timestamped
 * entries with attached files). Closed to the raw API like every collection;
 * reached through the exp.* operations (lib_exp.js).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const ACTORS = ['person', 'agent', 'system'];
    const make = (name, fields, indexes) => {
      app.save(new Collection(Object.assign({ type: 'base', name: name, fields: fields.concat([{ name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }]), indexes: indexes }, closed)));
    };
    const projects = app.findCollectionByNameOrId('projects').id;
    make(
      'experiments',
      [
        { name: 'project', type: 'relation', maxSelect: 1, required: true, collectionId: projects, cascadeDelete: true },
        { name: 'number', type: 'number', required: true, min: 1, onlyInt: true },
        { name: 'title', type: 'text', required: true, max: 300 },
        { name: 'kind', type: 'select', maxSelect: 1, required: true, values: ['lab', 'chemistry', 'computational', 'study', 'field', 'other'] },
        { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['planned', 'running', 'done', 'failed', 'cancelled'] },
        { name: 'aim', type: 'text', max: 4000 },
        { name: 'hypothesis', type: 'text', max: 4000 },
        { name: 'variables', type: 'json', maxSize: 200000 },
        { name: 'steps', type: 'json', maxSize: 200000 },
        { name: 'materials', type: 'json', maxSize: 100000 },
        { name: 'links', type: 'json', maxSize: 20000 },
        { name: 'started_at', type: 'text', max: 40 },
        { name: 'ended_at', type: 'text', max: 40 },
        { name: 'summary', type: 'text', max: 20000 },
        { name: 'verdict', type: 'select', maxSelect: 1, values: ['supports', 'refutes', 'inconclusive'] },
        { name: 'conclusion_by', type: 'select', maxSelect: 1, values: ['person', 'agent'] },
        { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ACTORS },
      ],
      ['CREATE UNIQUE INDEX idx_exp_number ON experiments (project, number)', 'CREATE INDEX idx_exp_status ON experiments (project, status)'],
    );
    const experiments = app.findCollectionByNameOrId('experiments').id;
    make(
      'exp_runs',
      [
        { name: 'experiment', type: 'relation', maxSelect: 1, required: true, collectionId: experiments, cascadeDelete: true },
        { name: 'number', type: 'number', required: true, min: 1, onlyInt: true },
        { name: 'values', type: 'json', maxSize: 200000 },
        { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['planned', 'done', 'failed', 'excluded'] },
        { name: 'note', type: 'text', max: 4000 },
        { name: 'recorded_at', type: 'text', max: 40 },
        { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ACTORS },
      ],
      ['CREATE UNIQUE INDEX idx_run_number ON exp_runs (experiment, number)', 'CREATE INDEX idx_run_status ON exp_runs (experiment, status)'],
    );
    make(
      'exp_log',
      [
        { name: 'experiment', type: 'relation', maxSelect: 1, required: true, collectionId: experiments, cascadeDelete: true },
        { name: 'kind', type: 'select', maxSelect: 1, required: true, values: ['note', 'observation', 'result', 'issue', 'change', 'system'] },
        { name: 'text', type: 'text', max: 20000 },
        { name: 'files', type: 'file', maxSelect: 20, maxSize: 104857600, mimeTypes: [], thumbs: [], protected: true },
        { name: 'at', type: 'text', required: true, max: 40 },
        { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ACTORS },
      ],
      ['CREATE INDEX idx_log_exp ON exp_log (experiment, at)'],
    );
  },
  (app) => {
    for (const name of ['exp_log', 'exp_runs', 'experiments']) app.delete(app.findCollectionByNameOrId(name));
  },
);
