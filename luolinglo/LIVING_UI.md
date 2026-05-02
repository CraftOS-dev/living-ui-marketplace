# Luolinglo

Comprehensive language learning app with vocabulary management, flashcards (SM-2 spaced repetition), quizzes (4 types), AI teacher chat, and heavy gamification (XP, levels, streaks, achievements).

## Overview

Luolinglo is a single-user language learning Living UI app. It supports 15+ curated languages plus custom input. All vocabulary, quizzes, and tips are generated on-demand by the LLM and cached in SQLite. The AI teacher provides multi-turn conversation practice adapting to the user's proficiency level.

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| UserProfile | User settings, XP, streaks | native_language, target_language, proficiency_level, total_xp, level, current_streak, daily_xp_goal |
| VocabularyWord | Individual vocabulary entries | word, translation, pronunciation, part_of_speech, example_sentence, category, language_pair |
| VocabularyList | Themed word collections | name, description, category, difficulty, is_generated |
| VocabularyListItem | Join table for lists/words | list_id, word_id, order |
| FlashcardProgress | SM-2 spaced repetition state | word_id, easiness_factor, interval, repetitions, next_review_date |
| QuizAttempt | Quiz history records | quiz_type, total_questions, correct_answers, xp_earned, questions_data |
| ChatMessage | AI teacher conversation history | session_id, role, content |
| DailyActivity | Daily practice tracking | date, words_learned, cards_reviewed, quizzes_completed, xp_earned |
| Achievement | Earned badges | badge_id, name, description, icon, earned_at |
| LLMCache | Cached LLM responses | cache_key, content, expires_at |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /profile | Get user profile |
| POST | /profile | Create profile (initial setup) |
| PUT | /profile | Update profile settings |
| POST | /profile/record-practice | Record practice, update streak |
| GET | /vocabulary | List words with search/filter/pagination |
| POST | /vocabulary | Add word manually |
| GET | /vocabulary/{id} | Get word details |
| DELETE | /vocabulary/{id} | Delete word |
| POST | /vocabulary/generate | LLM-generate vocabulary for category |
| GET | /lists | Get all vocabulary lists |
| POST | /lists | Create list |
| GET | /lists/{id} | Get list with words |
| DELETE | /lists/{id} | Delete list |
| POST | /lists/{id}/words | Add word to list |
| DELETE | /lists/{id}/words/{word_id} | Remove word from list |
| POST | /lists/generate | LLM-generate themed vocabulary list |
| GET | /flashcards/due | Get cards due for review |
| GET | /flashcards/stats | Flashcard statistics |
| POST | /flashcards/add/{word_id} | Add word to flashcard deck |
| POST | /flashcards/review | Submit review with SM-2 rating |
| POST | /flashcards/add-list/{list_id} | Add all list words to deck |
| POST | /quiz/generate | LLM-generate quiz questions |
| POST | /quiz/submit | Submit quiz, earn XP |
| GET | /quiz/history | Past quiz attempts |
| POST | /chat/message | Send message to AI teacher |
| GET | /chat/sessions | List chat sessions |
| GET | /chat/sessions/{id} | Get session messages |
| POST | /chat/sessions | Create new session |
| DELETE | /chat/sessions/{id} | Delete session |
| GET | /tips | Get LLM-generated learning tips |
| GET | /progress/dashboard | Dashboard aggregated data |
| GET | /progress/activity | Daily activity for charts |
| GET | /progress/stats | Overall statistics |
| GET | /progress/achievements | All badges (earned + locked) |
| GET | /progress/weekly-xp | Weekly XP totals |
| POST | /streak-freeze/buy | Buy streak freeze (100 XP) |
| PUT | /daily-goal | Update daily XP goal |

## Frontend Components

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Router/view switcher, setup wizard gate |
| layout/AppLayout.tsx | Sidebar + content layout |
| layout/Sidebar.tsx | Navigation, XP/streak display |
| setup/SetupWizard.tsx | Language selection onboarding |
| dashboard/DashboardView.tsx | Dashboard with stat cards |
| dashboard/DailyGoalRing.tsx | SVG circular progress ring |
| dashboard/StreakCard.tsx | Streak display |
| dashboard/XPCard.tsx | Level and XP progress |
| dashboard/DueCardsCard.tsx | Flashcards due count |
| dashboard/DailyTipCard.tsx | LLM-generated tips |
| vocabulary/VocabularyView.tsx | Vocab management with tabs |
| vocabulary/WordTable.tsx | Vocabulary word table |
| vocabulary/WordDetailModal.tsx | Word detail popup |
| vocabulary/GenerateWordsForm.tsx | LLM vocabulary generation |
| flashcards/FlashcardsView.tsx | Flashcard hub and stats |
| flashcards/FlashcardSession.tsx | Card flip review session |
| flashcards/FlashcardSummary.tsx | Session results |
| quiz/QuizView.tsx | Quiz type selection hub |
| quiz/QuizSession.tsx | Active quiz renderer |
| quiz/MultipleChoiceQuestion.tsx | MC question |
| quiz/FillBlankQuestion.tsx | Fill-in-the-blank |
| quiz/MatchPairsQuestion.tsx | Match pairs exercise |
| quiz/SentenceBuildQuestion.tsx | Sentence building |
| quiz/QuizResults.tsx | Quiz results screen |
| quiz/QuizHistory.tsx | Past quizzes table |
| chat/AITeacherView.tsx | AI teacher chat interface |
| chat/ChatMessageBubble.tsx | Chat message display |
| chat/ChatInput.tsx | Chat input with quick actions |
| progress/ProgressView.tsx | Progress tabs |
| progress/StatsCards.tsx | Statistics grid |
| progress/AchievementGrid.tsx | Achievement badges |
| progress/WeeklyXPChart.tsx | Weekly XP bar chart |
| progress/StreakCalendar.tsx | Compact GitHub-style 30-day practice calendar (14×14 cells, 4-tier intensity, legend) |
| progress/ActivitySummary.tsx | Activity tab metric tiles (active days, XP, words, cards, quizzes) |
| progress/RecentDays.tsx | Last-10-days activity list with per-day breakdown |
| progress/PersonalBests.tsx | Personal records |
| settings/SettingsView.tsx | App settings |
| shared/ProgressBar.tsx | Reusable progress bar |
| shared/LoadingView.tsx | Loading spinner |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | 10 SQLAlchemy domain models |
| backend/routes.py | 35+ REST API endpoints |
| backend/llm_service.py | CraftBot LLM integration |
| backend/sm2.py | SM-2 spaced repetition algorithm |
| backend/prompts.py | LLM prompt templates |
| frontend/types.ts | TypeScript interfaces for all models |
| frontend/AppController.ts | State management with profile/dashboard |
| frontend/services/ApiService.ts | HTTP client for all endpoints |

## State Flow

```
User Action -> React Component -> ApiService -> Backend Route -> SQLite DB
                                                     |
                                              LLM (if needed)
                                                     |
                                              Response -> UI Update + Toast
```

## Testing

1. Open app -> setup wizard appears
2. Select languages and proficiency -> dashboard loads
3. Navigate to Vocabulary -> generate words via LLM
4. Add words to flashcards -> review with card flip
5. Take a quiz -> see XP earned
6. Chat with AI teacher -> multi-turn conversation
7. Check Progress -> see achievements and stats
8. Refresh page -> all data persists
