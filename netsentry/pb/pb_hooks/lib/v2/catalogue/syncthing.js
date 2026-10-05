/** Syncthing — lab-verified (tests/fixtures/catalogue/syncthing.json; the fresh config.xml <gui> has no <user>/<password>, address 0.0.0.0:8384). */
const { updateHow } = require('./_common.js');

const KEYS = [{ key: 'user' }, { key: 'password', secret: true }, { key: 'address' }];

module.exports = {
  id: 'syncthing',
  version: 1,
  name: 'Syncthing',
  category: 'files',
  what: 'the app that keeps your folders in sync between devices',
  sources: {
    gui: 'https://docs.syncthing.net/users/guisettings.html',
    config: 'https://docs.syncthing.net/users/config.html',
    linuxserver: 'https://docs.linuxserver.io/images/docker-syncthing/',
    releases: 'https://github.com/syncthing/syncthing/releases',
    lab: 'tests/fixtures/catalogue/syncthing.json',
  },
  recognise: {
    images: ['lscr.io/linuxserver/syncthing', 'linuxserver/syncthing', 'syncthing/syncthing'],
    containerPorts: [8384],
    ports: [8384],
    processes: ['syncthing', 'syncthing.exe'],
    http: { path: '/rest/noauth/health', want: 'json', match: (r) => !!(r && r.json && r.json.status === 'OK') },
  },
  probe: [{ path: '/rest/noauth/health', want: 'json' }],
  versionFrom: () => '',
  config: [
    { images: ['lscr.io/linuxserver/syncthing', 'linuxserver/syncthing'], path: '/config/config.xml', format: 'xml', keys: KEYS },
    { images: ['syncthing/syncthing'], path: '/var/syncthing/config/config.xml', format: 'xml', keys: KEYS },
  ],
  defaultIntent: 'local_network',
  data: { important: ['Syncthing config and keys (/config in the container)'], lose: 'your device pairings and folder settings', skip: ['the synced folders — they live on your other devices too'] },
  updates: { github: 'syncthing/syncthing', advisories: 'github', how: updateHow('syncthing', 'lscr.io/linuxserver/syncthing:latest', 'syncthing') },
  noPassword: {
    test: (http, cfg) => {
      if (!cfg) return null;
      const pw = cfg.password;
      return !cfg.user && !(pw && pw.set);
    },
    power: 'share your folders with any device they choose, or read and delete your files',
    how: ['Open Syncthing → Actions → Settings → GUI.', 'Set a GUI Authentication User and a strong Password, and click Save.'],
  },
  checks: ['APP-NO-PASSWORD'],
};
