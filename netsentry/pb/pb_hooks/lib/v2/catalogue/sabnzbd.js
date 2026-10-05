/** SABnzbd — lab-verified (tests/fixtures/catalogue/sabnzbd.json: fresh start shows the Quick-Start Wizard; version answers without a key). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'sabnzbd',
  version: 1,
  name: 'SABnzbd',
  category: 'download',
  what: 'your Usenet downloader',
  sources: {
    wizard: 'https://sabnzbd.org/wiki/introduction/quick-setup',
    api: 'https://sabnzbd.org/wiki/configuration/4.5/api',
    linuxserver: 'https://docs.linuxserver.io/images/docker-sabnzbd/',
    releases: 'https://github.com/sabnzbd/sabnzbd/releases',
    lab: 'tests/fixtures/catalogue/sabnzbd.json',
  },
  recognise: {
    images: ['lscr.io/linuxserver/sabnzbd', 'linuxserver/sabnzbd', 'ghcr.io/hotio/sabnzbd', 'hotio/sabnzbd'],
    containerPorts: [8080],
    ports: [8080],
    processes: ['sabnzbd', 'sabnzbd.exe', 'sabnzbd.py'],
    http: { path: '/', want: 'title', match: (r) => !!(r && /SABnzbd/.test(r.title || '')) },
  },
  probe: [
    { path: '/', want: 'title' },
    { path: '/api?mode=version&output=json', want: 'json' },
  ],
  versionFrom: (http) => {
    const r = http['/api?mode=version&output=json'];
    return r && r.json && r.json.version ? String(r.json.version) : '';
  },
  config: [],
  defaultIntent: 'local_network',
  data: { important: ['SABnzbd settings (/config in the container)'], lose: 'your news-server logins and settings', skip: ['downloads'] },
  updates: { github: 'sabnzbd/sabnzbd', advisories: 'github', how: updateHow('sabnzbd', 'lscr.io/linuxserver/sabnzbd:latest') },
  setup: {
    path: '/',
    open: (r) => (r && typeof r.title === 'string' && r.title ? /Quick-Start Wizard/i.test(r.title) : null),
    becomes: 'its admin, and use your news-server account',
    how: (a, url) => [`Open ${url} in your browser now and finish the Quick-Start Wizard.`, 'Then in Config → General, set a username and a strong password for the web interface.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
