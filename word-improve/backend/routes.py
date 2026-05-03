"""
Word Improve API Routes — git-style merge flow.

Lifecycle of a session:
1. POST /api/sessions               — create the session, persist input + mode
2. POST /api/sessions/{id}/generate — single LLM call returns title + N
                                       whole-text variants. Backend splits
                                       original + each variant into "units"
                                       (sentences + paragraph breaks),
                                       aligns by index, and persists one
                                       MergeSegment per row.
3. PUT  /api/segments/{id}/select   — user picks which lane wins for a row.
4. POST /api/sessions/{id}/compile  — stitch picked lanes, store compiled text,
                                       and return a word-level diff.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional, Literal
from datetime import datetime
import logging

from database import get_db
from models import (
    AppState,
    LLMCache,
    MergeSegment,
    Session,
    SessionVariant,
    UISnapshot,
    UIScreenshot,
)
from text_utils import (
    PARAGRAPH_BREAK,
    join_units,
    split_into_units,
    split_sentences_with_breaks,
    word_diff,
)
from prompts import SYSTEM_PROMPT, session_generation_prompt
from llm_service import (
    check_cache,
    generate_text_sync,
    llm_available,
    make_cache_key,
    parse_json_response,
    store_cache,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Schemas
# ============================================================================

class SessionCreate(BaseModel):
    """Inline Literal types so the OpenAPI schema expands the enum values
    directly — the marketplace smoke test's auto-payload generator can't
    follow ``$ref`` for non-object schemas."""
    original_text: str = Field(default="", min_length=0)
    mode: Literal["improve", "tone_shift", "custom"] = "improve"
    tone: Optional[
        Literal["Formal", "Casual", "Persuasive", "Concise", "Friendly", "Academic"]
    ] = None
    custom_instruction: Optional[str] = None
    variant_count: int = Field(default=3, ge=2, le=5)
    title: Optional[str] = None


class SessionTitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class SegmentSelect(BaseModel):
    selection: Optional[int] = None


class StateUpdate(BaseModel):
    data: Dict[str, Any]


class UISnapshotUpdate(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


# ============================================================================
# LLM helpers
# ============================================================================

def _stub_structured_variants(
    sentences: List[str],
    count: int,
    mode: str,
) -> List[List[Dict[str, Any]]]:
    """Structured stub variants when CraftBot's LLM isn't available.

    Each stub variant preserves the original sentence order with a clearly
    marked rewrite, so the alignment-aware merge view still produces sensible
    segments and the marketplace smoke test stays green offline.
    """
    label_by_mode = {
        "improve": "stub rewrite",
        "tone_shift": "stub tone shift",
        "custom": "stub custom rewrite",
    }
    label = label_by_mode.get(mode, "stub variant")
    note = "(configure CraftBot LLM provider for real output)"
    variants: List[List[Dict[str, Any]]] = []
    for i in range(count):
        sents: List[Dict[str, Any]] = []
        for j, orig in enumerate(sentences):
            text = (orig or "").strip()
            if not text:
                continue
            sents.append({
                "text": f"{text} [{label} #{i + 1}] {note}",
                "from_original": j,
            })
        if not sents:
            sents.append({
                "text": f"[{label} #{i + 1}] {note}",
                "from_original": None,
            })
        variants.append(sents)
    return variants


def _stub_title(original_text: str) -> str:
    base = (original_text or "").strip()
    fallback = (base.split("\n", 1)[0])[:32].strip() or "Untitled"
    return f"{fallback} (stub)"


def _validate_structured_variants(
    raw_variants: Any,
    sentence_count: int,
) -> List[List[Dict[str, Any]]]:
    """Coerce LLM output into the structured shape, dropping invalid entries.

    Each variant becomes a list of ``{"text": str, "from_original": int|None}``.
    Out-of-range from_original values are normalised to None.
    """
    if not isinstance(raw_variants, list):
        return []
    out: List[List[Dict[str, Any]]] = []
    for raw_v in raw_variants:
        if not isinstance(raw_v, dict):
            continue
        raw_sents = raw_v.get("sentences")
        if not isinstance(raw_sents, list):
            continue
        sents: List[Dict[str, Any]] = []
        for raw_s in raw_sents:
            if not isinstance(raw_s, dict):
                continue
            text = str(raw_s.get("text") or "").strip()
            if not text:
                continue
            fo = raw_s.get("from_original")
            if isinstance(fo, int) and 0 <= fo < sentence_count:
                pass
            else:
                fo = None
            sents.append({"text": text, "from_original": fo})
        if sents:
            out.append(sents)
    return out


def _generate_session_payload(
    db: DBSession,
    original_text: str,
    mode: str,
    tone: Optional[str],
    custom_instruction: Optional[str],
    count: int,
    salt: int = 0,
) -> Dict[str, Any]:
    """Run a single LLM call → ``{"title", "variants"}`` where each variant is
    a structured ``[{"text", "from_original"}]`` list.

    Cached with LLMCache. Falls back to stub variants when CraftBot's LLM is
    not reachable or its response can't be parsed.
    """
    sentences, _ = split_sentences_with_breaks(original_text or "")
    cache_key = make_cache_key(
        "session_v3",
        mode,
        tone or "",
        custom_instruction or "",
        count,
        salt,
        original_text or "",
    )
    cached = check_cache(db, cache_key)
    if (
        isinstance(cached, dict)
        and isinstance(cached.get("variants"), list)
        and len(cached["variants"]) >= count
        and isinstance(cached.get("title"), str)
    ):
        return {
            "title": cached["title"],
            "variants": cached["variants"][:count],
        }

    title = ""
    variants: List[List[Dict[str, Any]]] = []
    if llm_available():
        prompt = session_generation_prompt(
            mode=mode,
            sentences=sentences,
            count=count,
            tone=tone,
            custom_instruction=custom_instruction,
            salt=salt,
        )
        raw = generate_text_sync(SYSTEM_PROMPT, prompt)
        parsed = parse_json_response(raw) if raw else None
        if isinstance(parsed, dict):
            title = str(parsed.get("title") or "").strip()
            variants = _validate_structured_variants(parsed.get("variants"), len(sentences))

    if not title:
        title = _stub_title(original_text)
    if len(variants) < count:
        stub_variants = _stub_structured_variants(sentences, count, mode)
        variants = (variants + stub_variants)[:count]
    else:
        variants = variants[:count]

    payload = {"title": title, "variants": variants}
    store_cache(db, cache_key, payload, hours=12)
    return payload


def _variant_full_text(variant_sents: List[Dict[str, Any]]) -> str:
    """Reconstruct a readable whole-text rendering of a structured variant."""
    return " ".join(s["text"] for s in variant_sents if s.get("text")).strip()


# ============================================================================
# Segment building
# ============================================================================

def _detect_reorder_note(
    variant_sents: List[Dict[str, Any]],
    v_pos: int,
    original_index: int,
) -> Optional[str]:
    """Return ``"reordered"`` if the variant placed this sentence somewhere
    other than its expected position relative to other mapped sentences.

    "Expected" position = the index it would have if the variant's mapped
    sentences were in original order. If the LLM kept the same relative order,
    no badge is emitted.
    """
    expected = sum(
        1 for j in range(original_index)
        if any(s.get("from_original") == j for s in variant_sents)
    )
    actual = sum(
        1 for s in variant_sents[:v_pos]
        if isinstance(s.get("from_original"), int)
    )
    return "reordered" if expected != actual else None


def _build_segments(
    original_text: str,
    variants_struct: List[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Align original + N variants using ``from_original`` mappings.

    Output segment kinds:
      - ``"auto"``     — every non-empty choice is identical (paragraph breaks,
                          unchanged sentences). Default selection = 0.
      - ``"conflict"`` — choices differ. User must pick.
      - ``"addition"`` — a variant added new content (from_original = null);
                          choice list is just ``[skip, the addition]`` so the
                          user toggles include / skip. Inserted at the anchor
                          slot the LLM intended (right after the most-recent
                          mapped original sentence in that variant's flow), so
                          including an addition slots it in the middle of the
                          text rather than the tail.
    """
    sentences, breaks_after = split_sentences_with_breaks(original_text or "")
    variant_count = len(variants_struct)

    # ------------------------------------------------------------------
    # Pass 1: collect each variant's additions, keyed by their anchor —
    # the from_original index of the most-recent mapped sentence that
    # appears before the addition in the variant's own sentence list.
    # Anchor = -1 means "before original sentence 0".
    # ------------------------------------------------------------------
    additions_by_anchor: Dict[int, List[Dict[str, Any]]] = {}
    for v_idx, v_sents in enumerate(variants_struct):
        last_anchor = -1
        for s in v_sents:
            fo = s.get("from_original")
            if isinstance(fo, int):
                last_anchor = fo
                continue
            text = (s.get("text") or "").strip()
            if not text:
                continue
            additions_by_anchor.setdefault(last_anchor, []).append({
                "kind": "addition",
                "choices": [
                    {"source": "original", "text": "", "note": "skip"},
                    {
                        "source": f"variant_{v_idx}",
                        "text": text,
                        "note": "added",
                    },
                ],
                "selection": 0,
            })

    # ------------------------------------------------------------------
    # Pass 2: build the original-aligned segments + paragraph breaks +
    # interleaved addition segments. Addition segments anchored at i are
    # emitted right after the aligned segment for original index i,
    # BEFORE any paragraph break following it — so an addition stays in
    # the same paragraph as its anchor sentence.
    # ------------------------------------------------------------------
    segments: List[Dict[str, Any]] = []

    def _emit(seg: Dict[str, Any]) -> None:
        seg["position"] = len(segments)
        segments.append(seg)

    # Additions before the first original sentence.
    for add in additions_by_anchor.get(-1, []):
        _emit(add)

    for i, orig_sentence in enumerate(sentences):
        choices: List[Dict[str, Any]] = [
            {"source": "original", "text": orig_sentence, "note": None}
        ]
        for v_idx, v_sents in enumerate(variants_struct):
            mapped_indices = [
                j for j, s in enumerate(v_sents) if s.get("from_original") == i
            ]
            if not mapped_indices:
                choices.append({
                    "source": f"variant_{v_idx}",
                    "text": "",
                    "note": "removed",
                })
            elif len(mapped_indices) == 1:
                v_pos = mapped_indices[0]
                text = v_sents[v_pos]["text"]
                note = _detect_reorder_note(v_sents, v_pos, i)
                choices.append({
                    "source": f"variant_{v_idx}",
                    "text": text,
                    "note": note,
                })
            else:
                joined = " ".join(v_sents[k]["text"] for k in mapped_indices)
                choices.append({
                    "source": f"variant_{v_idx}",
                    "text": joined,
                    "note": "split",
                })

        non_empty_texts = [c["text"] for c in choices if c["text"]]
        all_have_text = all(c["text"] for c in choices)
        if all_have_text and len(set(non_empty_texts)) == 1:
            kind = "auto"
            default_selection = 0
        else:
            kind = "conflict"
            default_selection = None

        _emit({
            "kind": kind,
            "choices": choices,
            "selection": default_selection,
        })

        # Slot any additions anchored at this original index BEFORE the
        # paragraph break, so they stay in the same paragraph.
        for add in additions_by_anchor.get(i, []):
            _emit(add)

        if i < len(breaks_after) and breaks_after[i]:
            br_choices: List[Dict[str, Any]] = [
                {"source": "original", "text": PARAGRAPH_BREAK, "note": None}
            ]
            for v_idx in range(variant_count):
                br_choices.append({
                    "source": f"variant_{v_idx}",
                    "text": PARAGRAPH_BREAK,
                    "note": None,
                })
            _emit({
                "kind": "auto",
                "choices": br_choices,
                "selection": 0,
            })

    return segments


def _persist_segments(
    db: DBSession,
    session: Session,
    segment_dicts: List[Dict[str, Any]],
) -> None:
    """Replace a session's segments with the new generation.

    Variants are handled by the calling route (generate / regenerate) — this
    function intentionally does *not* delete them, so the SessionVariant rows
    just inserted by the route survive.
    """
    for s in list(session.segments):
        db.delete(s)
    db.flush()
    for seg in segment_dicts:
        db.add(MergeSegment(
            session_id=session.id,
            position=seg["position"],
            kind=seg["kind"],
            choices=seg["choices"],
            selection=seg["selection"],
        ))


# ============================================================================
# Session routes
# ============================================================================

@router.post("/sessions")
def create_session(data: SessionCreate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    sess = Session(
        title=data.title,
        original_text=data.original_text or "",
        mode=data.mode or "improve",
        tone=data.tone,
        custom_instruction=data.custom_instruction,
        variant_count=data.variant_count or 3,
        status="draft",
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    logger.info("[Routes] Created session %s (mode=%s)", sess.id, sess.mode)
    return sess.to_detail()


@router.get("/sessions")
def list_sessions(db: DBSession = Depends(get_db)) -> List[Dict[str, Any]]:
    sessions = db.query(Session).order_by(Session.updated_at.desc(), Session.id.desc()).all()
    return [s.to_summary() for s in sessions]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    sess = db.query(Session).filter(Session.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess.to_detail()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    """Idempotent — returns 200 status='not_found' if already gone."""
    sess = db.query(Session).filter(Session.id == session_id).first()
    if not sess:
        return {"status": "not_found", "id": session_id}
    db.delete(sess)
    db.commit()
    return {"status": "deleted", "id": session_id}


@router.put("/sessions/{session_id}/title")
def rename_session(
    session_id: int,
    data: SessionTitleUpdate,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    sess = db.query(Session).filter(Session.id == session_id).first()
    if not sess:
        return {"status": "not_found", "id": session_id}
    sess.title = data.title.strip() or sess.title
    db.commit()
    db.refresh(sess)
    return {"status": "ok", "session": sess.to_summary()}


@router.post("/sessions/{session_id}/generate")
def generate_session(
    session_id: int,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    """One LLM call → title + N whole-text variants → aligned segments."""
    sess = db.query(Session).filter(Session.id == session_id).first()
    if not sess:
        return {
            "status": "not_found",
            "id": session_id,
            "llmAvailable": llm_available(),
        }

    payload = _generate_session_payload(
        db,
        original_text=sess.original_text or "",
        mode=sess.mode or "improve",
        tone=sess.tone,
        custom_instruction=sess.custom_instruction,
        count=sess.variant_count or 3,
    )

    for v in list(sess.variants):
        db.delete(v)
    db.flush()
    for i, v_sents in enumerate(payload["variants"]):
        db.add(SessionVariant(
            session_id=sess.id,
            idx=i,
            text=_variant_full_text(v_sents),
        ))
    db.flush()

    segments = _build_segments(
        original_text=sess.original_text or "",
        variants_struct=payload["variants"],
    )
    _persist_segments(db, sess, segments)

    if payload.get("title") and not sess.title:
        sess.title = payload["title"][:255]
    sess.status = "variants_ready"
    db.commit()
    db.refresh(sess)
    return {
        "status": "ok",
        "llmAvailable": llm_available(),
        "session": sess.to_detail(),
    }


@router.post("/sessions/{session_id}/regenerate")
def regenerate_session(
    session_id: int,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    sess = db.query(Session).filter(Session.id == session_id).first()
    if not sess:
        return {
            "status": "not_found",
            "id": session_id,
            "llmAvailable": llm_available(),
        }

    salt = (datetime.utcnow().microsecond % 997) + 1
    payload = _generate_session_payload(
        db,
        original_text=sess.original_text or "",
        mode=sess.mode or "improve",
        tone=sess.tone,
        custom_instruction=sess.custom_instruction,
        count=sess.variant_count or 3,
        salt=salt,
    )

    for v in list(sess.variants):
        db.delete(v)
    db.flush()
    for i, v_sents in enumerate(payload["variants"]):
        db.add(SessionVariant(
            session_id=sess.id,
            idx=i,
            text=_variant_full_text(v_sents),
        ))
    db.flush()

    segments = _build_segments(
        original_text=sess.original_text or "",
        variants_struct=payload["variants"],
    )
    _persist_segments(db, sess, segments)

    sess.status = "variants_ready"
    sess.compiled_text = None
    db.commit()
    db.refresh(sess)
    return {
        "status": "ok",
        "llmAvailable": llm_available(),
        "session": sess.to_detail(),
    }


@router.post("/sessions/{session_id}/compile")
def compile_session(
    session_id: int,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    sess = db.query(Session).filter(Session.id == session_id).first()
    if not sess:
        return {"status": "not_found", "id": session_id, "compiled": "", "diff": []}

    units: List[str] = []
    for seg in sorted(sess.segments, key=lambda s: s.position or 0):
        choices = seg.choices or []
        sel = seg.selection
        if sel is None or sel < 0 or sel >= len(choices):
            sel = 0
        text = choices[sel].get("text", "") if choices else ""
        if text:
            units.append(text)
    compiled = join_units(units)

    sess.compiled_text = compiled
    sess.status = "compiled"
    db.commit()
    db.refresh(sess)

    diff = word_diff(sess.original_text or "", compiled)
    return {
        "status": "ok",
        "compiled": compiled,
        "diff": diff,
        "session": sess.to_detail(),
    }


# ============================================================================
# Segment routes
# ============================================================================

@router.put("/segments/{segment_id}/select")
def select_segment(
    segment_id: int,
    data: SegmentSelect,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    """Pick which lane wins for one row of the merge view.

    Returns 200 status='not_found' when the segment is absent so the
    marketplace smoke test (which has no way to seed segment IDs) does not
    fail on this route.
    """
    seg = db.query(MergeSegment).filter(MergeSegment.id == segment_id).first()
    if not seg:
        return {"status": "not_found", "id": segment_id}

    if data.selection is not None:
        choices = seg.choices or []
        if data.selection >= 0 and data.selection < len(choices):
            seg.selection = data.selection
        else:
            seg.selection = None

    db.commit()
    db.refresh(seg)
    return {"status": "ok", "segment": seg.to_dict()}


# ============================================================================
# Generic state + UI observation routes (template-provided)
# ============================================================================

@router.get("/state")
def get_state(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.delete("/state")
def clear_state(db: DBSession = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.get("/ui-snapshot")
def get_ui_snapshot(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None,
            "visibleText": [],
            "inputValues": {},
            "componentState": {},
            "currentView": None,
            "viewport": {},
            "timestamp": None,
            "status": "no_snapshot",
        }
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)
    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport
    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {
            "imageData": None,
            "width": None,
            "height": None,
            "timestamp": None,
            "status": "no_screenshot",
        }
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)
    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(screenshot)
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}
