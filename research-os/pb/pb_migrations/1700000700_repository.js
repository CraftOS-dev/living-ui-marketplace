/// <reference path="../pb_data/types.d.ts" />
/**
 * Each project's research repository: folders and files, as a tree.
 *
 *   repo_items     one folder or file of a project; `parent` is the folder it
 *                  sits in (empty at the top). Deleting a project deletes its
 *                  repository; deleting a folder deletes what is inside it.
 *                  Names are unique in a folder, ignoring case. A file's bytes
 *                  are in the protected `file` field; `name` is what people
 *                  see; `version` counts its versions.
 *   repo_versions  the earlier versions of a file: uploading a file with the
 *                  same name, or saving an edit, keeps the one before here
 *                  (as OSF, Drive, Dropbox and GitHub do), so nothing is lost.
 *   projects       `repo_ready` is set once the project's starter repository
 *                  has been made (lib_repo.ensure), so emptying a repository
 *                  never brings the starter back.
 *
 * Closed to the raw API like every other collection; screens and your AI
 * agent use the repo.* operations (lib_repo.js).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const MAX = 1073741824;
    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'repo_items',
            fields: [
              { name: 'project', type: 'relation', maxSelect: 1, required: true, collectionId: app.findCollectionByNameOrId('projects').id, cascadeDelete: true },
              { name: 'kind', type: 'select', maxSelect: 1, required: true, values: ['folder', 'file'] },
              { name: 'name', type: 'text', required: true, max: 255 },
              { name: 'file', type: 'file', maxSelect: 1, maxSize: MAX, mimeTypes: [], thumbs: [], protected: true },
              { name: 'bytes', type: 'number' },
              { name: 'version', type: 'number' },
              { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent', 'system'] },
              { name: 'created', type: 'autodate', onCreate: true },
              { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            ],
          },
          closed,
        ),
      ),
    );
    // The folder an item sits in points at the same collection, so it is added once the collection exists.
    const items = app.findCollectionByNameOrId('repo_items');
    items.fields.add(new RelationField({ name: 'parent', maxSelect: 1, collectionId: items.id, cascadeDelete: true }));
    items.indexes = ['CREATE UNIQUE INDEX idx_repo_name ON repo_items (project, parent, name COLLATE NOCASE)', 'CREATE INDEX idx_repo_kind ON repo_items (project, kind)'];
    app.save(items);

    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'repo_versions',
            fields: [
              { name: 'item', type: 'relation', maxSelect: 1, required: true, collectionId: items.id, cascadeDelete: true },
              { name: 'number', type: 'number', required: true },
              { name: 'file', type: 'file', maxSelect: 1, maxSize: MAX, mimeTypes: [], thumbs: [], protected: true },
              { name: 'bytes', type: 'number' },
              // Who made that version and when (the file's own time, not when it was superseded).
              { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent', 'system'] },
              { name: 'made_at', type: 'text', max: 40 },
              { name: 'created', type: 'autodate', onCreate: true },
            ],
            indexes: ['CREATE UNIQUE INDEX idx_repo_versions ON repo_versions (item, number)'],
          },
          closed,
        ),
      ),
    );

    const projects = app.findCollectionByNameOrId('projects');
    projects.fields.add(new BoolField({ name: 'repo_ready' }));
    app.save(projects);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('repo_versions'));
    app.delete(app.findCollectionByNameOrId('repo_items'));
    const projects = app.findCollectionByNameOrId('projects');
    projects.fields.removeByName('repo_ready');
    app.save(projects);
  },
);
