/// <reference path="../pb_data/types.d.ts" />
/**
 * Manuscripts typeset with LaTeX (lib_ms.js, engine/latex.mjs).
 *
 *   ms_blocks     three more kinds: figure (a picture or PDF from the project
 *                 repository; its caption is the block's content), table
 *                 (rows of cells; caption in content) and latex (code put in
 *                 as it is). `data` holds what a kind needs beyond its text:
 *                 figure {file, width}, table {rows, header, align}, latex
 *                 {code}.
 *   manuscripts   `preamble`: packages, macros, \author, \date, put before
 *                 \begin{document}; `style_folder`: a repository folder with
 *                 a venue's style files (.cls, .sty, .bst) for venues whose
 *                 files are not in the engine's package set.
 *   ms_builds     one PDF build: running, done or failed, with the PDF, the
 *                 engine's log and its errors mapped to blocks. A few recent
 *                 builds per manuscript are kept.
 */
migrate(
  (app) => {
    const blocks = app.findCollectionByNameOrId('ms_blocks');
    blocks.fields.getByName('type').values = ['h1', 'h2', 'h3', 'paragraph', 'quote', 'bullet', 'numbered', 'equation', 'abstract', 'figure', 'table', 'latex'];
    blocks.fields.add(new JSONField({ name: 'data', maxSize: 2000000 }));
    app.save(blocks);

    const ms = app.findCollectionByNameOrId('manuscripts');
    ms.fields.add(new JSONField({ name: 'authors', maxSize: 100000 }));
    ms.fields.add(new TextField({ name: 'preamble', max: 20000 }));
    ms.fields.add(new RelationField({ name: 'style_folder', maxSelect: 1, collectionId: app.findCollectionByNameOrId('repo_items').id, cascadeDelete: false }));
    app.save(ms);

    app.save(
      new Collection({
        type: 'base',
        name: 'ms_builds',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'manuscript', type: 'relation', maxSelect: 1, required: true, collectionId: ms.id, cascadeDelete: true },
          { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['running', 'done', 'failed'] },
          { name: 'phase', type: 'text', max: 40 },
          { name: 'pdf', type: 'file', maxSelect: 1, maxSize: 104857600, mimeTypes: [], thumbs: [], protected: true },
          { name: 'pages', type: 'number' },
          { name: 'seconds', type: 'number' },
          { name: 'log', type: 'text', max: 200000 },
          { name: 'errors', type: 'json', maxSize: 200000 },
          { name: 'lines', type: 'json', maxSize: 400000 },
          { name: 'dir', type: 'text', max: 1000 },
          { name: 'stamp', type: 'text', max: 64 },
          { name: 'finished_at', type: 'text', max: 40 },
          { name: 'actor', type: 'select', maxSelect: 1, required: true, values: ['person', 'agent', 'system'] },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_ms_builds ON ms_builds (manuscript, created)'],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('ms_builds'));
    const ms = app.findCollectionByNameOrId('manuscripts');
    ms.fields.removeByName('authors');
    ms.fields.removeByName('preamble');
    ms.fields.removeByName('style_folder');
    app.save(ms);
    const blocks = app.findCollectionByNameOrId('ms_blocks');
    blocks.fields.removeByName('data');
    blocks.fields.getByName('type').values = ['h1', 'h2', 'h3', 'paragraph', 'quote', 'bullet', 'numbered', 'equation'];
    app.save(blocks);
  },
);
