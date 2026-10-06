/**
 * Content system (plan §22). A check's result becomes text in layers:
 *   L1 title   — cards and alerts, ≤ 80 characters, app/machine name first
 *   L2 saw     — the facts, in plain words (2–5 lines)
 *   L3 means   — why it matters for THIS app and exposure (2–3 sentences)
 *   L4 steps   — what to do, for this setup (variant), plus how NetSentry will know
 *   L5         — technical details come from evidence, not from here
 * `lint` is what the tests run over every rendered fixture: no unfilled slots,
 * no jargon in L1–L3, length limits.
 */

// Words people shouldn't meet before the technical layer (lower-case, whole word).
const JARGON = [
  'bind', 'bound to', 'interface', 'cidr', 'ingress', 'egress', 'nacl', 'daemon', 'subnet', 'upnp', 'ssdp',
  'tcp', 'udp', 'whitelist', 'ghsa', 'endpoint', 'vantage', 'evaluation', 'observation', 'collector', 'sensor',
  'asset', 'fingerprint', 'localhost', '0.0.0.0', '127.0.0.1', 'json', 'api', 'http status',
];
const BROKEN = [/undefined/, /\bnull\b/, /NaN/, /\[object /, /\{\{|\}\}/, /\$\{/];

function render(control, subject, ctx, result) {
  const t = control.text;
  const f = Object.assign({}, result.facts || {});
  const out = { control: control.id, state: result.state };
  if (result.state === 'fail') {
    out.title = t.title(f, subject, ctx);
    out.saw = t.saw(f, subject, ctx);
    out.means = t.means(f, subject, ctx);
    const steps = t.steps(f, subject, ctx);
    out.steps = steps.list;
    out.variant = steps.variant;
    out.verify = t.verify(f, subject, ctx);
  } else if (result.state === 'pass') {
    out.title = t.pass(f, subject, ctx);
  } else if (result.state === 'unknown') {
    out.title = t.unknown(f, subject, ctx);
  } else {
    out.title = t.notApplicable ? t.notApplicable(f, subject, ctx) : 'Does not apply here';
  }
  return out;
}

function hasJargon(text) {
  // Text in double quotes is an app's own on-screen label: people must find it exactly as written.
  const s = ` ${String(text).toLowerCase().replace(/"[^"]*"/g, '""')} `;
  return JARGON.filter((w) => new RegExp(`[^a-z0-9.]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?[^a-z0-9]`).test(s));
}

/** Problems with a rendered result; [] = fine. */
function lint(r) {
  const problems = [];
  const all = [r.title, r.means, r.verify].concat(r.saw || [], r.steps || []).filter((x) => x !== undefined);
  for (const s of all) {
    if (typeof s !== 'string' || !s.trim()) problems.push('empty text');
    for (const re of BROKEN) if (re.test(String(s))) problems.push(`unfilled slot in: ${s}`);
  }
  if (!r.title || r.title.length > 80) problems.push(`title length ${r.title ? r.title.length : 0}: ${r.title}`);
  for (const s of [r.title, r.means].concat(r.saw || [])) {
    if (s === undefined) continue;
    const j = hasJargon(s);
    if (j.length) problems.push(`jargon (${j.join(', ')}) in: ${s}`);
  }
  if (r.state === 'fail') {
    if (!r.saw || r.saw.length < 1 || r.saw.length > 5) problems.push('saw must be 1–5 facts');
    if (!r.means || r.means.length > 400) problems.push('means must be 1–400 characters');
    if (!r.steps || !r.steps.length) problems.push('no steps');
    if (!r.verify) problems.push('no "how we will know"');
  }
  return problems;
}

/** "15 Sept 2026" (for text; locale-free so snapshots are stable). */
function day(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

/** "3 hours", "2 days" between two ISO times. */
function span(fromIso, toIso) {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!(ms >= 0)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

function plural(n, word, many) {
  return `${n} ${n === 1 ? word : many || word + 's'}`;
}

module.exports = { render, lint, hasJargon, day, span, plural, JARGON };
