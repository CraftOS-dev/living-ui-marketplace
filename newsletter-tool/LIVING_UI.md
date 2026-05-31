# Newsletter Tool

Production newsletter platform with subscribers, drag-and-drop email builder, AI generation, templates, scheduling, analytics, and Gmail sending.

## Overview

A self-contained newsletter platform inspired by Loops and Beehiiv. Manages a subscriber list, lets you write campaign emails with a drag-and-drop block editor (with optional AI assistance), schedule them for a future send time, and deliver them through your CraftBot-connected Gmail account. Tracks opens, clicks, and unsubscribes, with a one-click unsubscribe page for recipients.

Built for non-technical users — every action has a clear button, every screen explains itself, and the AI writer is one click away. No SMTP credentials, no API keys to manage; the CraftBot integration bridge handles authentication.

## Requirements

### Entities & Data Model

- **Subscriber** — `email`, `first_name`, `last_name`, `tags` (multi), `status` (`subscribed` / `unsubscribed` / `bounced`), `unsubscribe_token` (one-click).
- **Template** — reusable email design: `name`, `subject`, `preheader`, `blocks` (JSON), `category`, `is_builtin`, `icon`. Eight built-ins are seeded: Welcome, Weekly newsletter, Product launch, Promotion, Event, Monthly digest, Survey, Re-engagement.
- **Campaign** — outgoing newsletter: `name`, `subject`, `preheader`, `from_name`/`from_email`/`reply_to` overrides, `blocks`, `target_tags` / `target_all`, `status` (`draft` / `scheduled` / `sending` / `sent` / `failed` / `cancelled`), `scheduled_at`, `sent_at`, aggregate counts.
- **CampaignRecipient** — per-recipient delivery record: `email_snapshot`, `status`, `open_token`, `click_token`, timestamps.
- **SenderIdentity** — singleton: `from_name`, `from_email`, `reply_to`, `organization_name`, `organization_address` (CAN-SPAM footer), `tracking_base_url` (public URL for tracking + unsubscribe links).

### Layout & Design

- **Layout:** persistent left sidebar (collapsible on tablet, becomes a bottom-tab bar on mobile) with sections: Dashboard, Campaigns, Subscribers, Templates, Schedule, Settings. The Dashboard is the landing screen with stat cards, recent campaigns, and upcoming sends.
- **Theme:** CraftBot global design tokens. Primary accent `#FF4F18`. Follows system light/dark preference.
- **Detail view:** right-side Drawer for record details (~520px), full-screen sheet on mobile. The campaign editor takes the full content area (not a drawer) because of the drag-and-drop blocks panel.
- **Icons:** `react-icons` Feather set throughout (per requirement).

### Features

- Subscribers CRUD with email + name + tags + status, search, status & tag filtering, CSV import, CSV export, one-click unsubscribe.
- Templates library: 8 built-ins (read-only content, can be cloned), unlimited custom templates, kebab block editor.
- Campaign editor: tabbed (Content / Design / Audience / Review) with a drag-and-drop block list (heading / text / image / button / divider / spacer), per-block inline editing, live HTML preview, auto-save.
- AI generation: CraftBot LLM bridge for real generation (same provider as the rest of CraftBot), tone selector (friendly / professional / playful / concise / warm / persuasive), audience hint, optional CTA. Falls back to a deterministic stub when the LLM is offline so the editor stays useful.
- Schedule: pick a future date/time per campaign; an in-process scheduler thread polls every 20s and dispatches due campaigns.
- Send via Gmail API through the CraftBot integration bridge — no SMTP credentials. Multipart HTML+text MIME with RFC 8058 `List-Unsubscribe` headers.
- Analytics dashboard: total/active/unsubscribed subscribers, 30-day growth, campaigns sent, emails delivered, unique opens & clicks, open/click rates, sends-by-day for the last 7 days.
- Tracking: open pixel + click redirect + public unsubscribe page. Tracking activates when `tracking_base_url` is set in Settings.
- CAN-SPAM compliant footer (organization name + address + unsubscribe link on every email).

### Assumptions

- One user per install — no multi-user auth.
- Sending uses the CraftBot-connected Google Workspace account; if not connected, sends are cleanly marked `failed` with a user-facing message rather than crashing.
- The tracking base URL must be a publicly reachable host to actually record opens and clicks; left blank, emails still send but stats stay at zero.
- CSV import expects email in column 1, optional first/last name in columns 2 & 3. Existing subscribers are updated rather than duplicated.
- Date/time inputs in the editor are in the user's local timezone and converted to UTC ISO when sent to the backend.

## Data Model

### Backend Models ([backend/models.py](backend/models.py))

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `Subscriber` | Recipient with email, name, tags, status. | `email` (unique), `first_name`, `last_name`, `status`, `tags` (JSON), `unsubscribe_token` |
| `Template` | Reusable email design (subject + blocks). | `name`, `subject`, `preheader`, `blocks` (JSON), `category`, `is_builtin`, `icon` |
| `Campaign` | An outgoing newsletter. | `name`, `subject`, `preheader`, `blocks`, `target_tags`, `target_all`, `status`, `scheduled_at`, aggregates |
| `CampaignRecipient` | Per-recipient delivery + tracking. | `campaign_id`, `email_snapshot`, `status`, `open_token`, `click_token`, timestamps |
| `SenderIdentity` | Singleton sender settings. | `from_name`, `from_email`, `reply_to`, `organization_*`, `tracking_base_url` |
| `LLMCache` | Cache for AI generations. | `cache_key`, `content`, `expires_at` |
| `AppState`, `UISnapshot`, `UIScreenshot` | Template-provided generic state + agent observability. | |

## API Endpoints

### Custom Routes ([backend/routes.py](backend/routes.py))

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/subscribers` | List subscribers, optional `status` / `tag` / `search` filters. |
| POST | `/api/subscribers` | Create or upsert a subscriber. |
| GET | `/api/subscribers/{id}` | Get one. |
| PUT | `/api/subscribers/{id}` | Update (idempotent for missing rows). |
| DELETE | `/api/subscribers/{id}` | Delete (idempotent). |
| POST | `/api/subscribers/import` | Bulk import from a CSV string. |
| GET | `/api/subscribers-export` | Download all subscribers as CSV. |
| GET | `/api/tags` | Distinct tags with counts. |
| GET | `/api/templates` | List built-in + custom templates. |
| POST | `/api/templates` | Create a custom template. |
| GET | `/api/templates/{id}` | Get one. |
| PUT | `/api/templates/{id}` | Update (built-in content is read-only). |
| DELETE | `/api/templates/{id}` | Delete (built-ins protected). |
| GET | `/api/campaigns` | List campaigns, optional `status` filter. |
| POST | `/api/campaigns` | Create a draft. Optional `template_id` clones a template's blocks. |
| GET | `/api/campaigns/{id}` | Get with full blocks. |
| PUT | `/api/campaigns/{id}` | Update campaign body / metadata. |
| DELETE | `/api/campaigns/{id}` | Delete (idempotent). |
| POST | `/api/campaigns/{id}/duplicate` | Clone as a new draft. |
| POST | `/api/campaigns/{id}/send` | Send immediately via Gmail. |
| POST | `/api/campaigns/{id}/schedule` | Schedule for a future ISO datetime. |
| POST | `/api/campaigns/{id}/cancel` | Cancel a scheduled or draft campaign. |
| GET | `/api/campaigns/{id}/recipients` | Per-recipient delivery status. |
| GET | `/api/campaigns/{id}/preview` | Fully rendered HTML preview (uses a real subscriber for personalization). |
| POST | `/api/campaigns/generate` | AI-generate `subject` + `preheader` + `blocks`. |
| GET | `/api/sender-identity` | Get sender settings. |
| PUT | `/api/sender-identity` | Update sender settings. |
| GET | `/api/integrations` | Status of CraftBot LLM and Gmail integrations. |
| GET | `/api/analytics/overview` | Dashboard stats (subscribers + campaigns aggregates). |
| GET | `/api/analytics/recent-campaigns` | Last 10 sent/sending campaigns. |
| GET | `/api/dashboard` | Combined overview + recent + upcoming. |
| GET | `/api/track/open/{token}` | 1×1 pixel that records an open. |
| GET | `/api/track/click/{token}?url=…` | 302 redirect that records a click. |
| GET | `/api/unsubscribe/{token}` | Public unsubscribe confirmation page (HTML). |
| POST | `/api/unsubscribe/{token}` | RFC 8058 one-click unsubscribe endpoint. |
| GET / PUT / DELETE | `/api/state` | Template-provided UI state persistence. |
| POST | `/api/action` | Agent-action dispatcher (`send_campaign`, `schedule_campaign`, `refresh`). |
| GET / POST | `/api/ui-snapshot`, `/api/ui-screenshot` | Template-provided agent observability. |

## Frontend Components

### Components ([frontend/components/](frontend/components/))

| Component | Purpose |
|-----------|---------|
| [MainView.tsx](frontend/components/MainView.tsx) | Top-level shell: sidebar + active section + editor. |
| [Sidebar.tsx](frontend/components/Sidebar.tsx) | Desktop sidebar / mobile bottom tab bar. |
| [Drawer.tsx](frontend/components/Drawer.tsx) | Reusable right-side drawer (full-screen sheet on mobile). |
| [sections/Dashboard.tsx](frontend/components/sections/Dashboard.tsx) | Landing: stat cards, recent + upcoming campaigns. |
| [sections/Subscribers.tsx](frontend/components/sections/Subscribers.tsx) | List, search, tag/status filter, edit drawer, add modal, CSV import/export. |
| [sections/Templates.tsx](frontend/components/sections/Templates.tsx) | Built-in + custom template grid. |
| [sections/Campaigns.tsx](frontend/components/sections/Campaigns.tsx) | Campaign list with status filter chips and per-card actions. |
| [sections/Schedule.tsx](frontend/components/sections/Schedule.tsx) | Day-grouped schedule of upcoming sends. |
| [sections/Settings.tsx](frontend/components/sections/Settings.tsx) | Sender identity, footer compliance, tracking URL, integration status. |
| [editor/CampaignEditor.tsx](frontend/components/editor/CampaignEditor.tsx) | Tabbed editor with live preview, AI panel, send/schedule controls, auto-save. |
| [editor/BlockList.tsx](frontend/components/editor/BlockList.tsx) | Drag-and-drop list of email blocks with per-type inline editors. |
| [editor/BlockPalette.tsx](frontend/components/editor/BlockPalette.tsx) | Six block-type buttons (heading / text / button / image / divider / spacer). |
| [editor/AIPanel.tsx](frontend/components/editor/AIPanel.tsx) | Prompt + tone + audience form that calls the LLM. |
| [hooks/useViewport.ts](frontend/hooks/useViewport.ts) | Live viewport size classifier (mobile / tablet / desktop). |
| [hooks/useAppState.ts](frontend/hooks/useAppState.ts) | Subscribes a component to the AppController. |

## Key Files

| File | Purpose |
|------|---------|
| [backend/models.py](backend/models.py) | All SQLAlchemy models. |
| [backend/routes.py](backend/routes.py) | All API endpoints + bootstrap (template seed + scheduler start). |
| [backend/llm_service.py](backend/llm_service.py) | Wraps CraftBot's `LLMInterface` with a 6 s safety timeout + caching helpers. |
| [backend/prompts.py](backend/prompts.py) | AI email-generation system + user prompts + offline stub. |
| [backend/email_renderer.py](backend/email_renderer.py) | Renders blocks to inline-styled HTML + plain-text, substitutes `{firstName}` etc., adds tracking + footer. |
| [backend/email_service.py](backend/email_service.py) | Production Gmail send via CraftBot's `integration_client.request`. RFC 8058 headers. |
| [backend/campaign_send.py](backend/campaign_send.py) | Materializes recipients, sends each, records per-recipient status, rolls up aggregates. |
| [backend/scheduler.py](backend/scheduler.py) | Daemon thread polling for due scheduled campaigns. |
| [backend/seed_data.py](backend/seed_data.py) | Eight built-in templates seeded on first request. |
| [frontend/types.ts](frontend/types.ts) | TypeScript types matching backend response shapes. |
| [frontend/AppController.ts](frontend/AppController.ts) | State + all mutating API actions, with toast feedback. |
| [frontend/services/ApiService.ts](frontend/services/ApiService.ts) | Thin REST wrapper. |

## State Flow

```
User action  ──▶  Section component  ──▶  AppController  ──▶  ApiService  ──▶  FastAPI route
                                                                                    │
                                                                                    ▼
                                                                              SQLite + Gmail
                                                                                    │
                  React rerender  ◀──  controller.notifyListeners  ◀──  refresh* methods
```

The backend is the source of truth. The frontend never mutates state locally without confirming the change with the backend (except the active section, which is cached in `/api/state` for navigation persistence).

## Testing

### Local verification

```bash
cd newsletter-tool
python setup_local.py
# backend
cd backend
python -m pip install -r requirements.txt
python -m pytest tests/ -v          # 49 tests pass
python test_runner.py --internal    # ALL TESTS PASSED
python test_runner.py --unit        # ALL TESTS PASSED
# frontend
cd ..
npm install
npm run build                       # tsc + vite build
# smoke test (separate shells)
cd backend && python -m uvicorn main:app --port 3200
cd backend && python test_runner.py --external --port 3200  # ALL TESTS PASSED
# cleanup
git checkout .
```

### Manual flows to try in a browser

1. **Subscribers** — add one, edit it in the drawer, import a 5-line CSV, export.
2. **Templates** — open a built-in (e.g. *Weekly newsletter*) and click **Use template**: a draft campaign is created from it.
3. **Campaign editor** — open the AI panel, generate a draft, drag blocks around, watch the live preview update, save automatically.
4. **Schedule** — pick tomorrow morning, confirm the campaign shows up under **Schedule**, then cancel it.
5. **Send** — set a `from_email` in **Settings**, connect Gmail in CraftBot, then **Send now**. Verify the email arrives with the tracking pixel + unsubscribe footer.
6. **Resize** — shrink the window to ~360px to verify the sidebar collapses to a bottom-tab bar and the drawer becomes a full-screen sheet.
