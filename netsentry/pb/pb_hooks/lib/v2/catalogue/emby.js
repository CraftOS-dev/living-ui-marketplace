/** Emby — lab-verified (tests/fixtures/catalogue/emby.json: /emby/System/Info/Public has Version and no ProductName, unlike Jellyfin). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'emby',
  version: 1,
  name: 'Emby',
  category: 'media',
  what: 'your media server (movies, shows, music)',
  sources: {
    docker: 'https://hub.docker.com/r/emby/embyserver',
    releases: 'https://github.com/MediaBrowser/Emby.Releases/releases',
    lab: 'tests/fixtures/catalogue/emby.json',
  },
  recognise: {
    images: ['emby/embyserver', 'lscr.io/linuxserver/emby', 'linuxserver/emby'],
    containerPorts: [8096],
    ports: [8096],
    processes: ['embyserver', 'embyserver.exe'],
    // Same shape as Jellyfin's answer minus ProductName and StartupWizardCompleted (lab).
    http: { path: '/emby/System/Info/Public', want: 'json', match: (r) => !!(r && r.json && r.json.Version && r.json.Id && !r.json.ProductName && !('StartupWizardCompleted' in r.json)) },
  },
  probe: [{ path: '/emby/System/Info/Public', want: 'json' }],
  versionFrom: (http) => {
    const r = http['/emby/System/Info/Public'];
    return r && r.json && r.json.Version ? String(r.json.Version) : '';
  },
  config: [],
  defaultIntent: 'local_plus_private_remote',
  data: { important: ['Emby settings and watch history (/config in the container)'], lose: "your users, settings and everyone's watch history", skip: ['your media files'] },
  updates: { github: 'MediaBrowser/Emby.Releases', advisories: 'github', how: updateHow('emby', 'emby/embyserver:latest') },
  checks: [],
};
