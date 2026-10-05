/**
 * PURE — source scheduling, failure backoff and health.
 */

const DAY_MINUTES = 1440;

/** Next run: the schedule on success; exponential backoff (capped at 24 h) on failure. */
function nextRunAt(nowMs, scheduleMinutes, consecutiveFailures) {
  const f = Math.max(0, consecutiveFailures || 0);
  let minutes = scheduleMinutes;
  if (f > 0) {
    // Retry sooner than the normal schedule at first, then back off.
    const retry = Math.min(scheduleMinutes, 15) * Math.pow(2, Math.min(f - 1, 6));
    minutes = Math.min(retry, DAY_MINUTES);
  }
  return new Date(nowMs + minutes * 60000).toISOString();
}

function healthFor(consecutiveFailures) {
  if (!consecutiveFailures) return 'ok';
  return consecutiveFailures >= 3 ? 'failing' : 'degraded';
}

module.exports = { nextRunAt, healthFor };
