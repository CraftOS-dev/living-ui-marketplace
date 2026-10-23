/// <reference path="../pb_data/types.d.ts" />
/**
 * CAD Workshop schema (auth mode none: open read rules, loopback only).
 *
 * A part is a feature tree: an ordered list of typed features driven by
 * named parameters. The tree is the truth; geometry is derived. Every run of
 * the tree through the engine is a `builds` row whose files (viewer mesh,
 * topology, thumbnail) are attached to it, keyed by a hash of everything the
 * build depends on. Every edit to a tree is a `changes` row in a batch, so a
 * batch (one action, or one run of the AI agent) reverts in one step.
 *
 * Every collection changes only through the app's operations (direct API
 * writes are refused in hooks.pb.js), so the UI, the AI agent's CLI and the
 * engine always agree.
 *
 * The blueprint's starter `items` collection is removed first (its
 * migration stays: it is applied history).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    const opsOnly = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const define = (def) => new Collection(Object.assign({ type: 'base' }, opsOnly, def));
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const ident = '^[a-z][a-z0-9_]{0,31}$';
    const actors = ['you', 'agent'];
    const MB = 1024 * 1024;

    const settings = define({
      name: 'settings',
      fields: [
        { name: 'display_unit', type: 'select', required: true, maxSelect: 1, values: ['mm', 'in'] },
        { name: 'navigation', type: 'select', required: true, maxSelect: 1, values: ['left_rotates', 'right_rotates', 'middle_rotates'] },
        { name: 'projection', type: 'select', required: true, maxSelect: 1, values: ['perspective', 'orthographic'] },
        { name: 'show_grid', type: 'bool' },
        { name: 'default_material', type: 'text', max: 60 },
        { name: 'materials', type: 'json', maxSize: 20000 },
        { name: 'agent_wait_s', type: 'number', min: 0, max: 25 },
        { name: 'last_prune_at', type: 'text', max: 40 },
      ].concat(stamps),
    });
    app.save(settings);

    const parts = define({
      name: 'parts',
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'description', type: 'text', max: 4000 },
        { name: 'material', type: 'text', max: 60 },
        { name: 'density', type: 'number', min: 0, max: 30 },
        { name: 'color', type: 'select', maxSelect: 1, values: ['neutral', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'graphite'] },
        { name: 'tree_hash', type: 'text', max: 80 },
        { name: 'rollback_after', type: 'text', max: 40 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['empty', 'queued', 'building', 'ok', 'warning', 'failed'] },
        { name: 'thumbnail', type: 'file', maxSelect: 1, maxSize: 4 * MB, mimeTypes: ['image/png'] },
        { name: 'pinned', type: 'bool' },
        { name: 'archived', type: 'bool' },
        { name: 'origin', type: 'select', maxSelect: 1, values: ['you', 'agent', 'import'] },
        { name: 'notes', type: 'text', max: 4000 },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_parts_name ON parts (name COLLATE NOCASE)'],
    });
    app.save(parts);
    const partsId = app.findCollectionByNameOrId('parts').id;
    const partRel = { name: 'part', type: 'relation', required: true, maxSelect: 1, collectionId: partsId, cascadeDelete: true };

    const parameters = define({
      name: 'parameters',
      fields: [
        partRel,
        { name: 'name', type: 'text', required: true, max: 32, pattern: ident },
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['length', 'angle', 'count', 'ratio'] },
        { name: 'expr', type: 'text', required: true, max: 500 },
        { name: 'value', type: 'number' },
        { name: 'bounds', type: 'json', maxSize: 200 },
        { name: 'comment', type: 'text', max: 300 },
        { name: 'author', type: 'select', maxSelect: 1, values: actors },
        { name: 'sort', type: 'number', onlyInt: true },
        { name: 'error', type: 'text', max: 500 },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_parameters_name ON parameters (part, name)'],
    });
    app.save(parameters);

    const features = define({
      name: 'features',
      fields: [
        partRel,
        { name: 'seq', type: 'number', onlyInt: true },
        { name: 'name', type: 'text', required: true, max: 32, pattern: ident },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['sketch', 'extrude', 'revolve', 'primitive', 'hole', 'fillet', 'chamfer', 'shell', 'pattern_linear', 'pattern_circular', 'mirror', 'boolean', 'transform', 'import_step'],
        },
        { name: 'params', type: 'json', required: true, maxSize: 200000 },
        { name: 'suppressed', type: 'bool' },
        { name: 'author', type: 'select', maxSelect: 1, values: actors },
        { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'ok', 'warning', 'error', 'suppressed', 'rolled_back', 'not_built'] },
        { name: 'error', type: 'json', maxSize: 20000 },
        { name: 'warnings', type: 'json', maxSize: 20000 },
        { name: 'ms', type: 'number' },
        { name: 'faces', type: 'number', onlyInt: true },
        { name: 'note', type: 'text', max: 500 },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_features_name ON features (part, name)', 'CREATE INDEX idx_features_seq ON features (part, seq)'],
    });
    app.save(features);

    const builds = define({
      name: 'builds',
      fields: [
        partRel,
        { name: 'input_hash', type: 'text', max: 80 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['queued', 'running', 'ok', 'warning', 'failed', 'cancelled'] },
        { name: 'requested_by', type: 'select', maxSelect: 1, values: ['you', 'agent', 'system'] },
        { name: 'preview', type: 'bool' },
        { name: 'tree', type: 'json', maxSize: 2000000 },
        { name: 'started', type: 'text', max: 40 },
        { name: 'finished', type: 'text', max: 40 },
        { name: 'ms', type: 'number' },
        { name: 'view', type: 'file', maxSelect: 1, maxSize: 400 * MB },
        { name: 'topology', type: 'file', maxSelect: 1, maxSize: 200 * MB },
        { name: 'thumb', type: 'file', maxSelect: 1, maxSize: 4 * MB, mimeTypes: ['image/png'] },
        { name: 'summary', type: 'json', maxSize: 100000 },
        { name: 'features', type: 'json', maxSize: 500000 },
        { name: 'error', type: 'json', maxSize: 20000 },
        { name: 'checks', type: 'json', maxSize: 100000 },
        { name: 'cached', type: 'number', onlyInt: true },
        { name: 'triangles', type: 'number', onlyInt: true },
        { name: 'note', type: 'text', max: 300 },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_builds_part ON builds (part, created)', 'CREATE INDEX idx_builds_status ON builds (status)', 'CREATE INDEX idx_builds_hash ON builds (part, input_hash)'],
    });
    app.save(builds);

    const p = app.findCollectionByNameOrId('parts');
    p.fields.add(new RelationField({ name: 'current_build', maxSelect: 1, collectionId: app.findCollectionByNameOrId('builds').id, cascadeDelete: false }));
    app.save(p);

    const changes = define({
      name: 'changes',
      fields: [
        partRel,
        { name: 'batch', type: 'text', required: true, max: 40 },
        { name: 'actor', type: 'select', required: true, maxSelect: 1, values: ['you', 'agent', 'system'] },
        {
          name: 'action',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['add_feature', 'update_feature', 'move_feature', 'delete_feature', 'set_parameter', 'delete_parameter', 'roll_to'],
        },
        { name: 'target', type: 'text', max: 40 },
        { name: 'target_id', type: 'text', max: 40 },
        { name: 'before', type: 'json', maxSize: 200000 },
        { name: 'after', type: 'json', maxSize: 200000 },
        { name: 'hash_before', type: 'text', max: 80 },
        { name: 'hash_after', type: 'text', max: 80 },
        { name: 'note', type: 'text', max: 500 },
        { name: 'reverted_by', type: 'text', max: 40 },
        { name: 'reverts', type: 'text', max: 40 },
        { name: 'ord', type: 'number', onlyInt: true },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_changes_part ON changes (part, ord)', 'CREATE INDEX idx_changes_batch ON changes (batch)'],
    });
    app.save(changes);

    const exportsC = define({
      name: 'exports',
      fields: [
        partRel,
        { name: 'build', type: 'relation', maxSelect: 1, collectionId: app.findCollectionByNameOrId('builds').id, cascadeDelete: false },
        { name: 'format', type: 'select', required: true, maxSelect: 1, values: ['step', 'stl', '3mf', 'glb'] },
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 1000 * MB },
        { name: 'name', type: 'text', max: 120 },
        { name: 'bytes', type: 'number', onlyInt: true },
        { name: 'triangles', type: 'number', onlyInt: true },
        { name: 'tolerance', type: 'number' },
        { name: 'verified', type: 'bool' },
        { name: 'input_hash', type: 'text', max: 80 },
        { name: 'requested_by', type: 'select', maxSelect: 1, values: actors },
        { name: 'pinned', type: 'bool' },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_exports_part ON exports (part, created)'],
    });
    app.save(exportsC);

    const selections = define({
      name: 'selections',
      fields: [partRel, { name: 'keys', type: 'json', maxSize: 50000 }, { name: 'set_by', type: 'select', maxSelect: 1, values: actors }].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_selections_part ON selections (part)'],
    });
    app.save(selections);

    const checks = define({
      name: 'checks',
      fields: [
        partRel,
        { name: 'name', type: 'text', required: true, max: 80 },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['bbox_x', 'bbox_y', 'bbox_z', 'volume', 'area', 'mass', 'solid_count', 'valid', 'distance', 'center_distance', 'radius', 'face_count', 'fits_within'],
        },
        { name: 'refs', type: 'json', maxSize: 20000 },
        { name: 'op', type: 'select', maxSelect: 1, values: ['eq', 'le', 'ge', 'between'] },
        { name: 'target', type: 'number' },
        { name: 'target_max', type: 'number' },
        { name: 'tolerance', type: 'number', min: 0 },
        { name: 'box', type: 'json', maxSize: 200 },
        { name: 'author', type: 'select', maxSelect: 1, values: actors },
        { name: 'result', type: 'select', maxSelect: 1, values: ['pending', 'pass', 'fail', 'cannot_run'] },
        { name: 'value', type: 'json', maxSize: 200 },
        { name: 'detail', type: 'text', max: 500 },
        { name: 'build', type: 'relation', maxSelect: 1, collectionId: app.findCollectionByNameOrId('builds').id, cascadeDelete: false },
        { name: 'sort', type: 'number', onlyInt: true },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_checks_part ON checks (part)'],
    });
    app.save(checks);

    const assets = define({
      name: 'assets',
      fields: [
        partRel,
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['step'] },
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 500 * MB },
        { name: 'bytes', type: 'number', onlyInt: true },
        { name: 'hash', type: 'text', max: 80 },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_assets_part ON assets (part)'],
    });
    app.save(assets);

    const briefs = define({
      name: 'briefs',
      fields: [
        { name: 'part', type: 'relation', maxSelect: 1, collectionId: partsId, cascadeDelete: true },
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['design', 'repair', 'review'] },
        { name: 'title', type: 'text', required: true, max: 160 },
        { name: 'body', type: 'text', max: 8000 },
        { name: 'selection', type: 'json', maxSize: 20000 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['sent', 'working', 'done', 'failed'] },
        { name: 'result', type: 'text', max: 8000 },
        { name: 'request_id', type: 'text', max: 40 },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_briefs_part ON briefs (part, created)'],
    });
    app.save(briefs);

    const compares = define({
      name: 'compares',
      fields: [
        partRel,
        { name: 'from_build', type: 'text', max: 40 },
        { name: 'to_build', type: 'text', max: 40 },
        { name: 'batch', type: 'text', max: 40 },
        { name: 'added', type: 'file', maxSelect: 1, maxSize: 400 * MB },
        { name: 'removed', type: 'file', maxSelect: 1, maxSize: 400 * MB },
        { name: 'added_mm3', type: 'number' },
        { name: 'removed_mm3', type: 'number' },
        { name: 'before_mm3', type: 'number' },
        { name: 'after_mm3', type: 'number' },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_compares_part ON compares (part, created)'],
    });
    app.save(compares);
  },
  (app) => {
    for (const name of ['compares', 'briefs', 'assets', 'checks', 'selections', 'exports', 'changes']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
    const p = app.findCollectionByNameOrId('parts');
    p.fields.removeByName('current_build');
    app.save(p);
    for (const name of ['builds', 'features', 'parameters', 'parts', 'settings']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
