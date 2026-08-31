# Resume Maker

> Per-project plan / context / index. The building agent keeps this current (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

Interactive split-view resume maker with 34 live template previews, custom fonts and colors, certifications, publications section, portfolio links, section management, multi-resume dashboard, score analysis, and PDF/Print export.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] 34 responsive resume templates with live theme styling
- [x] Real-time editor with forms for Personal Info, Experience, Education, Skills, Projects, Certifications, Publications, My Time, Philosophy, Most Proud Of
- [x] Smart bullet formatting on Enter key for Experience and Projects
- [x] Clickable project links and certification URLs across all templates
- [x] Multi-resume management (create, duplicate, delete, switch, random candidate generator)
- [x] ATS score calculation and optimization suggestions
- [x] PocketBase persistence with schema migrations and seed data
- [x] PDF export and print formatting

## Entities

| Collection   | Purpose                                      | Notes                               |
|--------------|----------------------------------------------|-------------------------------------|
| resume_state | State storage for active resumes and presets | Managed via PocketBase pb_migrations |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `health` (GET /api/health)
- `ops.list` (GET /api/_ops)
- `resumes.list` (CRUD list resume_state)
- `resumes.get` (CRUD get resume_state)
- `resumes.create` (CRUD create resume_state)
- `resumes.duplicate` (POST /api/ops/resumes/duplicate)

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| (none) | | | |

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`, `operations.json`, `reference/requirements.md`, this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
