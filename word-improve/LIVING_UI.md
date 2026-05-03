# Word Improve

GitHub-style merge UI for prose. Paste text, get LLM variants per paragraph or sentence, pick what you like, copy the compiled result.

## Overview

Word Improve is a GitHub-style merge UI for prose. The user pastes a paragraph (or several) they want polished or extended, picks a mode (Improve, Auto-complete, Tone shift, or Custom instruction), and the LLM proposes N variants per chunk. The user then "merges" the variants they like — at paragraph granularity by default, or drilling into sentence-level variants for any paragraph that needs finer control. The compiled result is shown as a diff against the original and copied to the clipboard with one click.

The app is single-user, single-pass (one round of variant picking per session), and connects to whichever LLM provider the user has already configured in CraftBot — no separate API key setup.

## Requirements

### Entities & Data Model

- **Session** — one improvement run. Holds the user's original input, the chosen mode/tone/custom instruction, the variant count, and the final compiled output once the user finishes.
- **Chunk** — a paragraph or sentence inside a session. A paragraph chunk can have child sentence chunks generated on demand. Each chunk stores the original text, its position, its kind (paragraph or sentence), the variants, and which variant the user selected.
- **Variant** — one LLM-generated alternative for a chunk. Holds the generated text and an index (0..N-1).
- **LLMCache** — opaque key/content cache so identical chunk-mode-instruction combinations don't re-hit the LLM.

Relationships: Session has many Chunks; paragraph Chunks have many sentence Chunks (parent_id self-FK); Chunk has many Variants.

### Layout & Design

- **Layout:** Single scrolling page with a sticky toolbar. Top: input textarea + mode/options toolbar. Below: variant picker (one row per paragraph chunk, GitHub-style side-by-side columns: Original | Variant A | Variant B | …). Bottom: compiled result + diff view + Copy button, revealed once the user clicks "Compile".
- **Variant picker style:** GitHub-style side-by-side columns on desktop (≥768 px). On narrow viewports the columns stack vertically. Each variant is a clickable card; the selected card has a primary-colour border and a check icon. "Keep original" is always one of the picks per chunk.
- **Drill-down:** A paragraph chunk has a small "Sentence-level" button that splits the original paragraph into sentences and fetches sentence-level variants inline below the paragraph row. Once drilled in, the user picks per sentence; the paragraph row's selection becomes "Use sentence-level picks".
- **Compact density:** Tight padding, 13–14 px text, small icon buttons. Inspired by GitHub's diff view.
- **Colour scheme:** CraftBot global tokens — primary `#FF4F18`, dark mode by default, light mode supported via `[data-theme="light"]`.
- **Icons:** `lucide-react` (the preset). Wand2 for Improve, ArrowRight for Auto-complete, Mic for Tone shift, Sparkles for Custom, Copy for clipboard, Check for selected, RefreshCw for regenerate.
- **Diff:** Inline word-level diff rendered between the user's original input and the compiled output (additions in green, deletions struck-through in red), plus a Copy button on the compiled result.

### Features

1. **Session input** — textarea with paragraph parsing, mode picker (4 modes), tone selector (when "Tone shift" is chosen), custom instruction field (when "Custom" is chosen), variant-count selector (2–5, default 3), and a "Generate variants" button.
2. **LLM bridge** — backend service that pulls the user's CraftBot-configured LLM provider/model/api-key (same pattern as `luolinglo/backend/llm_service.py`) and prompts it to produce N variants per chunk.
3. **Paragraph variant picker** — for each paragraph: original card + N variant cards in a horizontal row. Click to lock a selection. "Regenerate" button per chunk to re-prompt the LLM (with a different temperature seed).
4. **Sentence-level drill-down** — expand a paragraph row into its constituent sentences, each with its own variants. Per-sentence picks roll up into the paragraph's compiled output.
5. **Compile** — when the user has picked a variant for every chunk, the "Compile" CTA enables. Click → backend stitches selected variants into the final text, persists it on the Session, and reveals the diff + result panel.
6. **Diff + copy** — inline word-level diff against the original input. Big primary "Copy" button next to the result. Toast confirms.
7. **Persistence** — sessions and chunks live in SQLite so the user can leave the page and come back. (The brief said single-pass per session, not single-session ever.)

### Assumptions

- **Single user, no auth.** No mention of multi-user / team / sharing in the brief.
- **Single-pass means single round of variant-picking per session, but multiple distinct sessions are persisted.** The user can close the tab and return to a session in progress.
- **"Auto-complete" mode** appends LLM-generated continuation text per paragraph.
- **"Tone shift" mode** uses a fixed list of tones: Formal, Casual, Persuasive, Concise, Friendly, Academic.
- **Copy to clipboard** is included as a basic export (the brief explicitly required it). A `.md` download / session history list were not picked in Batch 2 and are out of scope.
- **Variant-count default 3, range 2–5,** matching the user's pick.
- **`react-icon` interpreted as `lucide-react`** because that's the marketplace preset and what `COMPONENTS.md` specifies. If the user meant the `react-icons` package, it can swap with one dependency change.
- **Paragraph splitting** is by `\n\n` (one or more blank lines). Sentence splitting uses a regex on terminal punctuation (`. ! ?`) with safeguards for common abbreviations.
- **Regenerate** keeps the same mode/tone/instruction but bumps a salt so the LLM cache returns a fresh result.

## Data Model

### Backend Models (backend/models.py)

| Model       | Purpose                                                                  | Key Fields                                                                                                       |
|-------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Session     | One improvement run                                                      | id, original_text, mode, tone, custom_instruction, variant_count, compiled_text, status                          |
| Chunk       | Paragraph or sentence within a session (self-FK for sentence drill-down) | id, session_id, parent_id, kind, position, original_text, selection, use_sentence_picks                          |
| Variant     | One LLM-generated alternative for a chunk                                | id, chunk_id, idx, text                                                                                          |
| LLMCache    | Opaque cache for LLM responses (per chunk + mode + tone + salt)          | id, cache_key, content, expires_at                                                                               |
| AppState    | Generic key-value JSON state (template-provided, retained)               | id, data                                                                                                         |
| UISnapshot  | UI snapshot for agent observation (template-provided)                    | id, html_structure, visible_text, input_values, component_state, current_view, viewport, timestamp               |
| UIScreenshot| UI screenshot for agent observation (template-provided)                  | id, image_data, width, height, timestamp                                                                         |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path                                  | Description                                                                                |
|--------|---------------------------------------|--------------------------------------------------------------------------------------------|
| POST   | /api/sessions                         | Create a session, split the input into paragraph chunks                                    |
| GET    | /api/sessions                         | List sessions (newest first, no chunk payload)                                             |
| GET    | /api/sessions/{session_id}            | Get one session with its chunks (paragraphs + any drilled sentences)                       |
| DELETE | /api/sessions/{session_id}            | Idempotent delete — returns 200 with status="not_found" when the row is gone               |
| POST   | /api/sessions/{session_id}/generate   | Generate variants for every paragraph chunk in the session (uses CraftBot LLM)             |
| POST   | /api/sessions/{session_id}/compile    | Stitch the user's variant selections into a final text and produce a word-level diff       |
| GET    | /api/chunks/{chunk_id}                | Get a single chunk (with variants and children)                                            |
| PUT    | /api/chunks/{chunk_id}/select         | Pick a variant for a chunk (selection >= 0) or keep the original (selection = -1)          |
| POST   | /api/chunks/{chunk_id}/regenerate     | Re-prompt the LLM for a single chunk's variants (new salt to bypass the cache)             |
| POST   | /api/chunks/{chunk_id}/drill          | Split a paragraph chunk into sentence chunks and generate variants for each                |
| GET / PUT / DELETE | /api/state                | Generic JSON state (template-provided, retained)                                           |
| GET / POST | /api/ui-snapshot                  | Agent UI observation (template-provided)                                                   |
| GET / POST | /api/ui-screenshot                | Agent UI observation (template-provided)                                                   |

## Frontend Components

### Components (frontend/components/)

| Component             | Purpose                                                                                              |
|-----------------------|------------------------------------------------------------------------------------------------------|
| MainView.tsx          | Top-level layout: sticky toolbar, session picker, active-session card, picker, compiled result      |
| SessionInput.tsx      | Textarea + mode chips (Improve / Auto-complete / Tone shift / Custom), tone select, variant-count select, Generate button |
| ChunkRow.tsx          | One paragraph or sentence row — original card + variant cards in side-by-side columns; Regenerate / Sentence-level / Use-paragraph-picks actions |
| CompiledResult.tsx    | Word-level diff vs original, plain-text panel, Copy-to-clipboard with toast confirmation             |
| ui/index.tsx          | Preset UI kit (Button, Card, Input, Textarea, Select, Alert, …) — DO NOT EDIT                       |

## Key Files

| File                                | Purpose                                                                          |
|-------------------------------------|----------------------------------------------------------------------------------|
| backend/models.py                   | Session / Chunk / Variant / LLMCache SQLAlchemy models + agent observation models|
| backend/routes.py                   | Session lifecycle + variant generation + compile + chunk select/drill/regenerate |
| backend/llm_service.py              | Bridge to CraftBot's configured LLM provider (mirrors luolinglo's pattern)       |
| backend/prompts.py                  | Per-mode prompt templates (improve / auto_complete / tone_shift / custom)        |
| backend/text_utils.py               | Paragraph + sentence splitters; word-level LCS diff                              |
| backend/test_runner.py              | Marketplace pre/post-server test runner (patched: anyOf handler in `_generate_value`) |
| frontend/types.ts                   | TypeScript interfaces matching backend `to_dict()` shapes                        |
| frontend/AppController.ts           | API client + session state machine + subscriber notifications                    |
| frontend/components/MainView.tsx    | Wires SessionInput / ChunkRow list / CompiledResult                              |

## State Flow

```
User pastes text + picks mode
        ↓
POST /api/sessions  → backend splits into paragraph chunks
        ↓
POST /api/sessions/{id}/generate  → LLM produces N variants per chunk
        ↓
PUT  /api/chunks/{id}/select   → user picks a variant
        +
POST /api/chunks/{id}/drill    → optional sentence-level breakdown
        ↓
POST /api/sessions/{id}/compile  → backend stitches selections, runs diff
        ↓
GET  /api/sessions/{id}  → frontend renders diff + Copy button
```

## Testing

1. Paste 2–3 paragraphs, pick "Improve", click Generate. Each paragraph row shows N variant cards plus the original.
2. Click a variant on each paragraph; the "Compile" button enables.
3. Drill into one paragraph with "Sentence-level"; pick per-sentence variants. The paragraph row marks itself as "Use sentence-level picks".
4. Click Compile. The diff panel shows insertions in green and deletions struck through in red. Click Copy → clipboard contains the merged text.
5. Reload the page; the session is still in the list and selections persist.
6. Run `python -m pytest tests/ -v`, `python test_runner.py --internal`, `python test_runner.py --unit`, and `python test_runner.py --external --port <port>` — all four must report `ALL TESTS PASSED`.
