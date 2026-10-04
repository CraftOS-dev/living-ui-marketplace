# AI Audio Notes

Audio note taking app with voice recording, session manager, overview, summary, key highlights, and action items.

## What this app does

AI Audio Notes allows users to record live audio from their microphone (with real-time animated waveform visualizers) or import audio files (.mp3, .wav, .m4a, .webm, .ogg). It organizes voice memos, executive meetings, customer interviews, and academic lectures into structured notes containing:
- **Overview**: Meeting context, purpose, attendees list, and full discussion transcript.
- **Executive Summary**: Synthesized TL;DR, key discussion points, and conclusions reached.
- **Key Highlights & Action Items**: Bulleted high-impact takeaways with an interactive task checklist.
- **Collapsible Sidebar**: Manage and filter multiple saved recording sessions by category, search queries, and starred items.

## Platform & Architecture

- **Platform**: Living UI V2 (PocketBase + React 19 + TypeScript + Vite + Tailwind 4)
- **Port**: Single port — PocketBase serves both the built frontend assets from `pb/pb_public` and the REST API
- **Audio Capture**: Browser MediaRecorder API with Web Audio API AnalyserNode for live spectrum animation
- **Audio Playback**: Custom scrubber player with speed switching (0.75x, 1x, 1.25x, 1.5x, 2x) and volume controls
- **Auth Mode**: `none` — binds to loopback with local PocketBase persistence

## Entities

| Collection | Purpose | Fields |
|------------|---------|--------|
| `sessions` | Saved audio recording sessions and note files | `title`, `category`, `date`, `duration`, `attendees`, `is_starred`, `audio`, `audio_format`, `audio_url`, `overview`, `summary`, `key_highlights`, `transcript`, `action_items`, `created`, `updated` |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`:

| Operation | Method | Path | Purpose |
|-----------|--------|------|---------|
| `health` | GET | `/api/health` | Built-in PocketBase liveness check |
| `ops.list` | GET | `/api/_ops` | Operations manifest discovery |
| `sessions.duplicate` | POST | `/api/ops/sessions/duplicate` | Duplicates a saved session record |
| `sessions.clear-completed-actions` | POST | `/api/ops/sessions/clear-completed-actions` | Bulk removes completed action items for a session |

## Ownership Map

- **Editable**: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`, `operations.json`, this file.
- **System-managed**: `frontend/src/kit/`, `frontend/src/main.tsx`, `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
