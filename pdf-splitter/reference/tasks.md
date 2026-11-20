# Tasks: PDF Splitter

Every task cites what it implements. The View's features already exist in the published app `pdf-splitter` 1.0.0. The agent operations were added with the framework conversion and tested against a live PocketBase 0.39.7 on a scratch copy (2026-11-11). Every build task is therefore recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): two-pane frame. The Documents sidebar collapses between 280 and 48 px; below 768 px it is a drawer with a backdrop, opened from the top bar's menu button (`components/MainView.tsx`, `Sidebar.tsx`).
- [x] T-2 (F-FRM-4): the theme follows the host's `craftbot-theme` and `livingui-theme` messages, CraftBot dark by default (`App.tsx`, `theme/themes.ts`).
- [x] T-3 (F-FRM-5, F-FRM-6): toasts in the top-right corner for 3 s (react-toastify), and a full-screen spinner until the first document list arrives.
- [x] T-4 (F-DOC-1, F-DOC-2, F-DOC-3): drop zone and file picker. The browser runs the upload checks: `.pdf` name, `%PDF` start, the pdf.js page count, and no password (pdf.js's `PasswordException`, or an owner password seen as its `EncryptFilterName`). The upload is a multipart create of `pdfs`, and the new document opens with a toast (`DropZone.tsx`, `apiAdapter.ts` handleUpload).
- [x] T-5 (F-DOC-4, F-DOC-5, F-DOC-6, F-DOC-7): the sidebar list, newest first (up to 500), with size and date. The open document is highlighted. The no-document upload view, and "Upload another" with its inline drop zone.
- [x] T-6 (F-DOC-8): delete from the trash button. The relation cascade removes the split history and PocketBase removes the stored file; the next document opens.
- [x] T-7 (F-PAG-1): thumbnail grid. pdf.js renders each page at 1.5× in the browser, with a spinner, then the page or "Failed" (`ThumbnailGrid.tsx`, `apiAdapter.ts` handleThumbnail).
- [x] T-8 (F-PAG-2, F-PAG-3, F-PAG-4, F-PAG-5): page selection: click to toggle, shift+click for a run, Select all and Deselect all, the selected and hover looks, and the reset on a document switch.
- [x] T-9 (F-SPL-1, F-SPL-2, F-SPL-3, F-SPL-4, F-SPL-5): split controls with three tabs. They include the range parser with its "Invalid range" message, the "→ files" previews, N starting at 2, and "Split PDF" disabled until the input is valid (`SplitControls.tsx`).
- [x] T-10 (F-SPL-6, F-SPL-7): "Split PDF" opens the source with pdf-lib, builds the page groups and writes one `split_jobs` row. The Split Complete panel follows, with file buttons and "Download All (ZIP)" (`apiAdapter.ts` handleSplit, buildPageGroups).
- [x] T-11 (F-HIS-1, F-HIS-4, F-HIS-5): downloads are rebuilt in the browser with pdf-lib, and the ZIP `split_output.zip` with JSZip, indexed in the panel's plan order (`outputFiles`). Repeated names get " (2)", " (3)"…, so each part is its own file and the ZIP holds them all.
- [x] T-12 (F-HIS-2, F-HIS-3, F-HIS-6): Split History per document, newest first. Each row has its type badge, summary, date, ZIP button and Part buttons. The section collapses, and it reloads when the document changes or after a split (`SplitHistory.tsx`).
- [x] T-13 (F-AGT-1, F-AGT-8): the agent operations. The routes are in `pb/pb_hooks/agent_ops.pb.js`, `require()`d inside each handler. The logic is in `lib_agent.js`, which resolves a PDF by id or by a unique exact name. The 7 operations are declared in `operations.json` and served as `POST /api/ops/<name>` by the generated `a2app_routes.pb.js`.
- [x] T-14 (F-AGT-2, F-AGT-3, F-AGT-4): `pdfs.upload` reads an absolute path and runs the UI's checks in order, plus the 100 MB limit. It reads the page count from the plain page tree; otherwise it requires `page_count` and cross-checks it whenever the count is readable. It refuses encrypted files. The scan uses indexOf instead of whole-file regexes, which took a 40 MB file from 28 s to 3 s.
- [x] T-15 (F-AGT-5): `splits.preview` and `splits.create` port `parsedRanges`, `canSplit`, `handleSplit` and `buildPageGroups`. They write the UI's exact `split_config` and list files in the panel's order, which the downloads follow, with the same unique names. A 31-input parser battery agreed with the UI's own parser, extracted from the TypeScript source.
- [x] T-16 (F-AGT-6): `splits.get` returns the source path and the files in download order (`outputFiles`), each with its part label and page range, plus the ZIP's entries.
- [x] T-17 (F-AGT-7): `pdfs.delete` is declared destructive, so the adapter answers `approval_required` until the person approves. It removes the PDF, its file and its history, the same as the trash button.
- [x] T-18 (F-DOC-2, F-HIS-4, F-HIS-5, F-AGT-4, F-AGT-6): the defect fixes of 2026-11-11 (requirements ## Changes) in `apiAdapter.ts` and `lib_agent.js`: password-protected uploads refused (pdf-lib's `ignoreEncryption` was tried and gives blank parts), downloads and the ZIP in the panel's order, unique part names. Checked live through the screens (Playwright, the ZIP unzipped) and through the agent operations.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 7 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
