# {{PROJECT_NAME}}

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

{{PROJECT_DESCRIPTION}}

A newsletter workbench: manage a subscriber audience, compose campaigns in
a block editor, and send them. Sending always snapshots the audience onto
the campaign; tick "actually email everyone" to also deliver each message
through the CraftBot Gmail integration (per-recipient outcomes are
recorded). Without CraftBot/Gmail the send is recorded only — export the
audience as CSV to deliver elsewhere.

## Requirements

Feature checklist:

- [x] Subscribers: add (unique email), unsubscribe/resubscribe, delete, tags field
- [x] Subscriber table with status badges + subscribed count
- [x] Export subscribed audience as CSV (copies to clipboard; also an op)
- [x] Campaigns: compose drafts (subject + body), list with status badges
- [x] Send with confirmation → server-side audience snapshot + sent metadata
- [x] Real delivery via the CraftBot Gmail integration (HTML email rendered from blocks,
      sender identity from Settings, per-recipient delivered/failed status + Results dialog)
- [x] Scheduled sends can deliver for real too (the cron honours the campaign's deliver flag)
- [x] Per-campaign recipient snapshot survives later subscriber deletions
- [x] Dashboard tab (audience + campaign stats, recipients-per-campaign bars)
- [x] Templates tab (create/edit/delete; "start from template" in the composer)
- [x] Block-based editor (heading/paragraph/button/divider, reorder, live preview) for campaigns and templates
- [x] Subscriber CSV import (email, name, tags — duplicates skipped) + edit subscriber
- [x] Subscriber text + tag filters
- [x] Edit draft campaigns, duplicate any campaign, delete, cancel a schedule
- [x] AI draft assist (topic → subject + body via CraftBot LLM bridge, 503 outside)
- [x] Scheduled sends (pick date/time; a PB cron auto-sends due drafts every minute)
- [x] Schedule tab: month calendar of scheduled + sent campaigns, and an upcoming-sends list
- [x] Sender settings tab (name + email; shown on send confirmation)
- [x] Seeded example subscribers, template and sender identity

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| subscribers | The audience | email (unique), name, status, tags |
| campaigns   | Newsletters | subject, body, status draft/sent, sent_at, recipients_count |
| campaign_recipients | Audience snapshot per send | campaign (rel), email + name copies, status (delivered/logged/failed), detail |
| templates   | Reusable campaign starters | name, subject, body |
| settings    | Sender identity (single row) | sender_name, sender_email |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `campaigns.send` (destructive) — snapshot audience + mark sent; `deliver=true` also emails everyone via Gmail.
- `subscribers.export` — subscribed audience as CSV text.
- `ai.draft` — draft subject+body from a topic via the CraftBot LLM bridge.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
