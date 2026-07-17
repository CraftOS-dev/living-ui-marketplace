# Social Media Manager

Compose, schedule, publish, and analyze posts across Twitter/X, LinkedIn, and YouTube — with an AI writing suite built in.

## Overview

Social Media Manager is a Living UI for content creators and social media managers who work across multiple platforms. It covers the full post lifecycle: draft → schedule → publish → analyze. The AI writing suite (caption generator, hook creator, text humanizer, comment insights) runs through CraftBot's LLM bridge. Platform publishing and analytics sync use CraftBot's OAuth integration bridge — no credentials are stored in the app itself.

## Requirements

### Entities & Data Model

**Posts** are the core entity. Each post targets a single platform and moves through a defined status lifecycle. Per-platform content overrides are stored in `extraData.overrides` so one global draft can have platform-specific copy without duplicate records.

**PostAnalytics** tracks engagement for published posts, fetched on demand via the integration bridge.

**PlatformAccount** caches authenticated account info per platform (one row per platform), populated via `/accounts/sync`.

**Ideas** store content ideas separately from posts and can be promoted to drafts in one action.

**HashtagSets** are saved collections of hashtags for reuse across posts.

### Layout & Design

Dark theme. Sidebar navigation with 8 sections. Modals for post detail and AI caption generation. Platform preview panel in the composer shows how content renders per platform.

### Features

- Full post CRUD with draft/scheduled/publishing/published/failed/cancelled lifecycle
- Per-platform content overrides (write once, customize per platform via extraData.overrides)
- Schedule posts for future publishing; background scheduler fires at due time
- Queue view of all upcoming scheduled/publishing posts
- Calendar view (month grid) of scheduled and published posts
- Per-platform analytics summary + per-post analytics sync via integration
- AI caption generator (topic + tone → platform-appropriate copy)
- AI hook creator (7 distinct frameworks, platform-aware constraints)
- AI text humanizer (removes AI tells, adds burstiness and stance)
- AI comment insights (fetch comments + LLM sentiment/theme/insight analysis)
- Ideas board with CRUD and one-click promote-to-draft
- Hashtag set library with use count tracking
- Media upload and serving (images/video attached to posts)
- Platform account sync (Twitter, LinkedIn, YouTube via integration bridge)

### Assumptions

- Single user per installation (no auth module). Multi-user support not required.
- Publishing to platforms requires the user to have connected them in CraftBot's integration settings before launching.
- AI features degrade gracefully when the integration bridge is unavailable (return `status: "unavailable"`; UI shows a disabled state).
- The background scheduler checks for due posts every 60 seconds.

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Post | Core post entity | id, globalContent, platform, status, scheduledAt, publishedAt, platformPostId, errorMessage, retryCount, mediaUrls, extraData |
| PostAnalytics | Engagement metrics per post (1:1 with Post, cascade delete) | id, postId, impressions, likes, comments, shares, clicks, fetchedAt, rawData |
| PlatformAccount | Cached account info per platform (unique per platform) | id, platform, accountId, displayName, username, avatarUrl, followerCount, extraData, syncedAt |
| Idea | Content idea on the ideas board | id, title, content, platform, tags, source, status, createdAt, updatedAt |
| HashtagSet | Saved hashtag collection | id, name, platform, tags, useCount, createdAt, updatedAt |
| AppState | Generic JSON state blob for agent access | id, data, createdAt, updatedAt |
| UISnapshot | Agent UI observation (DOM / visible text) | id, htmlStructure, visibleText, inputValues, componentState, currentView, viewport, timestamp |
| UIScreenshot | Agent visual observation (base64 PNG) | id, imageData, width, height, timestamp |

## API Endpoints

### Custom Routes (backend/routes.py)

All routes are mounted under the `/api` prefix by `main.py`.

| Method | Path | Description |
|--------|------|-------------|
| GET | /state | Read generic agent state blob |
| PUT | /state | Merge-update agent state blob |
| POST | /state/replace | Full-replace agent state blob |
| DELETE | /state | Clear agent state blob |
| POST | /action | Execute named agent action (reset / increment / decrement) |
| GET | /ui-snapshot | Read latest UI snapshot for agent observation |
| POST | /ui-snapshot | Frontend posts UI state update |
| GET | /ui-screenshot | Read latest UI screenshot for agent observation |
| POST | /ui-screenshot | Frontend posts screenshot update |
| GET | /integrations/status | Check which platforms are connected via CraftBot bridge |
| POST | /accounts/sync | Sync account info for all platforms from integration bridge |
| GET | /accounts | List cached platform accounts |
| GET | /posts | List posts (optional ?platform= and ?status= filters) |
| POST | /posts | Create a new post |
| GET | /posts/{post_id} | Get a single post with its analytics |
| PUT | /posts/{post_id} | Update post fields |
| DELETE | /posts/{post_id} | Delete a post |
| POST | /posts/{post_id}/schedule | Set scheduledAt and move status to "scheduled" |
| POST | /posts/{post_id}/publish-now | Publish immediately via integration bridge |
| POST | /posts/{post_id}/cancel | Cancel a scheduled post |
| GET | /posts/{post_id}/analytics | Get stored analytics for a post |
| POST | /posts/{post_id}/analytics/sync | Fetch and store latest analytics from platform |
| GET | /queue | List scheduled and publishing posts ordered by scheduledAt |
| GET | /calendar | Posts indexed by day for a given ?year=&month= |
| GET | /analytics/summary | Aggregate impressions/likes/comments/shares per platform |
| POST | /ai/generate-caption | Generate a platform-optimized caption via LLM |
| POST | /ai/generate-hooks | Generate N hooks across 7 distinct frameworks via LLM |
| POST | /ai/humanize | Rewrite AI-sounding text to be more human via LLM |
| POST | /ai/comment-insights | Fetch comments from a live post + LLM sentiment/theme analysis |
| POST | /media/upload | Upload a media file; returns /api/media/{filename} URL |
| GET | /media/{filename} | Serve an uploaded media file |
| GET | /ideas | List ideas (optional ?platform= ?status= ?q= filters) |
| POST | /ideas | Create an idea |
| PUT | /ideas/{idea_id} | Update an idea |
| DELETE | /ideas/{idea_id} | Delete an idea |
| POST | /ideas/{idea_id}/promote | Convert idea to a draft post and archive the idea |
| GET | /hashtag-sets | List all hashtag sets |
| POST | /hashtag-sets | Create a hashtag set |
| PUT | /hashtag-sets/{set_id} | Update a hashtag set (or increment use count) |
| DELETE | /hashtag-sets/{set_id} | Delete a hashtag set |

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Root layout — mounts Sidebar and the active section view |
| Sidebar.tsx | Left nav with 8 sections; shows platform connection status |
| ComposerView.tsx | Post composer: platform selector, content editor, per-platform overrides, scheduling, media upload, AI caption shortcut |
| QueueView.tsx | List of scheduled/publishing posts with publish-now and cancel actions |
| CalendarView.tsx | Month grid showing posts by day; click a day to see posts |
| AnalyticsView.tsx | Per-platform aggregated stats; per-post analytics with sync |
| HookCreatorView.tsx | AI hook generator — topic/audience/tone/goal inputs, 7-framework output, save-to-ideas action |
| TextHumanizerView.tsx | AI text humanizer — paste text, pick platform/tone, get rewritten output, save-to-ideas action |
| CommentInsightsView.tsx | Fetch comments from a live post and run LLM sentiment/theme/insight analysis |
| IdeasBoardView.tsx | Ideas CRUD board with promote-to-draft and filter by platform/status |
| PostDetailModal.tsx | Full post detail modal with analytics panel and quick actions |
| AiCaptionModal.tsx | AI caption generation modal triggered from the composer |
| PlatformPreview.tsx | Preview panel simulating how a post renders on Twitter/LinkedIn/YouTube |
| QueuePostCard.tsx | Individual card in the queue view with status badge and action buttons |
| ui/ | Preset component library (Button, Card, Input, Modal, Alert, Table, etc.) — do not modify |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | SQLAlchemy models for all entities |
| backend/routes.py | All API endpoints |
| backend/scheduler.py | Background task that checks for due scheduled posts and publishes them |
| backend/services/integration_client.py | CraftBot integration bridge (OAuth requests + LLM calls) |
| backend/health_checker.py | Health check utility used by the pipeline |
| backend/logger.py | Structured logging setup |
| backend/tests/ | Pytest test suite |
| frontend/types.ts | TypeScript interfaces matching all backend models |
| frontend/AppController.ts | State management — all API calls go through here |
| frontend/components/MainView.tsx | Main UI entry point |
| config/manifest.json | Pipeline config; {{PORT}} / {{BACKEND_PORT}} / {{PROJECT_ID}} placeholders |
| setup_local.py | Substitutes placeholders for local dev |

## State Flow

```
User Action → Frontend Component → AppController → Backend API → SQLite DB
                                        ↓
                                  Update UI State
                                        ↓
                         (AI / publish) → CraftBot Integration Bridge → Platform APIs
```

## Testing

1. Start backend: `cd backend && python -m uvicorn main:app --port 3101`
2. Run unit tests: `python -m pytest tests/ -v`
3. Run smoke tests: `python test_runner.py --internal && python test_runner.py --external --port 3101`
4. Build frontend: `cd .. && npm install && npm run build`
5. Open `http://localhost:3101` — composer should load, sidebar shows platform connection status
6. Create a draft post, schedule it, verify it appears in Queue and Calendar views
7. Check Analytics summary (shows zeroes until posts are published and analytics are synced)
