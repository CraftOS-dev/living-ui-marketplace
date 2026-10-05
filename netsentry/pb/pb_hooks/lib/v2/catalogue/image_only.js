/**
 * Apps recognised by their image only (they need a database or cache to start,
 * so the lab has not recorded their answers yet). They get the generic checks —
 * who can reach them, updates, backups, up — but no app-specific ones until a
 * recording verifies what they answer.
 */
const { updateHow } = require('./_common.js');

function imageOnly(o) {
  return {
    id: o.id,
    version: 1,
    name: o.name,
    category: o.category,
    what: o.what,
    sources: Object.assign({ verified: 'image name only — answers not yet recorded in the lab' }, o.sources),
    template: o.template,
    recognise: { images: o.images, containerPorts: o.ports, ports: o.ports, processes: o.processes || [], http: { path: '/', want: 'status', match: () => false } },
    probe: [{ path: '/', want: 'status' }],
    versionFrom: () => '',
    config: [],
    defaultIntent: o.intent,
    data: { important: o.important, lose: o.lose, skip: o.skip || [] },
    updates: { github: o.repo, advisories: 'github', how: updateHow(o.id, o.images[0] + ':release') },
    checks: [],
  };
}

const ENTRIES = [
  imageOnly({
    id: 'immich', name: 'Immich', category: 'files', what: 'your photo and video library', ports: [2283], repo: 'immich-app/immich',
    images: ['ghcr.io/immich-app/immich-server', 'altran1502/immich-server'], intent: 'local_plus_private_remote',
    important: ['the upload folder (your photos and videos) and its database'], lose: 'your photos, videos and albums',
    sources: { docker: 'https://immich.app/docs/install/docker-compose', backups: 'https://immich.app/docs/administration/backup-and-restore', releases: 'https://github.com/immich-app/immich/releases' },
  }),
  imageOnly({
    id: 'photoprism', name: 'PhotoPrism', category: 'files', what: 'your photo library', ports: [2342], repo: 'photoprism/photoprism',
    images: ['photoprism/photoprism'], intent: 'local_plus_private_remote',
    important: ['your originals folder and the storage folder (index and settings)'], lose: 'your photo library, albums and labels',
    sources: { docker: 'https://docs.photoprism.app/getting-started/docker-compose/', releases: 'https://github.com/photoprism/photoprism/releases' },
  }),
  imageOnly({
    id: 'paperless', name: 'Paperless-ngx', category: 'files', what: 'your scanned documents', ports: [8000], repo: 'paperless-ngx/paperless-ngx',
    images: ['ghcr.io/paperless-ngx/paperless-ngx', 'paperlessngx/paperless-ngx'], intent: 'local_plus_private_remote',
    important: ['the media folder (your documents) and the data folder'], lose: 'every document you scanned',
    sources: { docker: 'https://docs.paperless-ngx.com/setup/#docker', backups: 'https://docs.paperless-ngx.com/administration/#backup', releases: 'https://github.com/paperless-ngx/paperless-ngx/releases' },
  }),
  imageOnly({
    id: 'frigate', name: 'Frigate', category: 'home', what: 'your camera recorder', ports: [5000, 8971], repo: 'blakeblackshear/frigate',
    images: ['ghcr.io/blakeblackshear/frigate', 'blakeblackshear/frigate'], intent: 'local_network',
    important: ['the config folder (/config)'], lose: 'your camera settings and zones', skip: ['recordings — usually too big to back up'],
    sources: { docker: 'https://docs.frigate.video/frigate/installation', auth: 'https://docs.frigate.video/configuration/authentication', releases: 'https://github.com/blakeblackshear/frigate/releases' },
  }),
];

module.exports = ENTRIES;
// Other catalogue files build their own image-only entries with it.
module.exports.imageOnly = imageOnly;
