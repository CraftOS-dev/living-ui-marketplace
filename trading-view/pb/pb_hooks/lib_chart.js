/// <reference path="../pb_data/types.d.ts" />
/**
 * Chart readings for the AI agent (and the facts panel of the Analyst
 * widget): indicator values, support and resistance, and the facts pack
 * that explains a move. Computed with lib_ta on the same cached bars the
 * chart shows, so the agent quotes the numbers the person sees.
 */

function round(v, d) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const k = Math.pow(10, d === undefined ? 4 : d);
  return Math.round(v * k) / k;
}

function iso(t) {
  return new Date(t * 1000).toISOString();
}

/** Parse indicator specs: "rsi", "rsi:21", {id, params} or a JSON list of them. */
function specs(raw) {
  const u = require(`${__hooks}/lib_util.js`);
  if (raw === undefined || raw === null || raw === '') return [{ id: 'rsi', params: {} }, { id: 'macd', params: {} }, { id: 'sma', params: { length: 50 } }, { id: 'sma', params: { length: 200 } }];
  let list = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.charAt(0) === '[') {
      try {
        list = JSON.parse(t);
      } catch {
        throw u.fail(400, 'indicators must be a JSON list like [{"id":"rsi","params":{"length":14}}] or names like "rsi, macd, sma:50"');
      }
    } else list = t.split(',');
  }
  if (!Array.isArray(list)) list = [list];
  return list.slice(0, 12).map((x) => {
    if (typeof x === 'string') {
      const parts = x.trim().split(':');
      const id = parts[0].trim().toLowerCase();
      const params = {};
      if (parts[1]) {
        const ta = require(`${__hooks}/lib_ta.js`);
        const def = ta.find(id);
        const nums = parts[1].split('/');
        if (def) def.params.filter((q) => !q.options).forEach((q, i) => nums[i] !== undefined && (params[q.key] = Number(nums[i])));
      }
      return { id: id, params: params };
    }
    return { id: String((x && x.id) || '').toLowerCase(), params: (x && x.params) || {} };
  });
}

/** Indicator values: the last `tail` points of each output and the latest reading. */
function indicators(app, symbol, interval, raw, tail) {
  const m = require(`${__hooks}/lib_market.js`);
  const ta = require(`${__hooks}/lib_ta.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const list = specs(raw);
  let warm = 0;
  for (const s of list) {
    const def = ta.find(s.id);
    if (!def) throw u.fail(400, 'Unknown indicator "' + s.id + '"; one of: ' + ta.CATALOGUE.map((d) => d.id).join(', '));
    const prm = ta.params(s.id, s.params);
    for (const k of Object.keys(prm)) if (typeof prm[k] === 'number') warm = Math.max(warm, prm[k]);
  }
  const n = Math.max(1, Math.min(500, tail || 20));
  const s = m.series(app, symbol, interval, { count: Math.min(5000, n + warm * 4 + 50) });
  const bars = s.bars;
  const out = [];
  for (const spec of list) {
    const r = ta.compute(spec.id, bars, spec.params, { offset: s.meta.gmtoffset || 0 });
    const outputs = {};
    const latest = {};
    for (const k of Object.keys(r.outputs)) {
      const arr = r.outputs[k];
      const from = Math.max(0, bars.length - n);
      const pts = [];
      for (let i = from; i < bars.length; i++) pts.push([bars[i].t, round(arr[i], 6)]);
      outputs[k] = pts;
      latest[k] = round(ta.lastOf(arr), 6);
    }
    out.push({ id: spec.id, label: r.label, params: r.params, latest: latest, values: outputs });
  }
  const last = bars[bars.length - 1];
  return {
    symbol: s.symbol,
    interval: s.interval,
    as_of: last ? iso(last.t) : null,
    close: last ? last.c : null,
    stale: s.stale,
    indicators: out,
  };
}

/** Support and resistance levels from swing points. */
function levels(app, symbol, interval, count) {
  const m = require(`${__hooks}/lib_market.js`);
  const ta = require(`${__hooks}/lib_ta.js`);
  const s = m.series(app, symbol, interval, { count: Math.max(100, Math.min(2000, count || 400)) });
  const bars = s.bars;
  const last = bars.length > 0 ? bars[bars.length - 1].c : null;
  return {
    symbol: s.symbol,
    interval: s.interval,
    close: last,
    levels: ta.levels(bars, 8).map((l) => ({ price: round(l.price, 6), kind: l.kind, touches: l.touches, last_touch: iso(l.last_touch), distance_pct: round(l.distance_pct, 2) })),
  };
}

function pct(a, b) {
  return a !== null && b ? round(((a - b) / b) * 100, 2) : null;
}

/**
 * The facts behind a move, for the AI agent to explain (it never has to
 * guess numbers): price and change, performance, 52-week range, trend,
 * momentum, volatility, volume, levels, notable recent bars, dividends and
 * splits, and the latest headlines.
 */
function explain(app, symbol, interval, opts) {
  const m = require(`${__hooks}/lib_market.js`);
  const ta = require(`${__hooks}/lib_ta.js`);
  const o = opts || {};
  const sym = m.normalize(symbol);
  const iv = m.interval(interval, '1D');
  const daily = m.series(app, sym, '1D', { count: 300 });
  const meta = daily.meta;
  const d = daily.bars;
  const n = d.length;
  if (n < 2) throw m.fail(404, 'Not enough history for ' + sym);
  const c = d.map((b) => b.c);
  const last = c[n - 1];
  let quote = null;
  try {
    quote = m.quotes(app, [sym]).quotes[sym] || null;
  } catch {
    quote = null;
  }
  const price = quote && typeof quote.price === 'number' ? quote.price : last;
  const year = new Date(d[n - 1].t * 1000).getUTCFullYear();
  let ytd = null;
  for (let i = n - 1; i >= 0; i--) {
    if (new Date(d[i].t * 1000).getUTCFullYear() < year) {
      ytd = c[i];
      break;
    }
  }
  const back = (k) => (n > k ? c[n - 1 - k] : null);
  let hi52 = -Infinity;
  let lo52 = Infinity;
  for (let i = Math.max(0, n - 252); i < n; i++) {
    hi52 = Math.max(hi52, d[i].h);
    lo52 = Math.min(lo52, d[i].l);
  }
  const sma20 = ta.sma(c, 20);
  const sma50 = ta.sma(c, 50);
  const sma200 = ta.sma(c, 200);
  const s50 = ta.lastOf(sma50);
  const s50ago = n > 70 ? sma50[n - 21] : null;
  let cross = null;
  for (let i = n - 1; i > Math.max(0, n - 60); i--) {
    if (sma50[i] === null || sma200[i] === null || sma50[i - 1] === null || sma200[i - 1] === null) break;
    const now = sma50[i] - sma200[i];
    const before = sma50[i - 1] - sma200[i - 1];
    if (now > 0 && before <= 0) {
      cross = { kind: 'golden cross (SMA 50 above SMA 200)', date: iso(d[i].t), bars_ago: n - 1 - i };
      break;
    }
    if (now < 0 && before >= 0) {
      cross = { kind: 'death cross (SMA 50 below SMA 200)', date: iso(d[i].t), bars_ago: n - 1 - i };
      break;
    }
  }

  // Readings on the requested interval.
  const series = iv === '1D' ? daily : m.series(app, sym, iv, { count: 300 });
  const b = series.bars;
  const bn = b.length;
  const bc = b.map((x) => x.c);
  const rsi = ta.rsiOf(bc, 14);
  const macd = ta.compute('macd', b, {}).outputs;
  const bb = ta.compute('bb', b, {}).outputs;
  const atr = ta.rma(ta.trueRange(b), 14);
  const adx = ta.compute('adx', b, {}).outputs;
  const stoch = ta.compute('stoch', b, {}).outputs;
  let macdCross = null;
  for (let i = bn - 1; i > Math.max(0, bn - 10); i--) {
    if (macd.macd[i] === null || macd.signal[i] === null || macd.macd[i - 1] === null || macd.signal[i - 1] === null) break;
    const now = macd.macd[i] - macd.signal[i];
    const before = macd.macd[i - 1] - macd.signal[i - 1];
    if ((now > 0) !== (before > 0)) {
      macdCross = { kind: now > 0 ? 'bullish (MACD above signal)' : 'bearish (MACD below signal)', bars_ago: bn - 1 - i };
      break;
    }
  }
  const lastRsi = ta.lastOf(rsi);
  const bbU = ta.lastOf(bb.upper);
  const bbL = ta.lastOf(bb.lower);
  const bbB = ta.lastOf(bb.basis);
  const vols = b.map((x) => x.v || 0);
  const avgVol = bn > 21 ? ta.lastOf(ta.sma(vols.slice(0, bn - 1), 20)) : null;
  const moves = [];
  for (let i = Math.max(1, bn - 30); i < bn; i++) moves.push({ time: iso(b[i].t), change_pct: round(((b[i].c - b[i - 1].c) / b[i - 1].c) * 100, 2), volume_x: avgVol ? round(vols[i] / avgVol, 2) : null });
  moves.sort((x, y) => Math.abs(y.change_pct) - Math.abs(x.change_pct));
  let hi20 = -Infinity;
  let lo20 = Infinity;
  for (let i = Math.max(0, bn - 21); i < bn - 1; i++) {
    hi20 = Math.max(hi20, b[i].h);
    lo20 = Math.min(lo20, b[i].l);
  }
  const lb = b[bn - 1];
  const pb = b[bn - 2];
  const flags = [];
  if (lb.h > hi20) flags.push('broke above the prior 20-bar high');
  if (lb.l < lo20) flags.push('broke below the prior 20-bar low');
  if (pb && lb.h <= pb.h && lb.l >= pb.l) flags.push('inside bar');
  if (pb && lb.h > pb.h && lb.l < pb.l) flags.push('outside bar');
  if (pb && lb.o > pb.h) flags.push('gapped up');
  if (pb && lb.o < pb.l) flags.push('gapped down');

  let events = null;
  try {
    const ev = m.events(app, sym);
    const cut = Math.floor(Date.now() / 1000) - 400 * 86400;
    events = { dividends: ev.dividends.filter((x) => x.t >= cut).map((x) => ({ date: iso(x.t), amount: x.amount })), splits: ev.splits.filter((x) => x.t >= cut).map((x) => ({ date: iso(x.t), ratio: x.ratio })) };
  } catch {
    events = null;
  }
  let news = [];
  if (o.news !== false) {
    try {
      news = m.news(app, sym, '', 6).map((x) => ({ title: x.title, publisher: x.publisher, time: x.time ? iso(x.time) : null, link: x.link }));
    } catch {
      news = [];
    }
  }
  const atrLast = ta.lastOf(atr);
  return {
    symbol: sym,
    name: meta.name,
    exchange: meta.exchange,
    type: meta.type,
    currency: meta.currency,
    interval: iv,
    as_of: iso(lb.t),
    market_state: quote ? quote.state : null,
    price: {
      last: round(price, 6),
      change: quote ? round(quote.change, 6) : round(last - c[n - 2], 6),
      change_pct: quote ? round(quote.change_pct, 2) : pct(last, c[n - 2]),
      prev_close: quote ? quote.prev_close : c[n - 2],
      day_high: quote ? quote.high : d[n - 1].h,
      day_low: quote ? quote.low : d[n - 1].l,
      ext_price: quote ? quote.ext_price : null,
      ext_change_pct: quote ? round(quote.ext_change_pct, 2) : null,
    },
    performance_pct: { '1W': pct(last, back(5)), '1M': pct(last, back(21)), '3M': pct(last, back(63)), '6M': pct(last, back(126)), YTD: pct(last, ytd), '1Y': pct(last, back(252)) },
    range_52w: { high: hi52, low: lo52, position_pct: hi52 > lo52 ? round(((last - lo52) / (hi52 - lo52)) * 100, 1) : null, from_high_pct: pct(last, hi52) },
    trend_daily: {
      sma20: round(ta.lastOf(sma20), 6),
      sma50: round(s50, 6),
      sma200: round(ta.lastOf(sma200), 6),
      above_sma20: ta.lastOf(sma20) !== null ? last > ta.lastOf(sma20) : null,
      above_sma50: s50 !== null ? last > s50 : null,
      above_sma200: ta.lastOf(sma200) !== null ? last > ta.lastOf(sma200) : null,
      sma50_slope_1m_pct: pct(s50, s50ago),
      recent_cross: cross,
    },
    momentum: {
      interval: iv,
      rsi14: round(lastRsi, 1),
      rsi_state: lastRsi === null ? null : lastRsi >= 70 ? 'overbought' : lastRsi <= 30 ? 'oversold' : 'neutral',
      macd: round(ta.lastOf(macd.macd), 6),
      macd_signal: round(ta.lastOf(macd.signal), 6),
      macd_hist: round(ta.lastOf(macd.hist), 6),
      macd_cross: macdCross,
      stoch_k: round(ta.lastOf(stoch.k), 1),
      adx14: round(ta.lastOf(adx.adx), 1),
      trend_strength: ta.lastOf(adx.adx) === null ? null : ta.lastOf(adx.adx) >= 25 ? 'trending' : 'ranging',
    },
    volatility: {
      interval: iv,
      atr14: round(atrLast, 6),
      atr_pct: atrLast && lb.c ? round((atrLast / lb.c) * 100, 2) : null,
      bollinger_pct_b: bbU !== null && bbL !== null && bbU > bbL ? round(((lb.c - bbL) / (bbU - bbL)) * 100, 1) : null,
      bollinger_width_pct: bbB ? round(((bbU - bbL) / bbB) * 100, 2) : null,
    },
    volume: { interval: iv, last: lb.v, avg20: avgVol ? Math.round(avgVol) : null, relative: avgVol ? round(lb.v / avgVol, 2) : null },
    levels: ta.levels(b, 6).map((l) => ({ price: round(l.price, 6), kind: l.kind, touches: l.touches, distance_pct: round(l.distance_pct, 2) })),
    last_bar: { time: iso(lb.t), open: lb.o, high: lb.h, low: lb.l, close: lb.c, change_pct: pb ? pct(lb.c, pb.c) : null, flags: flags },
    biggest_moves: moves.slice(0, 5),
    events: events,
    news: news,
    stale: daily.stale || series.stale,
    data_note: m.provider(sym) === 'yahoo' ? 'Yahoo Finance data, delayed up to 15 minutes for most exchanges' : 'Binance spot market data',
  };
}

/** A compact subset of the facts kept with a finished analysis. */
function snapshot(f) {
  return {
    as_of: f.as_of,
    price: f.price.last,
    change_pct: f.price.change_pct,
    rsi14: f.momentum.rsi14,
    rsi_state: f.momentum.rsi_state,
    atr_pct: f.volatility.atr_pct,
    trend: f.trend_daily.above_sma50 === null ? null : (f.trend_daily.above_sma50 ? 'above' : 'below') + ' SMA 50, ' + (f.trend_daily.above_sma200 ? 'above' : 'below') + ' SMA 200',
    performance_pct: f.performance_pct,
    range_52w_position_pct: f.range_52w.position_pct,
    relative_volume: f.volume.relative,
  };
}

module.exports = { round: round, specs: specs, indicators: indicators, levels: levels, explain: explain, snapshot: snapshot };
