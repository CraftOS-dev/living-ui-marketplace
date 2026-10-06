/** Plex Media Server — lab-verified (tests/fixtures/catalogue/plex.json: /identity claimed="0" on a fresh server). */
const { updateHow } = require('./_common.js');

/** An attribute of Plex's <MediaContainer> element (not the XML declaration's version="1.0"). */
function attr(text, name) {
  const t = String(text || '');
  const start = t.indexOf('<MediaContainer');
  if (start < 0) return null;
  const tag = t.slice(start, t.indexOf('>', start) + 1 || t.length);
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) return null;
  const from = at + key.length;
  return tag.slice(from, tag.indexOf('"', from));
}

module.exports = {
  id: 'plex',
  version: 1,
  name: 'Plex',
  category: 'media',
  what: 'your media server (movies, shows, music)',
  sources: {
    docker: 'https://github.com/plexinc/pms-docker',
    claiming: 'https://support.plex.tv/articles/200288586-installation/',
    url_commands: 'https://support.plex.tv/articles/201638786-plex-media-server-url-commands/',
    lab: 'tests/fixtures/catalogue/plex.json',
  },
  recognise: {
    images: ['plexinc/pms-docker', 'lscr.io/linuxserver/plex', 'linuxserver/plex', 'ghcr.io/hotio/plex', 'hotio/plex'],
    containerPorts: [32400],
    ports: [32400],
    processes: ['plex media server', 'plex media server.exe', 'plexmediaserver'],
    http: { path: '/identity', want: 'text', match: (r) => !!(r && r.status === 200 && /<MediaContainer[^>]*machineIdentifier=/.test(r.text || '')) },
  },
  probe: [{ path: '/identity', want: 'text' }],
  versionFrom: (http) => (attr((http['/identity'] || {}).text, 'version') || '').split('-')[0],
  config: [],
  defaultIntent: 'local_plus_private_remote',
  data: { important: ['Plex settings, watch history and metadata (/config in the container)'], lose: "your libraries' settings and everyone's watch history", skip: ['your media files'] },
  // Plex publishes no releases or advisories on GitHub: updates are checked by Plex itself.
  updates: { how: updateHow('plex', 'plexinc/pms-docker:latest', 'plexmediaserver') },
  // An unclaimed server can be claimed by anyone who reaches it (lab: claimed="0").
  setup: {
    path: '/identity',
    open: (r) => {
      const c = r ? attr(r.text, 'claimed') : null;
      return c === null ? null : c === '0';
    },
    becomes: 'its owner, with your libraries',
    how: (a, url) => [`On ${a.machine}, open ${url}/web in a browser and sign in with your Plex account — this claims the server as yours.`, 'Check that Settings → General shows your account as the owner.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
