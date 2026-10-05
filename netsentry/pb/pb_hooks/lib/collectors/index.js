/**
 * Collector registry — a plain list. Adding a collector = one file + one line.
 *
 * Collector contract:
 *   id, title, appliesTo: asset kinds (null = global), scheduleMinutes,
 *   kinds(asset) → observation kinds it fully owns for that asset,
 *   remote?: true (the sensor runs it; see sensor.js), signalKinds?: [],
 *   collect({ asset }, deps) → { observations?, discovered?, baselineIfMissing?,
 *                                intel?, indicators?, note?, partialError? }
 */
const intel = require('./intel.js');
const sensor = require('./sensor.js');

const ALL = [
  intel.kev,
  intel.epss,
  intel.blocklists,
  sensor.liveness,
].concat(sensor.REMOTE);

const BY_ID = {};
for (const c of ALL) BY_ID[c.id] = c;

function get(id) {
  return BY_ID[id] || null;
}

/** Collectors that should run for an asset of this kind. */
function forAssetKind(kind) {
  return ALL.filter((c) => c.appliesTo && c.appliesTo.indexOf(kind) >= 0);
}

module.exports = { ALL, get, forAssetKind };
