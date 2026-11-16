/** SCRATCH STUB (committee tests only, never shipped): lib_deals_notes.forDeal. Every deal has one note. */
function forDeal(app, dealId) {
  return [{ id: 'stubnote' + String(dealId).slice(0, 7), title: 'First call', deal: dealId }];
}
module.exports = { forDeal: forDeal };
