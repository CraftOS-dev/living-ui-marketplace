/// <reference path="../pb_data/types.d.ts" />
/**
 * Record rules the screens rely on, for every path (the screens, the agent
 * operations and plain `data` calls alike).
 */

// Deleting a workspace deletes what is filed under it. The Groups dialog asks
// "delete workspace X and all its invoices, subscriptions and feed entries?";
// the links are plain text ids (group_id), so nothing cascades on its own.
onRecordAfterDeleteSuccess((e) => {
  const groupId = e.record.id;
  e.app.runInTransaction((txApp) => {
    ['invoices', 'subscriptions', 'activities'].forEach((name) => {
      const rows = txApp.findRecordsByFilter(name, 'group_id = {:g}', '', 0, 0, { g: groupId });
      for (let i = 0; i < rows.length; i++) txApp.delete(rows[i]);
    });
  });
  e.next();
}, 'groups');

// Download PDF (ledger and inspector): serves the PDF stored on the invoice
// (`pdf_file`) under the name it was attached with.
routerAdd('GET', '/api/invoices/{id}/download-pdf', (e) => {
  const id = e.request.pathValue('id');
  let rec = null;
  try {
    rec = e.app.findRecordById('invoices', id);
  } catch (_err) {
    return e.json(404, { status: 404, message: 'No invoice with id "' + id + '".' });
  }
  const file = rec.getString('pdf_file');
  if (!file) return e.json(404, { status: 404, message: 'No PDF is attached to this invoice.' });
  const fsys = e.app.newFilesystem();
  try {
    fsys.serve(e.response, e.request, rec.baseFilesPath() + '/' + file, rec.getString('pdf_filename') || file);
  } finally {
    fsys.close();
  }
});
