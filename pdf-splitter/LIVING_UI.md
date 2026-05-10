# PDF Splitter

A clean, single-page PDF splitter. Upload a PDF, preview every page as a thumbnail, then split into separate files by individual pages, custom ranges, or every N pages. Download files individually or as a ZIP. Per-document split history is preserved across reloads.

## Overview

- **Who it's for** — anyone who needs to extract or chunk pages out of a PDF without uploading to a third-party site. All processing happens locally in the backend.
- **Core flow** — drop a PDF on the upload zone → thumbnails render in a responsive grid → click pages (or type a range like `1-5, 8, 11-15`) → press *Split PDF* → download individual files or one ZIP.
- **History** — every split is stored per-document; the *Split History* section shows the type, config, timestamp, and download buttons for each previous split.
- **Sidebar** — collapsible left rail listing all uploaded PDFs. On viewports below 768 px it hides off-canvas and is opened from a hamburger button in the top bar.

## Layout & Design

- Two-pane layout: collapsible left sidebar (documents) + main content area (top bar, thumbnails, split controls, history).
- Theme: system (light + dark) using design tokens from `frontend/styles/global.css`.
- Primary color `#FF4F18` (orange) — page selection ring/overlay, primary buttons, active states.
- Secondary `#262626` for sidebar/surface; accent `#E64515` for hover.
- Typography: Inter / system sans stack from `--font-sans`.
- Components: preset `Button`, `Input`, `Spinner` from `frontend/components/ui`. Toast notifications via `react-toastify`.
- Responsive: breakpoint at 768 px. The sidebar becomes an overlay drawer with backdrop on mobile; thumbnail grid auto-fills down to ~110 px columns; top bar wraps; content padding shrinks.

## Data Model

| Model | Purpose | Key fields |
|---|---|---|
| `AppState` | Generic JSON state bag (template-provided) | `id`, `data` (JSON) |
| `UISnapshot`, `UIScreenshot` | Agent-observation captures (template-provided) | DOM/text/screenshot blobs |
| `PDFDocument` | An uploaded PDF | `id`, `filename`, `file_path`, `file_size`, `page_count`, `uploaded_at` |
| `SplitJob` | One split operation against a `PDFDocument` | `id`, `document_id` (FK → `pdf_documents`), `split_type` (`pages`/`ranges`/`every_n`), `split_config` (JSON), `output_dir`, `file_count`, `created_at` |

`PDFDocument.splits` cascades delete: removing a PDF deletes its split jobs and the on-disk split outputs.

## API Endpoints

State & action (template-provided):

| Method | Path | Purpose |
|---|---|---|
| GET / PUT / POST / DELETE | `/api/state[/replace]` | Generic JSON state |
| POST | `/api/action` | Generic action handler (`reset`) |
| GET / POST | `/api/ui-snapshot`, `/api/ui-screenshot` | Agent observation |

PDF documents:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/pdfs/upload` | Upload a PDF (multipart `file` field). Validates `%PDF` magic bytes, extracts page count via PyMuPDF. |
| GET | `/api/pdfs` | List uploaded PDFs (newest first) |
| GET | `/api/pdfs/{pdf_id}` | Get PDF details |
| DELETE | `/api/pdfs/{pdf_id}` | Delete the PDF, its file, and all split outputs |

Thumbnails (rendered on-demand at 1.5× zoom, cached on disk):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pdfs/{pdf_id}/thumbnails` | List thumbnail URLs for every page |
| GET | `/api/pdfs/{pdf_id}/thumbnails/{page_num}` | PNG for a single page |

Split & download:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/pdfs/{pdf_id}/split` | Run a split. Body: `{split_type: "pages"\|"ranges"\|"every_n", config: {...}}` |
| GET | `/api/splits` | All splits, newest first |
| GET | `/api/pdfs/{pdf_id}/splits` | Splits for a single PDF |
| GET | `/api/splits/{split_id}/download/{file_index}` | One PDF from the split |
| GET | `/api/splits/{split_id}/download-zip` | Whole split as ZIP |

`split_type` is a Pydantic `Literal["pages","ranges","every_n"]` so OpenAPI exposes the enum and the marketplace smoke test picks a valid value.

## Frontend Components

| Component | Purpose |
|---|---|
| `App.tsx` | Mounts the controller, registers UI capture, renders `MainView` + `ToastContainer` |
| `MainView.tsx` | Top-level layout. Owns viewport detection, sidebar overlay logic, and switches between empty-state upload and document-active view |
| `Sidebar.tsx` | Document list with active highlight, file size + upload time, delete button. Collapsible (280 px ↔ 48 px on desktop; full-screen drawer on mobile) |
| `DropZone.tsx` | Drag-and-drop upload area with click-to-browse fallback. Validates PDF MIME / extension, shows uploading spinner |
| `ThumbnailGrid.tsx` | Responsive grid. Click toggles a page; shift-click extends a range; hovered + selected states show a checkbox + orange overlay |
| `SplitControls.tsx` | Three modes (selected pages, custom ranges, every N pages). Range parser handles `1-5, 8, 11-15` syntax with validation. Sticky bottom panel; switches to a results view after a successful split |
| `SplitHistory.tsx` | Per-document history. Each row shows split type, config summary, timestamp, individual part downloads + ZIP |

## State Management

`frontend/AppController.ts` holds:

- `documents: PDFDocument[]`, `activeDocumentId`, `sidebarCollapsed`
- `uploading`, `loading`, `splitting`, `lastSplitJob`, `error`

It exposes a subscribe/notify pattern. `init()` runs in the constructor and loads documents. Methods: `uploadPdf`, `deletePdf`, `refreshDocuments`, `splitPdf`, `clearLastSplitJob`, `setActiveDocument`, `toggleSidebar`, `clearError`, `getActiveDocument`.

`frontend/services/ApiService.ts` is a singleton wrapper around `fetch` for every backend endpoint and exposes URL helpers (`getThumbnailUrl`, `getDownloadUrl`, `getZipDownloadUrl`) used by `<img>` tags and `window.open(...)`.

## Key Files

| File | Purpose |
|---|---|
| `backend/models.py` | `PDFDocument`, `SplitJob` (plus template `AppState`, `UISnapshot`, `UIScreenshot`) |
| `backend/routes.py` | All API endpoints. Uses absolute imports; Pydantic `Literal` for `split_type` |
| `backend/tests/test_pdf_upload.py` | Upload, list, detail, delete, validation |
| `backend/tests/test_thumbnails.py` | Thumbnail rendering, listing, caching, error cases |
| `backend/tests/test_split.py` | Split modes, error cases, individual + ZIP download, history |
| `backend/requirements.txt` | Adds `PyMuPDF>=1.24.0` and `python-multipart>=0.0.6` to the template baseline |
| `frontend/AppController.ts` | State management |
| `frontend/services/ApiService.ts` | Backend API client |
| `frontend/components/*.tsx` | UI pieces above |
| `config/manifest.json` | Pipeline config with `{{PROJECT_ID}}` / `{{PORT}}` / `{{BACKEND_PORT}}` placeholders |
| `setup_local.py` | Substitutes placeholders for local dev (run before `npm run build` + `pytest`); revert with `git checkout .` |

## Testing

- **Unit tests** — `cd backend && python -m pytest tests/ -v`. 32 tests across upload, thumbnails, and split. PyMuPDF generates multi-page test PDFs in-memory.
- **Marketplace smoke test** — `python test_runner.py --internal` then `--external --port <port>` against a running `uvicorn`. Auto-discovers routes from OpenAPI and walks them in POST → GET → PUT → DELETE order. Routes that need a parent ID (`/api/pdfs/{pdf_id}/...`, `/api/splits/{split_id}/...`) are skipped automatically because `POST /api/pdfs/upload` is multipart and produces no JSON `id` for the auto-generator to capture; the surviving endpoints (state, action, list, no-arg upload) all return 2xx.

## Notes / Decisions

- All PDF processing (page count, thumbnails, splitting) is done backend-side with PyMuPDF; the frontend never parses PDFs.
- Thumbnails are rendered lazily on the first request to `/api/pdfs/{id}/thumbnails/{page}` and cached on disk under `backend/uploads/thumbs_{id}/`.
- Split outputs are written to `backend/splits/<uuid>/`. Deleting the parent PDF removes the directory.
- The sidebar uses an overlay/drawer pattern under 768 px to keep tap targets large and avoid horizontal overflow.
