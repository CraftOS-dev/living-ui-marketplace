/// <reference path="../pb_data/types.d.ts" />
/**
 * Word Improve — the agent operations (routes in agent_ops.pb.js).
 *
 * Each operation does what a person does in the UI, with the same writes the
 * UI's fetch shim (frontend/src/app/services/apiAdapter.ts) makes to the
 * `sessions` collection and the same validation the screens apply. The text
 * work is the ported engine in lib_agent_text.js; the LLM call is the one the
 * app already uses (_craftbot_bridge.callLLM, as in ops.pb.js ai.generate).
 *
 * Errors answer `{ error }` with a 4xx status, like the existing ops.pb.js
 * routes. PocketBase JSVM: shared modules are require()d inside functions,
 * query results are copied with Array.from() before any array method.
 */

const MODES = ['improve', 'tone_shift', 'custom']; // SessionInput.tsx:32-41
const TONES = ['Formal', 'Casual', 'Persuasive', 'Concise', 'Friendly', 'Academic']; // types.ts TONES
const MIN_VARIANTS = 2; // SessionInput.tsx:157 — the select offers 2, 3, 4, 5
const MAX_VARIANTS = 5;
const LIST_LIMIT = 500; // apiAdapter.ts:808 perPage=500
/**
 * The server-side word diff is O(words x words) and PocketBase's JS engine
 * manages roughly 0.3-1 M table cells a second; above this many cells
 * (about 1,200 x 1,200 words) the diff is skipped and only the text returned.
 */
const MAX_DIFF_CELLS = 1500000;
const NO_MODEL_MESSAGE =
  'No model answered (no LLM bridge is connected to the app), so the variants are placeholder stubs — ' +
  'the same stubs the app shows a person without an LLM. Do not pick them as real rewrites; tell the person.';

/** The marker the app's own placeholder variants carry (lib_agent_text.js stubVariants). */
// The current note, and the one sessions saved before it changed still carry.
const STUB_MARKERS = ['(connect an AI agent for real output)', '(configure CraftBot LLM provider for real output)'];

/** How many of a stored session's variants are placeholder stubs (so a later
 *  read still says so — the create/regenerate result is not the only warning). */
function placeholderCount(d) {
  const vs = Array.isArray(d && d.variants) ? d.variants : [];
  let n = 0;
  for (let i = 0; i < vs.length; i++) {
    const t = JSON.stringify(vs[i]);
    if (STUB_MARKERS.some((m) => t.indexOf(m) >= 0)) n++;
  }
  return n;
}

/** Adds the placeholder warning to a read result when the session holds stubs. */
function withPlaceholderNote(out, d) {
  const n = placeholderCount(d);
  if (n > 0) {
    out.placeholder_variants = n;
    out.warning = NO_MODEL_MESSAGE;
  }
  return out;
}

function text() {
  return require(`${__hooks}/lib_agent_text.js`);
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Run an operation: params from the JSON body (query string as fallback),
 * 200 with the result, or `{ error }` with the failure's status.
 */
function handle(e, fn) {
  let params = {};
  try {
    const info = e.requestInfo();
    const query = info.query || {};
    for (const k of Object.keys(query)) params[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) params[k] = body[k];
  } catch (_e) {
    params = {};
  }
  try {
    return e.json(200, fn(params, e.app));
  } catch (err) {
    if (err && typeof err.status === 'number') return e.json(err.status, { error: String(err.message) });
    console.error('[word-improve] agent op failed:', err);
    return e.json(500, { error: String((err && err.message) || err) });
  }
}

// --------------------------------------------------------------- params

function has(p, name) {
  return p[name] !== undefined && p[name] !== null && p[name] !== '';
}

function str(p, name) {
  return has(p, name) ? String(p[name]) : '';
}

function sessionIdParam(p) {
  const id = str(p, 'session_id').trim();
  if (!id) throw fail(400, 'session_id is required (an id from sessions.list)');
  return id;
}

function intParam(value, name) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) throw fail(400, `${name} must be a whole number`);
  return n;
}

// --------------------------------------------------------------- records

function findSession(app, id) {
  try {
    return app.findRecordById('sessions', id);
  } catch (_e) {
    throw fail(404, 'Session not found');
  }
}

function readJson(rec, field) {
  try {
    return JSON.parse(rec.getString(field) || 'null');
  } catch (_e) {
    return null;
  }
}

/** A sessions record as the plain dict the UI's shim sees from the record API. */
function dict(rec) {
  return {
    id: rec.id,
    title: rec.getString('title'),
    original_text: rec.getString('original_text'),
    mode: rec.getString('mode'),
    tone: rec.getString('tone'),
    custom_instruction: rec.getString('custom_instruction'),
    variant_count: rec.getFloat('variant_count'),
    compiled_text: rec.getString('compiled_text'),
    status: rec.getString('status'),
    variants: readJson(rec, 'variants'),
    segments: readJson(rec, 'segments'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

/** The session as the screens show it (header, merge view, live compiled text). */
function sessionView(d) {
  const T = text();
  const s = T.toSummary(d); // apiAdapter.ts:691-704 + toDetail :730-739
  const merge = T.mergeView(d.segments);
  return {
    id: s.id,
    title: s.title,
    mode: s.mode,
    mode_label: s.mode.replace('_', ' '), // MainView.tsx:155
    tone: s.tone,
    variant_count: s.variantCount,
    status: s.status,
    created: s.createdAt,
    updated: s.updatedAt,
    original_text: d.original_text || '',
    custom_instruction: d.custom_instruction ? String(d.custom_instruction) : null,
    stats: merge.stats,
    segments: merge.segments,
    // What the result panel shows (apiAdapter.ts:872-881) — computed, not stored.
    compiled_text: merge.segments.length ? T.compileSegments(d.segments) : null,
  };
}

/** The `llm` block of create/regenerate: what the model contributed. */
function llmReport(info, count) {
  const out = {
    answered: info.answered,
    model_variants: info.modelVariants,
    stub_variants: count - info.modelVariants,
  };
  if (!info.answered) out.message = NO_MODEL_MESSAGE;
  else if (out.stub_variants > 0) {
    out.message = `The model's answer gave ${info.modelVariants} usable variant(s); the rest are placeholder stubs, as the app shows them.`;
  }
  return out;
}

/**
 * apiAdapter.ts:851-866 handleGenerate + :779-801 applyGeneration, then the
 * silent compile the controller runs after it (AppController.ts:136-144,
 * :214-222 -> apiAdapter.ts:868-891). `salt` 0 = first generation,
 * > 0 = regenerate (clears the compiled text first, adds the salt line).
 * The LLM call happens outside any transaction; the record is re-read after it.
 */
function generate(app, id, salt) {
  const T = text();
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);

  let rec = findSession(app, id);
  if (salt > 0) {
    // regenerate clears any previous compiled output (apiAdapter.ts:855-858).
    rec.set('compiled_text', '');
    app.save(rec);
  }
  const d = dict(rec);
  const originalText = String(d.original_text || '');
  const mode = String(d.mode || '') || 'improve';
  const tone = d.tone ? String(d.tone) : null;
  const customInstruction = d.custom_instruction ? String(d.custom_instruction) : null;
  const count = Number(d.variant_count || 0) || 3;

  const payload = T.generatePayload(originalText, mode, tone, customInstruction, count, salt, (system, prompt) =>
    bridge.callLLM(prompt, system),
  );

  // The LLM may have taken minutes: write onto the current record.
  try {
    rec = app.findRecordById('sessions', id);
  } catch (_e) {
    throw fail(404, 'Session was deleted while the variants were being written');
  }
  const update = T.generationUpdate(originalText, payload, rec.getString('title'));
  rec.set('variants', update.variants);
  rec.set('segments', update.segments);
  rec.set('status', update.status);
  if (update.title !== undefined) rec.set('title', update.title);
  if (update.segments.length > 0) {
    rec.set('compiled_text', T.compileSegments(update.segments));
    rec.set('status', 'compiled');
  }
  app.save(rec);

  return { session: sessionView(dict(rec)), llm: llmReport(payload.llm, count) };
}

// --------------------------------------------------------------- operations

/** sessions.list — the sidebar (AppController.ts:110-117, apiAdapter.ts:807-810, SessionList.tsx:312-339). */
function listSessions(app) {
  const T = text();
  const rows = Array.from(app.findRecordsByFilter('sessions', "id != ''", '-updated', LIST_LIMIT, 0));
  return {
    sessions: rows.map((rec) => {
      const d = dict(rec);
      const s = T.toSummary(d);
      const stubs = placeholderCount(d);
      const row = {
        id: s.id,
        title: s.title,
        status: s.status,
        status_label: T.statusLabel(s.status, s.variantCount),
        mode: s.mode,
        mode_label: s.mode.replace('_', ' '),
        tone: s.tone,
        variant_count: s.variantCount,
        created: s.createdAt,
        updated: s.updatedAt,
      };
      if (stubs > 0) row.placeholder_variants = stubs;
      return row;
    }),
  };
}

/** sessions.get — open a session (AppController.ts:158-172), read-only. */
function getSession(app, p) {
  const d = dict(findSession(app, sessionIdParam(p)));
  return withPlaceholderNote(sessionView(d), d);
}

/** sessions.result — the compiled-result panel (apiAdapter.ts:868-891, CompiledResult.tsx:55-107). */
function sessionResult(app, p) {
  const T = text();
  const id = sessionIdParam(p);
  const d = dict(findSession(app, id));
  const segs = Array.isArray(d.segments) ? d.segments : [];
  if (segs.length === 0) {
    // MainView.tsx:207-221 — a draft has no result panel.
    throw fail(409, 'This session has no variants yet; run sessions.regenerate to write them');
  }
  const compiled = T.compileSegments(segs);
  const original = String(d.original_text || '');
  const out = withPlaceholderNote({ session_id: id, compiled_text: compiled }, d);
  if (T.diffCells(original, compiled) > MAX_DIFF_CELLS) {
    out.diff = null;
    out.diff_skipped = 'The text is too long for a server-side word diff; compiled_text is complete.';
    return out;
  }
  const diff = T.wordDiff(original, compiled);
  const st = T.diffStats(diff);
  out.words_added = st.wordsAdded;
  out.words_removed = st.wordsRemoved;
  out.no_changes = st.noChanges;
  out.diff = diff;
  return out;
}

/**
 * sessions.create — the new-session form (SessionInput.tsx:57-78) and
 * AppController.createAndGenerate (:123-156): create the draft exactly as
 * apiAdapter.ts:812-827 does, generate (salt 0), then compile.
 */
function createSession(app, p) {
  const textIn = has(p, 'text') ? String(p.text) : '';
  if (!textIn.trim()) throw fail(400, 'text is required'); // SessionInput.tsx:58-61

  const mode = has(p, 'mode') ? String(p.mode).trim() : 'improve';
  if (MODES.indexOf(mode) < 0) throw fail(400, `mode must be one of ${MODES.join(', ')}`);

  let tone = '';
  if (has(p, 'tone')) {
    if (mode !== 'tone_shift') throw fail(400, 'tone applies only to mode tone_shift');
    const want = String(p.tone).trim().toLowerCase();
    tone = TONES.filter((t) => t.toLowerCase() === want)[0] || '';
    if (!tone) throw fail(400, `tone must be one of ${TONES.join(', ')}`);
  } else if (mode === 'tone_shift') {
    tone = 'Formal'; // SessionInput.tsx:46 default
  }

  let instruction = '';
  if (has(p, 'instruction')) {
    if (mode !== 'custom') throw fail(400, 'instruction applies only to mode custom');
    instruction = String(p.instruction);
  }
  if (mode === 'custom' && !instruction.trim()) {
    throw fail(400, 'custom mode needs an instruction'); // SessionInput.tsx:62-65
  }

  let variants = 3; // SessionInput.tsx:48 default
  if (has(p, 'variants')) {
    variants = intParam(p.variants, 'variants');
    if (variants < MIN_VARIANTS || variants > MAX_VARIANTS) {
      throw fail(400, `variants must be ${MIN_VARIANTS} to ${MAX_VARIANTS}`);
    }
  }

  // apiAdapter.ts:812-827 handleCreateSession (the form sends no title; tone /
  // instruction are null for the other modes and stored as '').
  const rec = new Record(app.findCollectionByNameOrId('sessions'));
  rec.set('title', '');
  rec.set('original_text', textIn);
  rec.set('mode', mode);
  rec.set('tone', mode === 'tone_shift' ? tone : '');
  rec.set('custom_instruction', mode === 'custom' ? instruction : '');
  rec.set('variant_count', variants);
  rec.set('status', 'draft');
  rec.set('variants', []);
  rec.set('segments', []);
  app.save(rec);

  return generate(app, rec.id, 0);
}

/** sessions.regenerate — "Regenerate" / "Generate variants" (AppController.ts:204-230, apiAdapter.ts:951-953). */
function regenerateSession(app, p) {
  const id = sessionIdParam(p);
  findSession(app, id);
  return generate(app, id, (Date.now() % 997) + 1);
}

/**
 * Resolve one requested pick against a stored segment: the selection value the
 * UI would store (MergeView.tsx:232-235 conflict cards, :407-422 Skip/Include).
 */
function resolvePick(T, segs, rawPos, rawChoice) {
  if (rawPos === undefined || rawPos === null || rawPos === '') throw fail(400, 'position is required');
  const position = intParam(rawPos, 'position');
  if (position < 0 || position >= segs.length) {
    throw fail(400, `position must be 0 to ${segs.length - 1} (positions are listed by sessions.get)`);
  }
  const seg = T.storedSegments(segs)[position];
  const choice = String(rawChoice == null ? '' : rawChoice).trim();
  if (!choice) throw fail(400, `choice is required for position ${position}`);
  const key = choice.toLowerCase();

  if (seg.kind === 'addition') {
    // Addition rows: Skip = 0, Include = 1 (MergeView.tsx:407-422).
    if (key === 'skip') return { position: position, selection: 0, choice: 'skip' };
    if (key === 'include') return { position: position, selection: 1, choice: 'include' };
    throw fail(400, `position ${position} is an addition: choice must be include or skip`);
  }
  if (seg.kind !== 'conflict' || T.isParagraphBreakSegment(seg)) {
    throw fail(409, `position ${position} is text every variant agrees on; the app offers no choice there`);
  }

  // Conflict rows: a card, or `none` = click the picked card again (MergeView.tsx:232-235).
  if (key === 'none') return { position: position, selection: null, choice: 'none' };
  let idx = -1;
  if (key === 'original') {
    idx = seg.choices.findIndex((c) => c && c.source === 'original');
  } else if (/^[a-z]$/.test(key)) {
    const source = `variant_${key.charCodeAt(0) - 97}`;
    idx = seg.choices.findIndex((c) => c && c.source === source);
  }
  if (idx < 0) {
    const keys = seg.choices.map((c, i) => T.choiceKey(c && c.source, i));
    throw fail(400, `position ${position}: choice must be one of ${keys.join(', ')} or none`);
  }
  if (!T.isPickable(seg.choices[idx])) {
    throw fail(409, `position ${position}: ${T.variantLabel(seg.choices[idx].source, idx)} has no text in this variant and cannot be picked`);
  }
  return { position: position, selection: idx, choice: T.choiceKey(seg.choices[idx].source, idx) };
}

/**
 * sessions.pick — conflict cards and addition Skip/Include
 * (AppController.selectSegment :232-247 -> apiAdapter.ts:893-918, then the
 * silent compile). All picks are checked first; one transaction writes them.
 */
function pickSegments(app, p) {
  const T = text();
  const id = sessionIdParam(p);

  let requests;
  if (has(p, 'picks')) {
    let list = p.picks;
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch (_e) {
        throw fail(400, 'picks must be a JSON array like [{"position":3,"choice":"B"}]');
      }
    }
    if (!Array.isArray(list) || list.length === 0) {
      throw fail(400, 'picks must be a non-empty JSON array like [{"position":3,"choice":"B"}]');
    }
    if (has(p, 'position') || has(p, 'choice')) throw fail(400, 'pass either position + choice, or picks — not both');
    requests = list.map((x) => (x && typeof x === 'object' ? x : {}));
  } else {
    if (!has(p, 'position') || !has(p, 'choice')) throw fail(400, 'pass position + choice, or picks');
    requests = [{ position: p.position, choice: p.choice }];
  }

  let failure = null;
  let result = null;
  app.runInTransaction((tx) => {
    let rec;
    try {
      rec = tx.findRecordById('sessions', id);
    } catch (_e) {
      failure = fail(404, 'Session not found');
      return;
    }
    const segs = readJson(rec, 'segments');
    if (!Array.isArray(segs) || segs.length === 0) {
      failure = fail(409, 'This session has no variants yet; run sessions.regenerate to write them');
      return;
    }
    const picks = [];
    try {
      for (const r of requests) picks.push(resolvePick(T, segs, r.position, r.choice));
    } catch (err) {
      failure = err;
      return;
    }
    for (const pick of picks) {
      const raw = segs[pick.position];
      const choices = Array.isArray(raw.choices) ? raw.choices : [];
      raw.selection = T.clampSelection(pick.selection, choices.length); // apiAdapter.ts:908-913
    }
    rec.set('segments', segs);
    // The live compile after every pick (AppController.ts:242-243 -> apiAdapter.ts:883).
    rec.set('compiled_text', T.compileSegments(segs));
    rec.set('status', 'compiled');
    tx.save(rec);

    const view = T.mergeView(segs);
    const byPos = {};
    for (const s of view.segments) byPos[s.position] = s;
    result = {
      session_id: id,
      status: 'compiled',
      picked: picks.map((pk) => ({
        position: pk.position,
        kind: byPos[pk.position] ? byPos[pk.position].kind : null,
        number: byPos[pk.position] ? byPos[pk.position].number : null,
        choice: pk.choice,
      })),
      stats: view.stats,
      compiled_text: rec.getString('compiled_text'),
    };
  });
  if (failure) throw failure;
  return result;
}

/** sessions.delete — Delete + its confirm (MainView.tsx:57-66, SessionList.tsx:272-281, apiAdapter.ts:835-840). */
function deleteSession(app, p) {
  const T = text();
  const id = sessionIdParam(p);
  const rec = findSession(app, id);
  const title = T.toSummary(dict(rec)).title;
  app.delete(rec);
  return { deleted: id, title: title };
}

module.exports = {
  handle: handle,
  listSessions: listSessions,
  getSession: getSession,
  sessionResult: sessionResult,
  createSession: createSession,
  regenerateSession: regenerateSession,
  pickSegments: pickSegments,
  deleteSession: deleteSession,
};
