/** Vaultwarden — lab-verified (tests/fixtures/catalogue/vaultwarden.json: /api/version answers; SIGNUPS_ALLOWED unset on a fresh container). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'vaultwarden',
  version: 1,
  name: 'Vaultwarden',
  category: 'files',
  what: 'your password manager',
  sources: {
    env_template: 'https://github.com/dani-garcia/vaultwarden/blob/main/.env.template',
    signups: 'https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users',
    admin: 'https://github.com/dani-garcia/vaultwarden/wiki/Enabling-admin-page',
    releases: 'https://github.com/dani-garcia/vaultwarden/releases',
    lab: 'tests/fixtures/catalogue/vaultwarden.json',
  },
  recognise: {
    images: ['vaultwarden/server', 'ghcr.io/dani-garcia/vaultwarden'],
    containerPorts: [80],
    ports: [80],
    processes: ['vaultwarden'],
    http: { path: '/api/version', want: 'text', match: (r) => !!(r && r.status === 200 && /^"\d+\.\d+/.test(r.text || '')) },
  },
  probe: [{ path: '/api/version', want: 'text' }],
  versionFrom: (http) => {
    const r = http['/api/version'];
    return r && r.status === 200 ? String(r.text || '').replace(/"/g, '').trim() : '';
  },
  // Configured by environment variables: read only these (ADMIN_TOKEN is described, never read).
  config: [
    { images: ['vaultwarden/server', 'ghcr.io/dani-garcia/vaultwarden'], path: 'env', format: 'container_env', keys: [{ key: 'SIGNUPS_ALLOWED' }, { key: 'ADMIN_TOKEN', secret: true }] },
  ],
  defaultIntent: 'local_plus_private_remote',
  data: { important: ['the Vaultwarden data folder (/data): its database and attachments'], lose: 'every password stored in it', skip: [] },
  updates: { github: 'dani-garcia/vaultwarden', advisories: 'github', how: updateHow('vaultwarden', 'vaultwarden/server:latest') },
  // Sign-ups are open unless SIGNUPS_ALLOWED=false (.env.template default: true).
  openSignup: {
    test: (cfg) => (cfg ? String(cfg.SIGNUPS_ALLOWED || 'true').toLowerCase() !== 'false' : null),
    how: (a) => [
      'In docker-compose.yml, add SIGNUPS_ALLOWED=false to the Vaultwarden environment (invite people from the admin page instead).',
      `Run: docker compose up -d ${a.service}`,
    ],
  },
  // A plain-text admin token is warned about by Vaultwarden itself; an Argon2 hash is the safe form.
  adminSecret: {
    test: (cfg) => {
      const t = cfg && cfg.ADMIN_TOKEN;
      return !cfg ? null : !t || !t.set ? false : t.form === 'plain';
    },
    how: (a) => [
      `Make a hashed token: docker exec -it ${a.container} /vaultwarden hash`,
      `Put the $argon2… value it prints in ADMIN_TOKEN (in docker-compose.yml, write each $ as $$), then docker compose up -d ${a.service}.`,
    ],
  },
  checks: ['APP-OPEN-SIGNUP', 'APP-ADMIN-SECRET-PLAIN'],
};
