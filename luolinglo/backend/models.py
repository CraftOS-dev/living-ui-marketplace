"""
Luolinglo Data Models

SQLAlchemy models for the language learning app.
Includes user profile, vocabulary, flashcards, quizzes, chat, achievements, and more.
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


# ============================================================================
# Framework Models (required by Living UI template)
# ============================================================================

class AppState(Base):
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


# ============================================================================
# Domain Models
# ============================================================================

class UserProfile(Base):
    __tablename__ = "user_profile"

    id = Column(Integer, primary_key=True, default=1)
    native_language = Column(String(100), nullable=False)
    target_language = Column(String(100), nullable=False)
    proficiency_level = Column(String(20), default="beginner")
    display_name = Column(String(100), default="Learner")
    total_xp = Column(Integer, default=0)
    level = Column(Integer, default=1)
    current_streak = Column(Integer, default=0)
    longest_streak = Column(Integer, default=0)
    last_practice_date = Column(String(10), nullable=True)
    streak_freeze_inventory = Column(Integer, default=0)
    daily_xp_goal = Column(Integer, default=50)
    daily_xp_earned = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "nativeLanguage": self.native_language,
            "targetLanguage": self.target_language,
            "proficiencyLevel": self.proficiency_level,
            "displayName": self.display_name,
            "totalXp": self.total_xp,
            "level": self.level,
            "currentStreak": self.current_streak,
            "longestStreak": self.longest_streak,
            "lastPracticeDate": self.last_practice_date,
            "streakFreezeInventory": self.streak_freeze_inventory,
            "dailyXpGoal": self.daily_xp_goal,
            "dailyXpEarned": self.daily_xp_earned,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class VocabularyWord(Base):
    __tablename__ = "vocabulary_words"

    id = Column(Integer, primary_key=True, index=True)
    word = Column(String(255), nullable=False)
    translation = Column(String(255), nullable=False)
    pronunciation = Column(String(255), nullable=True)
    part_of_speech = Column(String(50), nullable=True)
    example_sentence = Column(Text, nullable=True)
    example_translation = Column(Text, nullable=True)
    difficulty = Column(String(20), default="beginner")
    category = Column(String(100), nullable=True)
    language_pair = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "word": self.word,
            "translation": self.translation,
            "pronunciation": self.pronunciation,
            "partOfSpeech": self.part_of_speech,
            "exampleSentence": self.example_sentence,
            "exampleTranslation": self.example_translation,
            "difficulty": self.difficulty,
            "category": self.category,
            "languagePair": self.language_pair,
            "notes": self.notes,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class VocabularyList(Base):
    __tablename__ = "vocabulary_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    language_pair = Column(String(200), nullable=False)
    difficulty = Column(String(20), default="beginner")
    is_generated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "languagePair": self.language_pair,
            "difficulty": self.difficulty,
            "isGenerated": self.is_generated,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class VocabularyListItem(Base):
    __tablename__ = "vocabulary_list_items"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("vocabulary_lists.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("vocabulary_words.id"), nullable=False)
    order = Column(Integer, default=0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "listId": self.list_id,
            "wordId": self.word_id,
            "order": self.order,
        }


class FlashcardProgress(Base):
    __tablename__ = "flashcard_progress"

    id = Column(Integer, primary_key=True, index=True)
    word_id = Column(Integer, ForeignKey("vocabulary_words.id"), nullable=False, unique=True)
    easiness_factor = Column(Float, default=2.5)
    interval = Column(Integer, default=0)
    repetitions = Column(Integer, default=0)
    next_review_date = Column(String(10), nullable=False)
    last_review_date = Column(String(10), nullable=True)
    total_reviews = Column(Integer, default=0)
    correct_count = Column(Integer, default=0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "wordId": self.word_id,
            "easinessFactor": self.easiness_factor,
            "interval": self.interval,
            "repetitions": self.repetitions,
            "nextReviewDate": self.next_review_date,
            "lastReviewDate": self.last_review_date,
            "totalReviews": self.total_reviews,
            "correctCount": self.correct_count,
        }


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id = Column(Integer, primary_key=True, index=True)
    quiz_type = Column(String(50), nullable=False)
    category = Column(String(100), nullable=True)
    total_questions = Column(Integer, nullable=False)
    correct_answers = Column(Integer, nullable=False)
    xp_earned = Column(Integer, default=0)
    time_taken_seconds = Column(Integer, nullable=True)
    questions_data = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "quizType": self.quiz_type,
            "category": self.category,
            "totalQuestions": self.total_questions,
            "correctAnswers": self.correct_answers,
            "xpEarned": self.xp_earned,
            "timeTakenSeconds": self.time_taken_seconds,
            "questionsData": self.questions_data or [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(100), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "role": self.role,
            "content": self.content,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class DailyActivity(Base):
    __tablename__ = "daily_activity"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), nullable=False, unique=True)
    words_learned = Column(Integer, default=0)
    cards_reviewed = Column(Integer, default=0)
    quizzes_completed = Column(Integer, default=0)
    xp_earned = Column(Integer, default=0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "date": self.date,
            "wordsLearned": self.words_learned,
            "cardsReviewed": self.cards_reviewed,
            "quizzesCompleted": self.quizzes_completed,
            "xpEarned": self.xp_earned,
        }


class Achievement(Base):
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, index=True)
    badge_id = Column(String(50), nullable=False, unique=True)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=False)
    icon = Column(String(10), nullable=False)
    earned_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "badgeId": self.badge_id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "earnedAt": self.earned_at.isoformat() if self.earned_at else None,
        }


class LLMCache(Base):
    __tablename__ = "llm_cache"

    id = Column(Integer, primary_key=True, index=True)
    cache_key = Column(String(255), nullable=False, unique=True, index=True)
    content = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "cacheKey": self.cache_key,
            "content": self.content,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
        }
