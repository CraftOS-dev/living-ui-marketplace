/**
 * Detections (docs/SYSTEM-V2-PLAN.md §20.4) — activity to review, not problems.
 *   - A machine's first LEARN_DAYS are learned quietly (baseline).
 *   - Programs signed by the operating system's maker are known good.
 *   - The same thing on the same machine is one detection (count + last seen);
 *     once someone says "expected", it stays expected.
 *   - "Looks wrong" turns it into an issue (Needs you).
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const plain = require('../rules/plain.js');
const { OpError } = require('../core/util.js');

const LEARN_DAYS = 7;
// Publishers of the operating systems themselves (plan: known-good publishers). Anything else is reviewed.
const KNOWN_GOOD = ['microsoft windows', 'microsoft windows publisher', 'microsoft corporation', 'apple inc.', 'software signing (apple)'];

function learning(assetRec, now) {
  const first = repo.isoOf(assetRec, 'first_seen') || repo.isoOf(assetRec, 'created');
  return !!first && Date.parse(now) - Date.parse(first) < LEARN_DAYS * 86400000;
}

function knownGood(evidence) {
  const e = evidence || {};
  const pub = String(e.publisher || '').toLowerCase().trim();
  return String(e.signed || '').indexOf('yes') === 0 && KNOWN_GOOD.indexOf(pub) >= 0;
}

/** One rule result → a detection (created, counted, or quietly learned). */
function record(app, assetRec, rule, res, now, opts) {
  const key = `${rule.id}|${assetRec.id}|${res.subject || ''}`;
  const on = assetRec.getString('label') || assetRec.getString('identifier');
  const summary = (plain.titleFor(rule.id, { subject: res.subject || '', evidence: res.evidence || {}, on }) || res.title || rule.title).slice(0, 300);
  const prior = repo.first(app, 'detections', 'dedupe_key = {:k}', { k: key }, '-last_at');
  if (prior) {
    // Same thing again: count it; a person's "expected" sticks.
    repo.update(app, prior, { count: prior.getInt('count') + 1, last_at: now, evidence: res.evidence || {}, summary });
    return prior;
  }
  const verdict = (opts && opts.verdict) || (learning(assetRec, now) ? 'learned' : knownGood(res.evidence) ? 'known_good' : 'unreviewed');
  return repo.create(app, 'detections', {
    dedupe_key: key, rule_id: rule.id, asset: assetRec.id, subject: String(res.subject || '').slice(0, 255), summary,
    severity: res.severity || rule.severity, evidence: res.evidence || {}, verdict, count: 1, first_at: now, last_at: now,
  });
}

function setVerdict(app, actor, p) {
  const d = repo.byId(app, 'detections', String(p.detection_id || ''));
  if (!d) throw new OpError(404, 'Not found.');
  if (['expected', 'suspicious'].indexOf(p.verdict) < 0) throw new OpError(400, 'verdict must be expected or suspicious.');
  const fields = { verdict: p.verdict, verdict_by: actor.label || actor.type };
  let findingId = '';
  if (p.verdict === 'suspicious') {
    // It becomes an issue: Needs you, with the rule's steps.
    const now = repo.nowIso();
    const f = repo.create(app, 'findings', {
      fingerprint: `det|${d.id}`, rule_id: d.getString('rule_id'), asset: d.getString('asset'), subject: d.getString('subject'),
      category: 'activity', status: 'open', severity: d.getString('severity') || 'high', title: d.getString('summary'),
      plain_title: d.getString('summary'), evidence: repo.jsonOf(d, 'evidence') || {}, first_seen: now, last_seen: now, reopen_count: 0,
      status_note: `Marked "looks wrong" by ${fields.verdict_by}.`, status_by: fields.verdict_by,
    });
    fields.finding = f.id;
    findingId = f.id;
  }
  repo.update(app, d, fields);
  audit.append(app, actor, `detection.${p.verdict}`, { collection: 'detections', id: d.id }, `${p.verdict === 'expected' ? 'Expected' : 'Looks wrong'}: ${d.getString('summary')}`, null);
  return { ok: true, finding_id: findingId };
}

module.exports = { record, setVerdict, learning, knownGood, LEARN_DAYS };
