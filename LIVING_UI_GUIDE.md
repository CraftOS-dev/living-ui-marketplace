# Living UI Creation Guide

This guide describes how to create a new Living UI app **directly in this repo** when a user gives a requirement, without relying on CraftBot's runtime. It is the workflow an AI coding agent should follow end-to-end.

## What this repo is

- `catalogue.json` — registry of every installable app. Each entry has `id`, `name`, `description`, `folder`, `tags`, `version`.
- Per-app folders (e.g. `research-board/`, `crm_system/`, `kanban-board/`) — the actual app source. CraftBot zip-pulls from these on install.
- `_template/` — empty Living UI scaffold. **Copy this** when starting a new app. Never edit `_template/` itself.
- `LIVING_UI_GUIDE.md` (this file) — the workflow you follow when the user asks for a new Living UI.

Every app in this repo follows the same structure (backend FastAPI + SQLite, frontend React + TypeScript + Vite, agent HTTP endpoints). Local-dev users run `setup_local.py` to substitute `{{PORT}}` / `{{BACKEND_PORT}}` / `{{PROJECT_ID}}` placeholders.

## Sibling-layout assumption

This file links into the CraftBot repo at `../CraftBot/...`. That works only if both repos sit as siblings under `CraftBot_/`:

```
CraftBot_/
├── CraftBot/                     # the main CraftBot repo
└── living-ui-marketplace/        # this repo
    ├── _template/
    ├── LIVING_UI_GUIDE.md        # ← you are here
    └── ...
```

If a `../CraftBot/...` link 404s, that's the first thing to check.

## The standard you must follow

Your ground truth is the original [SKILL.md](../CraftBot/skills/living-ui-creator/SKILL.md). This document is a **port** of SKILL.md to the no-runtime context. The principle: start from SKILL.md verbatim and only adapt what genuinely depends on CraftBot's runtime. Every other rule, code pattern, and forbidden action is preserved.

Differences from SKILL.md, summarized:

| Topic | What changes here |
|---|---|
| Phase 0 transport | Use direct conversation with the user (or a structured question tool such as `AskUserQuestion`) instead of `send_message(wait_for_user_reply=True)`. Two-batch minimum and vague-answer expansion **are preserved**. |
| Phase 8 — "don't run npm/uvicorn" | **Inverted.** Run `npm install`, `npm run build`, `pytest`, and optional `uvicorn` + `npm run preview` for local verification. Always `git checkout .` afterward to keep placeholders intact for commit. |
| Phase 10 — `living_ui_notify_ready` | **Replaced** by Marketplace Publish: confirm placeholders intact, ensure `setup_local.py` is in the new app folder, add a `catalogue.json` entry, verify locally, revert, clean caches. |
| Project ID / port assignment | No CraftBot allocation. Manifest keeps `{{PROJECT_ID}}` / `{{PORT}}` / `{{BACKEND_PORT}}` placeholders. `setup_local.py` substitutes for local dev; CraftBot fills them on install. |
| Reference paths | `references/X.md` → `../CraftBot/skills/living-ui-creator/references/X.md`. Same for `agent_file_system/GLOBAL_LIVING_UI.md` → `../CraftBot/agent_file_system/GLOBAL_LIVING_UI.md`. |

Anything not listed above is unchanged from SKILL.md.

## Architecture Overview

Living UI uses a **backend-first, stateless frontend** pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│   BACKEND (FastAPI + SQLite)                                    │
│   - THE source of truth for ALL application state               │
│   - Persists data to SQLite                                     │
│   - Exposes REST API at http://localhost:<backend_port>         │
│   - State survives page reloads and tab switches                │
├─────────────────────────────────────────────────────────────────┤
│   FRONTEND (React + TypeScript)                                 │
│   - Stateless view layer — fetches state FROM backend           │
│   - Sends user actions TO backend                               │
│   - Uses localStorage as cache only (fallback)                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle:** Frontend is a dumb view. Backend owns all state.

## Architecture Decision

Before coding, determine what your app needs:

| Need | Solution |
|---|---|
| Persist user data | SQLAlchemy models (SQLite) |
| Fetch external data | Backend proxy endpoint |
| Agent provides data | `PUT /api/state` to push data |
| Agent reads app data | `GET /api/state` endpoint |
| Agent observes UI | `GET /api/ui-snapshot` (auto-captured) |
| Agent sees visually | `GET /api/ui-screenshot` |
| Agent triggers actions | `POST /api/action` |
| Complex UI state | Multiple frontend components |
| Multiple users with own data | Auth module from `../CraftBot/app/data/living_ui_modules/auth/` |
| User roles (admin/member) | Auth module + role checks in routes |

**Default:** Most apps need all layers (DB + backend + frontend). Agent APIs are built into `_template/` — no extra work needed.

**Reference (read this when picking layers):** [MVC-A.md](../CraftBot/skills/living-ui-creator/references/MVC-A.md).

## Multi-User / Auth Support

If the app needs multiple users, login, teams, or shared data:

1. Read [auth/README.md](../CraftBot/app/data/living_ui_modules/auth/README.md) for the full integration guide.
2. Copy the module files into your project and wire them up as documented.

**When to add auth:** user mentioned "multiple users", "team", "sharing", "login", or the app manages per-user data (task tracker, CRM, project manager). If unsure, ask during Phase 0.

## Directory Structure (when you copy `_template/` to a new app)

```
<app-name>/
├── backend/                    # FastAPI + SQLite
│   ├── main.py                 # Entry — DO NOT EDIT
│   ├── database.py             # DB connection — DO NOT EDIT
│   ├── models.py               # SQLAlchemy models — EDIT for data
│   ├── routes.py               # API endpoints — EDIT for actions
│   ├── services/integration_client.py  # CraftBot integration bridge
│   ├── tests/
│   │   ├── conftest.py         # Pytest fixtures (DO NOT EDIT)
│   │   └── test_<feature>.py   # Your feature tests
│   ├── test_runner.py          # Used by CraftBot launch pipeline
│   └── requirements.txt
│
├── frontend/
│   ├── main.tsx                # React entry — DO NOT EDIT
│   ├── App.tsx                 # Root with ToastContainer
│   ├── AppController.ts        # State management — EDIT
│   ├── types.ts                # TS interfaces — EDIT
│   ├── agent/hooks.ts          # `useAgentAware` — DO NOT EDIT
│   ├── components/
│   │   ├── ui/index.tsx        # Preset UI — DO NOT EDIT
│   │   └── MainView.tsx        # Main view — EDIT
│   ├── services/               # ApiService, UICapture, etc. — DO NOT EDIT
│   ├── styles/global.css       # Design tokens
│   └── vite-env.d.ts
│
├── config/manifest.json        # Pipeline config + placeholders
├── index.html
├── package.json
├── tsconfig.json / tsconfig.node.json
├── vite.config.ts
├── setup_local.py              # Placeholder substitution for local dev
├── .env.example
└── LIVING_UI.md                # Documentation — FILL IN Phase 9
```

## UI Components (MANDATORY)

Use preset components for ALL standard UI elements — `Button`, `Card`, `Input`, `Modal`, `Alert`, `Table`, etc. Never create custom buttons, inputs, cards, or write custom CSS for standard elements.

```typescript
import { Button, Card, Input, Alert, Table, Modal } from './components/ui'
```

**Reference (read before frontend work):** [COMPONENTS.md](../CraftBot/skills/living-ui-creator/references/COMPONENTS.md) — full props, icons (`lucide-react`), toasts (`react-toastify`).

## Agent API (built into `_template/`)

Living UI exposes standard HTTP endpoints for agent observation:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ui-snapshot` | GET | UI state (DOM, text, form values) |
| `/api/ui-screenshot` | GET | Visual screenshot (PNG base64) |
| `/api/state` | GET / PUT | Application data |
| `/api/action` | POST | Trigger actions |

Frontend auto-captures UI state on meaningful events (page load, state changes, user interactions). See [MVC-A.md](../CraftBot/skills/living-ui-creator/references/MVC-A.md).

## Development Workflow

Follow these phases in order. **Use TodoWrite to track progress.**

### Before You Start: Read and Apply Global Config

**Reference (read this first):** [GLOBAL_LIVING_UI.md](../CraftBot/agent_file_system/GLOBAL_LIVING_UI.md) — global design preferences and rules.

You MUST apply these settings in your code:

- **Primary / Secondary / Accent Colors** — use the hex values in CSS and component styles. Set them as CSS custom properties in `frontend/styles/global.css` or use them directly. e.g., if Primary is `#FF4F18`, use it for primary buttons, active states, links, and accent elements.
- **Font Family** — apply as `font-family` in `global.css` body styles.
- **Enabled rules `[x]`** — hard requirements; your code must implement them.
- **Disabled rules `[ ]`** — skip these features.
- **Always-Enforced rules** — non-negotiable; always follow them.
- Per-project requirements from Phase 0 override global settings when they conflict.

### Phase 0 — Requirement Gathering (MANDATORY, minimum 2 batches)

**Reference (read this first):** [QUESTIONNAIRE.md](../CraftBot/skills/living-ui-creator/references/QUESTIONNAIRE.md) — question categories, examples, and vague-answer expansions.

In CraftBot, this phase uses `send_message(..., wait_for_user_reply=True)`. **Here you ask the user directly in the active conversation.** Use a structured question tool (e.g. `AskUserQuestion`) for choice-style prompts; use plain conversation for open-ended ones.

**CRITICAL RULES (preserved from SKILL.md):**

- Ask **at least 2 batches** of questions. Never skip to coding after just 1 batch.
- **Batch 1 MUST cover data/features.** **Batch 2 MUST cover design/visual preferences.**
- If the user gives short or vague answers, do not skip Batch 2 — offer specific choices instead (e.g., "Card grid like Pinterest, or columns like Trello?").
- The user can opt out only by explicitly saying "just build it" or "skip the questions". A short answer to one question is **not** "skip".
- **Expand vague answers** — when the user gives a brief reply ("basic user stuff", "normal layout", "simple dashboard"), expand it into concrete features using QUESTIONNAIRE.md mappings, then confirm with the user before proceeding.

**Process:**

1. Analyze the project description — identify what's clear and what's ambiguous.
2. **Batch 1: Data & Features (REQUIRED)** — 2–4 questions:
   - Open with a warm acknowledgement of the project idea.
   - Focus on: what entities/items exist, how they relate, what operations are needed.
3. **Batch 2: Design & Layout (REQUIRED)** — always ask, even if Batch 1 was short:
   - Acknowledge Batch 1 answers briefly.
   - Focus on: layout style (grid/kanban/list/freeform), visual style, color preferences, detail-view-vs-modal.
   - Offer concrete choices, not open-ended questions.
4. **Batch 3 (optional)** — only if significant gaps remain after Batch 2.
5. **Expand vague answers** — review the user's responses; rewrite vague ones into concrete features and **confirm with the user**.
6. **Fill gaps with explicit assumptions** — state them to the user so they can correct.
7. **Document in `LIVING_UI.md` (MANDATORY)** — fill in **all** subsections (Entities & Data Model, Layout & Design, Features, Assumptions). Replace **every** HTML comment and example. **Do not advance to Phase 1 until LIVING_UI.md has real content.**

**When to stop asking:** after Batch 2 unless major gaps remain (then Batch 3). Never more than 3 batches. If the user says "just build it" — stop, document assumptions, proceed.

**Tone:** warm and conversational. Offer concrete choices, not just open-ended questions. Acknowledge answers before asking more.

**Example Batch 1 (Data & Features):**

> "Love the idea! Before I start building, a few quick questions about what goes on the board:
> 1. What kinds of items will you add? (notes, images, videos, links, docs — all of these?)
> 2. What info should each item have? (just the content, or also title, description, tags, status?)
> 3. Do you need to organize items into categories or groups?"

**Example Batch 2 (Design & Layout):**

> "Thanks! Now a couple of questions about how it should look:
> 1. Layout — card grid (like Pinterest), columns (like Trello), or a list view?
> 2. When you click an item, should it open in a side panel, a full modal, or expand in place?
> 3. Any color/visual preference? (dark theme, light, colorful, minimal — or I'll use a clean modern default)"

### Phase 1 — Plan Features

Read the Phase 0 requirements from `LIVING_UI.md` and break the app into **features**. A feature is a complete user-facing capability ("Board Items", "Media Attachments", "Search/Filter").

Add features to your TodoWrite list. Order by dependency (core data first, enhancements after).

Example breakdown for a research board:

1. Board Items (CRUD with title/description)
2. Categories/Sections (organize items into groups)
3. Media Attachments (images, videos, links on items)
4. Search & Filter (by text, category, tags)
5. Drag & Drop (reorder items)

If Phase 0 was explicitly skipped (requirements were already complete in the user's prompt), document them in `LIVING_UI.md` now before proceeding.

### Phases 2–7 — Build Features (one at a time)

For each feature, follow A → B → C → D → E. Fully complete one feature before starting the next.

**Reference (when stuck):** [EXAMPLES.md](../CraftBot/skills/living-ui-creator/references/EXAMPLES.md) — complete code examples per phase.

#### Step A — Write tests first

Edit `backend/tests/test_<feature>.py`. Tests describe the expected API **before** routes are written. They will fail initially — that's expected. `conftest.py` provides a test client and a temporary in-memory database.

```python
# tests/test_items.py
def test_create_item(client):
    """Should create a new item."""
    response = client.post("/api/items", json={
        "title": "Test Item",
        "description": "A test item",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Test Item"
    assert "id" in data

def test_get_items(client):
    """Should return all items."""
    client.post("/api/items", json={"title": "Item 1"})
    client.post("/api/items", json={"title": "Item 2"})
    response = client.get("/api/items")
    assert response.status_code == 200
    assert len(response.json()) == 2

def test_delete_item(client):
    """Should delete an item and return 404 on re-fetch."""
    item = client.post("/api/items", json={"title": "To Delete"}).json()
    response = client.delete(f"/api/items/{item['id']}")
    assert response.status_code == 200
    assert client.get(f"/api/items/{item['id']}").status_code == 404
```

What to test: CRUD, business logic (cascading deletes), edge cases (404 on missing), relationships.

The `client` and `db` fixtures come from `conftest.py`. **Delete `tests/test_example.py` after creating your first real test file.**

#### Step B — Backend (model + routes)

**Edit `backend/models.py`** — add the model:

- Never use `metadata` as a column name (reserved by SQLAlchemy).
- Always include a `to_dict()` method for JSON serialization.
- If a model name conflicts with a Python builtin, alias on import: `from models import List as ListModel`.

**Edit `backend/routes.py`** — add routes that satisfy each test assertion:

- Use **absolute imports only** (`from models import ...`, never `from . import`).
- Do **not** add `/api` prefix to route paths in `routes.py` — the router prefix handles that.

#### Step C — Verify backend

```bash
cd backend && python -m pytest tests/ -v --tb=short
```

Fix any failures **before** moving to the frontend.

#### Step D — Frontend for this feature

**Edit `frontend/types.ts`** — TypeScript interfaces matching this feature's models.

**Edit `frontend/AppController.ts`** — methods to call this feature's API endpoints.

For the backend URL, use:

```typescript
const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3101'
```

**Never hardcode a specific port** — the port may change between launches.

**Edit `frontend/components/<Feature>.tsx`** — React components for this feature. Use preset UI components (`Button`, `Card`, `Input`, `Modal`, …); never raw HTML elements. Apply colors from `GLOBAL_LIVING_UI.md`.

**Edit `frontend/components/MainView.tsx`** — wire the new components in.

#### Step E — Move to next feature

Mark this feature done in TodoWrite, start the next. Repeat A–D.

### Phase 8 — Final Review

After all features are built:

- Backend routes use **absolute imports** (`from models import ...`, never `from . import`).
- Backend `routes.py` does **not** add `/api` prefix to route paths.
- Every `to_dict()` returns all fields.
- TypeScript types match backend model output.
- Components import correctly from relative paths.
- All tests pass: `cd backend && python -m pytest tests/ -v`.

**Reference (run before signing off):** [STANDARDS.md](../CraftBot/skills/living-ui-creator/references/STANDARDS.md) — quality bars (data persistence, responsive 320–1200 px, contrast 4.5:1, validation, loading/empty states).

#### `npm` and `uvicorn` — *inverted from SKILL.md*

SKILL.md forbids running `npm run dev/build/preview` and `uvicorn` manually because CraftBot's launch pipeline owns them. **Here, no pipeline owns them, so you do run them for verification.** Constraint: only inside the per-app folder, never against an installed marketplace app, and always `git checkout .` afterward so placeholders survive the commit. (See Phase 10.)

### Phase 9 — Update Documentation (MANDATORY)

Edit `LIVING_UI.md`. Update **every** section with real implementation details:

- **Overview** — what the app does, who it's for.
- **Data Model table** — every SQLAlchemy model with purpose and key fields (replace example rows).
- **API Endpoints table** — every custom route with method, path, description.
- **Frontend Components table** — every component with purpose.
- **Key Files table** — update if you added files.
- Remove **all** HTML comments and placeholder/example data.

Do not advance to Phase 10 if `LIVING_UI.md` still has placeholder content.

### Phase 10 — Marketplace Publish (replaces `living_ui_notify_ready`)

**Reference (run through this checklist):** [VERIFY.md](../CraftBot/skills/living-ui-creator/references/VERIFY.md) — the pre-publish QA list.

Steps:

1. **Confirm placeholders intact.** Run `git diff <app-folder>/config/manifest.json <app-folder>/LIVING_UI.md` etc. If you ran `setup_local.py` for local verification, the placeholders were substituted in place. Run `git checkout <app-folder>/` to revert before commit.
2. **Confirm `setup_local.py` is in the new app folder** (copied from `_template/`). Update the `REPLACEMENTS['{{PROJECT_NAME}}']` and `'{{PROJECT_DESCRIPTION}}'` defaults to match the app.
3. **Add a `catalogue.json` entry:**

   ```json
   {
     "id": "your-app-id",
     "name": "Your App",
     "description": "<one-line description>",
     "folder": "your-app-folder",
     "tags": ["..."],
     "version": "1.0.0"
   }
   ```

4. **Verify locally:**

   ```bash
   cd <app-folder>
   python setup_local.py
   cd backend && python -m pip install -r requirements.txt && python -m pytest tests/ -v
   cd .. && npm install && npm run build
   # optional smoke: python -m uvicorn main:app --port 3200 --app-dir backend
   #                 + npm run preview -- --port 3201
   ```

5. **Revert and clean:**

   ```bash
   git checkout .
   rm -rf node_modules dist backend/__pycache__ backend/.pytest_cache backend/living_ui.db* backend/logs
   ```

6. The app is now ready for commit. CraftBot can install it via the marketplace flow; local devs can run `setup_local.py` themselves.

## Files Summary

| File | Purpose | When to edit |
|---|---|---|
| `backend/models.py` | Database models | Define data entities |
| `backend/routes.py` | API endpoints | Add CRUD operations |
| `backend/tests/test_<feature>.py` | Pytest tests | Test-first per feature |
| `frontend/types.ts` | TypeScript types | Match backend models |
| `frontend/components/` | UI components | Build the interface |
| `frontend/AppController.ts` | State management | Connect UI to backend |
| `frontend/components/MainView.tsx` | Main view | Wire components |
| `LIVING_UI.md` | Documentation | Document your app |
| `config/manifest.json` | Manifest | At scaffold time only — set name, description, theme, createdAt; preserve `{{PORT}}` / `{{BACKEND_PORT}}` / `{{PROJECT_ID}}` placeholders |
| `setup_local.py` | Local dev script | At scaffold time only — update PROJECT_NAME / PROJECT_DESCRIPTION defaults |
| `catalogue.json` (root) | Marketplace registry | Add an entry per new app |

## Quality & Completion

[STANDARDS.md](../CraftBot/skills/living-ui-creator/references/STANDARDS.md) is the quality bar. [VERIFY.md](../CraftBot/skills/living-ui-creator/references/VERIFY.md) is the pre-publish checklist.

## External Integrations

CraftBot has connected services (Google, Discord, Slack, …). Living UIs access them via a built-in bridge — never build OAuth or store credentials yourself. See [INTEGRATIONS.md](../CraftBot/skills/living-ui-creator/references/INTEGRATIONS.md).

## Debugging

Read log files and check [TROUBLESHOOTING.md](../CraftBot/skills/living-ui-creator/references/TROUBLESHOOTING.md).

## FORBIDDEN actions (adapted from SKILL.md)

Items marked **(preserved)** are unchanged from SKILL.md. Items marked **(adapted)** or **(not applicable)** explain why they differ here.

- **Never use `metadata` as a SQLAlchemy column name.** *(preserved)*
- **Never use relative imports in backend code** (`from . import` or `from .models import`). *(preserved)*
- **Never add `/api` prefix to route paths in `routes.py`** — the router prefix handles this. *(preserved)*
- **Never store important state only in React** — use the backend. *(preserved)*
- **Never use raw HTML elements** (`<button>`, `<input>`, `<select>`) — use preset components (`<Button>`, `<Input>`, `<Select>`). *(preserved)*
- **Never write custom CSS for buttons, cards, inputs, modals, or alerts** — use preset component props. *(preserved)*
- **Never pick arbitrary colors** — use design tokens from `global.css` (e.g. `var(--color-primary)`). *(preserved)*
- **Never skip Phase 0 Batch 2** (design questions). Minimum 2 batches. *(preserved)*
- **Never edit `backend/main.py`.** *(preserved)*
- **Never edit `frontend/main.tsx`.** *(preserved)*
- **Never leave `LIVING_UI.md` with placeholder content, HTML comments, or example data.** *(preserved)*
- **`config/manifest.json`** — *(adapted)*: you may edit `name`, `description`, `theme`, and `createdAt` at scaffold time only. Pipeline config and `{{PORT}}` / `{{BACKEND_PORT}}` / `{{PROJECT_ID}}` placeholders must stay untouched.
- **Running `npm run dev/build/preview` or `uvicorn`** — *(inverted)*: these are **allowed and required** for local verification in Phase 10, inside the per-app folder. Always `git checkout .` afterward so placeholders survive commit.
- **`send_message(wait_for_user_reply=True)`** — *(not applicable)*: doesn't exist in this context. During Phase 0, ask the user directly in conversation or use a structured question tool. Do not re-prompt the user during Phases 1–10 unless genuinely blocked.
- **`living_ui_notify_ready(...)`** — *(not applicable)*: doesn't exist here. Replaced by Phase 10 Marketplace Publish.
- **Task session ID as `project_id`** — *(not applicable)*: there is no task session ID here; `{{PROJECT_ID}}` stays a placeholder.

### Marketplace-only additions

- **Never edit `_template/`.** It is the base. Copy first; mutate the copy.
- **Never commit filled-in placeholders or generated artifacts** (`node_modules/`, `dist/`, `__pycache__/`, `living_ui.db*`, `logs/`, `.last_launch`). After local verification, always `git checkout .` to restore placeholders.
- **Always add a `catalogue.json` entry** for the new app — the marketplace equivalent of "register with CraftBot".
- **Always preserve `setup_local.py`** in the new app folder.

## Phase-specific reference reading (don't skip)

| When | Read this |
|---|---|
| Before Phase 0 | [GLOBAL_LIVING_UI.md](../CraftBot/agent_file_system/GLOBAL_LIVING_UI.md) |
| Phase 0 | [QUESTIONNAIRE.md](../CraftBot/skills/living-ui-creator/references/QUESTIONNAIRE.md) |
| Picking layers (any phase) | [MVC-A.md](../CraftBot/skills/living-ui-creator/references/MVC-A.md) |
| Phases 2–7 Step D (frontend) | [COMPONENTS.md](../CraftBot/skills/living-ui-creator/references/COMPONENTS.md) |
| Phases 2–7 (when stuck) | [EXAMPLES.md](../CraftBot/skills/living-ui-creator/references/EXAMPLES.md) |
| Multi-user / auth | [auth/README.md](../CraftBot/app/data/living_ui_modules/auth/README.md) |
| External services | [INTEGRATIONS.md](../CraftBot/skills/living-ui-creator/references/INTEGRATIONS.md) |
| Phase 8 final review | [STANDARDS.md](../CraftBot/skills/living-ui-creator/references/STANDARDS.md) |
| Phase 10 publish | [VERIFY.md](../CraftBot/skills/living-ui-creator/references/VERIFY.md) |
| Anything failing | [TROUBLESHOOTING.md](../CraftBot/skills/living-ui-creator/references/TROUBLESHOOTING.md) |
| Whole-workflow ground truth | [SKILL.md](../CraftBot/skills/living-ui-creator/SKILL.md) |

## References (index)

- [SKILL.md](../CraftBot/skills/living-ui-creator/SKILL.md) — original workflow this file ports
- [COMPONENTS.md](../CraftBot/skills/living-ui-creator/references/COMPONENTS.md) — preset components, icons, toasts
- [STANDARDS.md](../CraftBot/skills/living-ui-creator/references/STANDARDS.md) — quality bars
- [MVC-A.md](../CraftBot/skills/living-ui-creator/references/MVC-A.md) — architecture layers
- [QUESTIONNAIRE.md](../CraftBot/skills/living-ui-creator/references/QUESTIONNAIRE.md) — Phase 0 questions, vague-answer expansions
- [VERIFY.md](../CraftBot/skills/living-ui-creator/references/VERIFY.md) — pre-publish checklist
- [EXAMPLES.md](../CraftBot/skills/living-ui-creator/references/EXAMPLES.md) — code examples per phase
- [INTEGRATIONS.md](../CraftBot/skills/living-ui-creator/references/INTEGRATIONS.md) — integration bridge
- [TROUBLESHOOTING.md](../CraftBot/skills/living-ui-creator/references/TROUBLESHOOTING.md) — debug guide
- [GLOBAL_LIVING_UI.md](../CraftBot/agent_file_system/GLOBAL_LIVING_UI.md) — global design rules
- [auth/README.md](../CraftBot/app/data/living_ui_modules/auth/README.md) — auth module
