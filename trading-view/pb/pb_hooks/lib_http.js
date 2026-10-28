/// <reference path="../pb_data/types.d.ts" />
/**
 * Outbound HTTP for market data: one token bucket per provider, retries with
 * backoff on 429/5xx, a cool-down after repeated throttling, and a health
 * record per provider the UI shows (ok, throttled, down).
 *
 * Free market data is fragile (Yahoo throttles bursts, nobody guarantees
 * uptime), so callers never hammer a provider: they ask through here, and
 * when a provider is cooling down they serve cached bars marked stale.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Requests per second and burst size per provider. */
const LIMITS = {
  yahoo: { rate: 3, burst: 6 },
  binance: { rate: 12, burst: 24 },
};

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Take a token; returns milliseconds to wait when the bucket is empty. */
function take(app, provider) {
  const lim = LIMITS[provider] || { rate: 2, burst: 4 };
  const key = 'tv_rl_' + provider;
  const now = Date.now();
  const s = app.store().get(key) || { tokens: lim.burst, ts: now };
  const tokens = Math.min(lim.burst, s.tokens + ((now - s.ts) / 1000) * lim.rate);
  if (tokens >= 1) {
    app.store().set(key, { tokens: tokens - 1, ts: now });
    return 0;
  }
  app.store().set(key, { tokens: tokens, ts: now });
  return Math.ceil(((1 - tokens) / lim.rate) * 1000);
}

function health(app, provider) {
  return app.store().get('tv_health_' + provider) || { provider: provider, state: 'unknown', message: '', at: 0, cool_until: 0 };
}

function setHealth(app, provider, state, message, coolMs) {
  const prev = health(app, provider);
  app.store().set('tv_health_' + provider, {
    provider: provider,
    state: state,
    message: message || '',
    at: Date.now(),
    cool_until: coolMs ? Date.now() + coolMs : state === 'ok' ? 0 : prev.cool_until,
  });
}

function cooling(app, provider) {
  return health(app, provider).cool_until > Date.now();
}

/**
 * GET a JSON document. Throws {status} errors: 502 when the provider answers
 * with an error, 503 when it does not answer or is cooling down.
 */
function getJson(app, provider, url, timeoutSec) {
  if (cooling(app, provider)) throw fail(503, provider + ' is throttling requests; showing cached data. Retry in a minute.');
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = take(app, provider);
    if (wait > 0) sleep(Math.min(wait, 2000));
    let res = null;
    try {
      res = $http.send({ url: url, method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: timeoutSec || 12 });
    } catch (err) {
      lastErr = String((err && err.message) || err);
      sleep(250 * (attempt + 1));
      continue;
    }
    if (res.statusCode === 200) {
      setHealth(app, provider, 'ok', '');
      return res.json;
    }
    if (res.statusCode === 429 || res.statusCode === 418 || res.statusCode >= 500) {
      lastErr = 'HTTP ' + res.statusCode;
      sleep(400 * (attempt + 1));
      continue;
    }
    // A clean refusal (404 unknown symbol, 400 bad range): no retry.
    let detail = '';
    try {
      const j = res.json;
      detail = (j && ((j.chart && j.chart.error && j.chart.error.description) || (j.finance && j.finance.error && j.finance.error.description) || j.msg)) || '';
    } catch {
      detail = '';
    }
    setHealth(app, provider, 'ok', '');
    throw fail(res.statusCode === 404 ? 404 : 502, provider + ' answered HTTP ' + res.statusCode + (detail !== '' ? ': ' + detail : ''));
  }
  const throttled = lastErr.indexOf('429') >= 0 || lastErr.indexOf('418') >= 0;
  setHealth(app, provider, throttled ? 'throttled' : 'down', lastErr, throttled ? 60000 : 15000);
  throw fail(503, provider + (throttled ? ' is throttling requests' : ' is not answering') + ' (' + lastErr + ')');
}

module.exports = { UA: UA, take: take, health: health, setHealth: setHealth, cooling: cooling, getJson: getJson };
