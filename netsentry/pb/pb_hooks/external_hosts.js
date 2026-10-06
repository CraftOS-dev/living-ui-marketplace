/**
 * Every external endpoint NetSentry talks to — one reviewable list.
 * All are public and keyless, called from hooks only (never the browser).
 * The validation gate reads these literals into manifest.capabilities.external_hosts.
 */
module.exports = {
  // DNS-over-HTTPS (JSON API): alert destinations must not point at private addresses (services/alerts.js)
  DOH: 'https://cloudflare-dns.com/dns-query',
  // Threat intelligence
  KEV: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  EPSS: 'https://api.first.org/data/v1/epss',
  DROP: 'https://www.spamhaus.org/drop/drop_v4.json',
  FEODO: 'https://feodotracker.abuse.ch/downloads/ipblocklist.json',
  URLHAUS_HOSTS: 'https://urlhaus.abuse.ch/downloads/hostfile/',
  // v2: each app's latest release and published security advisories, from the app's own repository
  GITHUB_API: 'https://api.github.com/repos/',
  // v3 M3: newer versions of the images apps run — Docker Hub's tag API and ghcr.io's registry (lscr.io's images), read without an account
  DOCKER_HUB: 'https://hub.docker.com/v2/namespaces/',
  GHCR: 'https://ghcr.io/',
};
