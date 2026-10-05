/**
 * "Ask the agent" on Home (v4 plan §5.1, §8). A person writes what's wrong in their own words; the
 * CraftBot agent is rung (trigger help_requested — no parameters: the question is read back through
 * help.pending, so nothing the app sends becomes the agent's instruction), looks at the server with
 * read-only operations, prepares any change for a person to confirm, and answers here.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const { OpError } = require('../core/util.js');

const MAX_WAITING = 20;

function ask(app, actor, p) {
  const q = String(p.question || '').trim();
  if (q.length < 3) throw new OpError(400, 'Say what you need help with.');
  if (q.length > 1000) throw new OpError(400, 'Keep it under 1000 characters.');
  if (repo.find(app, 'help_requests', 'status = "waiting"').length >= MAX_WAITING) throw new OpError(429, 'The agent already has a lot waiting — give it a moment.');
  const rec = repo.create(app, 'help_requests', { question: q, asked_by: actor.label || actor.type, status: 'waiting', changes: [] });
  audit.append(app, actor, 'help.asked', { collection: 'help_requests', id: rec.id }, `Asked the agent: ${q.slice(0, 120)}`, null);
  const r = require('./agentbell.js').ring(app, 'help_requested', {});
  return {
    ok: true, help_id: rec.id, rang: !!r.ok,
    message: r.ok || r.code === 'cooldown'
      ? 'The agent is looking. Its answer shows here; anything it wants to change waits for you to confirm.'
      : "The agent isn't connected right now — your question waits here until it is.",
  };
}

/** For the agent: the questions people are waiting on, oldest first. */
function pending(app) {
  return {
    ok: true,
    questions: repo.find(app, 'help_requests', 'status = "waiting"', {}, 'created', MAX_WAITING).map((r) => ({
      id: r.id, question: r.getString('question'), asked_by: r.getString('asked_by'), asked_at: repo.isoOf(r, 'created'),
    })),
  };
}

/** For the agent: the answer, and the changes it prepared (each still needs a person to confirm). */
function answer(app, actor, p) {
  const r = repo.byId(app, 'help_requests', String(p.help_id || ''));
  if (!r) throw new OpError(404, 'No such question.');
  if (r.getString('status') !== 'waiting') throw new OpError(409, 'That question was already answered.');
  const text = String(p.answer || '').trim();
  if (!text) throw new OpError(400, 'Give an answer.');
  const ids = String(p.remediation_ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  for (const id of ids) {
    const rem = repo.byId(app, 'remediations', id);
    if (!rem || rem.getString('status') !== 'planned') throw new OpError(400, `${id} is not a change waiting to be confirmed.`);
  }
  repo.update(app, r, { status: 'answered', answer: text.slice(0, 8000), changes: ids, answered_at: repo.nowIso() });
  audit.append(app, actor, 'help.answered', { collection: 'help_requests', id: r.id }, `Answered: ${r.getString('question').slice(0, 80)}`, { changes: ids });
  return { ok: true };
}

/** A person takes their question back (it was answered elsewhere, or the agent never came). */
function withdraw(app, actor, p) {
  const r = repo.byId(app, 'help_requests', String(p.help_id || ''));
  if (!r) throw new OpError(404, 'No such question.');
  if (r.getString('status') !== 'waiting') throw new OpError(409, 'Only a question still waiting can be withdrawn.');
  repo.update(app, r, { status: 'withdrawn' });
  audit.append(app, actor, 'help.withdrawn', { collection: 'help_requests', id: r.id }, `Withdrew the question: ${r.getString('question').slice(0, 80)}`, null);
  return { ok: true, message: 'Question withdrawn.' };
}

module.exports = { ask, pending, answer, withdraw };
