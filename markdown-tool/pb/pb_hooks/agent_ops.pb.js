/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — what a person does in the explorer and the editor, as
 * operations an AI agent can call. Every route here has a matching entry in
 * operations.json. The work is done by lib_agent.js, a server-side port of
 * the UI's own file API (frontend/src/app/services/apiAdapter.ts), so an agent
 * writes the same `nodes` / `sessions` records a person's actions write.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — each handler require()s
 * lib_agent.js itself (once), never referencing this file's scope.
 */

// files.list — the explorer tree (apiAdapter.ts handleListFiles + FolderPanel.tsx toggleDir).
routerAdd('GET', '/api/ops/files/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.list(app, p));
});

// files.read — open a .md file (apiAdapter.ts handleReadFile).
routerAdd('GET', '/api/ops/files/read', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.read(app, p));
});

// files.write — Save / Ctrl+S (MainView.tsx handleSave → apiAdapter.ts handleWriteFile).
routerAdd('POST', '/api/ops/files/write', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.write(app, p));
});

// files.create — New File / New Folder (FolderPanel.tsx handleCreate → apiAdapter.ts handleCreateItem).
routerAdd('POST', '/api/ops/files/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.create(app, p));
});

// files.upload — Upload File / Upload Folder, conflicts refused (apiAdapter.ts handleUpload, overwrite=false).
routerAdd('POST', '/api/ops/files/upload', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.upload(app, p, false));
});

// files.upload-overwrite — "Overwrite" in the upload conflict dialog (apiAdapter.ts handleUpload, overwrite=true).
routerAdd('POST', '/api/ops/files/upload-overwrite', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.upload(app, p, true));
});

// files.rename — the Rename modal (FolderPanel.tsx handleRename → apiAdapter.ts handleRenameItem).
routerAdd('POST', '/api/ops/files/rename', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.rename(app, p));
});

// files.move — drag a file onto a folder (FolderPanel.tsx handleDrop → apiAdapter.ts handleRenameItem).
routerAdd('POST', '/api/ops/files/move', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.move(app, p));
});

// files.delete — the delete confirm (FolderPanel.tsx handleDelete → apiAdapter.ts handleDeleteItem).
routerAdd('POST', '/api/ops/files/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.remove(app, p));
});

// editor.tabs — the tabs the editor restores (MainView.tsx restore), read-only.
routerAdd('GET', '/api/ops/editor/tabs', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.tabs(app));
});
