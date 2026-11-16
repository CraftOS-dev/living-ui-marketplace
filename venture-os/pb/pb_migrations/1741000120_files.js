/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS files (kernel-records): stored files with their owner (a deal,
 * company, person, fund, LP or another module's record, by collection name
 * and id), folders, versions by name within a folder (a new version keeps
 * `prev`; only the newest is `current`), the NDA flag; the text step of
 * each version (file_texts: state, content hash, page counts); each page's text layer (one record per page, `needs_ocr`
 * when the page has too little text to read) and anchors (a passage on a
 * page by offsets and quote, or a passage of a message by id and offsets).
 *
 * The file field is protected: files are served only through the app's
 * operations, which check rights (NDA files: the deal team, and your AI
 * agent only inside a claimed job for that deal).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max) => ({ name: name, type: 'text', max: max || 200 });
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name) => ({ name: name, type: 'number' });
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];

    make(
      'files',
      [
        req('owner_collection', 40),
        req('owner_id', 20),
        rel('deal', 'deals'),
        txt('folder', 300),
        req('name', 300),
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 209715200, protected: true },
        int('bytes', { min: 0 }),
        txt('mime', 120),
        txt('ext', 12),
        int('version', { min: 1 }),
        bool('current'),
        sel('origin', ['upload', 'email', 'agent', 'import', 'link', 'generated', 'system'], true),
        txt('source_ref', 300),
        bool('nda'),
        json('meta', 4000),
        txt('deleted_at', 40),
        txt('run', 40),
      ]
        .concat(written())
        .concat(stamps),
      [
        'CREATE INDEX idx_files_owner ON files (owner_collection, owner_id, current)',
        'CREATE INDEX idx_files_deal ON files (deal)',
      ],
    );
    const files = app.findCollectionByNameOrId('files');
    files.fields.add(new RelationField({ name: 'prev', maxSelect: 1, collectionId: files.id, cascadeDelete: false }));
    app.save(files);

    // The text step of each file version, kept apart from the file record so
    // the background step never changes the record an Undo of the upload
    // removes (the undo guard compares it with its state after the upload).
    make(
      'file_texts',
      [
        rel('file', 'files', { required: true, cascadeDelete: true }),
        sel('state', ['waiting', 'extracting', 'ready', 'needs_ocr', 'none', 'failed'], true),
        txt('error', 2000),
        txt('started_at', 40),
        int('attempts', { min: 0 }),
        txt('sha256', 64),
        int('pages', { min: 0 }),
        int('pages_with_text', { min: 0 }),
        int('ocr_pages', { min: 0 }),
        txt('engine', 60),
        txt('same_as', 20),
        json('meta', 200000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_file_texts_file ON file_texts (file)', 'CREATE INDEX idx_file_texts_state ON file_texts (state)', 'CREATE INDEX idx_file_texts_sha ON file_texts (sha256)'],
    );

    make(
      'pages',
      [
        rel('file', 'files', { required: true, cascadeDelete: true }),
        int('page_no', { min: 1 }),
        num('width'),
        num('height'),
        int('rotate'),
        txt('text', 1000000),
        json('items', 5000000),
        json('lines', 1000000),
        int('chars', { min: 0 }),
        bool('needs_ocr'),
        sel('origin', ['pdf_text', 'ocr', 'plain', 'office', 'none'], true),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_pages_file ON pages (file, page_no)', 'CREATE INDEX idx_pages_ocr ON pages (needs_ocr)'],
    );

    make(
      'anchors',
      [
        sel('kind', ['text', 'area', 'message'], true),
        rel('file', 'files', { cascadeDelete: true }),
        int('page_no', { min: 0 }),
        int('start', { min: 0 }),
        int('end', { min: 0 }),
        txt('quote', 40000),
        json('rects', 200000),
        json('area', 2000),
        txt('message_id', 200),
        txt('ref_collection', 40),
        txt('ref_id', 20),
        rel('deal', 'deals'),
        txt('run', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_anchors_file ON anchors (file, page_no)', 'CREATE INDEX idx_anchors_message ON anchors (message_id)', 'CREATE INDEX idx_anchors_deal ON anchors (deal)'],
    );
  },
  (app) => {
    for (const n of ['anchors', 'pages', 'file_texts', 'files']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
