/// <reference path="../pb_data/types.d.ts" />
/**
 * Pictures in notes. A note's image block names one `note_files` record of
 * the same note; deleting the note deletes its pictures. Pasted, dropped or
 * chosen pictures are uploaded here first (notes.add-image), then the editor
 * puts the block where the cursor is. Closed to the raw API like every other
 * collection (lib_notes.js).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'note_files',
            fields: [
              { name: 'note', type: 'relation', maxSelect: 1, required: true, collectionId: app.findCollectionByNameOrId('notes').id, cascadeDelete: true },
              { name: 'file', type: 'file', maxSelect: 1, maxSize: 26214400, mimeTypes: [], thumbs: [], protected: true },
              { name: 'name', type: 'text', max: 255 },
              { name: 'bytes', type: 'number' },
              { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent', 'system'] },
              { name: 'created', type: 'autodate', onCreate: true },
            ],
            indexes: ['CREATE INDEX idx_note_files_note ON note_files (note)'],
          },
          closed,
        ),
      ),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('note_files'));
  },
);
