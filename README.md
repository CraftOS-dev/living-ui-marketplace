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

## Creating a new app with an AI agent

You can build a new Living UI directly with an AI coding agent, without running CraftBot's agent runtime. Two artifacts in this repo make that work:

- **`_template/`** — empty Living UI scaffold. Copy it (don't edit it) when starting a new app.
- **`LIVING_UI_GUIDE.md`** — full workflow for the agent to follow. It's a port of [skills/living-ui-creator/SKILL.md](../CraftBot/skills/living-ui-creator/SKILL.md) adapted for the no-runtime setting (no `send_message`, no `living_ui_notify_ready`; verifies via `setup_local.py` + `pytest` + `npm run build` instead).
- **`NEW_APP_PROMPT.md`** — fill-in prompt template you can paste into a new agent session to kick off a build.

Quick start: open `NEW_APP_PROMPT.md`, fill in your requirement, paste the whole thing into a fresh agent session running in this repo, and the agent will copy `_template/`, run the Phase 0 questionnaire, build features test-first, and add a `catalogue.json` entry.

**Sibling-layout requirement:** `LIVING_UI_GUIDE.md` references the CraftBot repo's standards via `../CraftBot/...` paths, so this repo and the CraftBot repo must live as siblings under the same parent folder for those links to resolve.
