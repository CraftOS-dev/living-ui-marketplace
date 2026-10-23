/// <reference path="../pb_data/types.d.ts" />
/**
 * Hourly background work. Each job keeps its own cursor in settings.jobs so a
 * restart never repeats or skips work.
 */

function hourly(app) {
  const assets = (() => {
    try {
      return require(`${__hooks}/lib_assets.js`);
    } catch {
      return null;
    }
  })();
  if (assets !== null && typeof assets.scheduled === 'function') assets.scheduled(app);
}

module.exports = { hourly: hourly };
