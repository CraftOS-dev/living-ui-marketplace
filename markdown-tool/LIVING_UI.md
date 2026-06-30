# Markdown Editor

Three-panel markdown workspace: file browser, tabbed raw editor, and live GFM preview. Full file CRUD, resizable collapsible panels, and VSCode-style tabs.

## Overview

A desktop-style markdown editing environment running in the browser. Users can browse a workspace directory, open `.md` files in VSCode-style tabs, edit them in a plain textarea, and see a live GitHub Flavored Markdown (GFM) preview side-by-side. All three panels are independently resizable by dragging dividers and collapsible via toolbar toggle buttons. UI layout state (open tabs, panel widths, panel visibility) persists across page reloads via a backend session.

## Requirements

### Entities & Data Model

- **Workspace files**: `.md` files and directories stored on the filesystem under `WORKSPACE_ROOT`
- **EditorSession**: Persisted UI state — open tabs, active tab, panel widths, panel visibility, expanded directories

### Layout & Design

- Three-panel layout: Explorer (left) | Tabbed Editor (center) | Preview (right)
- VSCode-inspired dark theme, system light/dark respecting `[data-theme]`
- Primary color `#FF4F18`, secondary `#262626`
- Monospace font in editor; rendered markdown in preview

### Features

- Full file CRUD: create, rename, delete files and folders
- Clicking a `.md` file opens it in both editor and preview simultaneously
- Multiple files open as VSCode-style tabs (click to switch, × to close, ● unsaved indicator)
- All three panels resizable via drag dividers
- Folder and preview panels collapsible via toolbar toggle buttons
- Plain textarea editor — no formatting toolbar
- Ctrl+S saves; Tab inserts 2 spaces
- Session restore on page reload

### Assumptions

- Non-markdown files (images, etc.) are shown in the file tree but are not openable
- New files without `.md` extension have `.md` auto-appended
- Delete is permanent with a confirmation modal (no trash/undo)
- Workspace root defaults to `<app>/workspace/` unless `WORKSPACE_ROOT` env var is set

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| AppState | Standard Living UI app state | initialized, loading, error |
| UISnapshot | Screenshot capture for testing | id, timestamp, url, title |
| UIScreenshot | Binary screenshot storage | id, snapshot_id, image_data |
| EditorSession | Persisted editor UI state | open_tabs (JSON), active_tab, folder_panel_width, preview_panel_width, folder_visible, preview_visible, expanded_dirs (JSON), updated_at |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/files | List directory contents (`?path=` relative to workspace root) |
| GET | /api/files/read | Read file content (`?path=`) |
| PUT | /api/files/write | Write file content (`{path, content}`) |
| POST | /api/files/create | Create file or directory (`{path, type: "file"\|"directory"}`) |
| PUT | /api/files/rename | Rename/move item (`{old_path, new_path}`) |
| DELETE | /api/files/delete | Delete file or directory (`?path=`) — idempotent |
| GET | /api/session | Get persisted editor session |
| PUT | /api/session | Partial update editor session |

All file paths are relative to `WORKSPACE_ROOT`. Path traversal outside workspace returns HTTP 400.

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Orchestrates all panels; session restore on mount; panel resize and collapse state |
| FolderPanel.tsx | File tree with lazy directory loading; CRUD actions (create, rename, delete with confirmation modals) |
| TabBar.tsx | VSCode-style tab strip with unsaved indicator (●) and close (×) buttons |
| EditorPanel.tsx | Plain `<textarea>` editor; Ctrl+S to save; Tab inserts 2 spaces |
| PreviewPanel.tsx | Live GFM preview using `marked.parse()` + `dangerouslySetInnerHTML`; styled markdown |
| PanelDivider.tsx | Draggable resize handle between panels (incremental delta via `mousemove` on `document`) |
| ui/index.tsx | Shared UI kit: Button, Input, Modal, Card, Badge, Alert, Table, etc. |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | SQLAlchemy models including EditorSession |
| backend/routes.py | Workspace file API + session API |
| backend/tests/test_workspace.py | 20 workspace route tests using tmp_path |
| backend/tests/test_session.py | 8 session CRUD tests |
| frontend/types.ts | TypeScript interfaces: FileItem, OpenTab, EditorSession |
| frontend/AppController.ts | API methods for file ops and session |
| frontend/components/MainView.tsx | Main orchestration component |
| workspace/ | Default workspace directory (configurable via WORKSPACE_ROOT env var) |

## State Flow

```
User clicks file → FolderPanel.onOpenFile(path)
  → MainView.openFile(path) → controller.readFile(path) → GET /api/files/read
  → new OpenTab added → TabBar shows new tab → EditorPanel + PreviewPanel update

User edits text → EditorPanel.onChange → MainView.handleEditorChange
  → tab.content updated (dirty dot appears in TabBar)
  → PreviewPanel re-renders with marked.parse()

User Ctrl+S → MainView.handleSave → controller.writeFile() → PUT /api/files/write
  → tab.savedContent updated (dirty dot clears)

Panel drag → PanelDivider.onDrag(dx) → setFolderWidth/setPreviewWidth
  → useEffect debounces → controller.saveSession({folderPanelWidth, previewPanelWidth})

Page reload → MainView useEffect → controller.getSession()
  → restore widths, visibility, re-read each open tab's content
```

## Testing

```bash
# Backend tests (all 36 pass)
cd backend && python -m pytest tests/ -v

# Build check (zero TypeScript errors)
npm run build

# Local development
python setup_local.py  # substitute placeholders, create workspace/
cd backend && pip install -r requirements.txt
WORKSPACE_ROOT=./workspace uvicorn main:app --port 3200
npm run dev  # starts on port 3201
```

Manual verification checklist:
1. Open http://localhost:3201 — folder panel shows workspace files
2. Click a `.md` file — opens in editor tab and preview simultaneously
3. Edit text — preview updates live, dirty dot appears in tab
4. Ctrl+S — dirty dot clears, toast confirms save
5. Create a new file via toolbar button — appears in folder tree
6. Rename and delete with confirmation modal
7. Open 2+ files — multiple tabs appear; click to switch
8. Drag dividers between panels — panels resize
9. Click toggle buttons in toolbar — fold/unfold panels
10. Reload page — tabs, panel widths, and visibility restore from session
