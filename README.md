# Living UI Marketplace

Pre-built Living UI applications for CraftBot. Browse and install instantly from the CraftBot browser interface.

## Available Apps

| App | Description | Tags |
|-----|-------------|------|
| **Research Board** | Organize research with notes, images, videos, YouTube links, and documents on a visual board. Features categories, search, and detail views. | research, media, productivity |

## How to Use

1. Open CraftBot browser interface
2. Click "Add Living UI" in the sidebar
3. Browse the Marketplace tab
4. Click "Add" on any app
5. Wait for download and installation
6. App appears in your sidebar, ready to use

## Contributing

To add a new app to the marketplace:

1. Create a folder at the repo root with your app name (e.g. `my-app/`)
2. Build a complete Living UI app (backend + frontend) with a `LIVING_UI.md` spec
3. Use `{{PORT}}`, `{{BACKEND_PORT}}`, `{{PROJECT_ID}}`, `{{PROJECT_NAME}}` placeholders in config
4. Add your app entry to `catalogue.json` at the repo root
5. Submit a pull request
