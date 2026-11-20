/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY stand-in for kernel-records' lib_files.js: just pathOf, the
 * one function the kernel calls (outbound attachments). Never shipped.
 */
function pathOf(app, fileId) {
  const rec = app.findRecordById('files', String(fileId || ''));
  const data = app.dataDir();
  const base = $filepath.isAbs(data) ? data : $filepath.join($os.getwd(), data);
  return $filepath.join(base, 'storage', rec.baseFilesPath(), rec.getString('file'));
}

module.exports = { pathOf: pathOf };
