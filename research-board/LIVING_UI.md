# Research Board - Living UI

## Project Overview
A free-form canvas whiteboard app for game design research and planning.
Users can attach images, videos, YouTube links, docs, and notes to a whiteboard.

## Requirements

### Data & Content
- **Organization:** Single board (no multiple boards)
- **Item Types:**
  - Image (file upload or URL)
  - Video (file upload or URL)
  - YouTube link (URL with embedded preview)
  - Document (file upload or URL)
  - Note (simple text: title + body)
- **Item Metadata:** Title only (required)
- **File Handling:** Both file upload from computer AND paste URL

### Design & Layout
- **Board View:** Free-form canvas (whiteboard) - items can be dragged and positioned anywhere
- **Card Appearance:** Title + preview/thumbnail
- **Adding Items:** Sidebar with buttons for each item type
- **Item Detail:** Modal/popup overlay when clicking an item
- **Theme:** System (dark/light)

### Global Design Rules Applied
- Primary: #6366f1, Secondary: #8b5cf6, Accent: #06b6d4
- Rounded borders (var(--radius-md)), comfortable spacing
- Drag-and-drop for repositioning items on canvas
- Search/filter bar
- Item count badges
- Empty state with helpful messages
- Toast notifications for CRUD feedback
- Confirmation dialogs for delete
- Loading spinners for async operations
- Mobile responsive

## Features

### Feature 1: Canvas & Items [DONE]
**Description:** The main whiteboard canvas with draggable item cards. CRUD operations for all item types.
- Backend: BoardItem model (id, type, title, x, y, content, url, file_path, created_at, updated_at)
- Routes: GET/POST /api/items, GET/PUT/DELETE /api/items/{id}
- Frontend: MainView (sidebar + canvas), ItemCard (draggable), AddItemModal, ItemDetailModal
- Status: [x] DONE

### Feature 2: Media Attachments [DONE]
**Description:** File upload and URL handling for images, videos, YouTube links, and documents.
- Backend: POST /api/upload (file upload), GET /api/files/{filename} (serve files)
- Frontend: AddItemModal handles file upload + URL input, ItemCard shows previews
- Status: [x] DONE

### Feature 3: Notes [DONE]
**Description:** Simple text notes with title and body text.
- Backend: content field in BoardItem model
- Frontend: AddItemModal (note form), ItemDetailModal (note view/edit), ItemCard (note preview)
- Status: [x] DONE

### Feature 4: Search & Filter [DONE]
**Description:** Search bar to find items by title, filter by item type.
- Backend: GET /api/items?search=&type= (query params)
- Frontend: Search input + type filter buttons in canvas toolbar
- Status: [x] DONE

## Implementation Details

### Backend Models
- **BoardItem** (`backend/models.py`)
  - id: Integer (PK)
  - type: String (image/video/youtube/doc/note)
  - title: String
  - x: Float (canvas X position)
  - y: Float (canvas Y position)
  - content: Text (for notes)
  - url: Text (for URL-based items)
  - file_path: Text (for uploaded files)
  - created_at: DateTime
  - updated_at: DateTime

### Backend Routes (`backend/routes.py`)
- GET /api/items?search=&type= - List all items with optional search/filter
- POST /api/items - Create new item
- GET /api/items/{id} - Get item by ID
- PUT /api/items/{id} - Update item (including position)
- DELETE /api/items/{id} - Delete item
- POST /api/upload - Upload file
- GET /api/files/{filename} - Serve uploaded file

### Frontend Components
- **types.ts** - BoardItem, CreateBoardItemRequest, UpdateBoardItemRequest interfaces
- **AppController.ts** - Board items CRUD, file upload, backend communication
- **components/MainView.tsx** - Main layout: sidebar + canvas + search toolbar
- **components/ItemCard.tsx** - Draggable item card with type-specific preview
- **components/AddItemModal.tsx** - Modal for adding new items (type selection + form)
- **components/ItemDetailModal.tsx** - Modal for viewing/editing/deleting items
- **agent/hooks.ts** - useAgentAware hook for agent observation

### Test Infrastructure
- **backend/conftest.py** - Root conftest that patches SQLAlchemy to use StaticPool for in-memory SQLite (fixes threading issue with TestClient)
- **backend/tests/test_canvas_items.py** - 20 tests covering full CRUD for BoardItem

## Completion Checklist
- [x] Feature 1: Canvas & Items
- [x] Feature 2: Media Attachments
- [x] Feature 3: Notes
- [x] Feature 4: Search & Filter
