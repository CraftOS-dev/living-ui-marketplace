/** Prowlarr — lab-verified (tests/fixtures/catalogue/prowlarr.json). */
module.exports = require('./_common.js').servarr({
  id: 'prowlarr', name: 'Prowlarr', repo: 'Prowlarr/Prowlarr', port: 9696,
  what: 'the index manager for your downloaders', lose: 'your indexers and the logins stored for them',
  power: 'read the indexer accounts and passwords stored in it, and change your downloaders',
});
