/** Bazarr — lab-verified (tests/fixtures/catalogue/bazarr.json: page title "Bazarr"; its API asks for a key). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'bazarr',
  version: 1,
  name: 'Bazarr',
  category: 'download',
  what: 'your subtitle downloader',
  sources: {
    docs: 'https://wiki.bazarr.media/',
    linuxserver: 'https://docs.linuxserver.io/images/docker-bazarr/',
    releases: 'https://github.com/morpheus65535/bazarr/releases',
    lab: 'tests/fixtures/catalogue/bazarr.json',
  },
  recognise: {
    images: ['lscr.io/linuxserver/bazarr', 'linuxserver/bazarr', 'ghcr.io/hotio/bazarr', 'hotio/bazarr'],
    containerPorts: [6767],
    ports: [6767],
    processes: ['bazarr'],
    http: { path: '/', want: 'title', match: (r) => !!(r && r.title === 'Bazarr') },
  },
  probe: [{ path: '/', want: 'title' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  data: { important: ["Bazarr's settings and database (/config in the container)"], lose: 'your subtitle settings and provider logins', skip: ['subtitle files'] },
  updates: { github: 'morpheus65535/bazarr', advisories: 'github', how: updateHow('bazarr', 'lscr.io/linuxserver/bazarr:latest') },
  checks: [],
};
