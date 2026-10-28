/// <reference path="../pb_data/types.d.ts" />
/**
 * Market data, whichever provider serves a symbol:
 *
 *   symbols  "AAPL", "^GSPC", "EURUSD=X", "GC=F", "BTC-USD" (Yahoo) and
 *            "BINANCE:BTCUSDT" (Binance). "EUR/USD" and "BTC/USDT" are
 *            accepted and written the canonical way.
 *   bars     served from the persistent cache (collection `bars`, one row
 *            per symbol|interval and bar time). A request refreshes only the
 *            tail once its freshness window has passed (seconds while the
 *            market is open, minutes when it is closed) and pages further
 *            back only when more history is asked for. 4h stock bars are
 *            built from 1h bars, each group starting at its session open.
 *   quotes   batched (Yahoo spark, Binance 24h tickers), kept a few seconds
 *            in memory so every widget asking at once costs one request.
 *
 * When a provider throttles or is down, cached bars are served and marked
 * stale with the reason, never an empty chart.
 */

const IV_SEC = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800, '1M': 2592000 };
const INTERVALS = Object.keys(IV_SEC);
const INTRADAY = { '1m': true, '5m': true, '15m': true, '30m': true, '1h': true, '4h': true };
const MAX_BARS = 5000;
const CRYPTO_QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'BTC', 'ETH', 'BNB'];
const DAY = 86400;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/* ---------------------------------------------------------------- symbols */

/** Canonical symbol, or a 400 that shows how to write one. */
function normalize(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (s === '') throw fail(400, 'symbol is required, e.g. AAPL, ^GSPC, EURUSD=X or BINANCE:BTCUSDT');
  if (s.indexOf('BINANCE:') === 0) {
    const pair = s.slice(8).replace(/[^A-Z0-9]/g, '');
    if (pair.length < 4) throw fail(400, 'write a Binance pair like BINANCE:BTCUSDT');
    return 'BINANCE:' + pair;
  }
  const slash = s.indexOf('/');
  if (slash > 0) {
    const base = s.slice(0, slash).replace(/[^A-Z0-9]/g, '');
    const quote = s.slice(slash + 1).replace(/[^A-Z0-9]/g, '');
    if (CRYPTO_QUOTES.indexOf(quote) >= 0) return 'BINANCE:' + base + quote;
    if (base.length === 3 && quote.length === 3) return base + quote + '=X';
  }
  if (!/^[A-Z0-9^=.\-&]{1,32}$/.test(s)) throw fail(400, '"' + raw + '" is not a symbol; write it like AAPL, ^GSPC, EURUSD=X, GC=F, BTC-USD or BINANCE:BTCUSDT');
  return s;
}

function provider(sym) {
  return sym.indexOf('BINANCE:') === 0 ? 'binance' : 'yahoo';
}

/** Canonical interval from many spellings (5, 5m, 60, 1h, D, 1d, W, M, 1mo). */
function interval(raw, dflt) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim();
  if (v === '') {
    if (dflt) return dflt;
    throw fail(400, 'interval is required: one of ' + INTERVALS.join(', '));
  }
  if (IV_SEC[v]) return v;
  if (v === 'M' || v === '1M' || v === '1mo' || v === 'mo' || v.toLowerCase() === 'month') return '1M';
  const map = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', '60m': '1h', h: '1h', '1h': '1h', 240: '4h', '4h': '4h', d: '1D', '1d': '1D', day: '1D', w: '1W', '1w': '1W', '1wk': '1W', week: '1W' };
  const hit = map[v.toLowerCase()];
  if (hit) return hit;
  throw fail(400, 'interval must be one of ' + INTERVALS.join(', ') + ' (got "' + v + '")');
}

/* --------------------------------------------------------------- metadata */

function remember(app, m) {
  app.store().set('tv_meta|' + m.symbol, { at: Date.now(), m: m });
}

function fromRecord(rec) {
  let sessions = null;
  try {
    const raw = rec.getString('sessions');
    sessions = raw && raw !== 'null' ? JSON.parse(raw) : null;
  } catch {
    sessions = null;
  }
  const extra = (sessions && sessions._extra) || {};
  return {
    symbol: rec.getString('symbol'),
    provider: rec.getString('provider') || 'yahoo',
    name: rec.getString('name'),
    exchange: rec.getString('exchange'),
    type: rec.getString('type'),
    currency: rec.getString('currency'),
    tz: rec.getString('tz') || 'UTC',
    price_hint: rec.getInt('price_hint'),
    sessions: sessions && sessions.regular ? { regular: sessions.regular, pre: sessions.pre, post: sessions.post } : null,
    gmtoffset: extra.gmtoffset || 0,
    first_trade: extra.first_trade || null,
    ext_hours: extra.ext_hours === true,
  };
}

/** Keep the instrument record current (written only when something changed). */
function saveMeta(app, m) {
  remember(app, m);
  try {
    const rows = app.findRecordsByFilter('symbols', 'symbol = {:s}', '', 1, 0, { s: m.symbol });
    const rec = rows.length > 0 ? rows[0] : new Record(app.findCollectionByNameOrId('symbols'));
    const sessions = Object.assign({}, m.sessions || {}, { _extra: { gmtoffset: m.gmtoffset || 0, first_trade: m.first_trade || null, ext_hours: m.ext_hours === true } });
    const next = {
      symbol: m.symbol,
      provider: m.provider,
      name: String(m.name || '').slice(0, 200),
      exchange: String(m.exchange || '').slice(0, 80),
      type: String(m.type || '').slice(0, 30),
      currency: String(m.currency || '').slice(0, 12),
      tz: String(m.tz || 'UTC').slice(0, 60),
      price_hint: m.price_hint || 0,
    };
    let changed = rows.length === 0;
    for (const k of Object.keys(next)) {
      if (String(rec.get(k)) !== String(next[k])) {
        rec.set(k, next[k]);
        changed = true;
      }
    }
    if (rec.getString('sessions') !== JSON.stringify(sessions)) {
      rec.set('sessions', sessions);
      changed = true;
    }
    const fetched = Date.parse(rec.getString('fetched').replace(' ', 'T'));
    if (!changed && isFinite(fetched) && Date.now() - fetched < 6 * 3600 * 1000) return;
    rec.set('fetched', new Date().toISOString());
    app.save(rec);
  } catch (err) {
    // Two requests creating the same symbol at once: the other one saved it.
    console.warn('[trading-view] saving symbol details failed:', m.symbol, err);
  }
}

/** Instrument details: memory, then the symbols record, then the provider. */
function meta(app, raw) {
  const sym = normalize(raw);
  const mem = app.store().get('tv_meta|' + sym);
  if (mem && Date.now() - mem.at < 6 * 3600 * 1000) return mem.m;
  if (provider(sym) === 'binance') {
    const bn = require(`${__hooks}/lib_binance.js`);
    const pair = sym.slice(8);
    let known = true;
    try {
      known = bn.pairs(app).indexOf(pair) >= 0;
    } catch {
      known = true; // listing unavailable: let the bar request decide
    }
    if (!known) throw fail(404, sym + ' is not a Binance pair; search for it with market.search');
    const m = bn.meta(pair);
    remember(app, m);
    return m;
  }
  const rows = app.findRecordsByFilter('symbols', 'symbol = {:s}', '', 1, 0, { s: sym });
  const rec = rows.length > 0 ? rows[0] : null;
  if (rec) {
    const fetched = Date.parse(rec.getString('fetched').replace(' ', 'T'));
    if (isFinite(fetched) && Date.now() - fetched < 24 * 3600 * 1000) {
      const m = fromRecord(rec);
      remember(app, m);
      return m;
    }
  }
  try {
    const y = require(`${__hooks}/lib_yahoo.js`);
    const now = nowSec();
    const r = y.chart(app, sym, '1d', now - 10 * DAY, now + 60, false);
    saveMeta(app, r.meta);
    return r.meta;
  } catch (err) {
    if (rec && err.status !== 404) {
      const m = fromRecord(rec);
      remember(app, m);
      return m;
    }
    if (err.status === 404) throw fail(404, 'No instrument "' + sym + '" at Yahoo Finance; search for it with market.search');
    throw err;
  }
}

/* --------------------------------------------------------------- sessions */

/** Whether the market is (about to be, or just was) trading, for cache freshness. */
function isLive(m, now) {
  if (m.provider === 'binance' || m.type === 'CRYPTOCURRENCY') return true;
  const s = m.sessions;
  if (!s || !s.regular) return true;
  const local = now + (m.gmtoffset || 0);
  const dow = (Math.floor(local / DAY) + 4) % 7; // 0 = Sunday
  const minute = Math.floor((((local % DAY) + DAY) % DAY) / 60);
  const roundClock = m.type === 'CURRENCY' || m.type === 'FUTURE';
  if (dow === 6) return false;
  if (dow === 0) return roundClock && minute >= 17 * 60;
  if (roundClock) return true;
  const start = (s.pre || s.regular)[0] - 5;
  const end = (s.post || s.regular)[1] + 20;
  return minute >= start && minute < end;
}

/** Seconds a cached tail stays fresh. */
function ttl(m, iv, now) {
  const live = isLive(m, now);
  if (!live) return INTRADAY[iv] ? 15 * 60 : 30 * 60;
  if (m.provider === 'binance') return iv === '1m' ? 2 : iv === '5m' ? 3 : INTRADAY[iv] ? 5 : 10;
  return iv === '1m' ? 15 : iv === '5m' || iv === '15m' ? 20 : INTRADAY[iv] ? 30 : iv === '1D' ? 60 : 300;
}

/** Calendar seconds that hold about `n` bars of an interval. */
function spanFor(m, iv, n, ext) {
  if (iv === '1M') return n * 31 * DAY + 62 * DAY;
  if (iv === '1W') return n * 7 * DAY + 14 * DAY;
  const roundClock = m.provider === 'binance' || m.type === 'CRYPTOCURRENCY';
  const weekdays = m.type === 'CURRENCY' || m.type === 'FUTURE';
  if (iv === '1D') return Math.ceil(n * DAY * (roundClock ? 1 : 1.45)) + 6 * DAY;
  const ivSec = IV_SEC[iv];
  if (roundClock) return n * ivSec + ivSec * 2;
  let minutes = 1440;
  const s = m.sessions;
  if (!weekdays && s && s.regular) {
    const a = ext && s.pre ? s.pre[0] : s.regular[0];
    const b = ext && s.post ? s.post[1] : s.regular[1];
    minutes = Math.max(60, b - a);
  }
  const perDay = Math.max(1, (minutes * 60) / ivSec);
  const days = Math.ceil(n / perDay);
  return Math.ceil(days * 1.45) * DAY + 4 * DAY;
}

/* ------------------------------------------------------------ bar storage */

function readBars(app, key, before, n) {
  const rows = arrayOf(new DynamicModel({ t: 0, o: -0, h: -0, l: -0, c: -0, v: -0 }));
  app
    .db()
    .newQuery('SELECT t, o, h, l, c, v FROM bars WHERE key = {:k} AND t < {:b} ORDER BY t DESC LIMIT {:n}')
    .bind({ k: key, b: before, n: n })
    .all(rows);
  const out = new Array(rows.length);
  for (let i = rows.length - 1, j = 0; i >= 0; i--, j++) {
    const r = rows[i];
    out[j] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v };
  }
  return out;
}

function edge(app, key, fn) {
  const row = new DynamicModel({ t: 0, n: 0 });
  app
    .db()
    .newQuery('SELECT COALESCE(' + fn + '(t), 0) AS t, COUNT(*) AS n FROM bars WHERE key = {:k}')
    .bind({ k: key })
    .one(row);
  return { t: row.t, n: row.n };
}

/**
 * Store bars. With `replaceFrom`, cached bars at or after that time are
 * dropped first: a fetched tail is complete, and providers sometimes stamp
 * the bar in progress with the current time instead of its open.
 */
function writeBars(app, key, bars, replaceFrom) {
  if (bars.length === 0 && replaceFrom === null) return;
  app.runInTransaction((tx) => {
    if (replaceFrom !== null && replaceFrom !== undefined) {
      tx.db().newQuery('DELETE FROM bars WHERE key = {:k} AND t >= {:f}').bind({ k: key, f: replaceFrom }).execute();
    }
    for (let i = 0; i < bars.length; i += 150) {
      const chunk = bars.slice(i, i + 150);
      const parts = [];
      const params = { k: key };
      for (let j = 0; j < chunk.length; j++) {
        const b = chunk[j];
        parts.push('({:k},{:t' + j + '},{:o' + j + '},{:h' + j + '},{:l' + j + '},{:c' + j + '},{:v' + j + '})');
        params['t' + j] = b.t;
        params['o' + j] = b.o;
        params['h' + j] = b.h;
        params['l' + j] = b.l;
        params['c' + j] = b.c;
        params['v' + j] = b.v || 0;
      }
      tx.db()
        .newQuery('INSERT INTO bars (key, t, o, h, l, c, v) VALUES ' + parts.join(',') + ' ON CONFLICT(key, t) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v')
        .bind(params)
        .execute();
    }
  });
}

function dropKey(app, key) {
  app.db().newQuery('DELETE FROM bars WHERE key = {:k}').bind({ k: key }).execute();
  app.store().remove('tv_done|' + key);
}

/**
 * Merge a provider's duplicate stamps: a bar opening less than one interval
 * after the previous one is the same bar (Yahoo appends the trade in progress
 * with its own time, e.g. 16:00 after the 15:30 hourly bar).
 */
function tidy(bars, iv) {
  const ivSec = IV_SEC[iv];
  const gap = iv === '1M' ? 27 * DAY : iv === '1W' ? 6 * DAY : iv === '1D' ? 20 * 3600 : ivSec;
  const out = [];
  for (const b of bars) {
    if (!(b.h >= b.l)) continue;
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (prev && b.t < prev.t + gap) {
      if (b.t < prev.t) continue;
      prev.h = Math.max(prev.h, b.h);
      prev.l = Math.min(prev.l, b.l);
      prev.c = b.c;
      prev.v = Math.max(prev.v, b.v);
      continue;
    }
    out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
  }
  return out;
}

/* ---------------------------------------------------------------- fetching */

/** Yahoo bars between two times, split into requests Yahoo accepts (at most 4). */
function fetchYahoo(app, sym, iv, ext, p1, p2) {
  const y = require(`${__hooks}/lib_yahoo.js`);
  const yi = y.INTERVAL[iv];
  const now = nowSec();
  const reach = y.REACH[yi];
  let start = Math.max(0, Math.floor(p1));
  let reached = false;
  if (reach && start <= now - reach) {
    start = now - reach + 60;
    reached = true;
  }
  if (start >= p2) return { bars: [], meta: null, reached: true, events: null };
  const span = y.SPAN[yi];
  let cursor = start;
  let all = [];
  let m = null;
  let events = null;
  // Requests end at most a little past now; a window wholly in the future
  // is refused by Yahoo ("Data doesn't exist"), so stop before one.
  for (let n = 0; n < 4 && cursor < Math.min(p2, now); n++) {
    const end = Math.min(p2, cursor + span);
    let r = null;
    try {
      r = y.chart(app, sym, yi, cursor, end, ext && INTRADAY[iv]);
    } catch (err) {
      // A window with no trading (holidays, before listing) is not an error.
      if (all.length > 0 && String((err && err.message) || '').indexOf("doesn't exist") >= 0) break;
      throw err;
    }
    m = r.meta;
    all = all.concat(r.bars);
    if (r.dividends.length > 0 || r.splits.length > 0) events = { dividends: r.dividends, splits: r.splits };
    cursor = end;
  }
  if (m) saveMeta(app, m);
  all.sort((a, b) => a.t - b.t);
  return { bars: tidy(all, iv), meta: m, reached: reached, events: events };
}

function markDone(app, key) {
  app.store().set('tv_done|' + key, true);
}

function isDone(app, key) {
  return app.store().get('tv_done|' + key) === true;
}

/** First fill of an empty series: about `need` bars up to now. */
function initial(app, sym, iv, ext, need, m, key) {
  const now = nowSec();
  if (provider(sym) === 'binance') {
    const bn = require(`${__hooks}/lib_binance.js`);
    const pair = sym.slice(8);
    let rows = bn.klines(app, pair, iv, 0, 0, Math.min(1000, need));
    writeBars(app, key, rows, null);
    let got = rows.length;
    if (rows.length < Math.min(1000, need)) markDone(app, key);
    for (let page = 0; got < need && rows.length > 0 && page < 4; page++) {
      const limit = Math.min(1000, need - got);
      rows = bn.klines(app, pair, iv, 0, rows[0].t - 1, limit);
      writeBars(app, key, rows, null);
      got += rows.length;
      if (rows.length < limit) markDone(app, key);
    }
    return;
  }
  const r = fetchYahoo(app, sym, iv, ext, now - spanFor(m, iv, need, ext), now + 120);
  writeBars(app, key, r.bars, r.bars.length > 0 ? r.bars[0].t : null);
  if (r.events) app.store().set('tv_events|' + sym, { at: Date.now(), ev: r.events });
  if (r.reached) markDone(app, key);
}

/** Bring the cached tail up to now. */
function refreshTail(app, sym, iv, ext, need, m, key) {
  const last = edge(app, key, 'MAX');
  if (last.n === 0) return initial(app, sym, iv, ext, need, m, key);
  const ivSec = IV_SEC[iv];
  const now = nowSec();
  if (provider(sym) === 'binance') {
    const bn = require(`${__hooks}/lib_binance.js`);
    if ((now - last.t) / ivSec > 3000) {
      dropKey(app, key);
      return initial(app, sym, iv, ext, need, m, key);
    }
    let start = last.t;
    for (let page = 0; page < 4; page++) {
      const rows = bn.klines(app, sym.slice(8), iv, start, 0, 1000);
      writeBars(app, key, rows, rows.length > 0 ? rows[0].t : null);
      if (rows.length < 1000) break;
      start = rows[rows.length - 1].t;
    }
    return;
  }
  const y = require(`${__hooks}/lib_yahoo.js`);
  const yi = y.INTERVAL[iv];
  const reach = y.REACH[yi];
  if ((reach && last.t < now - reach + ivSec) || now - last.t > 4 * y.SPAN[yi]) {
    dropKey(app, key);
    return initial(app, sym, iv, ext, need, m, key);
  }
  const back = iv === '1M' ? 70 * DAY : iv === '1W' ? 21 * DAY : iv === '1D' ? 6 * DAY : ivSec * 3;
  const r = fetchYahoo(app, sym, iv, ext, last.t - back, now + 120);
  if (r.bars.length > 0) writeBars(app, key, r.bars, r.bars[0].t);
  if (r.events) app.store().set('tv_events|' + sym, { at: Date.now(), ev: r.events });
}

/** Older bars before the oldest cached one. */
function backfill(app, sym, iv, ext, missing, m, key) {
  const first = edge(app, key, 'MIN');
  const anchor = first.n > 0 ? first.t : nowSec();
  const want = Math.max(missing, 300);
  if (provider(sym) === 'binance') {
    const bn = require(`${__hooks}/lib_binance.js`);
    const limit = Math.min(1000, want);
    const rows = bn.klines(app, sym.slice(8), iv, 0, anchor - 1, limit);
    writeBars(app, key, rows, null);
    if (rows.length < limit) markDone(app, key);
    return;
  }
  if (m.first_trade && anchor <= m.first_trade + IV_SEC[iv]) {
    markDone(app, key);
    return;
  }
  const p1 = anchor - spanFor(m, iv, want, ext);
  const r = fetchYahoo(app, sym, iv, ext, p1, anchor);
  const older = r.bars.filter((b) => b.t < anchor);
  writeBars(app, key, older, null);
  if (r.reached || older.length === 0 || (m.first_trade && p1 <= m.first_trade)) markDone(app, key);
}

/* -------------------------------------------------------------------- bars */

/**
 * 4h bars from 1h bars. A group starts at a session open (the first bar
 * after a break longer than 90 minutes) and holds up to four hours from
 * there, so US stocks get 09:30 and 13:30 bars like the big platforms.
 * Series that never pause (crypto) are aligned to 00:00, 04:00... UTC.
 */
function to4h(bars) {
  let paused = false;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t - bars[i - 1].t > 5400) {
      paused = true;
      break;
    }
  }
  const out = [];
  let cur = null;
  let start = 0;
  let prevT = 0;
  let begun = !paused;
  for (const b of bars) {
    const brk = prevT > 0 && b.t - prevT > 5400;
    if (!begun) {
      if (!brk) {
        prevT = b.t;
        continue;
      }
      begun = true;
    }
    const fresh = !cur || brk || (paused ? b.t >= start + 14400 : Math.floor(b.t / 14400) !== Math.floor(start / 14400));
    if (fresh) {
      start = paused ? b.t : b.t - (b.t % 14400);
      cur = { t: start, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
    prevT = b.t;
  }
  return out;
}

/**
 * Bars for a symbol and interval.
 *   opts.count   how many (default 300, at most 5000)
 *   opts.before  only bars opening before this unix time (older history)
 *   opts.ext     include pre- and post-market trading (intraday stocks)
 *   opts.force   refresh the tail even when it is fresh
 * Returns { symbol, interval, ext, meta, bars: [{t,o,h,l,c,v}], complete,
 * stale, error } with bars oldest first.
 */
function series(app, rawSymbol, rawInterval, opts) {
  const o = opts || {};
  const sym = normalize(rawSymbol);
  const iv = interval(rawInterval, '1D');
  const prov = provider(sym);
  const m = meta(app, sym);
  const ext = o.ext === true && prov === 'yahoo' && INTRADAY[iv] === true && m.ext_hours === true;
  const count = Math.max(1, Math.min(MAX_BARS, Math.floor(o.count || 300)));
  const before = o.before ? Math.floor(o.before) : 0;
  const agg = prov === 'yahoo' && iv === '4h';
  const base = agg ? '1h' : iv;
  const key = sym + '|' + base + (ext ? '+x' : '');
  const need = agg ? count * 4 + 48 : count;
  let stale = false;
  let error = '';

  if (!before) {
    const fresh = app.store().get('tv_fresh|' + key);
    const now = nowSec();
    if (o.force || !fresh || Date.now() - fresh > ttl(m, base, now) * 1000) {
      try {
        refreshTail(app, sym, base, ext, need, m, key);
        app.store().set('tv_fresh|' + key, Date.now());
      } catch (err) {
        if (err.status === 404 && edge(app, key, 'MAX').n === 0) throw err;
        if (err.status === 400) throw err;
        stale = true;
        error = String((err && err.message) || err);
      }
    }
  }
  let bars = readBars(app, key, before || 4102444800, need);
  if (bars.length < need && !isDone(app, key) && !stale) {
    try {
      backfill(app, sym, base, ext, need - bars.length, m, key);
      bars = readBars(app, key, before || 4102444800, need);
    } catch (err) {
      if (bars.length === 0 && err.status === 404) throw err;
      stale = true;
      error = String((err && err.message) || err);
    }
  }
  if (bars.length === 0 && error !== '') throw fail(503, error);
  if (agg) bars = to4h(bars).slice(-count);
  return {
    symbol: sym,
    interval: iv,
    ext: ext,
    meta: m,
    bars: bars,
    complete: isDone(app, key) && bars.length < count,
    stale: stale,
    error: error,
  };
}

/** Bars as compact rows [t, o, h, l, c, v] for the UI. */
function rows(bars) {
  const out = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    out[i] = [b.t, b.o, b.h, b.l, b.c, b.v];
  }
  return out;
}

/* ------------------------------------------------------------------ quotes */

/**
 * Quotes keyed by symbol. Unknown symbols are left out and listed in
 * `missing`. When a provider fails, the last known quote is served with
 * stale: true.
 */
function quotes(app, list) {
  const store = app.store();
  const now = Date.now();
  const out = {};
  const missing = [];
  const needY = [];
  const needB = [];
  const seen = {};
  for (const raw of list || []) {
    let sym = '';
    try {
      sym = normalize(raw);
    } catch {
      missing.push(String(raw));
      continue;
    }
    if (seen[sym]) continue;
    seen[sym] = true;
    const c = store.get('tv_q|' + sym);
    const life = provider(sym) === 'binance' ? 2500 : 9000;
    if (c && now - c.at < life) out[sym] = c.q;
    else if (provider(sym) === 'binance') needB.push(sym);
    else needY.push(sym);
  }
  const keep = (sym, q) => {
    store.set('tv_q|' + sym, { at: Date.now(), q: q });
    out[sym] = q;
  };
  const fallback = (syms, err) => {
    for (const sym of syms) {
      const c = store.get('tv_q|' + sym);
      if (c) out[sym] = Object.assign({}, c.q, { stale: true, error: String((err && err.message) || err) });
      else missing.push(sym);
    }
  };
  if (needY.length > 0) {
    const y = require(`${__hooks}/lib_yahoo.js`);
    try {
      const got = y.spark(app, needY, false);
      const extNeed = [];
      for (const sym of needY) {
        const q = got[sym];
        if (!q) {
          missing.push(sym);
          continue;
        }
        q.ext_price = null;
        q.ext_change_pct = null;
        if ((q.state === 'pre' || q.state === 'post') && q.ext_hours && (q.type === 'EQUITY' || q.type === 'ETF')) extNeed.push(sym);
        keep(sym, q);
      }
      if (extNeed.length > 0) {
        try {
          const ext = y.spark(app, extNeed, true);
          for (const sym of extNeed) {
            const e = ext[sym];
            const pts = e && e.spark;
            if (!pts || pts.length === 0) continue;
            const q = out[sym];
            const last = pts[pts.length - 1];
            if (q.price && Math.abs(last - q.price) > 1e-9) {
              q.ext_price = last;
              q.ext_change_pct = ((last - q.price) / q.price) * 100;
              keep(sym, q);
            }
          }
        } catch (err) {
          console.warn('[trading-view] extended-hours quotes failed:', err);
        }
      }
    } catch (err) {
      fallback(needY, err);
    }
  }
  if (needB.length > 0) {
    const bn = require(`${__hooks}/lib_binance.js`);
    let known = null;
    try {
      known = bn.pairs(app);
    } catch {
      known = null;
    }
    const pairs = [];
    for (const sym of needB) {
      const pair = sym.slice(8);
      if (known && known.indexOf(pair) < 0) missing.push(sym);
      else pairs.push(pair);
    }
    if (pairs.length > 0) {
      try {
        const got = bn.tickers(app, pairs);
        for (const pair of pairs) {
          const q = got['BINANCE:' + pair];
          if (q) {
            q.ext_price = null;
            q.ext_change_pct = null;
            keep('BINANCE:' + pair, q);
          } else missing.push('BINANCE:' + pair);
        }
      } catch (err) {
        fallback(
          pairs.map((p) => 'BINANCE:' + p),
          err,
        );
      }
    }
  }
  return { quotes: out, missing: missing };
}

/* -------------------------------------------------------- search and news */

function search(app, q, limit) {
  const text = String(q || '').trim();
  const n = Math.max(1, Math.min(30, limit || 12));
  if (text === '') return [];
  const ck = 'tv_search|' + text.toUpperCase() + '|' + n;
  const c = app.store().get(ck);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.list;
  let yahooRows = [];
  let binanceRows = [];
  let lastErr = null;
  try {
    yahooRows = require(`${__hooks}/lib_yahoo.js`).search(app, text, n);
  } catch (err) {
    lastErr = err;
  }
  try {
    binanceRows = require(`${__hooks}/lib_binance.js`).search(app, text, Math.min(8, n));
  } catch (err) {
    lastErr = lastErr || err;
  }
  if (yahooRows.length === 0 && binanceRows.length === 0 && lastErr) throw lastErr;
  // Order: an exact ticker first, then pairs of the coin asked for, then the rest.
  const up = text.toUpperCase().replace(/^BINANCE:/, '');
  const bn = require(`${__hooks}/lib_binance.js`);
  const exact = yahooRows.filter((r) => r.symbol === up);
  const coin = binanceRows.filter((r) => bn.split(r.symbol.slice(8)).base === up || r.symbol === 'BINANCE:' + up);
  const merged = exact.concat(coin.slice(0, 3), yahooRows, binanceRows);
  const seen = {};
  const out = [];
  for (const r of merged) {
    if (seen[r.symbol]) continue;
    seen[r.symbol] = true;
    out.push(r);
    if (out.length >= n) break;
  }
  app.store().set(ck, { at: Date.now(), list: out });
  return out;
}

const COIN_NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB crypto', XRP: 'XRP Ripple', DOGE: 'Dogecoin', ADA: 'Cardano', TRX: 'Tron crypto', AVAX: 'Avalanche crypto',
  LINK: 'Chainlink', DOT: 'Polkadot', TON: 'Toncoin', SHIB: 'Shiba Inu', LTC: 'Litecoin', BCH: 'Bitcoin Cash', NEAR: 'NEAR Protocol', UNI: 'Uniswap', APT: 'Aptos',
  ARB: 'Arbitrum', OP: 'Optimism crypto', SUI: 'Sui crypto', PEPE: 'Pepe coin', FIL: 'Filecoin', ATOM: 'Cosmos crypto', ETC: 'Ethereum Classic', INJ: 'Injective', AAVE: 'Aave', XLM: 'Stellar XLM', HBAR: 'Hedera', ICP: 'Internet Computer',
};

/** The Yahoo query that finds news for a symbol (crypto by the coin's name: tickers find none). */
function newsQuery(sym) {
  let base = '';
  if (provider(sym) === 'binance') base = require(`${__hooks}/lib_binance.js`).split(sym.slice(8)).base;
  else if (/^[A-Z0-9]+-USD$/.test(sym)) base = sym.slice(0, -4);
  if (base === '') return sym;
  return COIN_NAMES[base] || base + ' crypto';
}

function news(app, rawSymbol, q, limit) {
  const query = rawSymbol ? newsQuery(normalize(rawSymbol)) : String(q || '').trim() || 'stock market';
  const n = Math.max(1, Math.min(30, limit || 12));
  const ck = 'tv_news|' + query + '|' + n;
  const c = app.store().get(ck);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.list;
  const list = require(`${__hooks}/lib_yahoo.js`).news(app, query, n);
  app.store().set(ck, { at: Date.now(), list: list });
  return list;
}

/** Dividends and splits over the instrument's history (Yahoo; none for crypto). */
function events(app, rawSymbol) {
  const sym = normalize(rawSymbol);
  if (provider(sym) === 'binance') return { dividends: [], splits: [] };
  const c = app.store().get('tv_events_all|' + sym);
  if (c && Date.now() - c.at < 6 * 3600 * 1000) return c.ev;
  const r = require(`${__hooks}/lib_yahoo.js`).chart(app, sym, '1mo', 0, nowSec() + 60, false);
  const ev = { dividends: r.dividends.sort((a, b) => a.t - b.t), splits: r.splits.sort((a, b) => a.t - b.t) };
  app.store().set('tv_events_all|' + sym, { at: Date.now(), ev: ev });
  return ev;
}

function health(app) {
  const http = require(`${__hooks}/lib_http.js`);
  return { yahoo: http.health(app, 'yahoo'), binance: http.health(app, 'binance') };
}

/** Drop cached intraday bars nobody asked for in a while (keeps the database small). */
function prune(app) {
  const cut = nowSec() - 120 * DAY;
  app.db().newQuery("DELETE FROM bars WHERE key LIKE '%|1m%' AND t < {:c}").bind({ c: nowSec() - 35 * DAY }).execute();
  app.db().newQuery("DELETE FROM bars WHERE (key LIKE '%|5m%' OR key LIKE '%|15m%' OR key LIKE '%|30m%') AND t < {:c}").bind({ c: cut }).execute();
}

module.exports = {
  IV_SEC: IV_SEC,
  INTERVALS: INTERVALS,
  INTRADAY: INTRADAY,
  MAX_BARS: MAX_BARS,
  fail: fail,
  normalize: normalize,
  provider: provider,
  interval: interval,
  meta: meta,
  isLive: isLive,
  series: series,
  rows: rows,
  to4h: to4h,
  tidy: tidy,
  quotes: quotes,
  search: search,
  news: news,
  events: events,
  health: health,
  prune: prune,
};
