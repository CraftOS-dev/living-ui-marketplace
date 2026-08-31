/// <reference path="../pb_data/types.d.ts" />
/**
 * Folders for the file repository — a Google-Drive-style hierarchy.
 *   - NEW  `folders` collection, self-nesting via a `parent` relation
 *   - ADD  a `folder` relation on `files` (which folder a file lives in)
 * Empty parent/folder means "root". Both relations cascadeDelete, so removing
 * a folder drops its subfolders and the files inside it (the client also
 * deletes the subtree explicitly, so this is a backstop).
 */
migrate(
  (app) => {
    const AUTH = '@request.auth.id != ""';
    const RULES = {
      listRule: AUTH,
      viewRule: AUTH,
      createRule: AUTH,
      updateRule: AUTH,
      deleteRule: AUTH,
    };
    const TS = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    // 1. folders (create first so its id exists for the self-relation)
    const folders = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'folders',
          fields: [{ name: 'name', type: 'text', required: true, max: 200 }].concat(TS),
        },
        RULES,
      ),
    );
    app.save(folders);

    // 2. self-relation parent (null = root)
    const foldersCol = app.findCollectionByNameOrId('folders');
    foldersCol.fields.add(
      new Field({ name: 'parent', type: 'relation', maxSelect: 1, collectionId: foldersCol.id, cascadeDelete: true }),
    );
    app.save(foldersCol);

    // 3. files.folder relation (null = root)
    const files = app.findCollectionByNameOrId('files');
    files.fields.add(
      new Field({ name: 'folder', type: 'relation', maxSelect: 1, collectionId: foldersCol.id, cascadeDelete: true }),
    );
    app.save(files);
  },
  (app) => {
    try {
      const files = app.findCollectionByNameOrId('files');
      files.fields.removeByName('folder');
      app.save(files);
    } catch {
      /* absent */
    }
    try {
      app.delete(app.findCollectionByNameOrId('folders'));
    } catch {
      /* absent */
    }
  },
);
