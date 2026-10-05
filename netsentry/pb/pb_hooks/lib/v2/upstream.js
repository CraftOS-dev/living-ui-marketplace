/**
 * Latest release + published security advisories for an app, from the app's
 * own GitHub repository (the source its catalogue entry names). Pure parts
 * here; fetching lives in services/v2.js. Unauthenticated GitHub API: 60
 * requests/hour per address — two per app type every 12 hours is well within.
 */
const versions = require('./versions.js');
const { GITHUB_API } = require('../../external_hosts.js');

function urls(entry) {
  const repo = entry.updates && entry.updates.github;
  if (!repo) return null;
  return {
    release: `${GITHUB_API}${repo}/releases/latest`,
    advisories: `${GITHUB_API}${repo}/security-advisories?per_page=100`,
    source: `https://github.com/${repo}/security/advisories`,
  };
}

/** GitHub answers → the app_intel record (trimmed to what checks and people need). */
function intelFromGithub(entry, release, advisories) {
  const tag = String((release && release.tag_name) || '');
  const prefix = (entry.updates && entry.updates.tagPrefix) || '';
  const latest = versions.normalise(prefix && tag.indexOf(prefix) === 0 ? tag.slice(prefix.length) : tag);
  const list = Array.isArray(advisories) ? advisories : [];
  return {
    latest_version: latest,
    latest_published: (release && release.published_at) || '',
    advisory_source: urls(entry).source,
    advisories: list.map((a) => ({
      ghsa_id: a.ghsa_id,
      cve_id: a.cve_id || '',
      severity: a.severity || '',
      summary: String(a.summary || '').slice(0, 200),
      html_url: a.html_url || '',
      published_at: a.published_at || '',
      withdrawn_at: a.withdrawn_at || '',
      vulnerabilities: (a.vulnerabilities || []).map((v) => ({
        vulnerable_version_range: v.vulnerable_version_range || '',
        patched_versions: v.patched_versions || '',
      })),
    })),
  };
}

module.exports = { urls, intelFromGithub };
