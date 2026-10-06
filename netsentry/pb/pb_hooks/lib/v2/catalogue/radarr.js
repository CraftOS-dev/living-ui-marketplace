/** Radarr — lab-verified (tests/fixtures/catalogue/radarr.json). */
module.exports = require('./_common.js').servarr({
  id: 'radarr', name: 'Radarr', repo: 'Radarr/Radarr', port: 7878,
  what: 'your movie downloader', lose: 'your list of movies, quality settings and download history',
  power: 'change settings, add or delete movies, and see your download accounts',
});
