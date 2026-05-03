"""Tests for the git-style merge flow.

Without a configured CraftBot LLM these tests rely on the stub fallback in
``routes._stub_response`` so the wiring is exercised even when offline.
"""


def _make_session(client, text: str = "First sentence. Second sentence.\n\nThird sentence.", count: int = 3):
    return client.post("/api/sessions", json={
        "original_text": text,
        "mode": "improve",
        "variant_count": count,
    }).json()


def test_create_session_persists_input(client):
    s = _make_session(client, "Hello world.")
    assert s["id"] >= 1
    assert s["originalText"] == "Hello world."
    assert s["mode"] == "improve"
    assert s["status"] == "draft"
    assert s["variants"] == []
    assert s["segments"] == []


def test_list_sessions_summary(client):
    _make_session(client, "Alpha.")
    _make_session(client, "Beta.")
    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 2
    # Summaries do not include heavy fields
    assert "segments" not in sessions[0]
    assert "variants" not in sessions[0]
    assert "title" in sessions[0]


def test_get_session_404(client):
    assert client.get("/api/sessions/9999").status_code == 404


def test_delete_session_idempotent(client):
    s = _make_session(client, "Hi.")
    first = client.delete(f"/api/sessions/{s['id']}").json()
    assert first["status"] == "deleted"
    second = client.delete(f"/api/sessions/{s['id']}").json()
    assert second["status"] == "not_found"


def test_rename_session(client):
    s = _make_session(client, "x")
    resp = client.put(f"/api/sessions/{s['id']}/title", json={"title": "My Title"})
    assert resp.status_code == 200
    assert resp.json()["session"]["title"] == "My Title"


def test_rename_missing_session_is_idempotent(client):
    resp = client.put("/api/sessions/9999/title", json={"title": "x"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


def test_generate_returns_variants_and_segments(client):
    s = _make_session(client, "First sentence. Second sentence.", count=3)
    resp = client.post(f"/api/sessions/{s['id']}/generate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    sess = body["session"]
    assert sess["status"] == "variants_ready"
    assert len(sess["variants"]) == 3
    assert all(v["text"] for v in sess["variants"])
    assert len(sess["segments"]) >= 1
    # Original-aligned segments (auto + conflict) carry one choice per variant
    # plus the original. Addition segments are 2-choice (skip + the addition).
    aligned = [s for s in sess["segments"] if s["kind"] != "addition"]
    for seg in aligned:
        assert len(seg["choices"]) == 4
        sources = [c["source"] for c in seg["choices"]]
        assert sources[0] == "original"
        assert sources[1:] == ["variant_0", "variant_1", "variant_2"]


def test_build_segments_auto_resolves_when_all_match():
    """Unit test for the alignment logic — independent of LLM output quality."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Hello.",
        variants_struct=[
            [{"text": "Hello.", "from_original": 0}],
            [{"text": "Hello.", "from_original": 0}],
            [{"text": "Hello.", "from_original": 0}],
        ],
    )
    assert len(segments) == 1
    assert segments[0]["kind"] == "auto"
    assert segments[0]["selection"] == 0


def test_build_segments_marks_conflict_when_variants_differ():
    from routes import _build_segments

    segments = _build_segments(
        original_text="Hello.",
        variants_struct=[
            [{"text": "Hi.", "from_original": 0}],
            [{"text": "Howdy.", "from_original": 0}],
            [{"text": "Greetings.", "from_original": 0}],
        ],
    )
    assert segments[0]["kind"] == "conflict"
    assert segments[0]["selection"] is None
    sources = [c["source"] for c in segments[0]["choices"]]
    assert sources == ["original", "variant_0", "variant_1", "variant_2"]


def test_build_segments_aligns_paragraph_breaks_when_preserved():
    """When variants preserve paragraph breaks, the break unit auto-resolves."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="One.\n\nTwo.",
        variants_struct=[
            [{"text": "1.", "from_original": 0}, {"text": "2.", "from_original": 1}],
            [{"text": "I.", "from_original": 0}, {"text": "II.", "from_original": 1}],
        ],
    )
    # 3 segments: sentence, paragraph break, sentence.
    assert len(segments) == 3
    break_seg = segments[1]
    assert break_seg["kind"] == "auto"
    assert break_seg["selection"] is not None


def test_build_segments_handles_reordered_variant():
    """Variant reorders B and C → segments still appear in original order, but
    each variant choice is tagged with note='reordered'."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha. Beta. Gamma.",
        variants_struct=[
            [
                {"text": "Alpha-r.", "from_original": 0},
                {"text": "Gamma-r.", "from_original": 2},
                {"text": "Beta-r.", "from_original": 1},
            ],
        ],
    )
    assert len(segments) == 3
    # Segment 0 = Alpha (original index 0). Variant put it at v_pos 0 — no
    # reorder.
    assert segments[0]["choices"][1]["text"] == "Alpha-r."
    assert segments[0]["choices"][1]["note"] is None
    # Segment 1 = Beta (original index 1). Variant put it at v_pos 2 instead
    # of v_pos 1 — reorder detected.
    assert segments[1]["choices"][1]["text"] == "Beta-r."
    assert segments[1]["choices"][1]["note"] == "reordered"
    # Segment 2 = Gamma (original index 2). Variant put it at v_pos 1 instead
    # of v_pos 2 — reorder detected.
    assert segments[2]["choices"][1]["text"] == "Gamma-r."
    assert segments[2]["choices"][1]["note"] == "reordered"


def test_build_segments_marks_deleted_sentences_with_removed_note():
    """Variant drops original sentence 1 → that segment shows note='removed'."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha. Beta. Gamma.",
        variants_struct=[
            [
                {"text": "Alpha.", "from_original": 0},
                {"text": "Gamma.", "from_original": 2},
            ],
        ],
    )
    assert segments[1]["choices"][1]["text"] == ""
    assert segments[1]["choices"][1]["note"] == "removed"


def test_build_segments_marks_split_with_split_note():
    """Variant splits original sentence 0 into two → joined text + note='split'."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha and beta. Gamma.",
        variants_struct=[
            [
                {"text": "Alpha.", "from_original": 0},
                {"text": "Beta.", "from_original": 0},
                {"text": "Gamma.", "from_original": 1},
            ],
        ],
    )
    assert segments[0]["choices"][1]["text"] == "Alpha. Beta."
    assert segments[0]["choices"][1]["note"] == "split"


def test_build_segments_appends_addition_segments():
    """Variant adds a sentence with from_original=null at the tail of its list
    → addition segment lands after the last original-aligned segment."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha. Beta.",
        variants_struct=[
            [
                {"text": "Alpha.", "from_original": 0},
                {"text": "Beta.", "from_original": 1},
                {"text": "Brand new.", "from_original": None},
            ],
        ],
    )
    addition_segs = [s for s in segments if s["kind"] == "addition"]
    assert len(addition_segs) == 1
    add = addition_segs[0]
    assert len(add["choices"]) == 2
    assert add["choices"][0]["source"] == "original"
    assert add["choices"][0]["text"] == ""
    assert add["choices"][0]["note"] == "skip"
    assert add["choices"][1]["source"] == "variant_0"
    assert add["choices"][1]["text"] == "Brand new."
    assert add["choices"][1]["note"] == "added"
    assert add["selection"] == 0  # default to skip
    # Anchored after the last original sentence (Beta = index 1), so it sits
    # at the end of the segment list.
    assert add["position"] == segments[-1]["position"]


def test_build_segments_inserts_mid_paragraph_addition_at_anchor():
    """A variant addition between two mapped sentences must be slotted between
    them, not appended to the end."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha. Beta. Gamma.",
        variants_struct=[
            [
                {"text": "Alpha-r.", "from_original": 0},
                {"text": "MIDDLE-NEW.", "from_original": None},
                {"text": "Beta-r.", "from_original": 1},
                {"text": "Gamma-r.", "from_original": 2},
            ],
        ],
    )
    # Order: Alpha segment, addition, Beta segment, Gamma segment.
    kinds_and_text = [
        (s["kind"], s["choices"][0]["text"] or s["choices"][1]["text"])
        for s in segments
    ]
    assert kinds_and_text == [
        ("conflict", "Alpha."),
        ("addition", "MIDDLE-NEW."),
        ("conflict", "Beta."),
        ("conflict", "Gamma."),
    ]


def test_build_segments_inserts_leading_addition_before_first_sentence():
    """An addition before any mapped sentence in a variant lands at position 0."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha. Beta.",
        variants_struct=[
            [
                {"text": "OPENER.", "from_original": None},
                {"text": "Alpha-r.", "from_original": 0},
                {"text": "Beta-r.", "from_original": 1},
            ],
        ],
    )
    assert segments[0]["kind"] == "addition"
    assert segments[0]["choices"][1]["text"] == "OPENER."
    assert segments[1]["choices"][0]["text"] == "Alpha."


def test_build_segments_keeps_addition_inside_anchor_paragraph():
    """An addition anchored at a sentence followed by a paragraph break must
    sit BEFORE that paragraph break (so it stays in the same paragraph)."""
    from routes import _build_segments

    segments = _build_segments(
        original_text="Alpha.\n\nBeta.",
        variants_struct=[
            [
                {"text": "Alpha-r.", "from_original": 0},
                {"text": "EXTRA.", "from_original": None},
                {"text": "Beta-r.", "from_original": 1},
            ],
        ],
    )
    # Expected order: Alpha conflict, EXTRA addition, paragraph break, Beta.
    kinds = [s["kind"] for s in segments]
    assert kinds == ["conflict", "addition", "auto", "conflict"]
    # The auto segment is the paragraph break.
    assert segments[2]["choices"][0]["text"] == "\n\n"


def test_generate_auto_assigns_title_when_blank(client):
    s = _make_session(client, "x")
    assert not s["title"] or s["title"].startswith("x")  # fallback title set
    resp = client.post(f"/api/sessions/{s['id']}/generate").json()
    title = resp["session"]["title"]
    # Stub generator emits "<first 32 chars> (stub)" when no LLM is wired.
    # When a real LLM is wired we get a 3-6-word phrase. Either way, non-empty.
    assert isinstance(title, str) and title.strip() != ""


def test_select_segment(client):
    s = _make_session(client, "Hello.")
    sess = client.post(f"/api/sessions/{s['id']}/generate").json()["session"]
    conflict = next((seg for seg in sess["segments"] if seg["kind"] == "conflict"), None)
    assert conflict is not None, "Stub variants should differ from the original"
    resp = client.put(f"/api/segments/{conflict['id']}/select", json={"selection": 1})
    assert resp.status_code == 200
    assert resp.json()["segment"]["selection"] == 1


def test_select_segment_missing_returns_not_found(client):
    """Smoke-test contract: missing segment → 200 with status='not_found'."""
    resp = client.put("/api/segments/9999/select", json={"selection": 0})
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


def test_select_segment_clamps_invalid_index(client):
    s = _make_session(client, "Hello.")
    sess = client.post(f"/api/sessions/{s['id']}/generate").json()["session"]
    seg = sess["segments"][0]
    resp = client.put(f"/api/segments/{seg['id']}/select", json={"selection": 99})
    assert resp.status_code == 200
    assert resp.json()["segment"]["selection"] is None


def test_compile_with_no_user_picks_falls_back_to_original(client):
    s = _make_session(client, "Untouched paragraph one.\n\nUntouched paragraph two.")
    client.post(f"/api/sessions/{s['id']}/generate")
    resp = client.post(f"/api/sessions/{s['id']}/compile")
    assert resp.status_code == 200
    body = resp.json()
    # Conflict segments default to original-source (index 0); auto segments
    # also pick the first non-empty source. So the compiled result for an
    # un-clicked merge equals the original text.
    assert "Untouched paragraph one." in body["compiled"]
    assert "Untouched paragraph two." in body["compiled"]
    assert body["session"]["status"] == "compiled"


def test_compile_uses_variant_when_user_picks_one(client):
    s = _make_session(client, "Hello there.")
    sess = client.post(f"/api/sessions/{s['id']}/generate").json()["session"]
    conflict = next(seg for seg in sess["segments"] if seg["kind"] == "conflict")
    target_text = conflict["choices"][1]["text"]  # variant_0's text for that segment
    client.put(f"/api/segments/{conflict['id']}/select", json={"selection": 1})
    body = client.post(f"/api/sessions/{s['id']}/compile").json()
    assert target_text in body["compiled"]


def test_regenerate_clears_compiled_text_and_keeps_variants_ready(client):
    """After compile + regenerate, the compiled output is cleared and the
    session re-enters the merge-picking state."""
    s = _make_session(client, "Hello world.")
    first = client.post(f"/api/sessions/{s['id']}/generate").json()["session"]
    client.post(f"/api/sessions/{s['id']}/compile")  # produces compiled_text + status=compiled

    second = client.post(f"/api/sessions/{s['id']}/regenerate").json()["session"]
    assert second["status"] == "variants_ready"
    assert second["compiledText"] is None
    assert len(second["variants"]) == len(first["variants"]) > 0
    assert len(second["segments"]) > 0


def test_mode_validation(client):
    resp = client.post("/api/sessions", json={
        "original_text": "x", "mode": "bogus", "variant_count": 2,
    })
    assert resp.status_code == 422


def test_variant_count_bounds(client):
    too_low = client.post("/api/sessions", json={
        "original_text": "x", "mode": "improve", "variant_count": 1,
    })
    too_high = client.post("/api/sessions", json={
        "original_text": "x", "mode": "improve", "variant_count": 99,
    })
    assert too_low.status_code == 422
    assert too_high.status_code == 422


def test_summary_falls_back_to_input_when_no_title(client):
    """Sidebar should never show empty titles."""
    text = "This is the first sentence of the input."
    s = client.post("/api/sessions", json={
        "original_text": text, "mode": "improve", "variant_count": 2,
    }).json()
    summaries = client.get("/api/sessions").json()
    assert summaries[0]["title"]
    assert text[:20] in summaries[0]["title"]
