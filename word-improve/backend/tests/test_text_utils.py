"""Tests for the text-splitting and word-diff helpers."""

from text_utils import (
    PARAGRAPH_BREAK,
    join_units,
    split_into_units,
    split_paragraphs,
    split_sentences,
    word_diff,
)


def test_split_into_units_preserves_paragraph_breaks():
    text = "First sentence. Second sentence.\n\nThird sentence."
    units = split_into_units(text)
    assert units == [
        "First sentence.",
        "Second sentence.",
        PARAGRAPH_BREAK,
        "Third sentence.",
    ]


def test_join_units_round_trips_simple_text():
    text = "Hello world. Goodbye world."
    units = split_into_units(text)
    assert join_units(units) == text


def test_join_units_round_trips_with_paragraphs():
    text = "Para one. Still one.\n\nPara two."
    units = split_into_units(text)
    assert join_units(units) == text


def test_join_units_skips_empty_choices():
    """When the user's pick is an empty string the joiner should drop it."""
    units = ["First.", "", "Second."]
    assert join_units(units) == "First. Second."


def test_split_paragraphs_basic():
    text = "First para.\n\nSecond para.\n\n\nThird para."
    assert split_paragraphs(text) == ["First para.", "Second para.", "Third para."]


def test_split_paragraphs_empty():
    assert split_paragraphs("") == []
    assert split_paragraphs("   \n\n   ") == []


def test_split_paragraphs_single():
    assert split_paragraphs("Just one") == ["Just one"]


def test_split_sentences_basic():
    para = "Hello world. This is the second sentence! And a third? Yes."
    sentences = split_sentences(para)
    assert sentences == [
        "Hello world.",
        "This is the second sentence!",
        "And a third?",
        "Yes.",
    ]


def test_split_sentences_handles_abbreviations():
    para = "Dr. Smith met Mr. Brown at 8 a.m. They had coffee."
    sentences = split_sentences(para)
    assert sentences[-1] == "They had coffee."
    assert any("Dr. Smith" in s for s in sentences)


def test_split_sentences_empty():
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_word_diff_equal():
    diff = word_diff("hello world", "hello world")
    assert all(seg["op"] == "equal" for seg in diff)
    assert "".join(seg["text"] for seg in diff) == "hello world"


def test_word_diff_insert():
    diff = word_diff("hello", "hello world")
    ops = {seg["op"] for seg in diff}
    assert "insert" in ops
    assert any(seg["op"] == "insert" and "world" in seg["text"] for seg in diff)


def test_word_diff_delete():
    diff = word_diff("hello cruel world", "hello world")
    assert any(seg["op"] == "delete" and "cruel" in seg["text"] for seg in diff)


def test_word_diff_replace():
    diff = word_diff("the cat sat", "the dog sat")
    has_insert = any(seg["op"] == "insert" and "dog" in seg["text"] for seg in diff)
    has_delete = any(seg["op"] == "delete" and "cat" in seg["text"] for seg in diff)
    assert has_insert and has_delete
