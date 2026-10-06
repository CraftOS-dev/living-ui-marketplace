/** Pi-hole — lab-verified (tests/fixtures/catalogue/pihole.json: /admin/ title "Pi-hole …"; v6 API asks for the password). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'pihole',
  version: 1,
  name: 'Pi-hole',
  category: 'home',
  what: 'your ad blocker and home DNS server',
  sources: {
    docker: 'https://github.com/pi-hole/docker-pi-hole',
    docs: 'https://docs.pi-hole.net/',
    releases: 'https://github.com/pi-hole/pi-hole/releases',
    lab: 'tests/fixtures/catalogue/pihole.json',
  },
  recognise: {
    images: ['pihole/pihole'],
    containerPorts: [80, 53],
    webPorts: [80],
    ports: [80, 53],
    processes: ['pihole-ftl'],
    http: { path: '/admin/', want: 'title', match: (r) => !!(r && /^Pi-hole/.test(r.title || '')) },
  },
  probe: [{ path: '/admin/', want: 'title' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  data: { important: ['Pi-hole settings (/etc/pihole)'], lose: 'your block lists, allow lists and settings', skip: ['query logs'] },
  updates: { github: 'pi-hole/pi-hole', advisories: 'github', how: updateHow('pihole', 'pihole/pihole:latest') },
  checks: [],
};
