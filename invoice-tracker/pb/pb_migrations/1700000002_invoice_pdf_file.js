/// <reference path="../pb_data/types.d.ts" />
/**
 * Invoice PDFs are stored on the invoice itself: `pdf_file` holds the PDF a
 * person attaches (Add Invoice form, or Attach PDF on an existing invoice).
 * `has_pdf_attachment` now means "a PDF file is stored", so rows that only
 * carried a PDF name are corrected to false.
 */
migrate(
  (app) => {
    const invoices = app.findCollectionByNameOrId('invoices');
    invoices.fields.add(
      new FileField({
        name: 'pdf_file',
        maxSelect: 1,
        maxSize: 26214400,
        mimeTypes: ['application/pdf'],
      }),
    );
    app.save(invoices);

    const named = app.findRecordsByFilter('invoices', 'has_pdf_attachment = true', '', 0, 0);
    for (let i = 0; i < named.length; i++) {
      named[i].set('has_pdf_attachment', false);
      app.save(named[i]);
    }
  },
  (app) => {
    const invoices = app.findCollectionByNameOrId('invoices');
    invoices.fields.removeByName('pdf_file');
    app.save(invoices);
  },
);
