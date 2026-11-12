/// <reference path="../pb_data/types.d.ts" />
/**
 * Word Improve — the text engine the browser runs, ported for the agent ops.
 *
 * The UI does ALL of its domain work client-side in
 * frontend/src/app/services/apiAdapter.ts (sentence splitting, the generation
 * prompt, LLM-answer validation + stub fallback, git-style merge segments,
 * compile, word diff). The agent operations (agent_ops.pb.js) must produce the
 * exact same records, so every function here is a faithful port of the named
 * source function — same inputs, same outputs, same stored JSON shapes. Do not
 * "improve" anything here without changing apiAdapter.ts the same way.
 *
 * Pure JavaScript, no PocketBase globals: PocketBase require()s it from the
 * hooks, and node can require() it too (parity tests against apiAdapter.ts).
 *
 * The view helpers at the bottom port what MergeView.tsx / CompiledResult.tsx
 * compute for display (labels, numbering, picked counts, word counts).
 */

// ===========================================================================
// text_utils — apiAdapter.ts:101-305
// ===========================================================================

// apiAdapter.ts:101-104
const PARAGRAPH_BREAK = '\n\n';
const PARAGRAPH_SPLIT = /\n\s*\n+/;
// apiAdapter.ts:103 splits with /(?<=[.!?])\s+(?=[A-Z"'(\[])/. The look-behind
// is replaced by an equivalent scan (see splitOnTerminators): the separator is
// the whitespace run right after a terminator and before a capital/quote/bracket.
const TERMINATOR_GAP = /[.!?]\s+(?=[A-Z"'(\[])/g;
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'etc', 'e.g', 'i.e', 'vs', 'fig']);

/** Equivalent of `text.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)` without look-behind. */
function splitOnTerminators(text) {
  const out = [];
  const re = new RegExp(TERMINATOR_GAP.source, 'g');
  let start = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    // keep the terminator with the sentence; drop the whitespace run
    out.push(text.slice(start, m.index + 1));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out;
}

// apiAdapter.ts:106-113 splitParagraphs
function splitParagraphs(text) {
  if (!text) return [];
  return text
    .trim()
    .split(PARAGRAPH_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
}

// apiAdapter.ts:115-135 splitSentences
function splitSentences(paragraph) {
  if (!paragraph || !paragraph.trim()) return [];
  const raw = splitOnTerminators(paragraph.trim());
  const sentences = [];
  let buffer = '';
  for (const part of raw) {
    const candidate = buffer ? `${buffer} ${part}`.trim() : part.trim();
    if (!candidate) continue;
    const words = candidate.match(/[A-Za-z.]+/g) || [];
    const last = words.length ? words[words.length - 1] : '';
    const tail = last.replace(/\.+$/, '').toLowerCase();
    if (ABBREVIATIONS.has(tail)) {
      buffer = candidate;
      continue;
    }
    sentences.push(candidate);
    buffer = '';
  }
  if (buffer) sentences.push(buffer);
  return sentences.filter(Boolean);
}

// apiAdapter.ts:137-151 splitSentencesWithBreaks
function splitSentencesWithBreaks(text) {
  const paragraphs = splitParagraphs(text);
  const sentences = [];
  const breaksAfter = [];
  paragraphs.forEach((para, pIdx) => {
    const paraSents = splitSentences(para);
    const lastPara = pIdx === paragraphs.length - 1;
    paraSents.forEach((s, j) => {
      sentences.push(s);
      const isLastOfPara = j === paraSents.length - 1;
      breaksAfter.push(isLastOfPara && !lastPara);
    });
  });
  return { sentences: sentences, breaksAfter: breaksAfter };
}

// apiAdapter.ts:153-168 joinUnits
function joinUnits(units) {
  const out = [];
  let prevWasBreak = true;
  for (const u of units) {
    if (!u) continue;
    if (u === PARAGRAPH_BREAK || u === '\n') {
      out.push(u);
      prevWasBreak = true;
    } else {
      if (!prevWasBreak) out.push(' ');
      out.push(u);
      prevWasBreak = false;
    }
  }
  return out.join('').trim();
}

// apiAdapter.ts:170-172 tokenizeWords
function tokenizeWords(text) {
  return (text || '').match(/\S+|\s+/g) || [];
}

// apiAdapter.ts:174-176 isSpace
function isSpace(tok) {
  return tok.length > 0 && /^\s+$/.test(tok);
}

/** Word counts of the two texts, for sizing the diff table before running it. */
function diffCells(original, revised) {
  const a = tokenizeWords(original).filter((t) => !isSpace(t)).length;
  const b = tokenizeWords(revised).filter((t) => !isSpace(t)).length;
  return (a + 1) * (b + 1);
}

// apiAdapter.ts:183-305 wordDiff. Same LCS algorithm and output. Speed only:
// words are compared as integer codes (equal codes <=> equal words) and the DP
// table is one flat Int32Array — PocketBase's JS engine is far slower than V8.
function wordDiff(original, revised) {
  const aTokens = tokenizeWords(original);
  const bTokens = tokenizeWords(revised);

  const aWordsIdx = [];
  aTokens.forEach((t, i) => {
    if (!isSpace(t)) aWordsIdx.push(i);
  });
  const bWordsIdx = [];
  bTokens.forEach((t, i) => {
    if (!isSpace(t)) bWordsIdx.push(i);
  });
  const aWords = aWordsIdx.map((i) => aTokens[i]);
  const bWords = bWordsIdx.map((i) => bTokens[i]);

  const codes = new Map();
  const code = (w) => {
    let c = codes.get(w);
    if (c === undefined) {
      c = codes.size;
      codes.set(w, c);
    }
    return c;
  };
  const A = new Int32Array(aWords.map(code));
  const B = new Int32Array(bWords.map(code));

  const n = aWords.length;
  const m = bWords.length;
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    const ai = A[i];
    const row = i * W;
    const below = row + W;
    for (let j = m - 1; j >= 0; j--) {
      if (ai === B[j]) {
        dp[row + j] = dp[below + j + 1] + 1;
      } else {
        const down = dp[below + j];
        const right = dp[row + j + 1];
        dp[row + j] = down > right ? down : right;
      }
    }
  }

  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      pairs.push({ op: 'equal', aIdx: aWordsIdx[i], bIdx: bWordsIdx[j] });
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
      pairs.push({ op: 'delete', aIdx: aWordsIdx[i], bIdx: null });
      i++;
    } else {
      pairs.push({ op: 'insert', aIdx: null, bIdx: bWordsIdx[j] });
      j++;
    }
  }
  while (i < n) {
    pairs.push({ op: 'delete', aIdx: aWordsIdx[i], bIdx: null });
    i++;
  }
  while (j < m) {
    pairs.push({ op: 'insert', aIdx: null, bIdx: bWordsIdx[j] });
    j++;
  }

  const segments = [];
  let aCursor = 0;
  let bCursor = 0;

  const flushAWhitespaceTo = (target) => {
    while (aCursor < target && isSpace(aTokens[aCursor])) {
      segments.push({ op: 'equal', text: aTokens[aCursor] });
      aCursor++;
    }
  };
  const flushBWhitespaceTo = (target) => {
    while (bCursor < target && isSpace(bTokens[bCursor])) {
      bCursor++;
    }
  };

  for (const p of pairs) {
    if (p.op === 'equal') {
      flushAWhitespaceTo(p.aIdx);
      flushBWhitespaceTo(p.bIdx);
      segments.push({ op: 'equal', text: aTokens[p.aIdx] });
      aCursor = p.aIdx + 1;
      bCursor = p.bIdx + 1;
    } else if (p.op === 'delete') {
      flushAWhitespaceTo(p.aIdx);
      segments.push({ op: 'delete', text: aTokens[p.aIdx] });
      aCursor = p.aIdx + 1;
    } else {
      flushBWhitespaceTo(p.bIdx);
      const last = segments[segments.length - 1];
      if (!last || !/[ \n\t]$/.test(last.text)) {
        segments.push({ op: 'equal', text: ' ' });
      }
      segments.push({ op: 'insert', text: bTokens[p.bIdx] });
      bCursor = p.bIdx + 1;
    }
  }

  while (aCursor < aTokens.length) {
    const tok = aTokens[aCursor];
    segments.push({ op: isSpace(tok) ? 'equal' : 'delete', text: tok });
    aCursor++;
  }
  while (bCursor < bTokens.length) {
    const tok = bTokens[bCursor];
    if (isSpace(tok)) {
      const last = segments[segments.length - 1];
      if (!last || last.op !== 'equal') {
        segments.push({ op: 'equal', text: tok });
      } else {
        last.text += tok;
      }
    } else {
      segments.push({ op: 'insert', text: tok });
    }
    bCursor++;
  }

  const merged = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.op === seg.op) {
      last.text += seg.text;
    } else {
      merged.push({ op: seg.op, text: seg.text });
    }
  }
  return merged;
}

// ===========================================================================
// prompts — apiAdapter.ts:311-393
// ===========================================================================

// apiAdapter.ts:311-315 SYSTEM_PROMPT
const SYSTEM_PROMPT =
  'You are an expert prose editor. You produce multiple distinct, ' +
  'high-quality whole-text rewrites of a passage in a single response. You ' +
  'ALWAYS return valid JSON with no commentary, no markdown fences, and no ' +
  'extra keys.';

// apiAdapter.ts:317-393 sessionGenerationPrompt
function sessionGenerationPrompt(mode, sentences, count, tone, customInstruction, salt) {
  let instruction;
  if (mode === 'improve') {
    instruction =
      'Rewrite the source text to be clearer, more polished, and more ' +
      'engaging while preserving the original meaning and voice. You ' +
      'may reorder sentences if it improves fluency.';
  } else if (mode === 'tone_shift') {
    const toneLabel = (tone || 'Formal').trim() || 'Formal';
    instruction =
      `Rewrite the source text in a ${toneLabel.toLowerCase()} tone while ` +
      `preserving the meaning. Do not invent facts.`;
  } else if (mode === 'custom') {
    const ci = (customInstruction || '').trim() || 'Rewrite the source text.';
    instruction =
      'Apply the following user instruction to the source text. ' +
      'Preserve meaning unless the instruction explicitly asks ' +
      `otherwise.\n\nUSER INSTRUCTION: ${ci}`;
  } else {
    instruction =
      'Produce alternative phrasings of the source text, preserving ' +
      'meaning and tone.';
  }

  const saltLine = salt
    ? `\nThis is regeneration attempt #${salt}. Produce variants noticeably ` +
      `different from any obvious rewrite the model would emit on the ` +
      `first attempt — vary sentence openings, structure, and word choice ` +
      `across the variants.\n`
    : '';

  let numbered = sentences.map((s, i) => `[${i}] ${s}`).join('\n');
  if (!numbered) numbered = '(empty input)';

  return `${instruction}${saltLine}

You will produce ${count} variants. Each variant is a complete rewrite expressed
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
{
  "title": "<concise 3-6 word title summarising the source>",
  "variants": [
    {
      "sentences": [
        {"text": "<sentence>", "from_original": 0},
        {"text": "<sentence>", "from_original": null}
      ]
    }
  ]
}

The "variants" array must have length ${count}. Each entry's "sentences" array
must contain at least one sentence.

ORIGINAL SENTENCES (numbered 0 to ${Math.max(0, sentences.length - 1)}):
${numbered}
`;
}

// ===========================================================================
// LLM answer handling — apiAdapter.ts:399-475
// ===========================================================================

// apiAdapter.ts:399-411 parseJsonResponse
function parseJsonResponse(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    return null;
  }
}

// apiAdapter.ts:413-437 validateStructuredVariants
function validateStructuredVariants(rawVariants, sentenceCount) {
  if (!Array.isArray(rawVariants)) return [];
  const out = [];
  for (const rawV of rawVariants) {
    if (rawV == null || typeof rawV !== 'object') continue;
    const rawSents = rawV.sentences;
    if (!Array.isArray(rawSents)) continue;
    const sents = [];
    for (const rawS of rawSents) {
      if (rawS == null || typeof rawS !== 'object') continue;
      const text = String(rawS.text == null ? '' : rawS.text).trim();
      if (!text) continue;
      const foRaw = rawS.from_original;
      let fo;
      if (typeof foRaw === 'number' && Number.isInteger(foRaw) && foRaw >= 0 && foRaw < sentenceCount) {
        fo = foRaw;
      } else {
        fo = null;
      }
      sents.push({ text: text, from_original: fo });
    }
    if (sents.length) out.push(sents);
  }
  return out;
}

// apiAdapter.ts:439-461 stubStructuredVariants
function stubStructuredVariants(sentences, count, mode) {
  const labelByMode = {
    improve: 'stub rewrite',
    tone_shift: 'stub tone shift',
    custom: 'stub custom rewrite',
  };
  const label = Object.prototype.hasOwnProperty.call(labelByMode, mode) ? labelByMode[mode] : 'stub variant';
  const note = '(connect an AI agent for real output)';
  const variants = [];
  for (let i = 0; i < count; i++) {
    const sents = [];
    sentences.forEach((orig, j) => {
      const text = (orig || '').trim();
      if (!text) return;
      sents.push({ text: `${text} [${label} #${i + 1}] ${note}`, from_original: j });
    });
    if (!sents.length) {
      sents.push({ text: `[${label} #${i + 1}] ${note}`, from_original: null });
    }
    variants.push(sents);
  }
  return variants;
}

// apiAdapter.ts:463-467 stubTitle
function stubTitle(originalText) {
  const base = (originalText || '').trim();
  const fallback = base.split('\n', 1)[0].slice(0, 32).trim() || 'Untitled';
  return `${fallback} (stub)`;
}

// apiAdapter.ts:469-475 variantFullText
function variantFullText(variantSents) {
  return variantSents
    .filter((s) => s.text)
    .map((s) => s.text)
    .join(' ')
    .trim();
}

// ===========================================================================
// Merge segments — apiAdapter.ts:493-589
// ===========================================================================

// apiAdapter.ts:493-503 detectReorderNote
function detectReorderNote(variantSents, vPos, originalIndex) {
  let expected = 0;
  for (let jj = 0; jj < originalIndex; jj++) {
    if (variantSents.some((s) => s.from_original === jj)) expected++;
  }
  let actual = 0;
  for (let k = 0; k < vPos; k++) {
    if (typeof variantSents[k].from_original === 'number') actual++;
  }
  return expected !== actual ? 'reordered' : null;
}

// apiAdapter.ts:505-589 buildSegments. Object key order kept as the UI builds
// them ({kind, choices, selection, position}; choices {source, text, note}).
function buildSegments(originalText, variantsStruct) {
  const split = splitSentencesWithBreaks(originalText || '');
  const sentences = split.sentences;
  const breaksAfter = split.breaksAfter;
  const variantCount = variantsStruct.length;

  // Pass 1: collect additions keyed by anchor.
  const additionsByAnchor = new Map();
  variantsStruct.forEach((vSents, vIdx) => {
    let lastAnchor = -1;
    for (const s of vSents) {
      if (typeof s.from_original === 'number') {
        lastAnchor = s.from_original;
        continue;
      }
      const text = (s.text || '').trim();
      if (!text) continue;
      const list = additionsByAnchor.get(lastAnchor) || [];
      list.push({
        kind: 'addition',
        choices: [
          { source: 'original', text: '', note: 'skip' },
          { source: `variant_${vIdx}`, text: text, note: 'added' },
        ],
        selection: 0,
        position: 0,
      });
      additionsByAnchor.set(lastAnchor, list);
    }
  });

  // Pass 2: build aligned segments + breaks + interleaved additions.
  const segments = [];
  const emit = (seg) => {
    seg.position = segments.length;
    segments.push(seg);
  };

  for (const add of additionsByAnchor.get(-1) || []) emit(add);

  sentences.forEach((origSentence, iIdx) => {
    const choices = [{ source: 'original', text: origSentence, note: null }];
    variantsStruct.forEach((vSents, vIdx) => {
      const mappedIndices = [];
      vSents.forEach((s, j) => {
        if (s.from_original === iIdx) mappedIndices.push(j);
      });
      if (mappedIndices.length === 0) {
        choices.push({ source: `variant_${vIdx}`, text: '', note: 'removed' });
      } else if (mappedIndices.length === 1) {
        const vPos = mappedIndices[0];
        const text = vSents[vPos].text;
        const note = detectReorderNote(vSents, vPos, iIdx);
        choices.push({ source: `variant_${vIdx}`, text: text, note: note });
      } else {
        const joined = mappedIndices.map((k) => vSents[k].text).join(' ');
        choices.push({ source: `variant_${vIdx}`, text: joined, note: 'split' });
      }
    });

    const nonEmptyTexts = choices.filter((c) => c.text).map((c) => c.text);
    const allHaveText = choices.every((c) => c.text);
    let kind;
    let defaultSelection;
    if (allHaveText && new Set(nonEmptyTexts).size === 1) {
      kind = 'auto';
      defaultSelection = 0;
    } else {
      kind = 'conflict';
      defaultSelection = null;
    }

    emit({ kind: kind, choices: choices, selection: defaultSelection, position: 0 });

    for (const add of additionsByAnchor.get(iIdx) || []) emit(add);

    if (iIdx < breaksAfter.length && breaksAfter[iIdx]) {
      const brChoices = [{ source: 'original', text: PARAGRAPH_BREAK, note: null }];
      for (let vIdx = 0; vIdx < variantCount; vIdx++) {
        brChoices.push({ source: `variant_${vIdx}`, text: PARAGRAPH_BREAK, note: null });
      }
      emit({ kind: 'auto', choices: brChoices, selection: 0, position: 0 });
    }
  });

  return segments;
}

// ===========================================================================
// Generation core — apiAdapter.ts:745-801
// ===========================================================================

/**
 * apiAdapter.ts:745-777 generatePayload, with the LLM call injected. The UI
 * calls the LLM only when integrations.status says a bridge is configured;
 * here `callLLM` is always tried and an empty answer is treated exactly like
 * "no LLM" (stub title + stub variants), which is what the UI ends up with.
 * Returns the payload plus what the model contributed.
 */
function generatePayload(originalText, mode, tone, customInstruction, count, salt, callLLM) {
  const sentences = splitSentencesWithBreaks(originalText || '').sentences;

  let title = '';
  let variants = [];

  const prompt = sessionGenerationPrompt(mode, sentences, count, tone, customInstruction, salt);
  const raw = String(callLLM(SYSTEM_PROMPT, prompt) || '');
  const parsed = raw ? parseJsonResponse(raw) : null;
  if (parsed != null && typeof parsed === 'object') {
    title = String(parsed.title == null ? '' : parsed.title).trim();
    variants = validateStructuredVariants(parsed.variants, sentences.length);
  }
  const modelVariants = Math.min(variants.length, count);

  if (!title) title = stubTitle(originalText);
  if (variants.length < count) {
    const stub = stubStructuredVariants(sentences, count, mode);
    variants = variants.concat(stub).slice(0, count);
  } else {
    variants = variants.slice(0, count);
  }
  return {
    title: title,
    variants: variants,
    llm: { answered: raw !== '', usable: parsed != null && typeof parsed === 'object', modelVariants: modelVariants },
  };
}

/**
 * apiAdapter.ts:779-801 applyGeneration, minus the PATCH: the fields the UI
 * writes for a fresh generation. `currentTitle` is the session's title.
 */
function generationUpdate(originalText, payload, currentTitle) {
  const variants = payload.variants.map((vSents, i) => ({ idx: i, text: variantFullText(vSents) }));
  const segments = buildSegments(originalText, payload.variants);
  const update = { variants: variants, segments: segments, status: 'variants_ready' };
  // Only set the auto title when the session doesn't already have one.
  if (payload.title && !String(currentTitle == null ? '' : currentTitle)) {
    update.title = payload.title.slice(0, 255);
  }
  return update;
}

// ===========================================================================
// Record shapes — apiAdapter.ts:87-95, 684-739
// ===========================================================================

// apiAdapter.ts:87-95 toIso
function toIso(v) {
  if (v == null || v === '') return null;
  try {
    const d = new Date(String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch (_e) {
    return null;
  }
}

// apiAdapter.ts:684-689 fallbackTitle
function fallbackTitle(id, originalText) {
  const text = (originalText || '').trim();
  if (!text) return `Untitled session #${id}`;
  const first = text.split('\n', 1)[0].trim();
  return first.length > 48 ? `${first.slice(0, 48)}…` : first;
}

// apiAdapter.ts:691-704 toSummary (rec = plain field dict of a sessions record)
function toSummary(rec) {
  const id = String(rec.id);
  const title = String(rec.title == null ? '' : rec.title);
  return {
    id: id,
    title: title || fallbackTitle(id, String(rec.original_text == null ? '' : rec.original_text)),
    mode: String(rec.mode == null ? '' : rec.mode) || 'improve',
    tone: rec.tone ? String(rec.tone) : null,
    variantCount: Number(rec.variant_count == null ? 0 : rec.variant_count) || 3,
    status: String(rec.status == null ? '' : rec.status) || 'draft',
    createdAt: toIso(rec.created),
    updatedAt: toIso(rec.updated),
  };
}

// apiAdapter.ts:717-728 storedSegments (without the synthetic ids)
function storedSegments(rawSegments) {
  const arr = Array.isArray(rawSegments) ? rawSegments : [];
  return arr.map((s, pos) => ({
    index: pos,
    position: Number(s.position == null ? pos : s.position),
    kind: String(s.kind == null ? 'conflict' : s.kind),
    choices: Array.isArray(s.choices) ? s.choices : [],
    selection: s.selection == null ? null : Number(s.selection),
  }));
}

// apiAdapter.ts:872-881 (handleCompile): the compiled text of the stored segments.
function compileSegments(rawSegments) {
  const segs = storedSegments(rawSegments)
    .slice()
    .sort((a, b) => Number(a.position) - Number(b.position));
  const units = [];
  for (const seg of segs) {
    const choices = Array.isArray(seg.choices) ? seg.choices : [];
    let sel = seg.selection == null ? null : Number(seg.selection);
    if (sel == null || sel < 0 || sel >= choices.length) sel = 0;
    const choice = choices.length ? choices[sel] : null;
    const text = choices.length ? String(choice && choice.text != null ? choice.text : '') : '';
    if (text) units.push(text);
  }
  return joinUnits(units);
}

/** apiAdapter.ts:904-913 (handleSelectSegment): the selection value it stores. */
function clampSelection(rawSel, choicesLength) {
  if (rawSel == null) return null;
  const sel = Number(rawSel);
  return sel >= 0 && sel < choicesLength ? sel : null;
}

// ===========================================================================
// What the screens show — MergeView.tsx / CompiledResult.tsx / SessionList.tsx
// ===========================================================================

// MergeView.tsx:15-17 isParagraphBreakSegment
function isParagraphBreakSegment(seg) {
  return seg.choices.some((c) => c && c.text === PARAGRAPH_BREAK);
}

// MergeView.tsx:19-24 variantLabel
function variantLabel(source, fallbackIdx) {
  if (source === 'original') return 'Original';
  const m = /^variant_(\d+)$/.exec(source);
  if (m) return `Variant ${String.fromCharCode(65 + Number(m[1]))}`;
  return `Choice ${fallbackIdx + 1}`;
}

/** The key an agent uses for a choice: 'original', the variant letter, or the index. */
function choiceKey(source, idx) {
  if (source === 'original') return 'original';
  const m = /^variant_(\d+)$/.exec(source);
  if (m) return String.fromCharCode(65 + Number(m[1]));
  return String(idx);
}

// MergeView.tsx:26-35 noteLabel
function noteLabel(note) {
  switch (note) {
    case 'reordered':
      return 'reordered';
    case 'split':
      return 'merged from multiple';
    case 'removed':
      return 'remove this sentence';
    case 'added':
      return 'new content';
    case 'skip':
      return 'skip';
    default:
      return null;
  }
}

// MergeView.tsx:37-40 isResolved
function isResolved(seg) {
  if (seg.kind === 'auto') return true;
  return seg.selection !== null && seg.selection >= 0 && seg.selection < seg.choices.length;
}

// MergeView.tsx:292-307 — a card is disabled when empty unless removed/skip.
function isPickable(choice) {
  const isEmpty = !(choice && choice.text);
  const isAcceptableEmpty = !!choice && (choice.note === 'removed' || choice.note === 'skip');
  return !(isEmpty && !isAcceptableEmpty);
}

/** SessionList.tsx:314-319 status label. */
function statusLabel(status, variantCount) {
  if (status === 'compiled') return 'compiled';
  if (status === 'variants_ready') return `${variantCount} variants ready`;
  return 'draft';
}

/**
 * The merge view as MergeView.tsx renders it (:47-58, :98-125, :169-171,
 * :197-238, :391-397): segments in position order, conflicts numbered #1..,
 * additions +1.., paragraph breaks as gaps, plus the header stats (:67-79).
 * `index` is the segment's place in the stored array — what sessions.pick takes.
 */
function mergeView(rawSegments) {
  const segments = storedSegments(rawSegments)
    .slice()
    .sort((a, b) => a.position - b.position);
  const conflicts = segments.filter((s) => s.kind === 'conflict');
  const resolved = conflicts.filter(isResolved).length;

  let conflictNumber = 0;
  let additionNumber = 0;
  const out = [];
  for (const seg of segments) {
    if (isParagraphBreakSegment(seg)) {
      out.push({ position: seg.index, kind: 'break' });
      continue;
    }
    if (seg.kind === 'auto') {
      const idx = seg.selection == null ? 0 : seg.selection;
      const picked = seg.choices[idx];
      const first = seg.choices[0];
      out.push({ position: seg.index, kind: 'auto', text: (picked && picked.text) || (first && first.text) || '' });
      continue;
    }
    if (seg.kind === 'addition') {
      additionNumber += 1;
      const includeChoice = seg.choices[1];
      out.push({
        position: seg.index,
        kind: 'addition',
        number: additionNumber,
        label: `${variantLabel((includeChoice && includeChoice.source) || '', 1)} adds`,
        text: (includeChoice && includeChoice.text) || '',
        included: seg.selection === 1,
      });
      continue;
    }
    conflictNumber += 1;
    const sel = seg.selection;
    out.push({
      position: seg.index,
      kind: 'conflict',
      number: conflictNumber,
      picked: sel !== null,
      selected: sel !== null && seg.choices[sel] ? choiceKey(seg.choices[sel].source, sel) : null,
      choices: seg.choices.map((c, idx) => ({
        choice: choiceKey(c && c.source, idx),
        label: variantLabel(c && c.source, idx),
        text: (c && c.text) || '',
        note: noteLabel(c && c.note),
        pickable: isPickable(c),
      })),
    });
  }
  return {
    stats: {
      sentences: segments.length,
      conflicts: conflicts.length,
      picked: resolved,
      to_go: conflicts.length - resolved,
    },
    segments: out,
  };
}

/** CompiledResult.tsx:55-61 — words added/removed and the "no changes" hint. */
function diffStats(diff) {
  const words = (s) => s.text.trim().split(/\s+/).filter(Boolean).length;
  const wordsAdded = diff.filter((s) => s.op === 'insert').reduce((acc, s) => acc + words(s), 0);
  const wordsRemoved = diff.filter((s) => s.op === 'delete').reduce((acc, s) => acc + words(s), 0);
  const noChanges = diff.length > 0 && diff.every((s) => s.op === 'equal');
  return { wordsAdded: wordsAdded, wordsRemoved: wordsRemoved, noChanges: noChanges };
}

module.exports = {
  PARAGRAPH_BREAK: PARAGRAPH_BREAK,
  SYSTEM_PROMPT: SYSTEM_PROMPT,
  splitParagraphs: splitParagraphs,
  splitSentences: splitSentences,
  splitSentencesWithBreaks: splitSentencesWithBreaks,
  joinUnits: joinUnits,
  tokenizeWords: tokenizeWords,
  diffCells: diffCells,
  wordDiff: wordDiff,
  sessionGenerationPrompt: sessionGenerationPrompt,
  parseJsonResponse: parseJsonResponse,
  validateStructuredVariants: validateStructuredVariants,
  stubStructuredVariants: stubStructuredVariants,
  stubTitle: stubTitle,
  variantFullText: variantFullText,
  detectReorderNote: detectReorderNote,
  buildSegments: buildSegments,
  generatePayload: generatePayload,
  generationUpdate: generationUpdate,
  toIso: toIso,
  fallbackTitle: fallbackTitle,
  toSummary: toSummary,
  storedSegments: storedSegments,
  compileSegments: compileSegments,
  clampSelection: clampSelection,
  isParagraphBreakSegment: isParagraphBreakSegment,
  variantLabel: variantLabel,
  choiceKey: choiceKey,
  noteLabel: noteLabel,
  isResolved: isResolved,
  isPickable: isPickable,
  statusLabel: statusLabel,
  mergeView: mergeView,
  diffStats: diffStats,
};
