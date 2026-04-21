"""
Living UI Data Models

SQLAlchemy models for data persistence.
Includes AppState for generic state, plus Pet and ActivityLog for the Tamagotchi app.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON, Float, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


class AppState(Base):
    """
    Flexible application state storage.
    Stores the entire app state as JSON, allowing any structure.
    """
    __tablename__ = "app_state"

    id = Column(Integer, primary_key=True, default=1)
    data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "data": self.data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def update_data(self, updates: Dict[str, Any]) -> None:
        current = self.data or {}
        current.update(updates)
        self.data = current
        self.updated_at = datetime.utcnow()


class UISnapshot(Base):
    """
    UI state snapshot for agent observation.
    """
    __tablename__ = "ui_snapshot"

    id = Column(Integer, primary_key=True, default=1)
    html_structure = Column(Text, nullable=True)
    visible_text = Column(JSON, default=list)
    input_values = Column(JSON, default=dict)
    component_state = Column(JSON, default=dict)
    current_view = Column(String(255), nullable=True)
    viewport = Column(JSON, default=dict)
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
    """
    __tablename__ = "ui_screenshot"

    id = Column(Integer, primary_key=True, default=1)
    image_data = Column(Text, nullable=True)
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


class Item(Base):
    """
    Example model for list-based data.
    """
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    completed = Column(Boolean, default=False)
    order = Column(Integer, default=0)
    extra_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "completed": self.completed,
            "order": self.order,
            "extraData": self.extra_data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


# ============================================================================
# Tamagotchi Models
# ============================================================================

VALID_STAGES = ["egg", "baby", "child", "teen", "adult"]
VALID_MOODS = ["happy", "excited", "neutral", "hungry", "sad", "sick", "sleeping", "critical"]

# Evolution point thresholds per stage
STAGE_THRESHOLDS = {
    "egg": 50,
    "baby": 150,
    "child": 300,
    "teen": 500,
    "adult": 700,  # retirement threshold
}

# Stat decay rates per minute (when awake)
DECAY_RATES = {
    "hunger": 2.0,       # hunger drops 2 per minute
    "happiness": 1.0,    # happiness drops 1 per minute
    "health_base": 0.5,  # health drops 0.5 per minute when other stats are low
}

# Slower decay when sleeping
SLEEP_DECAY_MULTIPLIER = 0.2


class Pet(Base):
    """
    The virtual CraftBot cat-bot pet.
    Stats decay over real time. Backend calculates current stats based on last_updated.
    """
    __tablename__ = "pets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    stage = Column(String(20), default="egg")  # egg, baby, child, teen, adult
    hunger = Column(Float, default=80.0)        # 0-100, 100=full
    happiness = Column(Float, default=80.0)     # 0-100, 100=very happy
    health = Column(Float, default=100.0)       # 0-100, 100=perfect health
    is_sleeping = Column(Boolean, default=False)
    is_sick = Column(Boolean, default=False)
    is_retired = Column(Boolean, default=False)
    retired_at = Column(DateTime, nullable=True)
    evolution_points = Column(Integer, default=0)
    age_minutes = Column(Float, default=0.0)    # age in minutes
    # Cooldown timestamps (ISO strings stored as JSON)
    cooldowns = Column(JSON, default=dict)      # {"feed": "2024-...", "play": "2024-..."}
    created_at = Column(DateTime, default=datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.utcnow)  # for decay calculation

    # Relationship to activity log
    activity_logs = relationship("ActivityLog", back_populates="pet", cascade="all, delete-orphan")

    def compute_mood(self) -> str:
        """Compute current mood based on stats."""
        if self.is_sleeping:
            return "sleeping"
        if self.is_sick:
            return "sick"
        if self.hunger < 10 or self.happiness < 10 or self.health < 10:
            return "critical"
        if self.hunger < 30:
            return "hungry"
        if self.happiness < 30:
            return "sad"
        if self.happiness > 90:
            return "excited"
        if self.hunger > 70 and self.happiness > 70 and self.health > 70:
            return "happy"
        return "neutral"

    def apply_decay(self, elapsed_minutes: float) -> None:
        """Apply stat decay based on elapsed time."""
        if elapsed_minutes <= 0:
            return

        multiplier = SLEEP_DECAY_MULTIPLIER if self.is_sleeping else 1.0

        # Hunger decays always
        self.hunger = max(0.0, self.hunger - DECAY_RATES["hunger"] * elapsed_minutes * multiplier)

        # Happiness decays always
        self.happiness = max(0.0, self.happiness - DECAY_RATES["happiness"] * elapsed_minutes * multiplier)

        # Health decays faster when hunger or happiness is low
        health_decay = DECAY_RATES["health_base"]
        if self.hunger < 30 or self.happiness < 30:
            health_decay *= 2.0
        if self.is_sleeping:
            # Health recovers slightly while sleeping
            self.health = min(100.0, self.health + 0.3 * elapsed_minutes)
        else:
            self.health = max(0.0, self.health - health_decay * elapsed_minutes * multiplier)

        # Random sickness: if health < 20, 5% chance per minute of getting sick
        import random
        if self.health < 20 and not self.is_sick:
            sick_chance = 0.05 * elapsed_minutes
            if random.random() < sick_chance:
                self.is_sick = True

        # Earn evolution points when stats are high (above 70)
        if not self.is_retired and self.hunger > 70 and self.happiness > 70 and self.health > 70:
            self.evolution_points += int(elapsed_minutes * 2)

        # Age the pet
        self.age_minutes += elapsed_minutes

        # Check for evolution
        self._check_evolution()

    def _check_evolution(self) -> None:
        """Check if pet should evolve to next stage."""
        if self.is_retired:
            return
        stage_idx = VALID_STAGES.index(self.stage)
        if stage_idx < len(VALID_STAGES) - 1:
            next_stage = VALID_STAGES[stage_idx + 1]
            threshold = STAGE_THRESHOLDS[self.stage]
            if self.evolution_points >= threshold:
                self.stage = next_stage

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "stage": self.stage,
            "hunger": round(self.hunger, 1),
            "happiness": round(self.happiness, 1),
            "health": round(self.health, 1),
            "is_sleeping": self.is_sleeping,
            "is_sick": self.is_sick,
            "is_retired": self.is_retired,
            "retired_at": self.retired_at.isoformat() if self.retired_at else None,
            "evolution_points": self.evolution_points,
            "age_minutes": round(self.age_minutes, 1),
            "cooldowns": self.cooldowns or {},
            "mood": self.compute_mood(),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
        }


class ActivityLog(Base):
    """
    Log of all care actions taken with the pet.
    """
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    action = Column(String(50), nullable=False)  # feed, play, sleep, wake, clean, medicine, evolve, retire
    description = Column(String(255), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

    pet = relationship("Pet", back_populates="activity_logs")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "pet_id": self.pet_id,
            "action": self.action,
            "description": self.description,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }
