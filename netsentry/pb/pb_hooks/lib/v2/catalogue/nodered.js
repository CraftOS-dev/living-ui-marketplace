/** Node-RED — lab-verified (tests/fixtures/catalogue/nodered.json: a fresh start serves /flows and /settings without a login). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'nodered',
  version: 1,
  name: 'Node-RED',
  category: 'home',
  what: 'your automation flows',
  sources: {
    security: 'https://nodered.org/docs/user-guide/runtime/securing-node-red',
    docker: 'https://nodered.org/docs/getting-started/docker',
    releases: 'https://github.com/node-red/node-red/releases',
    lab: 'tests/fixtures/catalogue/nodered.json',
  },
  recognise: {
    images: ['nodered/node-red'],
    containerPorts: [1880],
    ports: [1880],
    processes: ['node-red'],
    http: { path: '/settings', want: 'json', match: (r) => !!(r && r.json && typeof r.json.httpNodeRoot === 'string') },
  },
  probe: [
    { path: '/settings', want: 'json' },
    { path: '/flows', want: 'status' },
  ],
  versionFrom: (http) => {
    const r = http['/settings'];
    return r && r.json && r.json.version ? String(r.json.version) : '';
  },
  config: [],
  defaultIntent: 'local_network',
  data: { important: ['your flows and credentials (/data in the container)'], lose: 'all your flows', skip: [] },
  updates: { github: 'node-red/node-red', advisories: 'github', how: updateHow('nodered', 'nodered/node-red:latest') },
  // Without adminAuth, the editor and its API answer anyone; flows can run commands on the machine.
  noPassword: {
    path: '/flows',
    test: (http) => {
      const r = http['/flows'];
      return !r || !r.status ? null : r.status === 200 ? true : r.status === 401 ? false : null;
    },
    power: 'change your flows — and through them run any command on this server',
    how: (a) => [
      `Make a password hash: docker exec -it ${a.container} node-red admin hash-pw`,
      'In /data/settings.js, turn on adminAuth with a user and that hash (see "Securing Node-RED" in the Node-RED docs).',
      `Restart it: docker compose restart ${a.service}`,
    ],
  },
  checks: ['APP-NO-PASSWORD'],
};
