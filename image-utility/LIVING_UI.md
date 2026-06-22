# Image Utility

Upload an image, crop it interactively, resize, compress, or convert to PNG/JPEG/WEBP, then download the edited file. All processing runs offline on the backend with Pillow.

## Overview

Image Utility is a single-user Living UI for quick image edits — especially useful when an agent generates an image and you need a fast crop, resize, or format change without leaving CraftBot. Upload once, drag the crop box on a live preview, pick export settings, apply a single combined transform, and download the result.

The visual style follows the standard CraftBot Living UI tokens: dark/light system theme, `#FF4F18` primary accent on crop handles and primary actions, Inter/system sans typography, and preset components from `frontend/components/ui`.

## Requirements

### Entities & Data Model

- **ImageAsset** — one uploaded image. Fields:
  - `filename`, `file_path`, `file_size`, `format`, `width`, `height`, `uploaded_at`
  - `last_output` (JSON, nullable) — latest processed file metadata: `{path, filename, size, format, width, height}`
- No separate edit-history table; only the most recent output is kept per image.

### Layout & Design

- **Layout style**: Two-pane editor.
  - Left: compact image list (filename, dimensions, file size) with select + delete.
  - Main: top bar (title, upload), canvas preview with interactive crop rectangle, right/below edit panel.
  - Empty state: centered drop zone when no images exist.
- **Visual style**: System theme via `frontend/styles/global.css`. Primary `#FF4F18` on crop border/handles and Apply button. `lucide-react` icons in the top bar and asset list.
- **Responsive**: Breakpoint at 768 px. Sidebar becomes an overlay drawer with backdrop on mobile; canvas and edit panel stack vertically.

### Features

1. **Image upload** — drag-drop or click-to-browse; validates image MIME/extension; stores original on disk + DB row.
2. **Interactive crop** — drag to move, eight handles to resize; coordinates sent in original pixel space.
3. **Resize** — width/height inputs with aspect-ratio lock toggle.
4. **Format convert** — PNG (lossless), JPEG, or WEBP.
5. **File size preset** (JPEG/WEBP) — Smallest file / Balanced / Best detail (maps to backend quality 55 / 80 / 95).
6. **Combined transform** — one Apply runs crop → resize → encode in a single backend pass.
7. **Download** — fetch latest processed output via `/api/images/{id}/download`.
8. **Persistence** — uploaded images and last output survive reload; delete removes DB row and on-disk files.
9. **Agent observability** — template state, ui-snapshot, ui-screenshot, and action endpoints work out of the box.

### Assumptions

- Single-user app; no auth module.
- No batch processing or edit history — only the latest output per image.
- PNG exports use lossless optimization; no compression preset shown for PNG.
- Supported uploads: PNG, JPEG, WEBP, GIF, BMP, TIFF.
- All image decoding/encoding is backend-side (Pillow); frontend only handles crop UI.

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| AppState | Generic JSON state (template) | id, data |
| UISnapshot, UIScreenshot | Agent observation (template) | DOM/text/screenshot blobs |
| ImageAsset | Uploaded image + latest output | filename, file_path, file_size, format, width, height, last_output, uploaded_at |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/images/upload | Upload image (multipart `file`). Validates with Pillow. |
| GET | /api/images | List images (newest first) |
| GET | /api/images/{id} | Image metadata |
| DELETE | /api/images/{id} | Delete image, uploads, and outputs |
| GET | /api/images/{id}/preview | Original image bytes for canvas preview |
| POST | /api/images/{id}/transform | Combined crop → resize → encode |
| GET | /api/images/{id}/download | Download latest processed output |

Transform body example:

```json
{
  "crop": {"x": 0, "y": 0, "width": 100, "height": 80},
  "resize": {"width": 50, "height": 40, "maintain_aspect": true},
  "format": "JPEG",
  "quality": 80
}
```

`format` is `Literal["PNG","JPEG","WEBP"]`. `crop` and `resize` are optional.

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Layout shell: sidebar, top bar, empty state, editor view |
| AssetList.tsx | Image list with select/delete |
| DropZone.tsx | Drag-drop upload with image validation |
| ImageCanvas.tsx | Scaled preview + interactive crop rectangle |
| EditPanel.tsx | Resize, format, file-size preset, Apply, download result |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | ImageAsset model |
| backend/routes.py | Upload, transform, download endpoints |
| backend/tests/test_image_upload.py | Upload CRUD tests |
| backend/tests/test_transform.py | Transform and download tests |
| backend/requirements.txt | Adds Pillow and python-multipart |
| frontend/types.ts | TypeScript interfaces |
| frontend/AppController.ts | State management + API orchestration |
| frontend/services/ApiService.ts | Backend API client |
| frontend/components/MainView.tsx | Main UI |
| config/manifest.json | Pipeline config with placeholders |
| setup_local.py | Placeholder substitution for local dev |

## State Flow

```
User Action → React Component → AppController.method() → ApiService → /api/images/...
                                       ↓
                              SQLite (ImageAsset) + disk (uploads/outputs)
                                       ↓
                            AppController updates state
                                       ↓
                                   Re-renders UI
```

## State Management

`frontend/AppController.ts` holds:

- `assets: ImageAsset[]`, `activeId`, `loading`, `uploading`, `processing`, `lastResult`, `error`

It exposes subscribe/notify. `init()` runs in the constructor and loads images. Methods: `uploadImage`, `deleteImage`, `refresh`, `setActive`, `transform`, `clearResult`, `clearError`, `getActiveAsset`.

## Testing

1. Upload a PNG — appears in the sidebar with correct dimensions.
2. Drag the crop box smaller — crop summary updates in the edit panel.
3. Set format to JPEG, file size to Balanced, click Apply — toast + result card with smaller file size.
4. Click Download — browser saves the edited JPEG.
5. Reload the page — image list persists; download still works.
6. Delete the image — removed from list and disk.

**Automated tests:**

```bash
cd image-utility
python setup_local.py
pip install -r backend/requirements.txt
cd backend && python -m pytest tests/ -v
cd .. && npm install && npm run build
git checkout image-utility/index.html image-utility/config image-utility/package.json image-utility/vite.config.ts image-utility/backend/main.py image-utility/frontend/services/
```

- **Unit tests** — 17 tests across upload and transform. Pillow generates in-memory PNGs in tests.
- **Marketplace smoke test** — `python test_runner.py --internal` then `--external --port <port>` against a running `uvicorn`.

## Notes / Decisions

- Image processing is backend-only (Pillow). Frontend sends crop coordinates in original pixel space.
- Uploads live in `backend/uploads/`; processed files in `backend/outputs/<image_id>/`.
- File-size presets replace a raw quality slider for clearer UX on JPEG/WEBP exports.
- Sidebar uses overlay/drawer pattern under 768 px for mobile-friendly tap targets.
