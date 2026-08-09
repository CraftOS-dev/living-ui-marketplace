/// <reference path="../pb_data/types.d.ts" />
/**
 * PDF Splitter schema.
 *
 * PocketBase (Go + isolated JS hooks) cannot render or split PDFs — there is no
 * server-side compute runtime (that design was tried and rejected). So all PDF
 * work (thumbnail rendering, page extraction, zipping) happens CLIENT-SIDE in
 * the browser (pdf.js / pdf-lib / jszip); the backend only STORES the uploaded
 * source PDF (a `file` field) and the split-job history. Split outputs are
 * regenerated client-side on download from the source + the stored config.
 *
 * Auth mode "none": open rules are acceptable because the app binds loopback
 * and the origin guard (_system.pb.js) refuses foreign-origin writes. The open
 * `source` file field is served at /api/files/pdfs/<recordId>/<filename>.
 */
migrate(
  (app) => {
    const pdfs = new Collection({
      type: 'base',
      name: 'pdfs',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'filename', type: 'text', required: true, max: 500 },
        {
          name: 'source',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 104857600, // 100 MB
          mimeTypes: ['application/pdf'],
        },
        { name: 'file_size', type: 'number' },
        { name: 'page_count', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(pdfs);

    const splitJobs = new Collection({
      type: 'base',
      name: 'split_jobs',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'document',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('pdfs').id,
          cascadeDelete: true,
        },
        { name: 'split_type', type: 'select', maxSelect: 1, values: ['pages', 'ranges', 'every_n'] },
        { name: 'split_config', type: 'json', maxSize: 200000 },
        { name: 'file_count', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(splitJobs);
  },
  (app) => {
    for (const name of ['split_jobs', 'pdfs']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
