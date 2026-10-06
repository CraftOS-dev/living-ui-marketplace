/**
 * The app catalogue (plan §14): what NetSentry knows about the apps people
 * run. Ships inside the Agent App and changes only with app updates (D9).
 * One file per app; add an app = add a file here.
 */
const ENTRIES = [
  // media
  require('./jellyfin.js'), require('./plex.js'), require('./emby.js'), require('./jellyseerr.js'),
  // downloads
  require('./sonarr.js'), require('./radarr.js'), require('./lidarr.js'), require('./prowlarr.js'), require('./bazarr.js'),
  require('./qbittorrent.js'), require('./transmission.js'), require('./sabnzbd.js'),
  // home
  require('./homeassistant.js'), require('./adguardhome.js'), require('./pihole.js'), require('./nodered.js'),
  // files and photos
  require('./nextcloud.js'), require('./syncthing.js'), require('./vaultwarden.js'),
]
  // organisations: code, infrastructure, business apps, databases
  .concat(require('./forges.js'), require('./infra.js'), require('./monitoring.js'), require('./databases.js'), require('./business.js'), [require('./netsentry.js')])
  .concat(require('./image_only.js'))
  // v4 §7.4: any container nothing above matched (never matched by image; recognise.js adds it last)
  .concat([require('./generic.js')]);

const BY_ID = {};
for (const e of ENTRIES) BY_ID[e.id] = e;

/** "lscr.io/linuxserver/jellyfin:10.9@sha256:…" → "lscr.io/linuxserver/jellyfin"; docker.io and library/ dropped. */
function imageRepo(image) {
  let s = String(image || '').toLowerCase().split('@')[0];
  const lastSlash = s.lastIndexOf('/');
  const colon = s.indexOf(':', lastSlash + 1);
  if (colon >= 0) s = s.slice(0, colon);
  s = s.replace(/^docker\.io\//, '').replace(/^index\.docker\.io\//, '').replace(/^library\//, '');
  return s;
}

function byImage(image) {
  const repo = imageRepo(image);
  return ENTRIES.find((e) => e.recognise.images.some((i) => imageRepo(i) === repo)) || null;
}

function byProcess(process) {
  const p = String(process || '').toLowerCase();
  return p ? ENTRIES.find((e) => e.recognise.processes.indexOf(p) >= 0) || null : null;
}

module.exports = { ALL: ENTRIES, get: (id) => BY_ID[id] || null, imageRepo, byImage, byProcess };
