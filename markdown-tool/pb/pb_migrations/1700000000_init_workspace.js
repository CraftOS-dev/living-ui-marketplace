/// <reference path="../pb_data/types.d.ts" />
/**
 * Markdown Editor schema.
 *
 * V1 stored the workspace as real files on disk (a WORKSPACE_ROOT directory).
 * V2 has no arbitrary server filesystem, so the workspace is modelled as a
 * VIRTUAL filesystem: one `nodes` record per file or folder. The fetch adapter
 * (src/app/services/apiAdapter.ts) reproduces V1's /api/files* endpoints
 * (list / read / write / create / rename / delete / upload) entirely
 * client-side against this collection's plain REST CRUD.
 *
 *   - `path`   full workspace-relative path, e.g. "notes/todo.md" (unique)
 *   - `parent` the path's parent directory ("" for root children) — the
 *              directory-listing key, so a child query is `parent = '<dir>'`
 *   - `name`   the final path segment
 *   - `is_dir` folder vs file
 *   - `content` file text (empty for folders)
 *   - `modified` last-write epoch seconds (V1 returned st_mtime)
 *
 * `sessions` is a single record persisting the editor layout (open tabs, active
 * tab, panel widths + visibility, expanded dirs) — V1's EditorSession row.
 *
 * Auth mode "none": open rules are acceptable because the app binds loopback
 * and the origin guard (_system.pb.js) refuses foreign-origin writes.
 */
migrate(
  (app) => {
    const nodes = new Collection({
      type: 'base',
      name: 'nodes',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'path', type: 'text', required: true, max: 2000 },
        { name: 'parent', type: 'text', max: 2000 },
        { name: 'name', type: 'text', required: true, max: 500 },
        { name: 'is_dir', type: 'bool' },
        { name: 'content', type: 'text', max: 10000000 },
        { name: 'modified', type: 'number' },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_nodes_path ON nodes (path)',
        'CREATE INDEX idx_nodes_parent ON nodes (parent)',
      ],
    });
    app.save(nodes);

    const sessions = new Collection({
      type: 'base',
      name: 'sessions',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'open_tabs', type: 'json', maxSize: 2000000 },
        { name: 'active_tab', type: 'text', max: 2000 },
        { name: 'folder_panel_width', type: 'number' },
        { name: 'preview_panel_width', type: 'number' },
        { name: 'folder_visible', type: 'bool' },
        { name: 'preview_visible', type: 'bool' },
        { name: 'expanded_dirs', type: 'json', maxSize: 2000000 },
      ],
    });
    app.save(sessions);
  },
  (app) => {
    for (const name of ['sessions', 'nodes']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
