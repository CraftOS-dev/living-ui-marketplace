/** Transmission — lab-verified (tests/fixtures/catalogue/transmission.json: a fresh start answers RPC with 409 + session id, i.e. no password). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'transmission',
  version: 1,
  name: 'Transmission',
  category: 'download',
  what: 'your download client',
  sources: {
    rpc: 'https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md',
    settings: 'https://github.com/transmission/transmission/blob/main/docs/Editing-Configuration-Files.md',
    linuxserver: 'https://docs.linuxserver.io/images/docker-transmission/',
    releases: 'https://github.com/transmission/transmission/releases',
    lab: 'tests/fixtures/catalogue/transmission.json',
  },
  recognise: {
    images: ['lscr.io/linuxserver/transmission', 'linuxserver/transmission', 'haugene/transmission-openvpn'],
    containerPorts: [9091],
    ports: [9091],
    processes: ['transmission-daemon', 'transmission-qt', 'transmission-qt.exe'],
    // RPC: 409 (asks for a session id) when no password is needed; 401 when one is.
    http: { path: '/transmission/rpc', want: 'status', match: (r) => !!(r && (r.status === 409 || r.status === 401)) },
  },
  probe: [{ path: '/transmission/rpc', want: 'status' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  data: { important: ['Transmission settings (/config in the container)'], lose: 'your settings and list of downloads', skip: ['downloads'] },
  updates: { github: 'transmission/transmission', advisories: 'github', how: updateHow('transmission', 'lscr.io/linuxserver/transmission:latest', 'transmission-daemon') },
  noPassword: {
    path: '/transmission/rpc',
    test: (http) => {
      const r = http['/transmission/rpc'];
      return !r || !r.status ? null : r.status === 409 ? true : r.status === 401 ? false : null;
    },
    power: 'add downloads, change settings or delete files',
    how: [
      'linuxserver image: add USER and PASS to its environment in docker-compose.yml, then docker compose up -d transmission.',
      'Otherwise: stop Transmission, set "rpc-authentication-required": true with rpc-username and rpc-password in settings.json, and start it again.',
    ],
  },
  checks: ['APP-NO-PASSWORD'],
};
