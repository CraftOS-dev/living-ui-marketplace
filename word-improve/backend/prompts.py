"""
Prompt templates for Word Improve.

A single LLM call produces all N whole-text variants AND a short title. Each
variant is returned as a list of sentences, where each sentence carries a
``from_original`` field pointing back to the index of the original sentence it
expresses (or ``null`` for newly added content). The backend uses those
mappings to align variants with the original even when sentences are
reordered, merged, split, deleted, or new content is inserted.
"""

from typing import List, Optional


SYSTEM_PROMPT = (
    "You are an expert prose editor. You produce multiple distinct, "
    "high-quality whole-text rewrites of a passage in a single response. You "
    "ALWAYS return valid JSON with no commentary, no markdown fences, and no "
    "extra keys."
)


def session_generation_prompt(
    mode: str,
    sentences: List[str],
    count: int,
    tone: Optional[str] = None,
    custom_instruction: Optional[str] = None,
    salt: int = 0,
) -> str:
    """Build a prompt that asks for ``count`` aligned variants + a title.

    ``sentences`` is the source split into numbered sentences (0..N-1). Each
    variant returns its own sentence list; each sentence carries a
    ``from_original`` index into ``sentences`` (or ``null`` when newly added).
    """

    if mode == "improve":
        instruction = (
            "Rewrite the source text to be clearer, more polished, and more "
            "engaging while preserving the original meaning and voice. You "
            "may reorder sentences if it improves fluency."
        )
    elif mode == "tone_shift":
        tone_label = (tone or "Formal").strip() or "Formal"
        instruction = (
            f"Rewrite the source text in a {tone_label.lower()} tone while "
            f"preserving the meaning. Do not invent facts."
        )
    elif mode == "custom":
        ci = (custom_instruction or "").strip() or "Rewrite the source text."
        instruction = (
            "Apply the following user instruction to the source text. "
            "Preserve meaning unless the instruction explicitly asks "
            f"otherwise.\n\nUSER INSTRUCTION: {ci}"
        )
    else:
        instruction = (
            "Produce alternative phrasings of the source text, preserving "
            "meaning and tone."
        )

    salt_line = (
        f"\nThis is regeneration attempt #{salt}. Produce variants noticeably "
        f"different from any obvious rewrite the model would emit on the "
        f"first attempt — vary sentence openings, structure, and word choice "
        f"across the variants.\n"
        if salt else ""
    )

    numbered = "\n".join(f"[{i}] {s}" for i, s in enumerate(sentences))
    if not numbered:
        numbered = "(empty input)"

    return f"""{instruction}{salt_line}

You will produce {count} variants. Each variant is a complete rewrite expressed
as a list of sentences. For each variant sentence, set "from_original" to the
0-based index of the original sentence it expresses, or null when the sentence
is new content not present in the source.

Use from_original to express structural changes:
- Reorder: same indices in different positions.
- Split one original sentence into two: BOTH variant sentences carry the same
  from_original index.
- Merge two original sentences into one: pick the index of the more prominent
  source sentence; do not include the other index.
- Delete an original sentence: omit any variant sentence pointing at it.
- Add new content: from_original = null.

Return EXACTLY this JSON shape (no other keys, no markdown fences):
{{
  "title": "<concise 3-6 word title summarising the source>",
  "variants": [
    {{
      "sentences": [
        {{"text": "<sentence>", "from_original": 0}},
        {{"text": "<sentence>", "from_original": null}}
      ]
    }}
  ]
}}

The "variants" array must have length {count}. Each entry's "sentences" array
must contain at least one sentence.

ORIGINAL SENTENCES (numbered 0 to {max(0, len(sentences) - 1)}):
{numbered}
"""
