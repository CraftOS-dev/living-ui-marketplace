"""
Luolinglo API Routes

REST API endpoints for the language learning app.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import (
    AppState, UISnapshot, UIScreenshot,
    UserProfile, VocabularyWord, VocabularyList, VocabularyListItem,
    FlashcardProgress, QuizAttempt, ChatMessage, DailyActivity, Achievement,
)
from sm2 import sm2_update
from datetime import datetime, date, timedelta
import logging
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]

class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None

class ProfileCreate(BaseModel):
    nativeLanguage: str
    targetLanguage: str
    proficiencyLevel: str = "beginner"
    displayName: str = "Learner"

class ProfileUpdate(BaseModel):
    nativeLanguage: Optional[str] = None
    targetLanguage: Optional[str] = None
    proficiencyLevel: Optional[str] = None
    displayName: Optional[str] = None
    dailyXpGoal: Optional[int] = None

class WordCreate(BaseModel):
    word: str
    translation: str
    pronunciation: Optional[str] = None
    partOfSpeech: Optional[str] = None
    exampleSentence: Optional[str] = None
    exampleTranslation: Optional[str] = None
    difficulty: str = "beginner"
    category: Optional[str] = None
    notes: Optional[str] = None

class VocabGenerateRequest(BaseModel):
    category: str
    difficulty: str = "beginner"
    count: int = 10

class ListCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    difficulty: str = "beginner"

class ListGenerateRequest(BaseModel):
    category: str
    difficulty: str = "beginner"
    count: int = 10

class FlashcardReview(BaseModel):
    wordId: int
    quality: int  # 0-5

class QuizGenerateRequest(BaseModel):
    quizType: str  # multiple_choice, fill_blank, match_pairs, sentence_build
    category: Optional[str] = None
    count: int = 5

class QuizSubmit(BaseModel):
    quizType: str
    category: Optional[str] = None
    totalQuestions: int
    correctAnswers: int
    timeTakenSeconds: Optional[int] = None
    questionsData: Optional[List[Dict[str, Any]]] = None

class ChatMessageCreate(BaseModel):
    sessionId: str
    content: str

class ChatSessionCreate(BaseModel):
    name: Optional[str] = None

class UISnapshotUpdate(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None

class UIScreenshotUpdate(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


# ============================================================================
# Helper Functions
# ============================================================================

def _get_profile(db: Session) -> Optional[UserProfile]:
    return db.query(UserProfile).first()

def _get_language_pair(profile: UserProfile) -> str:
    return f"{profile.native_language}-{profile.target_language}"

def _get_or_create_daily_activity(db: Session) -> DailyActivity:
    today_str = date.today().isoformat()
    activity = db.query(DailyActivity).filter(DailyActivity.date == today_str).first()
    if not activity:
        activity = DailyActivity(date=today_str)
        db.add(activity)
        db.commit()
        db.refresh(activity)
    return activity

def _add_xp(db: Session, profile: UserProfile, xp: int) -> int:
    """Add XP to profile with streak multiplier. Returns actual XP added."""
    multiplier = min(2.0, 1.0 + profile.current_streak * 0.05)
    actual_xp = round(xp * multiplier)
    profile.total_xp += actual_xp
    profile.level = (profile.total_xp // 150) + 1
    profile.daily_xp_earned += actual_xp

    activity = _get_or_create_daily_activity(db)
    activity.xp_earned += actual_xp

    db.commit()
    return actual_xp

def _record_practice(db: Session, profile: UserProfile) -> None:
    """Record practice and update streak."""
    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()

    if profile.last_practice_date == today_str:
        return

    if profile.last_practice_date == yesterday_str:
        profile.current_streak += 1
    elif profile.last_practice_date and profile.last_practice_date < yesterday_str:
        if profile.streak_freeze_inventory > 0:
            profile.streak_freeze_inventory -= 1
            profile.current_streak += 1
        else:
            profile.current_streak = 1
    else:
        profile.current_streak = 1

    if profile.current_streak > profile.longest_streak:
        profile.longest_streak = profile.current_streak

    profile.last_practice_date = today_str

    # Reset daily XP if it's a new day
    profile.daily_xp_earned = 0

    db.commit()

    _check_achievements(db, profile)


# Achievement definitions
BADGE_DEFINITIONS = [
    {"badge_id": "streak_7", "name": "Week Warrior", "description": "7-day streak", "icon": "🔥", "check": lambda p, db: p.current_streak >= 7},
    {"badge_id": "streak_30", "name": "Monthly Master", "description": "30-day streak", "icon": "💪", "check": lambda p, db: p.current_streak >= 30},
    {"badge_id": "streak_100", "name": "Century Streak", "description": "100-day streak", "icon": "🏆", "check": lambda p, db: p.current_streak >= 100},
    {"badge_id": "streak_365", "name": "Year of Learning", "description": "365-day streak", "icon": "👑", "check": lambda p, db: p.current_streak >= 365},
    {"badge_id": "vocab_50", "name": "Word Collector", "description": "Learn 50 words", "icon": "📚", "check": lambda p, db: db.query(VocabularyWord).count() >= 50},
    {"badge_id": "vocab_200", "name": "Vocabulary Builder", "description": "Learn 200 words", "icon": "📖", "check": lambda p, db: db.query(VocabularyWord).count() >= 200},
    {"badge_id": "vocab_500", "name": "Word Master", "description": "Learn 500 words", "icon": "🎓", "check": lambda p, db: db.query(VocabularyWord).count() >= 500},
    {"badge_id": "vocab_1000", "name": "Lexicon Legend", "description": "Learn 1000 words", "icon": "🌟", "check": lambda p, db: db.query(VocabularyWord).count() >= 1000},
    {"badge_id": "quiz_first", "name": "First Quiz", "description": "Complete your first quiz", "icon": "✅", "check": lambda p, db: db.query(QuizAttempt).count() >= 1},
    {"badge_id": "quiz_perfect_10", "name": "Perfect Ten", "description": "10 perfect quiz scores", "icon": "💯", "check": lambda p, db: db.query(QuizAttempt).filter(QuizAttempt.correct_answers == QuizAttempt.total_questions).count() >= 10},
    {"badge_id": "quiz_100", "name": "Quiz Champion", "description": "Complete 100 quizzes", "icon": "🏅", "check": lambda p, db: db.query(QuizAttempt).count() >= 100},
    {"badge_id": "chat_first", "name": "First Chat", "description": "Start your first AI conversation", "icon": "💬", "check": lambda p, db: db.query(ChatMessage).filter(ChatMessage.role == "user").count() >= 1},
    {"badge_id": "chat_50", "name": "Chatty Learner", "description": "50 AI conversations", "icon": "🗣️", "check": lambda p, db: db.query(ChatMessage).filter(ChatMessage.role == "user").count() >= 50},
    {"badge_id": "level_apprentice", "name": "Apprentice", "description": "Reach level 6", "icon": "📗", "check": lambda p, db: p.level >= 6},
    {"badge_id": "level_student", "name": "Student", "description": "Reach level 11", "icon": "📘", "check": lambda p, db: p.level >= 11},
    {"badge_id": "level_speaker", "name": "Speaker", "description": "Reach level 21", "icon": "📙", "check": lambda p, db: p.level >= 21},
    {"badge_id": "level_fluent", "name": "Fluent", "description": "Reach level 36", "icon": "📕", "check": lambda p, db: p.level >= 36},
    {"badge_id": "level_master", "name": "Master", "description": "Reach level 51", "icon": "🎯", "check": lambda p, db: p.level >= 51},
]

def _check_achievements(db: Session, profile: UserProfile) -> List[Dict[str, Any]]:
    """Check and award new achievements. Returns newly earned badges."""
    newly_earned = []
    for badge_def in BADGE_DEFINITIONS:
        existing = db.query(Achievement).filter(Achievement.badge_id == badge_def["badge_id"]).first()
        if existing:
            continue
        if badge_def["check"](profile, db):
            achievement = Achievement(
                badge_id=badge_def["badge_id"],
                name=badge_def["name"],
                description=badge_def["description"],
                icon=badge_def["icon"],
            )
            db.add(achievement)
            newly_earned.append(achievement.to_dict())
    if newly_earned:
        db.commit()
    return newly_earned


# ============================================================================
# State Management Routes (Framework)
# ============================================================================

@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}

@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.data or {}

@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
    db.commit()
    db.refresh(state)
    return state.data or {}

@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}

@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    payload = request.payload or {}
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}

    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    else:
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# Profile Routes
# ============================================================================

@router.get("/profile")
def get_profile(db: Session = Depends(get_db)):
    profile = _get_profile(db)
    if not profile:
        return None
    return profile.to_dict()

@router.post("/profile")
def create_profile(data: ProfileCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    existing = _get_profile(db)
    if existing:
        raise HTTPException(status_code=400, detail="Profile already exists")

    profile = UserProfile(
        native_language=data.nativeLanguage,
        target_language=data.targetLanguage,
        proficiency_level=data.proficiencyLevel,
        display_name=data.displayName,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    logger.info("[Routes] Created user profile: %s learning %s", data.nativeLanguage, data.targetLanguage)
    return profile.to_dict()

@router.put("/profile")
def update_profile(data: ProfileUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    if data.nativeLanguage is not None:
        profile.native_language = data.nativeLanguage
    if data.targetLanguage is not None:
        profile.target_language = data.targetLanguage
    if data.proficiencyLevel is not None:
        profile.proficiency_level = data.proficiencyLevel
    if data.displayName is not None:
        profile.display_name = data.displayName
    if data.dailyXpGoal is not None:
        profile.daily_xp_goal = data.dailyXpGoal

    db.commit()
    db.refresh(profile)
    return profile.to_dict()

@router.post("/profile/record-practice")
def record_practice(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    _record_practice(db, profile)
    db.refresh(profile)
    return profile.to_dict()


# ============================================================================
# Vocabulary Routes
# ============================================================================

@router.get("/vocabulary")
def list_vocabulary(
    category: Optional[str] = None,
    difficulty: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(VocabularyWord)

    if category:
        query = query.filter(VocabularyWord.category == category)
    if difficulty:
        query = query.filter(VocabularyWord.difficulty == difficulty)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (VocabularyWord.word.ilike(search_term)) |
            (VocabularyWord.translation.ilike(search_term))
        )

    total = query.count()
    words = query.order_by(VocabularyWord.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

    return {
        "words": [w.to_dict() for w in words],
        "total": total,
        "page": page,
        "limit": limit,
    }

@router.post("/vocabulary")
def create_word(data: WordCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    word = VocabularyWord(
        word=data.word,
        translation=data.translation,
        pronunciation=data.pronunciation,
        part_of_speech=data.partOfSpeech,
        example_sentence=data.exampleSentence,
        example_translation=data.exampleTranslation,
        difficulty=data.difficulty,
        category=data.category,
        language_pair=_get_language_pair(profile),
        notes=data.notes,
    )
    db.add(word)
    db.commit()
    db.refresh(word)

    _add_xp(db, profile, 2)
    _record_practice(db, profile)

    activity = _get_or_create_daily_activity(db)
    activity.words_learned += 1
    db.commit()

    return word.to_dict()

@router.get("/vocabulary/{word_id}")
def get_word(word_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    word = db.query(VocabularyWord).filter(VocabularyWord.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")
    return word.to_dict()

@router.delete("/vocabulary/{word_id}")
def delete_word(word_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    word = db.query(VocabularyWord).filter(VocabularyWord.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")

    db.query(VocabularyListItem).filter(VocabularyListItem.word_id == word_id).delete()
    db.query(FlashcardProgress).filter(FlashcardProgress.word_id == word_id).delete()
    db.delete(word)
    db.commit()
    return {"status": "deleted", "id": str(word_id)}

@router.post("/vocabulary/generate")
async def generate_vocabulary(data: VocabGenerateRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    from llm_service import generate_text, parse_json_response, make_cache_key, check_cache, store_cache
    from prompts import vocabulary_generation_prompt

    lang_pair = _get_language_pair(profile)
    cache_key = make_cache_key("vocab", lang_pair, data.category, data.difficulty, str(data.count))

    cached = check_cache(db, cache_key)
    if cached:
        words_data = cached
    else:
        prompt = vocabulary_generation_prompt(
            target_language=profile.target_language,
            native_language=profile.native_language,
            category=data.category,
            difficulty=data.difficulty,
            count=data.count,
        )
        response = await generate_text(
            system_prompt="You are a language education content generator. Output ONLY valid JSON.",
            user_prompt=prompt,
        )
        if not response:
            raise HTTPException(status_code=503, detail="LLM service unavailable")

        words_data = parse_json_response(response)
        if not words_data or not isinstance(words_data, list):
            raise HTTPException(status_code=500, detail="Failed to parse LLM response")

        store_cache(db, cache_key, words_data, hours=168)

    created_words = []
    for wd in words_data:
        word = VocabularyWord(
            word=wd.get("word", ""),
            translation=wd.get("translation", ""),
            pronunciation=wd.get("pronunciation"),
            part_of_speech=wd.get("partOfSpeech"),
            example_sentence=wd.get("exampleSentence"),
            example_translation=wd.get("exampleTranslation"),
            difficulty=data.difficulty,
            category=data.category,
            language_pair=lang_pair,
        )
        db.add(word)
        db.flush()
        created_words.append(word)

    db.commit()

    _add_xp(db, profile, len(created_words) * 2)
    _record_practice(db, profile)

    activity = _get_or_create_daily_activity(db)
    activity.words_learned += len(created_words)
    db.commit()

    return {"words": [w.to_dict() for w in created_words]}


# ============================================================================
# Vocabulary List Routes
# ============================================================================

@router.get("/lists")
def list_vocab_lists(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    lists = db.query(VocabularyList).order_by(VocabularyList.created_at.desc()).all()
    result = []
    for vl in lists:
        d = vl.to_dict()
        d["wordCount"] = db.query(VocabularyListItem).filter(VocabularyListItem.list_id == vl.id).count()
        result.append(d)
    return result

@router.post("/lists")
def create_vocab_list(data: ListCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    vl = VocabularyList(
        name=data.name,
        description=data.description,
        category=data.category,
        language_pair=_get_language_pair(profile),
        difficulty=data.difficulty,
    )
    db.add(vl)
    db.commit()
    db.refresh(vl)
    d = vl.to_dict()
    d["wordCount"] = 0
    return d

@router.get("/lists/{list_id}")
def get_vocab_list(list_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    vl = db.query(VocabularyList).filter(VocabularyList.id == list_id).first()
    if not vl:
        raise HTTPException(status_code=404, detail="List not found")

    items = db.query(VocabularyListItem).filter(VocabularyListItem.list_id == list_id).order_by(VocabularyListItem.order).all()
    word_ids = [item.word_id for item in items]
    words = db.query(VocabularyWord).filter(VocabularyWord.id.in_(word_ids)).all() if word_ids else []
    words_map = {w.id: w.to_dict() for w in words}

    d = vl.to_dict()
    d["words"] = [words_map[wid] for wid in word_ids if wid in words_map]
    d["wordCount"] = len(d["words"])
    return d

@router.delete("/lists/{list_id}")
def delete_vocab_list(list_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    vl = db.query(VocabularyList).filter(VocabularyList.id == list_id).first()
    if not vl:
        raise HTTPException(status_code=404, detail="List not found")
    db.query(VocabularyListItem).filter(VocabularyListItem.list_id == list_id).delete()
    db.delete(vl)
    db.commit()
    return {"status": "deleted", "id": str(list_id)}

@router.post("/lists/{list_id}/words")
def add_word_to_list(list_id: int, data: Dict[str, int], db: Session = Depends(get_db)) -> Dict[str, Any]:
    vl = db.query(VocabularyList).filter(VocabularyList.id == list_id).first()
    if not vl:
        raise HTTPException(status_code=404, detail="List not found")

    word_id = data.get("wordId")
    if not word_id:
        raise HTTPException(status_code=400, detail="wordId required")

    word = db.query(VocabularyWord).filter(VocabularyWord.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")

    existing = db.query(VocabularyListItem).filter(
        VocabularyListItem.list_id == list_id,
        VocabularyListItem.word_id == word_id,
    ).first()
    if existing:
        return {"status": "already_exists"}

    max_order = db.query(VocabularyListItem).filter(VocabularyListItem.list_id == list_id).count()
    item = VocabularyListItem(list_id=list_id, word_id=word_id, order=max_order)
    db.add(item)
    db.commit()
    return {"status": "added"}

@router.delete("/lists/{list_id}/words/{word_id}")
def remove_word_from_list(list_id: int, word_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    item = db.query(VocabularyListItem).filter(
        VocabularyListItem.list_id == list_id,
        VocabularyListItem.word_id == word_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Word not in list")
    db.delete(item)
    db.commit()
    return {"status": "removed"}

@router.post("/lists/generate")
async def generate_vocab_list(data: ListGenerateRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    from llm_service import generate_text, parse_json_response, make_cache_key, check_cache, store_cache
    from prompts import vocabulary_generation_prompt

    lang_pair = _get_language_pair(profile)
    cache_key = make_cache_key("list_gen", lang_pair, data.category, data.difficulty, str(data.count))

    cached = check_cache(db, cache_key)
    if cached:
        words_data = cached
    else:
        prompt = vocabulary_generation_prompt(
            target_language=profile.target_language,
            native_language=profile.native_language,
            category=data.category,
            difficulty=data.difficulty,
            count=data.count,
        )
        response = await generate_text(
            system_prompt="You are a language education content generator. Output ONLY valid JSON.",
            user_prompt=prompt,
        )
        if not response:
            raise HTTPException(status_code=503, detail="LLM service unavailable")

        words_data = parse_json_response(response)
        if not words_data or not isinstance(words_data, list):
            raise HTTPException(status_code=500, detail="Failed to parse LLM response")

        store_cache(db, cache_key, words_data, hours=168)

    vl = VocabularyList(
        name=data.category,
        description=f"Auto-generated {data.difficulty} vocabulary for {data.category}",
        category=data.category,
        language_pair=lang_pair,
        difficulty=data.difficulty,
        is_generated=True,
    )
    db.add(vl)
    db.flush()

    created_words = []
    for i, wd in enumerate(words_data):
        word = VocabularyWord(
            word=wd.get("word", ""),
            translation=wd.get("translation", ""),
            pronunciation=wd.get("pronunciation"),
            part_of_speech=wd.get("partOfSpeech"),
            example_sentence=wd.get("exampleSentence"),
            example_translation=wd.get("exampleTranslation"),
            difficulty=data.difficulty,
            category=data.category,
            language_pair=lang_pair,
        )
        db.add(word)
        db.flush()

        item = VocabularyListItem(list_id=vl.id, word_id=word.id, order=i)
        db.add(item)
        created_words.append(word)

    db.commit()

    _add_xp(db, profile, len(created_words) * 2)
    _record_practice(db, profile)

    activity = _get_or_create_daily_activity(db)
    activity.words_learned += len(created_words)
    db.commit()

    result = vl.to_dict()
    result["words"] = [w.to_dict() for w in created_words]
    result["wordCount"] = len(created_words)
    return result


# ============================================================================
# Flashcard Routes
# ============================================================================

@router.get("/flashcards/due")
def get_due_flashcards(limit: int = 20, db: Session = Depends(get_db)) -> Dict[str, Any]:
    today_str = date.today().isoformat()
    due = db.query(FlashcardProgress).filter(
        FlashcardProgress.next_review_date <= today_str
    ).limit(limit).all()

    cards = []
    for progress in due:
        word = db.query(VocabularyWord).filter(VocabularyWord.id == progress.word_id).first()
        if word:
            cards.append({
                "progress": progress.to_dict(),
                "word": word.to_dict(),
            })

    return {"cards": cards, "totalDue": len(cards)}

@router.get("/flashcards/stats")
def get_flashcard_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    today_str = date.today().isoformat()
    total = db.query(FlashcardProgress).count()
    due = db.query(FlashcardProgress).filter(FlashcardProgress.next_review_date <= today_str).count()
    learned = db.query(FlashcardProgress).filter(FlashcardProgress.repetitions >= 3).count()

    return {"total": total, "due": due, "learned": learned}

@router.post("/flashcards/add/{word_id}")
def add_to_flashcards(word_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    word = db.query(VocabularyWord).filter(VocabularyWord.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")

    existing = db.query(FlashcardProgress).filter(FlashcardProgress.word_id == word_id).first()
    if existing:
        return {"status": "already_exists", "progress": existing.to_dict()}

    progress = FlashcardProgress(
        word_id=word_id,
        next_review_date=date.today().isoformat(),
    )
    db.add(progress)
    db.commit()
    db.refresh(progress)
    return {"status": "added", "progress": progress.to_dict()}

@router.post("/flashcards/review")
def review_flashcard(data: FlashcardReview, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    progress = db.query(FlashcardProgress).filter(FlashcardProgress.word_id == data.wordId).first()
    if not progress:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    progress = sm2_update(progress, data.quality)
    db.commit()
    db.refresh(progress)

    xp = 10 if data.quality >= 3 else 5
    actual_xp = _add_xp(db, profile, xp)
    _record_practice(db, profile)

    activity = _get_or_create_daily_activity(db)
    activity.cards_reviewed += 1
    db.commit()

    _check_achievements(db, profile)

    return {"progress": progress.to_dict(), "xpEarned": actual_xp}

@router.post("/flashcards/add-list/{list_id}")
def add_list_to_flashcards(list_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    items = db.query(VocabularyListItem).filter(VocabularyListItem.list_id == list_id).all()
    if not items:
        raise HTTPException(status_code=404, detail="List not found or empty")

    added = 0
    today_str = date.today().isoformat()
    for item in items:
        existing = db.query(FlashcardProgress).filter(FlashcardProgress.word_id == item.word_id).first()
        if not existing:
            progress = FlashcardProgress(word_id=item.word_id, next_review_date=today_str)
            db.add(progress)
            added += 1

    db.commit()
    return {"status": "added", "count": added}


# ============================================================================
# Quiz Routes
# ============================================================================

@router.post("/quiz/generate")
async def generate_quiz(data: QuizGenerateRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    from llm_service import generate_text, parse_json_response
    from prompts import quiz_generation_prompt

    query = db.query(VocabularyWord)
    if data.category:
        query = query.filter(VocabularyWord.category == data.category)
    words = query.limit(50).all()

    words_context = ", ".join([f"{w.word} ({w.translation})" for w in words[:20]]) if words else "general vocabulary"

    prompt = quiz_generation_prompt(
        target_language=profile.target_language,
        native_language=profile.native_language,
        quiz_type=data.quizType,
        difficulty=profile.proficiency_level,
        words_context=words_context,
        count=data.count,
    )

    response = await generate_text(
        system_prompt="You are a language quiz generator. Output ONLY valid JSON.",
        user_prompt=prompt,
    )
    if not response:
        raise HTTPException(status_code=503, detail="LLM service unavailable")

    questions = parse_json_response(response)
    if not questions or not isinstance(questions, list):
        raise HTTPException(status_code=500, detail="Failed to parse quiz questions")

    return {"questions": questions, "quizType": data.quizType, "count": len(questions)}

@router.post("/quiz/submit")
def submit_quiz(data: QuizSubmit, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    base_xp = data.correctAnswers * 10
    if data.totalQuestions > 0:
        accuracy = data.correctAnswers / data.totalQuestions
        if accuracy == 1.0:
            base_xp += 20
        elif accuracy >= 0.8:
            base_xp += 10

    actual_xp = _add_xp(db, profile, base_xp)
    _record_practice(db, profile)

    attempt = QuizAttempt(
        quiz_type=data.quizType,
        category=data.category,
        total_questions=data.totalQuestions,
        correct_answers=data.correctAnswers,
        xp_earned=actual_xp,
        time_taken_seconds=data.timeTakenSeconds,
        questions_data=data.questionsData or [],
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    activity = _get_or_create_daily_activity(db)
    activity.quizzes_completed += 1
    db.commit()

    _check_achievements(db, profile)

    return {"attempt": attempt.to_dict(), "xpEarned": actual_xp}

@router.get("/quiz/history")
def get_quiz_history(limit: int = 20, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    attempts = db.query(QuizAttempt).order_by(QuizAttempt.created_at.desc()).limit(limit).all()
    return [a.to_dict() for a in attempts]


# ============================================================================
# AI Teacher Chat Routes
# ============================================================================

@router.post("/chat/sessions")
def create_chat_session(data: Optional[ChatSessionCreate] = None, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session_id = str(uuid.uuid4())[:8]
    return {"sessionId": session_id, "name": data.name if data else "New Conversation", "createdAt": datetime.utcnow().isoformat()}

@router.get("/chat/sessions")
def list_chat_sessions(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    from sqlalchemy import func, distinct
    session_ids = db.query(distinct(ChatMessage.session_id)).all()
    sessions = []
    for (sid,) in session_ids:
        first_msg = db.query(ChatMessage).filter(
            ChatMessage.session_id == sid
        ).order_by(ChatMessage.created_at.asc()).first()
        last_msg = db.query(ChatMessage).filter(
            ChatMessage.session_id == sid
        ).order_by(ChatMessage.created_at.desc()).first()
        msg_count = db.query(ChatMessage).filter(ChatMessage.session_id == sid).count()

        preview = first_msg.content[:80] if first_msg and first_msg.role == "user" else "New Conversation"

        sessions.append({
            "sessionId": sid,
            "preview": preview,
            "messageCount": msg_count,
            "createdAt": first_msg.created_at.isoformat() if first_msg else None,
            "lastMessageAt": last_msg.created_at.isoformat() if last_msg else None,
        })

    sessions.sort(key=lambda s: s["lastMessageAt"] or "", reverse=True)
    return sessions

@router.get("/chat/sessions/{session_id}")
def get_chat_session(session_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.asc()).all()
    return {
        "sessionId": session_id,
        "messages": [m.to_dict() for m in messages],
    }

@router.delete("/chat/sessions/{session_id}")
def delete_chat_session(session_id: str, db: Session = Depends(get_db)) -> Dict[str, str]:
    deleted = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
    db.commit()
    return {"status": "deleted", "messagesDeleted": str(deleted)}

@router.post("/chat/message")
async def send_chat_message(data: ChatMessageCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not set up")

    from llm_service import generate_text
    from prompts import teacher_system_prompt

    user_msg = ChatMessage(
        session_id=data.sessionId,
        role="user",
        content=data.content,
    )
    db.add(user_msg)
    db.commit()

    history = db.query(ChatMessage).filter(
        ChatMessage.session_id == data.sessionId
    ).order_by(ChatMessage.created_at.desc()).limit(20).all()
    history.reverse()

    conversation = ""
    for msg in history:
        role_label = "Student" if msg.role == "user" else "Teacher"
        conversation += f"{role_label}: {msg.content}\n"

    system_prompt = teacher_system_prompt(
        target_language=profile.target_language,
        native_language=profile.native_language,
        proficiency_level=profile.proficiency_level,
    )

    response = await generate_text(
        system_prompt=system_prompt,
        user_prompt=conversation,
    )

    if not response:
        response = "I'm sorry, I'm having trouble connecting right now. Please try again in a moment."

    assistant_msg = ChatMessage(
        session_id=data.sessionId,
        role="assistant",
        content=response,
    )
    db.add(assistant_msg)
    db.commit()

    _add_xp(db, profile, 5)
    _record_practice(db, profile)
    _check_achievements(db, profile)

    return {
        "message": assistant_msg.to_dict(),
        "userMessage": user_msg.to_dict(),
    }


# ============================================================================
# Tips Routes
# ============================================================================

@router.get("/tips")
async def get_tips(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        return {"tips": ["Set up your profile to get personalized tips!"]}

    from llm_service import generate_text, parse_json_response, make_cache_key, check_cache, store_cache
    from prompts import tips_generation_prompt

    lang_pair = _get_language_pair(profile)
    cache_key = make_cache_key("tips", lang_pair, profile.proficiency_level)

    cached = check_cache(db, cache_key)
    if cached and isinstance(cached, list):
        return {"tips": cached}

    prompt = tips_generation_prompt(
        target_language=profile.target_language,
        native_language=profile.native_language,
        proficiency_level=profile.proficiency_level,
    )

    response = await generate_text(
        system_prompt="You are a language learning advisor. Output ONLY valid JSON.",
        user_prompt=prompt,
    )

    if not response:
        return {"tips": [
            f"Practice {profile.target_language} for at least 10 minutes every day.",
            "Review your flashcards regularly to retain vocabulary.",
            "Try thinking in your target language during daily activities.",
        ]}

    tips = parse_json_response(response)
    if tips and isinstance(tips, list):
        store_cache(db, cache_key, tips, hours=24)
        return {"tips": tips}

    return {"tips": ["Keep practicing every day!", "Review your flashcards.", "Try the AI teacher for conversation practice."]}


# ============================================================================
# Progress Routes
# ============================================================================

@router.get("/progress/dashboard")
def get_dashboard(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        return {"hasProfile": False}

    today_str = date.today().isoformat()
    due_count = db.query(FlashcardProgress).filter(FlashcardProgress.next_review_date <= today_str).count()
    total_words = db.query(VocabularyWord).count()
    total_cards = db.query(FlashcardProgress).count()

    level_titles = {
        range(1, 6): "Novice",
        range(6, 11): "Apprentice",
        range(11, 21): "Student",
        range(21, 36): "Speaker",
        range(36, 51): "Fluent",
    }
    level_title = "Master"
    for r, title in level_titles.items():
        if profile.level in r:
            level_title = title
            break

    xp_for_next_level = profile.level * 150
    xp_in_current_level = profile.total_xp - ((profile.level - 1) * 150)

    return {
        "hasProfile": True,
        "profile": profile.to_dict(),
        "levelTitle": level_title,
        "xpForNextLevel": xp_for_next_level,
        "xpInCurrentLevel": xp_in_current_level,
        "dueCards": due_count,
        "totalWords": total_words,
        "totalCards": total_cards,
        "dailyGoalProgress": min(1.0, profile.daily_xp_earned / max(1, profile.daily_xp_goal)),
    }

@router.get("/progress/activity")
def get_activity(days: int = 30, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    activities = db.query(DailyActivity).filter(
        DailyActivity.date >= cutoff
    ).order_by(DailyActivity.date.asc()).all()
    return [a.to_dict() for a in activities]

@router.get("/progress/stats")
def get_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    total_words = db.query(VocabularyWord).count()
    total_quizzes = db.query(QuizAttempt).count()
    total_reviews = db.query(FlashcardProgress).count()

    from sqlalchemy import func
    avg_accuracy = db.query(
        func.avg(QuizAttempt.correct_answers * 100.0 / func.nullif(QuizAttempt.total_questions, 0))
    ).scalar()

    best_quiz = db.query(QuizAttempt).order_by(QuizAttempt.correct_answers.desc()).first()
    max_daily_xp = db.query(func.max(DailyActivity.xp_earned)).scalar()

    return {
        "totalWords": total_words,
        "totalQuizzes": total_quizzes,
        "totalReviews": total_reviews,
        "averageAccuracy": round(avg_accuracy or 0, 1),
        "longestStreak": profile.longest_streak if profile else 0,
        "bestQuizScore": f"{best_quiz.correct_answers}/{best_quiz.total_questions}" if best_quiz else "N/A",
        "maxDailyXp": max_daily_xp or 0,
    }

@router.get("/progress/achievements")
def get_achievements(db: Session = Depends(get_db)) -> Dict[str, Any]:
    earned = db.query(Achievement).all()
    earned_ids = {a.badge_id for a in earned}

    all_badges = []
    for badge_def in BADGE_DEFINITIONS:
        badge = {
            "badgeId": badge_def["badge_id"],
            "name": badge_def["name"],
            "description": badge_def["description"],
            "icon": badge_def["icon"],
            "earned": badge_def["badge_id"] in earned_ids,
            "earnedAt": None,
        }
        if badge_def["badge_id"] in earned_ids:
            a = next(a for a in earned if a.badge_id == badge_def["badge_id"])
            badge["earnedAt"] = a.earned_at.isoformat() if a.earned_at else None
        all_badges.append(badge)

    return {
        "badges": all_badges,
        "earnedCount": len(earned),
        "totalCount": len(BADGE_DEFINITIONS),
    }

@router.get("/progress/weekly-xp")
def get_weekly_xp(weeks: int = 8, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    result = []
    today = date.today()
    for i in range(weeks):
        week_end = today - timedelta(days=i * 7)
        week_start = week_end - timedelta(days=6)

        from sqlalchemy import func
        total = db.query(func.sum(DailyActivity.xp_earned)).filter(
            DailyActivity.date >= week_start.isoformat(),
            DailyActivity.date <= week_end.isoformat(),
        ).scalar()

        result.append({
            "weekStart": week_start.isoformat(),
            "weekEnd": week_end.isoformat(),
            "totalXp": total or 0,
        })

    result.reverse()
    return result


# ============================================================================
# Gamification Routes
# ============================================================================

@router.post("/streak-freeze/buy")
def buy_streak_freeze(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    if profile.total_xp < 100:
        raise HTTPException(status_code=400, detail="Not enough XP (need 100)")

    if profile.streak_freeze_inventory >= 3:
        raise HTTPException(status_code=400, detail="Maximum 3 streak freezes")

    profile.total_xp -= 100
    profile.streak_freeze_inventory += 1
    db.commit()
    db.refresh(profile)
    return profile.to_dict()

@router.put("/daily-goal")
def update_daily_goal(data: Dict[str, int], db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = _get_profile(db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    goal = data.get("dailyXpGoal")
    if goal and goal in [30, 50, 100, 200]:
        profile.daily_xp_goal = goal
        db.commit()
        db.refresh(profile)
    return profile.to_dict()


# ============================================================================
# UI Observation Routes (Agent API)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {"htmlStructure": None, "visibleText": [], "inputValues": {}, "componentState": {}, "currentView": None, "viewport": {}, "timestamp": None, "status": "no_snapshot"}
    return snapshot.to_dict()

@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)

    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport

    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    return snapshot.to_dict()

@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {"imageData": None, "width": None, "height": None, "timestamp": None, "status": "no_screenshot"}
    return screenshot.to_dict()

@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)

    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()

    db.commit()
    db.refresh(screenshot)
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}
