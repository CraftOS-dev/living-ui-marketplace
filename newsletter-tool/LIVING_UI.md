# Newsletter Tool

Production newsletter platform with subscribers, a Notion-style WYSIWYG email builder, AI generation, fully-editable templates, scheduling, analytics, Gmail sending, and a copy-paste signup form embed.

## Overview

A self-contained newsletter app inspired by Loops and Beehiiv. Manages a subscriber list, lets you compose campaign emails in a WYSIWYG canvas with drag-and-drop blocks and per-block design controls, schedule them for a future send time, and deliver them through your CraftBot-connected Gmail account. Tracks opens, clicks, and unsubscribes via a public tracking URL. Includes a public `POST /api/subscribe` endpoint plus an HTML embed snippet you can drop onto any other website to feed new contacts straight into the list.

Built for non-technical users — no SMTP credentials, no API keys to manage; the CraftBot integration bridge handles all auth. Every screen follows the same panel-based design language so the app reads as one tool, not five.

## Requirements

### Entities & Data Model

- **Subscriber** — `email`, `first_name`, `last_name`, `tags` (multi), `status` (`subscribed` / `unsubscribed` / `bounced`), `source`, `unsubscribe_token` (one-click).
- **Template** — reusable email design: `name`, `subject`, `preheader`, `blocks` (JSON), `design` (JSON — background/card/text/heading/button colors + font family), `category`, `is_builtin`, `icon`, `usage_count`. **Eight built-ins are seeded the first time the templates table is empty**: Welcome, Weekly newsletter, Product launch, Promotion, Event, Monthly digest, Survey, Re-engagement. Built-ins are fully editable and deletable — the `is_builtin` flag is metadata only.
- **Campaign** — outgoing newsletter: `name`, `subject`, `preheader`, `from_name`/`from_email`/`reply_to` overrides, `blocks`, `design`, `target_tags` / `target_all`, `status` (`draft` / `scheduled` / `sending` / `sent` / `failed` / `cancelled`), `scheduled_at`, `sent_at`, plus aggregate counters (`total_recipients`, `sent_count`, `failed_count`, `opens_unique`, `clicks_unique`, `unsubscribes`).
- **CampaignRecipient** — per-recipient delivery record: `email_snapshot`, `name_snapshot`, `status` (`pending` / `sent` / `opened` / `clicked` / `failed`), `open_token`, `click_token`, `sent_at` / `opened_at` / `clicked_at`, `error_message`.
- **SenderIdentity** — singleton: `from_name`, `from_email`, `reply_to`, `organization_name`, `organization_address` (CAN-SPAM footer), `tracking_base_url` (public URL used by tracking + unsubscribe links + signup form embed), `subscribe_key` (secret token for the public subscribe endpoint, auto-generated on first GET, rotatable).
- **LLMCache** — short-lived cache for AI generations keyed by `(mode, tone, prompt, …)`.

### Layout & Design

- **Layout:** persistent left sidebar (collapsible on tablet, becomes a bottom-tab bar on mobile) — sections are **Dashboard, Campaigns, Subscribers, Templates, Schedule, Settings**.
- **Standardized panel chrome.** Every section is built from a shared `Panel` component (1 px border, `--bg-secondary` fill, `--radius-md`, 16 px padding, tiny uppercase label). Panels never nest. The Briefing block on the Dashboard is the only intentionally chrome-less area.
- **Theme:** CraftBot global design tokens. Primary accent `#FF4F18` used sparingly (≤ 3 orange items per page — typically the primary CTA plus one accent like the `TODAY` line on the growth chart). Follows system light/dark.
- **Detail views:** right-side `Drawer` for subscriber edit + Schedule day view; the campaign and template editors take the full content area because of their sidebar + canvas layout.
- **Icons:** `react-icons` Feather set throughout. Templates and campaigns deliberately have **no icons** on their cards.

### Features

**Subscribers** — full CRUD + multi-tag editing + status filter (subscribed/unsubscribed/bounced) + text search + CSV import + CSV export + per-subscriber one-click unsubscribe link.

**Templates** — unified grid (no built-in vs custom sections), sorted by `usage_count` desc then `updated_at`. Click a card → opens the **Template editor** (a WYSIWYG canvas + design sidebar identical to the campaign editor, with auto-save). Built-in templates are fully editable and deletable. A separate **Start campaign** button on each card spawns a campaign that inherits the template's blocks **and** design.

**Campaign editor** — three tabs: Content / Audience / Review.
- **Content** is a two-column WYSIWYG: a left `EditorSidebar` (block palette + global design controls — email background, card, default text/heading/button colors, font family) and a right `CampaignCanvas` (real 600 px white email card with the actual rendered output).
- Blocks support: heading (H1/H2/H3), text (S/M/L), button, image, divider, spacer.
- **Notion-style drag handles** appear on hover at the **left edge** of each block. Dragging shows a faded preview; other blocks displace smoothly; an orange line indicates the drop position. Backed by `@dnd-kit/sortable`.
- **Left-click or right-click** any block to open a context menu with all per-block design controls (alignment, color, size, image URL/upload, button link, etc.). No inline chrome around the block; the active block gets a subtle ring outline via `box-shadow` (no layout shift).
- **Images** can be uploaded (read as base64 data URL inline, 5 MB cap) or sourced from a public URL.
- **AI write** button opens a panel that calls the CraftBot LLM (same provider as the rest of CraftBot) with a tone selector and optional audience hint. Falls back to a deterministic stub when the LLM isn't reachable.
- **Audience** tab has a summary count, two choice cards (Everyone subscribed / By tag), a tag-chip selector with counts, and a sample-recipients preview.
- **Review** tab shows the metadata summary plus the full rendered email iframe (includes the wrapping chrome — organization footer + unsubscribe link).
- **Auto-save** with a 700 ms debounce.

**Scheduling** — pick a future date/time on a campaign. The **Schedule** section shows a compact monthly calendar on the left (with dots for days that have sends) and an agenda list on the right. Click a day → list filters to that day. An in-process scheduler thread polls every 20 s and dispatches due campaigns.

**Sending** — production Gmail send through the CraftBot integration bridge (no SMTP credentials, no API keys stored). Multipart HTML+text MIME with RFC 8058 `List-Unsubscribe` headers and an `org · address` footer. Renders each email per-recipient with `{firstName}` / `{lastName}` / `{email}` / `{unsubscribeUrl}` substitution. If Gmail isn't connected, the campaign is cleanly marked `failed` with a user-facing reason rather than crashing.

**Dashboard** — editorial briefing layout, not a stat-card grid:
1. **Briefing** — time-of-day greeting, current date, a smart one-sentence headline picked from your data (imminent send / above-average open / growth / drafts waiting / Gmail-disconnected / quiet day), and an inline stat strip.
2. **Campaigns** — unified panel with drafts + scheduled in one list, status pills, soonest-first.
3. **Quick Start** + **Recent Sends** — two columns. Quick Start surfaces templates sorted by `usage_count` (back-filled with curated built-ins for first-time users).
4. **Subscriber growth & send activity** — full-width hero SVG timeline: subscriber-growth area chart for the past 30 days, send dots overlaid, scheduled dots to the right of today, single orange `TODAY` vertical line. Resizes responsively via `ResizeObserver`.
5. **Audience** — single sentence + thin stacked horizontal bar (subscribed / unsubscribed / bounced).

**Public signup form** — `POST /api/subscribe` accepts `{ email, first_name?, last_name?, tags?, source?, key? }`, always returns `200` with a `status` field (`subscribed` / `resubscribed` / `already_subscribed` / `error`). Settings shows a **Signup form embed** panel with the endpoint URL, the subscribe key (with Copy + Rotate), a copy-paste HTML+JS snippet, and a `curl` example for server-side integrations. The key auto-generates on first read and prevents random POSTs.

**Tracking** — `tracking_base_url` from Settings is the public host. Tracking pixel + click-redirect + public unsubscribe page (HTML) + RFC 8058 one-click endpoint. With the URL blank, emails still send but stats stay at zero.

**Analytics** — total / active / unsubscribed / bounced subscribers, 30-day growth, total campaigns sent, emails delivered, unique opens, unique clicks, open / click rate, sends-by-day for the past 7 days.

### Assumptions

- One user per install — no multi-user auth.
- Sending uses the CraftBot-connected Google Workspace account; if not connected, sends are cleanly marked `failed` rather than crashing.
- `tracking_base_url` must be a publicly reachable host to record opens / clicks and to power the signup-form embed. Left blank, emails still send but stats stay at zero.
- CSV import expects `email` in column 1, optional `first_name` / `last_name` in columns 2–3. Existing subscribers are upserted, not duplicated.
- Uploaded images are embedded inline as base64 data URLs (5 MB cap). Larger images should use the URL field with a hosted image.
- The seed of built-in templates runs only when the `templates` table is empty — deleting or renaming built-ins won't re-introduce them.

## Data Model

### Backend Models ([backend/models.py](backend/models.py))

| Model | Purpose | Key Fields |
|---|---|---|
| `Subscriber` | Recipient with email, name, tags, status. | `email` (unique), `first_name`, `last_name`, `status`, `tags` (JSON), `source`, `unsubscribe_token` |
| `Template` | Reusable email — fully editable. | `name`, `subject`, `preheader`, `blocks` (JSON), `design` (JSON), `category`, `is_builtin`, `icon`, `usage_count` |
| `Campaign` | An outgoing newsletter. | `name`, `subject`, `preheader`, `blocks`, `design` (JSON), `target_tags`, `target_all`, `status`, `scheduled_at`, `sent_at`, plus aggregates |
| `CampaignRecipient` | Per-recipient delivery + tracking record. | `campaign_id`, `subscriber_id`, `email_snapshot`, `status`, `open_token`, `click_token`, timestamps |
| `SenderIdentity` | Singleton sender settings + signup-form key. | `from_name`, `from_email`, `reply_to`, `organization_*`, `tracking_base_url`, `subscribe_key` |
| `LLMCache` | Short-lived cache for AI generations. | `cache_key`, `content`, `expires_at` |
| `AppState`, `UISnapshot`, `UIScreenshot` | Template-provided state + agent observability. | |

## API Endpoints

### Custom Routes ([backend/routes.py](backend/routes.py))

| Method | Path | Description |
|---|---|---|
| GET | `/api/subscribers` | List subscribers; optional `status` / `tag` / `search` filters. |
| POST | `/api/subscribers` | Create or upsert a subscriber. |
| GET | `/api/subscribers/{id}` | Get one. |
| PUT | `/api/subscribers/{id}` | Update (idempotent for missing rows). |
| DELETE | `/api/subscribers/{id}` | Delete (idempotent). |
| POST | `/api/subscribers/import` | Bulk import from a CSV string. |
| GET | `/api/subscribers-export` | Download all subscribers as CSV. |
| GET | `/api/tags` | Distinct tags with counts. |
| **POST** | **`/api/subscribe`** | **Public sign-up endpoint for embedded forms.** Returns `200` with `status: subscribed / resubscribed / already_subscribed / error`. Optional `key` validated against `SenderIdentity.subscribe_key`. |
| GET | `/api/templates` | List all templates. |
| POST | `/api/templates` | Create a custom template. |
| GET | `/api/templates/{id}` | Get one. |
| PUT | `/api/templates/{id}` | Update — all fields editable for both built-in and custom. |
| DELETE | `/api/templates/{id}` | Delete (idempotent). |
| GET | `/api/campaigns` | List campaigns; optional `status` filter. |
| POST | `/api/campaigns` | Create a draft. Optional `template_id` clones the template's blocks **and** design. |
| GET | `/api/campaigns/{id}` | Get with full blocks + design. |
| PUT | `/api/campaigns/{id}` | Update campaign body / metadata. |
| DELETE | `/api/campaigns/{id}` | Delete (idempotent). |
| POST | `/api/campaigns/{id}/duplicate` | Clone as a new draft. |
| POST | `/api/campaigns/{id}/send` | Send immediately via Gmail. |
| POST | `/api/campaigns/{id}/schedule` | Schedule for a future ISO datetime. |
| POST | `/api/campaigns/{id}/cancel` | Cancel a scheduled or draft campaign. |
| GET | `/api/campaigns/{id}/recipients` | Per-recipient delivery status. |
| GET | `/api/campaigns/{id}/preview` | Fully rendered HTML preview (uses a real subscriber for personalization). |
| POST | `/api/campaigns/generate` | AI-generate `subject` + `preheader` + `blocks`. |
| GET | `/api/sender-identity` | Get sender settings (lazy-generates `subscribe_key` on first read). |
| PUT | `/api/sender-identity` | Update sender settings. |
| **POST** | **`/api/sender-identity/rotate-subscribe-key`** | **Generate a new `subscribe_key` (invalidates old embed snippets).** |
| GET | `/api/integrations` | Status of CraftBot LLM and Gmail integrations. |
| GET | `/api/analytics/overview` | Subscribers + campaigns aggregates. |
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
|---|---|
| [MainView.tsx](frontend/components/MainView.tsx) | Top-level shell: sidebar + active section + campaign/template editor router. |
| [Sidebar.tsx](frontend/components/Sidebar.tsx) | Desktop sidebar / mobile bottom tab bar. |
| [Drawer.tsx](frontend/components/Drawer.tsx) | Reusable right-side drawer (full-screen sheet on mobile). |
| [Panel.tsx](frontend/components/Panel.tsx) | The standardized 1 px-border / `--bg-secondary` fill / uppercase-label panel used everywhere. |
| [sections/Dashboard.tsx](frontend/components/sections/Dashboard.tsx) | Briefing + Campaigns + Quick Start + Recent Sends + Growth chart (SVG, `ResizeObserver`) + Audience bar. |
| [sections/Subscribers.tsx](frontend/components/sections/Subscribers.tsx) | List, search, tag/status filter, edit drawer, add modal, CSV import/export. |
| [sections/Templates.tsx](frontend/components/sections/Templates.tsx) | Unified template grid (no built-in/custom sections); card click → editor; `Start campaign` button on each card. |
| [sections/Campaigns.tsx](frontend/components/sections/Campaigns.tsx) | Fixed-width campaign cards, status filter chips, bottom-pinned actions. |
| [sections/Schedule.tsx](frontend/components/sections/Schedule.tsx) | Compact monthly calendar on the left, full agenda list on the right, click-to-filter. |
| [sections/Settings.tsx](frontend/components/sections/Settings.tsx) | Sender identity, footer compliance, tracking URL, integration status, **Signup form embed panel**. |
| [editor/CampaignEditor.tsx](frontend/components/editor/CampaignEditor.tsx) | Header + Content / Audience / Review tabs. Wires sidebar + canvas. Auto-save. |
| [editor/CampaignCanvas.tsx](frontend/components/editor/CampaignCanvas.tsx) | WYSIWYG 600 px email card. `@dnd-kit/sortable` blocks with left-edge hover handle, faded drag overlay, orange drop indicator. Click block → context menu (move/delete + per-block design controls). |
| [editor/EditorSidebar.tsx](frontend/components/editor/EditorSidebar.tsx) | Left sidebar: vertical block palette + global design controls (bg/card/text/heading/button colors, font family). |
| [editor/TemplateEditor.tsx](frontend/components/editor/TemplateEditor.tsx) | Template editor — same canvas + sidebar as campaigns, no audience/schedule/send. Duplicate + Delete + Start campaign actions. Auto-save. |
| [editor/AIPanel.tsx](frontend/components/editor/AIPanel.tsx) | Prompt + tone + audience form that calls the LLM. |
| [hooks/useViewport.ts](frontend/hooks/useViewport.ts) | Live viewport size classifier (mobile / tablet / desktop). |
| [hooks/useAppState.ts](frontend/hooks/useAppState.ts) | Subscribes a component to the AppController. |

## Key Files

| File | Purpose |
|---|---|
| [backend/models.py](backend/models.py) | All SQLAlchemy models, including `Template.design` / `Campaign.design` / `SenderIdentity.subscribe_key` / `Template.usage_count`. |
| [backend/routes.py](backend/routes.py) | All API endpoints + bootstrap (template seed + scheduler start + idempotent column migrations for `design` and `subscribe_key`). |
| [backend/llm_service.py](backend/llm_service.py) | Wraps CraftBot's `LLMInterface` with a 6 s safety timeout + caching helpers. |
| [backend/prompts.py](backend/prompts.py) | AI email-generation system + user prompts + offline stub. |
| [backend/email_renderer.py](backend/email_renderer.py) | Renders blocks to inline-styled HTML + plain-text. Honors per-block + per-campaign `design` defaults. Substitutes `{firstName}` etc., adds tracking pixel + footer. |
| [backend/email_service.py](backend/email_service.py) | Production Gmail send via CraftBot's `integration_client.request`. RFC 8058 headers. |
| [backend/campaign_send.py](backend/campaign_send.py) | Materializes recipients, sends each, records per-recipient status, rolls up aggregates. |
| [backend/scheduler.py](backend/scheduler.py) | Daemon thread polling for due scheduled campaigns. |
| [backend/seed_data.py](backend/seed_data.py) | Eight starter templates — seeded **only when the templates table is empty**. |
| [frontend/types.ts](frontend/types.ts) | TypeScript types matching backend response shapes, including `CampaignDesign`. |
| [frontend/AppController.ts](frontend/AppController.ts) | State + all mutating API actions, with toast feedback + `rotateSubscribeKey`. |
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
python -m pytest tests/ -v          # 56 tests pass
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
2. **Templates** — click any starter template, edit its blocks/colors/font in the WYSIWYG editor (auto-saves), then hit **Start campaign** to spawn a campaign that inherits the design.
3. **Campaign editor** — open **AI write**, generate a draft. Hover a block to see the left drag handle. Drag a block — the source fades and other blocks displace; an orange line marks the drop. Click a block to open the context menu and change its alignment/color/size. Tweak global colors from the left sidebar.
4. **Audience** tab — switch to **By tag**, pick a tag; the recipient summary updates and the sample-recipients panel shows real contacts.
5. **Schedule** — pick tomorrow morning, confirm it appears on the calendar (with a dot) and in the agenda list. Click the day to filter the list. Cancel from the agenda.
6. **Send** — set a `from_email` in **Settings**, connect Gmail in CraftBot, then **Send now**. Verify the email arrives with the tracking pixel + unsubscribe footer.
7. **Signup form embed** — under **Settings → Signup form embed**, copy the HTML snippet. Paste it into a local HTML file, open it in a browser, type an email, hit Subscribe — the new contact appears immediately in the Subscribers list.
8. **Subscribe-key rotation** — click **Rotate** in the embed panel, confirm; re-copy the snippet. The previous snippet stops working.
9. **Resize** — shrink the window to ~360 px to verify the sidebar collapses to a bottom-tab bar and the drawer becomes a full-screen sheet.
