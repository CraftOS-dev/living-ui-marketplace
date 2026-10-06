/**
 * Image versions (v3 plan §10.1) — pure. Which registry an image comes from,
 * how its tag reads as a version, which newer tags are "the same kind of
 * tag", and how risky moving to one is.
 *
 *   parseRef('lscr.io/linuxserver/sonarr:latest') → { registry: 'ghcr.io', repo: 'linuxserver/sonarr', tag: 'latest' }
 *   versionOf('10.10.7') → { nums: [10, 10, 7], prefix: '', suffix: '' }
 */

// Registries NetSentry can read without an account, and where each one's tags live.
const MIRRORS = { 'lscr.io': 'ghcr.io' };
const HUB = 'docker.io';

function parseRef(image) {
  let ref = String(image || '').trim();
  if (!ref) return null;
  let digest = '';
  const at = ref.indexOf('@');
  if (at >= 0) {
    digest = ref.slice(at + 1);
    ref = ref.slice(0, at);
  }
  const slash = ref.indexOf('/');
  let registry = HUB;
  let rest = ref;
  if (slash > 0) {
    const first = ref.slice(0, slash);
    if (first.indexOf('.') >= 0 || first.indexOf(':') >= 0 || first === 'localhost') {
      registry = first;
      rest = ref.slice(slash + 1);
    }
  }
  const colon = rest.lastIndexOf(':');
  let repo = rest;
  let tag = 'latest';
  if (colon > 0) {
    repo = rest.slice(0, colon);
    tag = rest.slice(colon + 1);
  }
  if (registry === HUB && repo.indexOf('/') < 0) repo = `library/${repo}`;
  registry = MIRRORS[registry] || registry;
  return { registry, repo: repo.toLowerCase(), tag, digest };
}

/**
 * A tag as a version: leading word ("v"), numbers, and what follows ("-alpine", "-ls275"). Null when it isn't one.
 * A date after the version numbers ("12.1.20260915-010956", how Jellyfin 12 tags its releases) is the
 * release's build stamp → { nums: [12, 1], build: '20260915-010956' }. A tag that IS a date ("2026092811")
 * is a nightly build, not a release.
 */
function versionOf(tag) {
  const m = /^([a-zA-Z]*?)(\d+(?:\.\d+){0,3})((?:[-_.+][0-9A-Za-z.-]*)?)$/.exec(String(tag || ''));
  if (!m) return null;
  let nums = m[2].split('.').map((n) => parseInt(n, 10));
  let suffix = m[3] || '';
  let build = '';
  const stamp = nums.findIndex((n) => n > 99999);
  if (stamp === 0) return null;
  if (stamp > 0) {
    if (suffix && !/^-\d+$/.test(suffix)) return null;
    build = nums.slice(stamp).join('.') + suffix;
    nums = nums.slice(0, stamp);
    suffix = '';
  }
  // "-ls275" (linuxserver build) and "-r1" count as part of the version; "-alpine" is a flavour.
  return { prefix: m[1], nums, suffix, build, flavour: suffix.replace(/[-_.]?(ls|r|build)\d+$/i, '').replace(/^[-_.]?\d+$/, '') };
}

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Two parsed versions in order: numbers first, then the build stamp (a later stamp is a newer build). */
function compareVersions(a, b) {
  return compare(a.nums, b.nums) || ((a.build || '') < (b.build || '') ? -1 : (a.build || '') > (b.build || '') ? 1 : 0);
}

// Apps whose real "major" is the first TWO numbers: 10.10 → 10.11 changes their database (Jellyfin,
// Gitea), so it is treated like a major version — high risk, never automatic.
const MAJOR_PARTS = { 'jellyfin/jellyfin': 2, 'gitea/gitea': 2, 'codeberg.org/forgejo/forgejo': 1, 'linuxserver/jellyfin': 2 };

function majorParts(repo) {
  return MAJOR_PARTS[repo] || 1;
}

function sameMajor(a, b, parts) {
  for (let i = 0; i < parts; i++) if ((a[i] || 0) !== (b[i] || 0)) return false;
  return true;
}

/** A floating tag that moves on its own (latest, stable, a bare major like "16"). */
function floating(tag) {
  const v = versionOf(tag);
  return !v || v.nums.length === 1;
}

/**
 * From a registry's tag list, the newest tag of the same shape as `current`:
 * same prefix, same number of parts, same flavour (an "-alpine" user stays on alpine),
 * and no pre-releases. A new MAJOR may be tagged in another shape (Jellyfin 10.11.11 →
 * 12.1.20260915-010956), so for it any release tag with the same prefix and flavour counts.
 * → { patchMinor: tag|null, major: tag|null }
 */
function newerTags(current, tags, repo) {
  const parts = majorParts(repo || '');
  const cur = versionOf(current);
  if (!cur || (cur.nums.length < 2 && !cur.build)) return { patchMinor: null, major: null };
  let best = null;
  let bestMajor = null;
  for (const t of tags || []) {
    if (/(alpha|beta|rc|dev|nightly|unstable|preview|test)/i.test(t)) continue;
    const v = versionOf(t);
    if (!v || v.prefix !== cur.prefix || v.flavour !== cur.flavour) continue;
    if (compareVersions(v, cur) <= 0) continue;
    if (sameMajor(v.nums, cur.nums, parts)) {
      if (v.nums.length !== cur.nums.length || !v.build !== !cur.build) continue;
      if (!best || compareVersions(v, best.v) > 0 || (compareVersions(v, best.v) === 0 && t > best.tag)) best = { tag: t, v };
    } else if (v.nums.length >= 2 || v.build) {
      // Equal numbers: the tag with a build stamp is the exact release, a bare "12.1" moves.
      if (!bestMajor || compareVersions(v, bestMajor.v) > 0) bestMajor = { tag: t, v };
    }
  }
  return { patchMinor: best ? best.tag : null, major: bestMajor ? bestMajor.tag : null };
}

// Databases: a major version changes the files on disk; it never happens by itself.
const DATABASES = /(^|\/)(postgres|postgis|mariadb|mysql|mongo|mongodb|redis|valkey|elasticsearch|opensearch|influxdb|clickhouse)(-|$)/;

/**
 * How risky is moving from `from` to `to` (tags) of `repo`?
 * → { kind: 'patch'|'minor'|'major'|'rebuild', risk: 'low'|'medium'|'high', why }
 */
function classify(repo, from, to) {
  const a = versionOf(from);
  const b = versionOf(to);
  const db = DATABASES.test(repo);
  if (!a || !b || from === to) {
    return { kind: 'rebuild', risk: db ? 'medium' : 'medium', why: `a newer build of "${from}" — the tag doesn't say what changed` };
  }
  if (!sameMajor(a.nums, b.nums, majorParts(repo))) {
    return { kind: 'major', risk: 'high', why: db ? 'a new major version of a database: its data files change and older versions can’t read them back' : 'a new major version: settings and data may change and some things may stop working' };
  }
  // PostgreSQL numbers majors as "16" and its bug-fix releases as "16.15": the second number is a patch.
  const pgPatch = /(^|\/)(postgres|postgis)/.test(repo) && a.nums.length === 2;
  if (a.nums.length > 1 && a.nums[1] !== b.nums[1] && !pgPatch) return { kind: 'minor', risk: db ? 'medium' : 'low', why: 'new features and fixes, same major version' };
  return { kind: 'patch', risk: 'low', why: 'fixes only' };
}

/** May a standing "update me in my window" policy apply this one? Only small, never a database major. */
function autoAllowed(classified) {
  return classified.kind === 'patch' || classified.kind === 'minor' || (classified.kind === 'rebuild' && classified.risk !== 'high');
}

module.exports = { parseRef, versionOf, compare, compareVersions, floating, newerTags, classify, autoAllowed, DATABASES, majorParts };
