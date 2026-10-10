/// <reference path="../pb_data/types.d.ts" />
/**
 * Structured notes from a transcript, written by CraftBot's LLM through the
 * bridge in JSON mode. The reply is validated against the exact shape below;
 * a reply that does not match is a failed run (the user retries), never
 * repaired by guessing.
 */

const SYSTEM =
  'You turn transcripts of meetings, interviews, lectures and voice memos into accurate, ' +
  'concise notes. You only use facts stated in the transcript. You reply with one JSON object.';

const SHAPE = [
  '{',
  '  "title": string, a specific title of at most 80 characters',
  '  "overview": string, 1-3 sentences: what this recording is and its purpose',
  '  "summary": string, an executive summary of 3-6 sentences',
  '  "key_points": [string], the 3-10 most important points, one sentence each',
  '  "decisions": [string], decisions or agreements reached (empty list if none)',
  '  "action_items": [{ "title": string, "assignee": string, "due": string }],',
  '      assignee is the responsible person\'s name or "" if unclear,',
  '      due is a date YYYY-MM-DD or "" if no deadline was given',
  '}',
].join('\n');

/** { system, user } prompt for a note record. */
function buildPrompt(rec, notesLib) {
  const date = rec.getString('date');
  const known = notesLib.list(rec, 'attendees');
  const myNotes = rec.getString('my_notes').trim();
  const lang = rec.getString('detected_language') || rec.getString('language');
  const lines = [];
  if (date !== '') {
    lines.push('Recording date: ' + date + ' (' + notesLib.weekday(date) + '). Resolve relative deadlines ("by Thursday", "next Monday") against this date.');
  }
  lines.push('Category: ' + (rec.getString('category') || 'General'));
  if (known.length > 0) lines.push('People listed as present: ' + known.join(', '));
  if (myNotes !== '') lines.push('', "The user's own notes (context only):", myNotes);
  const labeled = notesLib.list(rec, 'segments').some((s) => s.speaker);
  lines.push(
    '',
    labeled
      ? 'Transcript (each line starts with its speaker, told apart by voice; a speaker is "Person N" until the user names them; use these speaker names for people unless the transcript gives other names):'
      : 'Transcript (speakers are not labeled):',
    rec.getString('transcript'),
    '',
  );
  lines.push(
    lang !== '' && lang !== 'auto'
      ? 'Write every text value in the language of the transcript (ISO code "' + lang + '").'
      : 'Write every text value in the language of the transcript.',
  );
  lines.push('Return exactly this JSON object, with every key present:', SHAPE);
  lines.push(
    'Do not invent names, numbers, dates or tasks. Use empty strings or empty lists when the transcript has nothing for a field.',
  );
  return { system: SYSTEM, user: lines.join('\n') };
}

// JSON null is how a model says "nothing here"; it reads as empty.
function str(v, key) {
  if (v === null) return '';
  if (typeof v !== 'string') throw new Error('"' + key + '" is not a string');
  return v.trim();
}

function strList(v, key) {
  if (v === null) return [];
  if (!Array.isArray(v)) throw new Error('"' + key + '" is not a list');
  return v.map((item) => str(item, key + '[]')).filter((t) => t !== '');
}

/**
 * Validate a reply. Returns the notes object or throws with what was wrong.
 * Due dates that are not real YYYY-MM-DD days are dropped (that field is
 * optional); every other mismatch rejects the reply.
 */
function parseReply(reply, notesLib) {
  let obj;
  try {
    obj = JSON.parse(reply);
  } catch {
    throw new Error('the reply was not JSON');
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('the reply was not a JSON object');
  for (const key of ['title', 'overview', 'summary', 'key_points', 'decisions', 'action_items']) {
    if (!(key in obj)) throw new Error('"' + key + '" is missing');
  }
  const rawActions = obj.action_items === null ? [] : obj.action_items;
  if (!Array.isArray(rawActions)) throw new Error('"action_items" is not a list');
  const actions = rawActions.map((a) => {
    if (a === null || typeof a !== 'object') throw new Error('an action item is not an object');
    const due = str(a.due, 'action_items[].due');
    return {
      id: $security.randomString(10),
      title: str(a.title, 'action_items[].title'),
      assignee: str(a.assignee, 'action_items[].assignee'),
      due: notesLib.isDay(due) ? due : '',
      done: false,
    };
  });
  return {
    title: str(obj.title, 'title').slice(0, 200),
    overview: str(obj.overview, 'overview'),
    summary: str(obj.summary, 'summary'),
    key_points: strList(obj.key_points, 'key_points'),
    decisions: strList(obj.decisions, 'decisions'),
    action_items: actions.filter((a) => a.title !== ''),
  };
}

module.exports = { buildPrompt: buildPrompt, parseReply: parseReply };
