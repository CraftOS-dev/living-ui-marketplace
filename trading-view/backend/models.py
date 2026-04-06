"""
Living UI Data Models - TradingView Clone

SQLAlchemy models for the TradingView Living UI project.
Includes framework models (AppState, UISnapshot, UIScreenshot)
and domain models for stocks, charting, alerts, and simulation.
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, JSON, Index, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


class AppState(Base):
    """
    Flexible application state storage.

    Stores the entire app state as JSON, allowing any structure.
    This is the primary model used by the default state management.

    The agent should extend this with custom models for complex data needs.
    """
    __tablename__ = "app_state"

    id = Column(Integer, primary_key=True, default=1)
    data = Column(JSON, default=dict)  # Stores arbitrary state as JSON
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "id": self.id,
            "data": self.data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def update_data(self, updates: Dict[str, Any]) -> None:
        """Merge updates into existing data."""
        current = self.data or {}
        current.update(updates)
        self.data = current
        self.updated_at = datetime.utcnow()


class UISnapshot(Base):
    """
    UI state snapshot for agent observation.

    Frontend periodically posts UI state here.
    Agent can GET this to observe the UI without WebSocket.
    """
    __tablename__ = "ui_snapshot"

    id = Column(Integer, primary_key=True, default=1)
    html_structure = Column(Text, nullable=True)  # Simplified DOM structure
    visible_text = Column(JSON, default=list)  # Array of visible text content
    input_values = Column(JSON, default=dict)  # Form field values
    component_state = Column(JSON, default=dict)  # Registered component states
    current_view = Column(String(255), nullable=True)  # Current route/view
    viewport = Column(JSON, default=dict)  # Window dimensions, scroll position
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "htmlStructure": self.html_structure,
            "visibleText": self.visible_text or [],
            "inputValues": self.input_values or {},
            "componentState": self.component_state or {},
            "currentView": self.current_view,
            "viewport": self.viewport or {},
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class UIScreenshot(Base):
    """
    UI screenshot for agent visual observation.

    Frontend captures and posts screenshot here.
    Agent can GET this to see the UI visually.
    """
    __tablename__ = "ui_screenshot"

    id = Column(Integer, primary_key=True, default=1)
    image_data = Column(Text, nullable=True)  # Base64 encoded PNG
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "imageData": self.image_data,
            "width": self.width,
            "height": self.height,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


# ============================================================================
# TradingView Domain Models
# ============================================================================


class Stock(Base):
    """Core stock/ticker model."""
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    sector = Column(String(100), nullable=True)
    market_cap = Column(Float, nullable=True)
    exchange = Column(String(50), default="NASDAQ")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    stock_price = relationship("StockPrice", back_populates="stock", uselist=False)
    candles = relationship("Candle", back_populates="stock")
    watchlist_entries = relationship("Watchlist", back_populates="stock")
    price_alerts = relationship("PriceAlert", back_populates="stock")
    drawings = relationship("Drawing", back_populates="stock")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "name": self.name,
            "sector": self.sector,
            "marketCap": self.market_cap,
            "exchange": self.exchange,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class StockPrice(Base):
    """Current price snapshot per stock."""
    __tablename__ = "stock_prices"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True, nullable=False)
    price = Column(Float, nullable=False)
    open_price = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    prev_close = Column(Float, nullable=False)
    volume = Column(Integer, default=0)
    change = Column(Float, default=0)
    change_pct = Column(Float, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    stock = relationship("Stock", back_populates="stock_price")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "stockId": self.stock_id,
            "price": self.price,
            "openPrice": self.open_price,
            "high": self.high,
            "low": self.low,
            "prevClose": self.prev_close,
            "volume": self.volume,
            "change": self.change,
            "changePct": self.change_pct,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Candle(Base):
    """OHLCV candle data."""
    __tablename__ = "candles"

    __table_args__ = (
        Index("ix_candles_stock_timeframe_timestamp", "stock_id", "timeframe", "timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True, nullable=False)
    timeframe = Column(String(10), nullable=False)  # "1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"
    timestamp = Column(DateTime, index=True, nullable=False)
    open_price = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close_price = Column(Float, nullable=False)
    volume = Column(Integer, default=0)

    # Relationships
    stock = relationship("Stock", back_populates="candles")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "stockId": self.stock_id,
            "timeframe": self.timeframe,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "openPrice": self.open_price,
            "high": self.high,
            "low": self.low,
            "closePrice": self.close_price,
            "volume": self.volume,
        }


class Watchlist(Base):
    """User watchlist entries."""
    __tablename__ = "watchlist"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True, nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    stock = relationship("Stock", back_populates="watchlist_entries")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "stockId": self.stock_id,
            "sortOrder": self.sort_order,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class PriceAlert(Base):
    """Price alert configuration."""
    __tablename__ = "price_alerts"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True, nullable=False)
    target_price = Column(Float, nullable=False)
    condition = Column(String(10), nullable=False)  # "above" or "below"
    triggered = Column(Boolean, default=False)
    triggered_at = Column(DateTime, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    stock = relationship("Stock", back_populates="price_alerts")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "stockId": self.stock_id,
            "targetPrice": self.target_price,
            "condition": self.condition,
            "triggered": self.triggered,
            "triggeredAt": self.triggered_at.isoformat() if self.triggered_at else None,
            "active": self.active,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Drawing(Base):
    """Chart drawing/annotation."""
    __tablename__ = "drawings"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True, nullable=False)
    timeframe = Column(String(10), nullable=False)
    tool_type = Column(String(50), nullable=False)  # "trendline", "horizontal", "fibonacci", "channel", "rectangle", "text", "arrow"
    drawing_data = Column(JSON, default=dict)  # Serialized coordinates/config
    color = Column(String(20), default="#2962FF")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    stock = relationship("Stock", back_populates="drawings")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "stockId": self.stock_id,
            "timeframe": self.timeframe,
            "toolType": self.tool_type,
            "drawingData": self.drawing_data or {},
            "color": self.color,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class WidgetLayout(Base):
    """Saved widget/chart layout configuration."""
    __tablename__ = "widget_layouts"

    id = Column(Integer, primary_key=True, index=True)
    layout_name = Column(String(100), default="default")
    layout_data = Column(JSON, default=dict)  # react-grid-layout serialized config
    chart_config = Column(JSON, default=dict)  # Per-chart settings (symbol, timeframe, indicators)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "layoutName": self.layout_name,
            "layoutData": self.layout_data or {},
            "chartConfig": self.chart_config or {},
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class MarketNews(Base):
    """Market news articles."""
    __tablename__ = "market_news"

    id = Column(Integer, primary_key=True, index=True)
    stock_symbol = Column(String(20), nullable=True)  # null = general market news
    headline = Column(String(1024), nullable=False)
    summary = Column(Text, nullable=True)
    source = Column(String(255), nullable=False)
    url = Column(String(2048), nullable=True)
    published_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "stockSymbol": self.stock_symbol,
            "headline": self.headline,
            "summary": self.summary,
            "source": self.source,
            "url": self.url,
            "publishedAt": self.published_at.isoformat() if self.published_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class SimulationState(Base):
    """Tracks simulation engine state."""
    __tablename__ = "simulation_state"

    id = Column(Integer, primary_key=True, default=1)
    last_tick_time = Column(DateTime, nullable=True)
    is_running = Column(Boolean, default=True)
    tick_count = Column(Integer, default=0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "lastTickTime": self.last_tick_time.isoformat() if self.last_tick_time else None,
            "isRunning": self.is_running,
            "tickCount": self.tick_count,
        }
