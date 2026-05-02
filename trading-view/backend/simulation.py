"""
Stock Data Engine

Real production data sources:
  - Symbol universe: NASDAQ Trader official symbol directory
    (https://www.nasdaqtrader.com/dynamic/SymDir/{nasdaqlisted,otherlisted}.txt)
    Covers all US-listed stocks (~10,000 symbols), refreshed daily by NASDAQ.
  - OHLCV candles: Yahoo Finance via yfinance (real historical + intraday data)
  - Real-time prices: Yahoo Finance fast_info (15-min delayed for free tier)
  - News: Yahoo Finance Ticker.news (real headlines + URLs + timestamps)
  - Sectors / market cap: Yahoo Finance Ticker.info (lazy-loaded per symbol)

Lazy-loading strategy:
  - Seed loads ALL symbol metadata (cheap, ~10k rows in seconds)
  - Prices, candles, sectors fetched on demand the first time a user opens the symbol
  - A small WARMUP_TICKERS list is fully populated during seed so the
    UI has something to show immediately (real data, not fake)
"""

import logging
import threading
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from typing import Optional, Iterable

import numpy as np
from sqlalchemy.orm import Session

from models import Stock, StockPrice, Candle, SimulationState, PriceAlert, MarketNews

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Symbol universe (live download — no hardcoded list)
# ---------------------------------------------------------------------------

# NASDAQ Trader publishes the canonical list of US-listed securities.
# These files are public, free, no auth, refreshed daily.
_NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
_OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

# Map otherlisted "Exchange" code → human-readable exchange name.
_EXCHANGE_CODE_MAP = {
    "A": "NYSE MKT",
    "N": "NYSE",
    "P": "NYSE ARCA",
    "Z": "Cboe BZX",
    "V": "IEXG",
}

# Tickers to fully populate (price + sector + candles) during the initial seed
# so the UI has live data immediately. Every other symbol in the universe is
# searchable but gets its data lazily on first open. These are real, large-cap
# US tickers — the choice of *which* to warm up is a UX default, not data.
WARMUP_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM", "V", "JNJ", "UNH", "WMT", "PG", "MA", "HD", "XOM", "CVX",
    "ABBV", "KO", "PEP", "AVGO", "COST", "MRK", "DIS", "NFLX", "AMD",
    "SPY", "QQQ", "DIA",
]


def _http_get_text(url: str, timeout: float = 30.0) -> str:
    """Fetch a URL as UTF-8 text. Raises on network error."""
    req = urllib.request.Request(url, headers={"User-Agent": "CraftBot-LivingUI/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _parse_listed_file(text: str, default_exchange: str) -> list[dict]:
    """Parse a NASDAQ Trader pipe-delimited symbol file."""
    out: list[dict] = []
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return out

    header = [h.strip() for h in lines[0].split("|")]

    def _idx(*candidates: str) -> Optional[int]:
        for cand in candidates:
            if cand in header:
                return header.index(cand)
        return None

    sym_idx = _idx("Symbol", "ACT Symbol")
    name_idx = _idx("Security Name")
    test_idx = _idx("Test Issue")
    etf_idx = _idx("ETF")
    exchange_idx = _idx("Exchange")
    if sym_idx is None or name_idx is None:
        logger.warning(f"[Universe] Unexpected header: {header}")
        return out

    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) <= max(sym_idx, name_idx):
            continue
        symbol = parts[sym_idx].strip()
        name = parts[name_idx].strip()
        if not symbol or not name:
            continue
        # Skip test issues
        if test_idx is not None and len(parts) > test_idx:
            if parts[test_idx].strip().upper() == "Y":
                continue

        # Determine exchange
        exchange = default_exchange
        if exchange_idx is not None and len(parts) > exchange_idx:
            code = parts[exchange_idx].strip()
            exchange = _EXCHANGE_CODE_MAP.get(code, code or default_exchange)

        # Note: yfinance uses "-" for share class separator, exchanges use "."
        # Store the exchange-format symbol (with "."); convert at yfinance call sites.
        is_etf = False
        if etf_idx is not None and len(parts) > etf_idx:
            is_etf = parts[etf_idx].strip().upper() == "Y"

        out.append({
            "symbol": symbol,
            "name": name,
            "exchange": exchange,
            "is_etf": is_etf,
        })
    return out


def load_symbol_universe() -> list[dict]:
    """Download the full US-listed symbol universe from NASDAQ Trader.

    Returns a list of dicts: {symbol, name, exchange, is_etf}.
    Returns an empty list if both downloads fail (caller should handle gracefully).
    """
    universe: list[dict] = []
    seen: set[str] = set()

    for url, default_exch in [
        (_NASDAQ_LISTED_URL, "NASDAQ"),
        (_OTHER_LISTED_URL, "NYSE"),
    ]:
        try:
            text = _http_get_text(url)
            entries = _parse_listed_file(text, default_exch)
            for e in entries:
                if e["symbol"] in seen:
                    continue
                seen.add(e["symbol"])
                universe.append(e)
            logger.info(f"[Universe] Loaded {len(entries)} symbols from {url}")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            logger.warning(f"[Universe] Failed to download {url}: {exc}")

    return universe


# ---------------------------------------------------------------------------
# yfinance helpers
# ---------------------------------------------------------------------------

def _to_yahoo_symbol(symbol: str) -> str:
    """Convert exchange-format ticker (e.g. 'BRK.B') to Yahoo format ('BRK-B')."""
    return symbol.replace(".", "-")


def _fetch_stock_info(symbol: str) -> dict:
    """Fetch sector, industry, market cap from yfinance for a symbol.

    Returns {} on any failure — never raises. Lazy-loaded per symbol.
    """
    try:
        import yfinance as yf
        t = yf.Ticker(_to_yahoo_symbol(symbol))
        info = t.info or {}
        return {
            "sector": info.get("sector") or info.get("category"),
            "industry": info.get("industry"),
            "market_cap": info.get("marketCap"),
            "long_name": info.get("longName") or info.get("shortName"),
        }
    except Exception as e:
        logger.debug(f"[Info] Failed to fetch info for {symbol}: {e}")
        return {}


def _enrich_stock(db: Session, stock: Stock) -> None:
    """Populate sector/market_cap on a Stock row by querying yfinance.

    No-op if the row already has both fields.
    """
    if stock.sector and stock.market_cap:
        return
    info = _fetch_stock_info(stock.symbol)
    changed = False
    if not stock.sector and info.get("sector"):
        stock.sector = info["sector"]
        changed = True
    if not stock.market_cap and info.get("market_cap"):
        try:
            stock.market_cap = float(info["market_cap"])
            changed = True
        except (TypeError, ValueError):
            pass
    if changed:
        db.commit()


def _refresh_price_from_yahoo(db: Session, stock: Stock) -> Optional[StockPrice]:
    """Fetch the current price for a single stock and write/update StockPrice.

    Returns the StockPrice row, or None on failure. Used for lazy initial load
    of stocks that aren't in the warmup set.
    """
    try:
        import yfinance as yf
        t = yf.Ticker(_to_yahoo_symbol(stock.symbol))
        fi = t.fast_info
        last = float(fi.last_price) if getattr(fi, "last_price", None) else None
        if last is None:
            return None
        prev_close = float(fi.previous_close) if getattr(fi, "previous_close", None) else last
        day_open = float(fi.open) if getattr(fi, "open", None) else last
        day_high = float(fi.day_high) if getattr(fi, "day_high", None) else last
        day_low = float(fi.day_low) if getattr(fi, "day_low", None) else last

        change = round(last - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0.0

        sp = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
        now = datetime.utcnow()
        if not sp:
            sp = StockPrice(
                stock_id=stock.id,
                price=round(last, 2),
                open_price=round(day_open, 2),
                high=round(day_high, 2),
                low=round(day_low, 2),
                prev_close=round(prev_close, 2),
                volume=0,
                change=change,
                change_pct=change_pct,
                updated_at=now,
            )
            db.add(sp)
        else:
            sp.price = round(last, 2)
            sp.open_price = round(day_open, 2)
            sp.high = round(day_high, 2)
            sp.low = round(day_low, 2)
            sp.prev_close = round(prev_close, 2)
            sp.change = change
            sp.change_pct = change_pct
            sp.updated_at = now
        db.commit()
        db.refresh(sp)
        return sp
    except Exception as e:
        logger.debug(f"[Price] Failed to fetch price for {stock.symbol}: {e}")
        return None


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

_seed_lock = threading.Lock()


def seed_stocks(db: Session, warmup: bool = True) -> list[dict]:
    """Populate the database with the full US-listed symbol universe.

    Adds Stock rows (metadata only) for every symbol returned by NASDAQ Trader.
    If warmup=True, also fetches live prices and sectors for the WARMUP_TICKERS
    list so the UI has data on first paint.

    Idempotent: re-running only inserts new symbols and re-runs warmup.
    """
    with _seed_lock:
        # 1. Download the universe (skip if we already have a healthy population).
        existing_count = db.query(Stock).count()
        if existing_count < 100:  # treat <100 as "needs initial seed"
            universe = load_symbol_universe()
            if not universe:
                logger.warning("[Seed] Symbol universe download failed — keeping any existing rows")
            else:
                # Bulk insert new symbols
                existing_syms = {s for (s,) in db.query(Stock.symbol).all()}
                to_add = []
                for entry in universe:
                    if entry["symbol"] in existing_syms:
                        continue
                    to_add.append(Stock(
                        symbol=entry["symbol"],
                        name=entry["name"],
                        exchange=entry["exchange"],
                    ))
                if to_add:
                    db.bulk_save_objects(to_add)
                    db.commit()
                    logger.info(f"[Seed] Inserted {len(to_add)} symbols (universe size: {len(universe)})")

        # 2. Ensure SimulationState row exists.
        sim = db.query(SimulationState).first()
        if not sim:
            sim = SimulationState(id=1, last_tick_time=datetime.utcnow(), is_running=True, tick_count=0)
            db.add(sim)
            db.commit()

        # 3. Warmup: fetch live data for popular tickers.
        if warmup:
            for sym in WARMUP_TICKERS:
                # Universe uses exchange format; convert if Yahoo format slipped in
                stock = db.query(Stock).filter(
                    (Stock.symbol == sym) | (Stock.symbol == sym.replace("-", "."))
                ).first()
                if not stock:
                    # Symbol not in NASDAQ list (shouldn't happen for these): create it
                    stock = Stock(symbol=sym, name=sym, exchange="NASDAQ")
                    db.add(stock)
                    db.commit()
                    db.refresh(stock)
                _enrich_stock(db, stock)
                if not stock.stock_price:
                    _refresh_price_from_yahoo(db, stock)

        # 4. Return all stocks (capped to keep response small)
        return [s.to_dict() for s in db.query(Stock).order_by(Stock.symbol).limit(500).all()]


# ---------------------------------------------------------------------------
# Historical candles (real Yahoo Finance data)
# ---------------------------------------------------------------------------

# Map our timeframe → (yfinance period, yfinance interval) for the *initial* load.
_INITIAL_FETCH_SPECS = [
    ("1D", "5y", "1d"),    # 5 years of daily candles
    ("1h", "60d", "1h"),   # 60 days of hourly candles
    ("1m", "7d", "5m"),    # 7 days of 5-min candles (stored under "1m")
]


def _persist_history(db: Session, stock: Stock, timeframe: str, hist) -> int:
    """Persist a yfinance DataFrame of candles to the DB. Skips duplicates.

    Returns the number of new candles inserted.
    """
    if hist is None or len(hist) == 0:
        return 0

    # Find existing timestamps for this stock+timeframe to dedupe.
    existing_ts = {
        ts for (ts,) in db.query(Candle.timestamp).filter(
            Candle.stock_id == stock.id,
            Candle.timeframe == timeframe,
        ).all()
    }

    to_add = []
    for ts, row in hist.iterrows():
        # Normalise to naive UTC datetime
        try:
            if hasattr(ts, "to_pydatetime"):
                py_ts = ts.to_pydatetime()
            else:
                py_ts = ts
            if getattr(py_ts, "tzinfo", None) is not None:
                py_ts = py_ts.astimezone(tz=None).replace(tzinfo=None)
        except Exception:
            continue

        if py_ts in existing_ts:
            continue
        try:
            to_add.append(Candle(
                stock_id=stock.id,
                timeframe=timeframe,
                timestamp=py_ts,
                open_price=round(float(row["Open"]), 4),
                high=round(float(row["High"]), 4),
                low=round(float(row["Low"]), 4),
                close_price=round(float(row["Close"]), 4),
                volume=int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,  # NaN check
            ))
        except (KeyError, TypeError, ValueError):
            continue

    if to_add:
        db.bulk_save_objects(to_add)
        db.commit()
    return len(to_add)


def fetch_initial_candles(db: Session, stock: Stock) -> None:
    """Fetch initial historical candles (1y daily, 30d hourly, 7d 5-min) from Yahoo."""
    import yfinance as yf
    yahoo_sym = _to_yahoo_symbol(stock.symbol)
    ticker = yf.Ticker(yahoo_sym)

    for timeframe, period, interval in _INITIAL_FETCH_SPECS:
        try:
            hist = ticker.history(period=period, interval=interval, auto_adjust=False)
            n = _persist_history(db, stock, timeframe, hist)
            if n:
                logger.info(f"[Candles] {stock.symbol} {timeframe}: +{n} candles")
        except Exception as e:
            logger.debug(f"[Candles] {stock.symbol} {timeframe} fetch failed: {e}")
            db.rollback()


# Map our internal timeframe → yfinance interval string.
_TF_TO_YF_INTERVAL = {
    "1m": "5m",   # we store 5-min bars under "1m"
    "1h": "1h",
    "1D": "1d",
    "1W": "1wk",
    "1M": "1mo",
}


def fetch_older_candles(
    db: Session,
    stock: Stock,
    timeframe: str,
    end: datetime,
    span_days: int = 365,
) -> int:
    """Fetch candles older than `end` for the given timeframe and persist them.

    Used for chart lazy-loading when the user scrolls/drags left past the
    currently loaded data. Returns the number of new candles inserted.

    Yahoo Finance limits intraday history to ~730 days, hourly to ~730 days,
    5-min to ~60 days. We respect those limits.
    """
    yf_interval = _TF_TO_YF_INTERVAL.get(timeframe)
    if not yf_interval:
        return 0

    # Determine fetch window
    if timeframe == "1m":
        span_days = min(span_days, 60)
    elif timeframe == "1h":
        span_days = min(span_days, 700)
    start = end - timedelta(days=span_days)

    try:
        import yfinance as yf
        ticker = yf.Ticker(_to_yahoo_symbol(stock.symbol))
        hist = ticker.history(
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            interval=yf_interval,
            auto_adjust=False,
        )
        n = _persist_history(db, stock, timeframe, hist)
        if n:
            logger.info(f"[Candles] {stock.symbol} {timeframe} older: +{n} from {start.date()} to {end.date()}")
        return n
    except Exception as e:
        logger.debug(f"[Candles] {stock.symbol} older fetch failed: {e}")
        db.rollback()
        return 0


# Backwards compatibility for any callers still using the old name.
def generate_historical_candles(db: Session, stock: Stock, *args, **kwargs) -> None:
    """Deprecated alias kept for any existing imports."""
    fetch_initial_candles(db, stock)


# ---------------------------------------------------------------------------
# Real-time price ticking
# ---------------------------------------------------------------------------

# Throttle: don't hammer Yahoo more than once every 30 seconds per ticker batch.
_TICK_INTERVAL_SECS = 30


def _active_stock_symbols(db: Session) -> list[str]:
    """Return symbols that already have a StockPrice row (i.e. user has opened them).

    These are the only symbols we poll on each tick — avoids a 10k-symbol fan-out.
    """
    rows = db.query(Stock.symbol).join(StockPrice, StockPrice.stock_id == Stock.id).all()
    return [r[0] for r in rows]


def tick_simulation(db: Session) -> dict:
    """Refresh real-time prices for all *active* stocks (those with a StockPrice row).

    Throttles to one Yahoo batch fetch every 30 seconds. Also evaluates and
    triggers price alerts. Returns ``{symbol: {price, change, changePct}}``.
    """
    import yfinance as yf

    now = datetime.utcnow()
    sim = db.query(SimulationState).first()
    if not sim:
        sim = SimulationState(id=1, last_tick_time=now, is_running=True, tick_count=0)
        db.add(sim)
        db.flush()

    last_tick = sim.last_tick_time or (now - timedelta(minutes=5))
    elapsed = (now - last_tick).total_seconds()

    result: dict[str, dict] = {}
    active_symbols = _active_stock_symbols(db)

    if elapsed >= _TICK_INTERVAL_SECS and active_symbols:
        try:
            # Use Yahoo-format symbols for the API call
            yahoo_syms = [_to_yahoo_symbol(s) for s in active_symbols]
            tickers = yf.Tickers(" ".join(yahoo_syms))

            for symbol in active_symbols:
                yahoo_key = _to_yahoo_symbol(symbol)
                ticker = tickers.tickers.get(yahoo_key)
                if ticker is None:
                    continue
                try:
                    fi = ticker.fast_info
                    if not getattr(fi, "last_price", None):
                        continue
                    current = round(float(fi.last_price), 2)
                    prev_close = round(float(fi.previous_close), 2) if getattr(fi, "previous_close", None) else current
                    day_open = round(float(fi.open), 2) if getattr(fi, "open", None) else current
                    day_high = round(float(fi.day_high), 2) if getattr(fi, "day_high", None) else current
                    day_low = round(float(fi.day_low), 2) if getattr(fi, "day_low", None) else current

                    change = round(current - prev_close, 2)
                    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0.0

                    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
                    if not stock:
                        continue
                    sp = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
                    if sp:
                        sp.price = current
                        sp.open_price = day_open
                        sp.high = day_high
                        sp.low = day_low
                        sp.prev_close = prev_close
                        sp.change = change
                        sp.change_pct = change_pct
                        sp.updated_at = now

                    result[symbol] = {"price": current, "change": change, "changePct": change_pct}
                except Exception as e:
                    logger.debug(f"[Tick] {symbol} fast_info failed: {e}")
        except Exception as e:
            logger.warning(f"[Tick] Batch fetch failed: {e}")

        sim.last_tick_time = now
        sim.tick_count = (sim.tick_count or 0) + 1
    else:
        # Return cached prices
        for symbol in active_symbols:
            stock = db.query(Stock).filter(Stock.symbol == symbol).first()
            if not stock:
                continue
            sp = db.query(StockPrice).filter(StockPrice.stock_id == stock.id).first()
            if sp:
                result[symbol] = {"price": sp.price, "change": sp.change, "changePct": sp.change_pct}

    # Evaluate alerts
    active_alerts = db.query(PriceAlert).filter(
        PriceAlert.active == True,  # noqa: E712
        PriceAlert.triggered == False,  # noqa: E712
    ).all()
    for alert in active_alerts:
        stock = db.query(Stock).filter(Stock.id == alert.stock_id).first()
        if not stock or stock.symbol not in result:
            continue
        cur = result[stock.symbol]["price"]
        triggered = (alert.condition == "above" and cur >= alert.target_price) or \
                    (alert.condition == "below" and cur <= alert.target_price)
        if triggered:
            alert.triggered = True
            alert.triggered_at = now

    db.commit()
    return result


# ---------------------------------------------------------------------------
# Candle aggregation (no change — real OHLCV math, not placeholder)
# ---------------------------------------------------------------------------

def aggregate_candles(
    db: Session,
    stock_id: int,
    timeframe: str,
    limit: int = 500,
    since: Optional[datetime] = None,
    before: Optional[datetime] = None,
) -> list:
    """Fetch candles for a stock at the requested timeframe.

    Native timeframes (1m, 1h, 1D) read directly. Derived timeframes
    (5m, 15m, 4h, 1W, 1M) aggregate from the closest base on the fly.
    """
    DERIVED_MAP = {
        "5m":  ("1m", 5 * 60),
        "15m": ("1m", 15 * 60),
        "4h":  ("1h", 4 * 3600),
        "1W":  ("1D", 7 * 86400),
        "1M":  ("1D", 30 * 86400),
    }

    if timeframe in ("1m", "1h", "1D"):
        query = db.query(Candle).filter(
            Candle.stock_id == stock_id,
            Candle.timeframe == timeframe,
        )
        if since:
            query = query.filter(Candle.timestamp >= since)
        if before:
            query = query.filter(Candle.timestamp < before)
        candles = query.order_by(Candle.timestamp.desc()).limit(limit).all()
        candles.reverse()
        return [c.to_dict() for c in candles]

    if timeframe not in DERIVED_MAP:
        return []

    base_tf, bucket_secs = DERIVED_MAP[timeframe]
    query = db.query(Candle).filter(
        Candle.stock_id == stock_id,
        Candle.timeframe == base_tf,
    )
    if since:
        query = query.filter(Candle.timestamp >= since)
    if before:
        query = query.filter(Candle.timestamp < before)
    base_candles = query.order_by(Candle.timestamp.asc()).all()
    if not base_candles:
        return []

    epoch = datetime(2000, 1, 1)
    buckets: dict[int, list] = {}
    for c in base_candles:
        ts_seconds = int((c.timestamp - epoch).total_seconds())
        bucket_key = (ts_seconds // bucket_secs) * bucket_secs
        buckets.setdefault(bucket_key, []).append(c)

    aggregated = []
    for bucket_key in sorted(buckets.keys()):
        group = buckets[bucket_key]
        bucket_ts = epoch + timedelta(seconds=bucket_key)
        aggregated.append({
            "stockId": stock_id,
            "timeframe": timeframe,
            "timestamp": bucket_ts.isoformat(),
            "openPrice": group[0].open_price,
            "high": max(c.high for c in group),
            "low": min(c.low for c in group),
            "closePrice": group[-1].close_price,
            "volume": sum(c.volume for c in group),
        })

    if limit and len(aggregated) > limit:
        aggregated = aggregated[-limit:]
    return aggregated


# ---------------------------------------------------------------------------
# Indicators (math only, no fake data)
# ---------------------------------------------------------------------------

def compute_indicator(candles: list, indicator_type: str, period: int = 14) -> list:
    """Compute SMA/EMA/RSI/MACD/BB/VWAP from real OHLCV candles."""
    if not candles:
        return []

    def _close(c):
        return c.get("closePrice") or c.get("close", 0)

    def _high(c):
        return c.get("high", _close(c))

    def _low(c):
        return c.get("low", _close(c))

    def _volume(c):
        return c.get("volume", 0)

    def _ts(c):
        return c.get("timestamp", "")

    closes = np.array([_close(c) for c in candles], dtype=float)

    if indicator_type == "SMA":
        result = []
        for i in range(len(closes)):
            if i < period - 1:
                continue
            val = float(np.mean(closes[i - period + 1:i + 1]))
            result.append({"timestamp": _ts(candles[i]), "value": round(val, 4)})
        return result

    if indicator_type == "EMA":
        multiplier = 2.0 / (period + 1)
        ema_values = np.empty(len(closes))
        ema_values[0] = closes[0]
        for i in range(1, len(closes)):
            ema_values[i] = (closes[i] - ema_values[i - 1]) * multiplier + ema_values[i - 1]
        return [
            {"timestamp": _ts(candles[i]), "value": round(float(ema_values[i]), 4)}
            for i in range(period - 1, len(closes))
        ]

    if indicator_type == "RSI":
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        result = []
        if len(gains) < period:
            return result
        avg_gain = float(np.mean(gains[:period]))
        avg_loss = float(np.mean(losses[:period]))
        for i in range(period, len(closes)):
            if i > period:
                avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
                avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
            rsi = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
            result.append({"timestamp": _ts(candles[i]), "value": round(rsi, 4)})
        return result

    if indicator_type == "MACD":
        fast_p, slow_p, sig_p = 12, 26, 9

        def _ema_arr(data, p):
            m = 2.0 / (p + 1)
            out = np.empty_like(data)
            out[0] = data[0]
            for i in range(1, len(data)):
                out[i] = (data[i] - out[i - 1]) * m + out[i - 1]
            return out

        if len(closes) < slow_p + sig_p:
            return []
        ema_fast = _ema_arr(closes, fast_p)
        ema_slow = _ema_arr(closes, slow_p)
        macd_line = ema_fast - ema_slow
        signal_line = _ema_arr(macd_line[slow_p - 1:], sig_p)
        result = []
        start = slow_p - 1 + sig_p - 1
        for i in range(start, len(closes)):
            mi = i - (slow_p - 1)
            si = mi - (sig_p - 1)
            macd_v = float(macd_line[i])
            sig_v = float(signal_line[si]) if 0 <= si < len(signal_line) else 0.0
            result.append({
                "timestamp": _ts(candles[i]),
                "macd": round(macd_v, 4),
                "signal": round(sig_v, 4),
                "histogram": round(macd_v - sig_v, 4),
            })
        return result

    if indicator_type == "BB":
        result = []
        for i in range(period - 1, len(closes)):
            window = closes[i - period + 1:i + 1]
            middle = float(np.mean(window))
            std = float(np.std(window, ddof=0))
            result.append({
                "timestamp": _ts(candles[i]),
                "upper": round(middle + 2.0 * std, 4),
                "middle": round(middle, 4),
                "lower": round(middle - 2.0 * std, 4),
            })
        return result

    if indicator_type == "VWAP":
        typical = np.array([(_high(c) + _low(c) + _close(c)) / 3.0 for c in candles], dtype=float)
        volumes = np.array([_volume(c) for c in candles], dtype=float)
        cum_tp_vol = np.cumsum(typical * volumes)
        cum_vol = np.cumsum(volumes)
        result = []
        for i in range(len(candles)):
            if cum_vol[i] == 0:
                continue
            result.append({"timestamp": _ts(candles[i]), "value": round(float(cum_tp_vol[i] / cum_vol[i]), 4)})
        return result

    return []


# ---------------------------------------------------------------------------
# Real news (Yahoo Finance Ticker.news — actual headlines + URLs)
# ---------------------------------------------------------------------------

# Symbols used to populate "general market" news when no symbol is specified.
_GENERAL_MARKET_SYMBOLS = ["SPY", "QQQ", "DIA", "^GSPC"]

_NEWS_TTL_SECONDS = 300  # 5 minutes


def _normalise_news_item(item: dict, fallback_symbol: Optional[str] = None) -> Optional[dict]:
    """Convert a yfinance news dict into our flat MarketNews shape.

    yfinance v2+ returns items shaped like:
      {"id": ..., "content": {"title", "summary", "pubDate", "provider": {"displayName"}, "canonicalUrl": {"url"}}}
    Older versions return flat {"title", "publisher", "link", "providerPublishTime"}.
    Returns None if the item can't be parsed.
    """
    if not isinstance(item, dict):
        return None

    headline = None
    summary = None
    source = None
    url = None
    published_at = None
    related_symbol = fallback_symbol

    content = item.get("content") if isinstance(item.get("content"), dict) else None

    if content:
        headline = content.get("title")
        summary = content.get("summary") or content.get("description")
        prov = content.get("provider") if isinstance(content.get("provider"), dict) else {}
        source = prov.get("displayName") or content.get("publisher")
        canon = content.get("canonicalUrl") if isinstance(content.get("canonicalUrl"), dict) else {}
        click = content.get("clickThroughUrl") if isinstance(content.get("clickThroughUrl"), dict) else {}
        url = canon.get("url") or click.get("url")
        pub = content.get("pubDate") or content.get("displayTime")
        if pub:
            try:
                published_at = datetime.fromisoformat(str(pub).replace("Z", "+00:00")).replace(tzinfo=None)
            except (ValueError, TypeError):
                pass
        # Try to extract a related symbol
        finance = content.get("finance") if isinstance(content.get("finance"), dict) else {}
        if isinstance(finance.get("stockTickers"), list) and finance["stockTickers"]:
            first = finance["stockTickers"][0]
            if isinstance(first, dict):
                related_symbol = first.get("symbol") or related_symbol
    else:
        headline = item.get("title")
        summary = item.get("summary")
        source = item.get("publisher")
        url = item.get("link")
        ts = item.get("providerPublishTime")
        if ts:
            try:
                published_at = datetime.utcfromtimestamp(int(ts))
            except (ValueError, TypeError):
                pass
        related = item.get("relatedTickers") or []
        if isinstance(related, list) and related:
            related_symbol = related[0]

    if not headline or not source:
        return None
    if not published_at:
        published_at = datetime.utcnow()

    return {
        "stock_symbol": related_symbol,
        "headline": headline[:1024],
        "summary": (summary or "")[:4096] or None,
        "source": source[:255],
        "url": url,
        "published_at": published_at,
    }


def fetch_news_for_symbol(symbol: str, max_items: int = 25) -> list[dict]:
    """Pull real news from Yahoo Finance for one ticker. Returns normalised dicts."""
    try:
        import yfinance as yf
        t = yf.Ticker(_to_yahoo_symbol(symbol))
        raw = t.news or []
    except Exception as e:
        logger.warning(f"[News] yfinance fetch failed for {symbol}: {e}")
        return []

    out: list[dict] = []
    for item in raw[:max_items]:
        norm = _normalise_news_item(item, fallback_symbol=symbol)
        if norm:
            out.append(norm)
    return out


def refresh_news_cache(db: Session, symbol: Optional[str] = None) -> int:
    """Pull fresh news from Yahoo Finance and upsert into MarketNews.

    Caches by (headline, source) so we don't insert duplicates across calls.
    Returns the number of new rows inserted.
    """
    sources_to_query: Iterable[Optional[str]]
    if symbol:
        sources_to_query = [symbol]
    else:
        sources_to_query = _GENERAL_MARKET_SYMBOLS

    inserted = 0
    seen_headlines = {
        (h, s) for h, s in db.query(MarketNews.headline, MarketNews.source).all()
    }

    for sym in sources_to_query:
        if sym is None:
            continue
        items = fetch_news_for_symbol(sym)
        for item in items:
            key = (item["headline"], item["source"])
            if key in seen_headlines:
                continue
            seen_headlines.add(key)
            # When fetching general market news, don't tag every item with the index symbol
            stock_symbol = item.get("stock_symbol")
            if symbol is None and stock_symbol in _GENERAL_MARKET_SYMBOLS:
                stock_symbol = None
            db.add(MarketNews(
                stock_symbol=stock_symbol,
                headline=item["headline"],
                summary=item["summary"],
                source=item["source"],
                url=item["url"],
                published_at=item["published_at"],
            ))
            inserted += 1

    if inserted:
        db.commit()
    return inserted
