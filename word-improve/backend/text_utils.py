"""
Text splitting and word-level diff utilities for Word Improve.

Pure functions, no side effects. Tested in tests/test_text_utils.py.
"""

import re
from typing import List, Dict, Any, Tuple


# Sentinel string used as a paragraph-break unit when splitting text into the
# alignment-friendly "units" used by the merge view.
PARAGRAPH_BREAK = "\n\n"


def split_sentences_with_breaks(text: str) -> Tuple[List[str], List[bool]]:
    """Flatten text into a sentence list plus a paragraph-break marker.

    Returns ``(sentences, breaks_after)`` where:
      - ``sentences`` is the flat sentence list across all paragraphs
      - ``breaks_after[i]`` is True when a paragraph break follows sentence i

    Used as the source of truth for LLM alignment: we number these sentences
    0..N-1 and ask the LLM to return ``from_original`` indices into that range.
    """
    paragraphs = split_paragraphs(text)
    sentences: List[str] = []
    breaks_after: List[bool] = []
    for p_idx, para in enumerate(paragraphs):
        para_sents = split_sentences(para)
        last_para = (p_idx == len(paragraphs) - 1)
        for j, s in enumerate(para_sents):
            sentences.append(s)
            is_last_of_para = (j == len(para_sents) - 1)
            breaks_after.append(is_last_of_para and not last_para)
    return sentences, breaks_after


_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n+")
_SENTENCE_TERMINATORS = re.compile(r"(?<=[\.\!\?])\s+(?=[A-Z\"'\(\[])")
_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "etc", "e.g", "i.e", "vs", "fig"}


def split_paragraphs(text: str) -> List[str]:
    """Split a body of text into paragraphs by blank lines."""
    if not text:
        return []
    parts = _PARAGRAPH_SPLIT.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


def split_sentences(paragraph: str) -> List[str]:
    """Split a paragraph into sentences, taking care with common abbreviations."""
    if not paragraph or not paragraph.strip():
        return []
    raw = _SENTENCE_TERMINATORS.split(paragraph.strip())
    sentences: List[str] = []
    buffer = ""
    for part in raw:
        candidate = (buffer + " " + part).strip() if buffer else part.strip()
        if not candidate:
            continue
        last_word = re.findall(r"[A-Za-z\.]+", candidate)
        tail = last_word[-1].rstrip(".").lower() if last_word else ""
        if tail in _ABBREVIATIONS:
            buffer = candidate
            continue
        sentences.append(candidate)
        buffer = ""
    if buffer:
        sentences.append(buffer)
    return [s for s in sentences if s]


def split_into_units(text: str) -> List[str]:
    """Split text into alignment units for the git-style merge view.

    A unit is either a sentence (no surrounding whitespace) or the paragraph
    break sentinel ``PARAGRAPH_BREAK``. Concatenating units back via
    ``join_units`` reconstructs the text with paragraph breaks intact.

    The merge view aligns variants by index, so when the LLM preserves
    sentence and paragraph counts (as the prompt asks it to), units with the
    same index across variants describe the "same idea" and end up as one row
    in the merge view.
    """
    paragraphs = split_paragraphs(text)
    units: List[str] = []
    for i, para in enumerate(paragraphs):
        if i > 0:
            units.append(PARAGRAPH_BREAK)
        for sent in split_sentences(para):
            units.append(sent)
    return units


def join_units(units: List[str]) -> str:
    """Reconstruct text from a list of units (sentences and paragraph breaks)."""
    out: List[str] = []
    prev_was_break = True  # treat start of buffer as a "break"
    for u in units:
        if not u:
            continue
        if u == PARAGRAPH_BREAK or u == "\n":
            out.append(u)
            prev_was_break = True
        else:
            if not prev_was_break:
                out.append(" ")
            out.append(u)
            prev_was_break = False
    return "".join(out).strip()


_WORD_RE = re.compile(r"\S+|\s+")


def _tokenize_words(text: str) -> List[str]:
    """Tokenize keeping whitespace as its own tokens so we can rebuild faithfully."""
    return _WORD_RE.findall(text or "")


def word_diff(original: str, revised: str) -> List[Dict[str, Any]]:
    """Compute a word-level diff between two strings.

    Returns a list of segments, each with:
      - ``op``: one of "equal", "insert", "delete"
      - ``text``: the text of the segment

    Uses the standard LCS (longest common subsequence) algorithm on word
    tokens, ignoring whitespace tokens for matching but preserving them in the
    output. Whitespace is always emitted as ``equal``.
    """
    a_tokens = _tokenize_words(original)
    b_tokens = _tokenize_words(revised)

    a_words_idx = [i for i, t in enumerate(a_tokens) if not t.isspace()]
    b_words_idx = [i for i, t in enumerate(b_tokens) if not t.isspace()]
    a_words = [a_tokens[i] for i in a_words_idx]
    b_words = [b_tokens[i] for i in b_words_idx]

    n, m = len(a_words), len(b_words)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            if a_words[i] == b_words[j]:
                dp[i][j] = dp[i + 1][j + 1] + 1
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])

    pairs: List[tuple] = []
    i = j = 0
    while i < n and j < m:
        if a_words[i] == b_words[j]:
            pairs.append(("equal", a_words[i], a_words_idx[i], b_words_idx[j]))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            pairs.append(("delete", a_words[i], a_words_idx[i], None))
            i += 1
        else:
            pairs.append(("insert", b_words[j], None, b_words_idx[j]))
            j += 1
    while i < n:
        pairs.append(("delete", a_words[i], a_words_idx[i], None))
        i += 1
    while j < m:
        pairs.append(("insert", b_words[j], None, b_words_idx[j]))
        j += 1

    segments: List[Dict[str, Any]] = []
    a_cursor = 0
    b_cursor = 0

    def _flush_a_whitespace_to(target: int) -> None:
        nonlocal a_cursor
        while a_cursor < target and a_tokens[a_cursor].isspace():
            segments.append({"op": "equal", "text": a_tokens[a_cursor]})
            a_cursor += 1

    def _flush_b_whitespace_to(target: int) -> None:
        nonlocal b_cursor
        while b_cursor < target and b_tokens[b_cursor].isspace():
            b_cursor += 1

    for op, _word, a_idx, b_idx in pairs:
        if op == "equal":
            _flush_a_whitespace_to(a_idx)
            _flush_b_whitespace_to(b_idx)
            segments.append({"op": "equal", "text": a_tokens[a_idx]})
            a_cursor = a_idx + 1
            b_cursor = b_idx + 1
        elif op == "delete":
            _flush_a_whitespace_to(a_idx)
            segments.append({"op": "delete", "text": a_tokens[a_idx]})
            a_cursor = a_idx + 1
        else:
            _flush_b_whitespace_to(b_idx)
            if not segments or not segments[-1]["text"].endswith((" ", "\n", "\t")):
                segments.append({"op": "equal", "text": " "})
            segments.append({"op": "insert", "text": b_tokens[b_idx]})
            b_cursor = b_idx + 1

    while a_cursor < len(a_tokens):
        tok = a_tokens[a_cursor]
        segments.append({"op": "equal" if tok.isspace() else "delete", "text": tok})
        a_cursor += 1
    while b_cursor < len(b_tokens):
        tok = b_tokens[b_cursor]
        if tok.isspace():
            if not segments or segments[-1]["op"] != "equal":
                segments.append({"op": "equal", "text": tok})
            else:
                segments[-1]["text"] += tok
        else:
            segments.append({"op": "insert", "text": tok})
        b_cursor += 1

    merged: List[Dict[str, Any]] = []
    for seg in segments:
        if merged and merged[-1]["op"] == seg["op"]:
            merged[-1]["text"] += seg["text"]
        else:
            merged.append(dict(seg))
    return merged
