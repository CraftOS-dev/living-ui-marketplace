/**
 * Monitoring tools. Lab-verified (tests/fixtures/catalogue/):
 *   grafana.json            fresh: /api/health answers (version); /api/search → 401 without a login;
 *   grafana_anonymous.json  GF_AUTH_ANONYMOUS_ENABLED=true: /api/search → 200 without a login.
 *   uptimekuma.json         /api/entry-page answers {"type":"entryPage"}; whether its first account
 *                           exists is only said over its websocket, so no setup check (not a GET).
 */
const { updateHow } = require('./_common.js');

const grafana = {
  id: 'grafana',
  version: 1,
  name: 'Grafana',
  category: 'monitoring',
  what: 'your dashboards and alerts',
  sources: {
    anonymous: 'https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/grafana/#anonymous-authentication',
    docker: 'https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/',
    releases: 'https://github.com/grafana/grafana/releases',
    lab: 'tests/fixtures/catalogue/grafana.json',
  },
  recognise: {
    images: ['grafana/grafana', 'grafana/grafana-oss', 'grafana/grafana-enterprise'],
    containerPorts: [3000],
    ports: [3000],
    processes: ['grafana', 'grafana-server'],
    http: { path: '/api/health', want: 'json', match: (r) => !!(r && r.json && r.json.database && r.json.version && r.json.commit) },
  },
  probe: [
    { path: '/api/health', want: 'json' },
    { path: '/api/search', want: 'status' },
  ],
  versionFrom: (http) => {
    const r = http['/api/health'];
    return r && r.json && r.json.version ? String(r.json.version) : '';
  },
  config: [],
  defaultIntent: 'local_network',
  template: 'admin_tool',
  data: { important: ['the /var/lib/grafana volume: grafana.db (dashboards, users, alert rules, data-source settings)'], lose: 'your dashboards, alerts and users', skip: [] },
  updates: { github: 'grafana/grafana', advisories: 'github', how: updateHow('grafana', 'grafana/grafana:latest') },
  // Anonymous access lets anyone open dashboards (and query the data sources behind them) without signing in.
  noPassword: {
    path: '/api/search',
    test: (http) => {
      const r = http['/api/search'];
      return !r || !r.status ? null : r.status === 200 ? true : r.status === 401 || r.status === 403 ? false : null;
    },
    title: (app) => `${app.name} lets anyone look at your dashboards without signing in`,
    power: 'open your dashboards and query the data behind them',
    how: (a) => [
      'In docker-compose.yml, set GF_AUTH_ANONYMOUS_ENABLED=false for Grafana (or enabled = false under [auth.anonymous] in grafana.ini).',
      `Run: docker compose up -d ${a.service}`,
      'To show one dashboard to people without an account, share just that dashboard ("Share externally") instead.',
    ],
  },
  checks: ['APP-NO-PASSWORD'],
};

const uptimekuma = {
  id: 'uptimekuma',
  version: 1,
  name: 'Uptime Kuma',
  category: 'monitoring',
  what: 'your uptime monitor',
  sources: {
    docker: 'https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install',
    releases: 'https://github.com/louislam/uptime-kuma/releases',
    lab: 'tests/fixtures/catalogue/uptimekuma.json',
  },
  recognise: {
    images: ['louislam/uptime-kuma'],
    containerPorts: [3001],
    ports: [3001],
    processes: [],
    http: { path: '/api/entry-page', want: 'json', match: (r) => !!(r && r.json && r.json.type === 'entryPage') },
  },
  probe: [{ path: '/api/entry-page', want: 'json' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  template: 'admin_tool',
  data: { important: ['the /app/data volume (kuma.db: monitors, notifications, users)'], lose: 'your monitors and notification settings', skip: [] },
  updates: { github: 'louislam/uptime-kuma', advisories: 'github', how: updateHow('uptime-kuma', 'louislam/uptime-kuma:1') },
  checks: [],
};

module.exports = [grafana, uptimekuma];
