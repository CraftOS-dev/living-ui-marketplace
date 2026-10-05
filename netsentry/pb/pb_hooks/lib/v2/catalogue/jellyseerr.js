/** Jellyseerr / Seerr — lab-verified (tests/fixtures/catalogue/jellyseerr.json: /api/v1/settings/public initialized:false; /api/v1/status reports version + updateAvailable). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'jellyseerr',
  version: 1,
  name: 'Jellyseerr',
  category: 'media',
  what: 'the app your family uses to request movies and shows',
  sources: {
    docs: 'https://docs.seerr.dev/',
    repo: 'https://github.com/seerr-team/seerr',
    lab: 'tests/fixtures/catalogue/jellyseerr.json',
  },
  recognise: {
    images: ['fallenbagel/jellyseerr', 'ghcr.io/fallenbagel/jellyseerr', 'ghcr.io/seerr-team/seerr', 'sctx/overseerr', 'lscr.io/linuxserver/overseerr', 'linuxserver/overseerr'],
    containerPorts: [5055],
    ports: [5055],
    processes: [],
    http: { path: '/api/v1/settings/public', want: 'json', match: (r) => !!(r && r.json && typeof r.json.initialized === 'boolean' && /seerr/i.test(String(r.json.applicationTitle || ''))) },
  },
  probe: [
    { path: '/api/v1/settings/public', want: 'json' },
    { path: '/api/v1/status', want: 'json' },
  ],
  versionFrom: (http) => {
    const r = http['/api/v1/status'];
    return r && r.json && r.json.version ? String(r.json.version) : '';
  },
  config: [],
  defaultIntent: 'local_plus_private_remote',
  data: { important: ['Jellyseerr settings and request history (/app/config)'], lose: 'everyone’s requests and your settings', skip: [] },
  updates: { github: 'seerr-team/seerr', advisories: 'github', how: updateHow('jellyseerr', 'fallenbagel/jellyseerr:latest') },
  setup: {
    path: '/api/v1/settings/public',
    open: (r) => (r && r.json && typeof r.json.initialized === 'boolean' ? !r.json.initialized : null),
    becomes: 'its admin, able to connect it to their own media server',
    how: (a, url) => [`Open ${url} in your browser now.`, 'Finish the setup by signing in with your Jellyfin or Plex account.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
