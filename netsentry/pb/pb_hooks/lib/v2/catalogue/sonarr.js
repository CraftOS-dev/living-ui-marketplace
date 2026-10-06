/** Sonarr — lab-verified (tests/fixtures/catalogue/sonarr.json, sonarr_login_on.json). */
module.exports = require('./_common.js').servarr({
  id: 'sonarr', name: 'Sonarr', repo: 'Sonarr/Sonarr', port: 8989,
  what: 'your TV-show downloader', lose: 'your list of shows, quality settings and download history',
  power: 'change settings, add or delete shows, and see your download accounts',
});
