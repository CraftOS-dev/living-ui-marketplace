/**
 * Infrastructure tools (organisations, plan §12.2 "admin tool"): Portainer,
 * Traefik, Caddy. Lab-verified (tests/fixtures/catalogue/):
 *   portainer.json        fresh: /api/users/admin/check → 404 "No administrator account found";
 *   portainer_timedout.json  5 minutes after start with no admin, the setup window closes: the check
 *                         answers 303 (to its "timed out" page) until Portainer is restarted;
 *   portainer_setup_token.json  from 2.43.0 the first admin can only be made with the one-time
 *                         token Portainer prints in its log (2.42.0 and older: anyone who opens it);
 *   traefik_insecure.json --api.insecure=true: /api/version, /api/http/routers answer anyone on :8080;
 *   caddy.json            "Server: Caddy" on its answers.
 */
const { updateHow } = require('./_common.js');
const versions = require('../versions.js');

// Lab-measured: the first version whose admin set-up needs the token from its own log.
const PORTAINER_TOKEN_FROM = '2.43.0';

const portainer = {
  id: 'portainer',
  version: 1,
  name: 'Portainer',
  category: 'infra',
  what: 'the control panel for your containers',
  sources: {
    install: 'https://docs.portainer.io/start/install-ce/server/docker/linux',
    timeout: 'https://docs.portainer.io/faqs/installing/your-portainer-instance-has-timed-out-for-security-purposes-error-fix',
    releases: 'https://github.com/portainer/portainer/releases',
    lab: 'tests/fixtures/catalogue/portainer.json',
  },
  recognise: {
    images: ['portainer/portainer-ce', 'portainer/portainer-ee', 'portainer/portainer'],
    containerPorts: [9000, 9443, 8000],
    webPorts: [9000],
    ports: [9000, 9443],
    processes: ['portainer'],
    // /api/system/status (the older /api/status logs a deprecation warning on every call)
    http: { path: '/api/system/status', want: 'json', match: (r) => !!(r && r.json && r.json.Version && r.json.InstanceID) },
  },
  probe: [
    { path: '/api/system/status', want: 'json' },
    { path: '/api/users/admin/check', want: 'status' },
  ],
  versionFrom: (http) => {
    const r = http['/api/system/status'];
    return r && r.json && r.json.Version ? String(r.json.Version) : '';
  },
  config: [],
  defaultIntent: 'local_network',
  template: 'admin_tool',
  data: { important: ['the /data volume: Portainer’s settings, users and stacks'], lose: 'your Portainer settings, users and stacks', skip: [] },
  updates: { github: 'portainer/portainer', advisories: 'github', how: updateHow('portainer', 'portainer/portainer-ce:lts') },
  setup: {
    paths: ['/api/users/admin/check', '/api/system/status'],
    // 404 = no administrator yet (lab). From 2.43.0 creating it needs the one-time token from
    // Portainer's own log, so a stranger can't (lab: portainer_setup_token.json).
    test: (http) => {
      const r = http['/api/users/admin/check'];
      if (!r || !r.status) return null;
      // 2xx: an administrator exists; 303: the setup window closed (timed out) — nobody can create one now.
      if (r.status !== 404) return r.status < 400 ? false : null;
      const st = http['/api/system/status'];
      const v = st && st.json && st.json.Version ? String(st.json.Version) : '';
      if (!v) return null;
      const c = versions.compare(v, PORTAINER_TOKEN_FROM);
      return c === null ? null : c < 0;
    },
    said: (http) => {
      const st = http['/api/system/status'];
      return `Portainer ${st && st.json ? st.json.Version : ''} has no administrator yet, and this version lets whoever opens it first create one.`;
    },
    becomes: 'the administrator of Portainer — and through it, of every container on this server',
    how: (a, url) => [
      `Open ${url} now and create the administrator with a strong, unique password.`,
      'If Portainer says it "timed out for security purposes", restart its container and do it straight away.',
      `Then update Portainer: from version ${PORTAINER_TOKEN_FROM} the first administrator can only be created with a token from its own log.`,
    ],
  },
  checks: ['APP-SETUP-OPEN'],
};

const traefik = {
  id: 'traefik',
  version: 1,
  name: 'Traefik',
  category: 'infra',
  what: 'the proxy that sends web traffic to your apps',
  sources: {
    api: 'https://doc.traefik.io/traefik/operations/api/#insecure',
    dashboard: 'https://doc.traefik.io/traefik/operations/dashboard/#secure-mode',
    releases: 'https://github.com/traefik/traefik/releases',
    lab: 'tests/fixtures/catalogue/traefik_insecure.json',
  },
  recognise: {
    images: ['traefik'],
    containerPorts: [80, 443, 8080],
    webPorts: [8080],
    ports: [80, 443, 8080],
    processes: ['traefik'],
    http: { path: '/api/version', want: 'json', match: (r) => !!(r && r.json && r.json.Version && r.json.Codename) },
  },
  probe: [{ path: '/api/version', want: 'json' }],
  versionFrom: (http) => {
    const r = http['/api/version'];
    return r && r.json && r.json.Version ? String(r.json.Version) : '';
  },
  config: [],
  defaultIntent: 'local_network',
  template: 'admin_tool',
  data: { important: ['your Traefik configuration (traefik.yml and the dynamic files) and acme.json (its certificates)'], lose: 'your routing rules and certificates', skip: [] },
  updates: { github: 'traefik/traefik', advisories: 'github', how: updateHow('traefik', 'traefik:latest') },
  // api.insecure serves the dashboard and API on :8080 with no login (docs: "not recommended in production").
  noPassword: {
    path: '/api/version',
    test: (http) => {
      const r = http['/api/version'];
      return !r || !r.status ? null : r.status === 200 && !!(r.json && r.json.Codename);
    },
    title: (app) => `${app.name}'s dashboard is open — anyone who reaches it sees every route`,
    power: 'see every site and app Traefik routes to, and exactly how to reach them — a map of your network for an attacker',
    how: (a) => [
      'In your Traefik settings, remove --api.insecure=true (or api.insecure: true in traefik.yml).',
      'If you want the dashboard, publish it through a router with a login (a basicAuth middleware) — see "Secure mode" in the Traefik dashboard docs.',
      `Run: docker compose up -d ${a.service}`,
    ],
  },
  checks: ['APP-NO-PASSWORD'],
};

const caddy = {
  id: 'caddy',
  version: 1,
  name: 'Caddy',
  category: 'infra',
  what: 'the web server in front of your apps',
  sources: {
    docker: 'https://hub.docker.com/_/caddy',
    admin: 'https://caddyserver.com/docs/api',
    releases: 'https://github.com/caddyserver/caddy/releases',
    lab: 'tests/fixtures/catalogue/caddy.json',
  },
  recognise: {
    images: ['caddy'],
    containerPorts: [80, 443],
    webPorts: [80],
    ports: [80, 443],
    processes: ['caddy'],
    http: { path: '/', want: 'status', match: (r) => !!(r && /^Caddy\b/.test(r.server || '')) },
  },
  probe: [{ path: '/', want: 'status' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'internet',
  template: 'public',
  data: { important: ['your Caddyfile and the /data volume (its certificates)'], lose: 'your site settings and certificates', skip: [] },
  updates: { github: 'caddyserver/caddy', advisories: 'github', how: updateHow('caddy', 'caddy:latest') },
  checks: [],
};

module.exports = [portainer, traefik, caddy];
