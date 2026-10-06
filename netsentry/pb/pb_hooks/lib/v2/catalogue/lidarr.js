/** Lidarr — lab-verified (tests/fixtures/catalogue/lidarr.json). */
module.exports = require('./_common.js').servarr({
  id: 'lidarr', name: 'Lidarr', repo: 'Lidarr/Lidarr', port: 8686,
  what: 'your music downloader', lose: 'your list of artists, quality settings and download history',
  power: 'change settings, add or delete music, and see your download accounts',
});
