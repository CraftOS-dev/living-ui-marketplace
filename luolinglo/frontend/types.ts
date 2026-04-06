export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

export type ViewName = 'dashboard' | 'flashcards' | 'vocabulary' | 'quizzes' | 'ai-teacher' | 'progress' | 'settings'

export interface UserProfile {
  id: number
  nativeLanguage: string
  targetLanguage: string
  proficiencyLevel: string
  displayName: string
  totalXp: number
  level: number
  currentStreak: number
  longestStreak: number
  lastPracticeDate: string | null
  streakFreezeInventory: number
  dailyXpGoal: number
  dailyXpEarned: number
  createdAt: string
  updatedAt: string
}

export interface VocabularyWord {
  id: number
  word: string
  translation: string
  pronunciation: string | null
  partOfSpeech: string | null
  exampleSentence: string | null
  exampleTranslation: string | null
  difficulty: string
  category: string | null
  languagePair: string
  notes: string | null
  createdAt: string
}

export interface VocabularyListData {
  id: number
  name: string
  description: string | null
  category: string | null
  languagePair: string
  difficulty: string
  isGenerated: boolean
  createdAt: string
  wordCount: number
  words?: VocabularyWord[]
}

export interface FlashcardProgressData {
  id: number
  wordId: number
  easinessFactor: number
  interval: number
  repetitions: number
  nextReviewDate: string
  lastReviewDate: string | null
  totalReviews: number
  correctCount: number
}

export interface FlashcardCard {
  progress: FlashcardProgressData
  word: VocabularyWord
}

export interface FlashcardStats {
  total: number
  due: number
  learned: number
}

export interface QuizQuestion {
  question: string
  correctAnswer: string
  options?: string[]
  explanation?: string
  hint?: string
  word?: string
  translation?: string
  scrambledWords?: string[]
}

export interface QuizAttemptData {
  id: number
  quizType: string
  category: string | null
  totalQuestions: number
  correctAnswers: number
  xpEarned: number
  timeTakenSeconds: number | null
  questionsData: QuizQuestion[]
  createdAt: string
}

export interface ChatMessageData {
  id: number
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface ChatSession {
  sessionId: string
  preview: string
  messageCount: number
  createdAt: string | null
  lastMessageAt: string | null
}

export interface DailyActivityData {
  id: number
  date: string
  wordsLearned: number
  cardsReviewed: number
  quizzesCompleted: number
  xpEarned: number
}

export interface AchievementBadge {
  badgeId: string
  name: string
  description: string
  icon: string
  earned: boolean
  earnedAt: string | null
}

export interface DashboardData {
  hasProfile: boolean
  profile: UserProfile
  levelTitle: string
  xpForNextLevel: number
  xpInCurrentLevel: number
  dueCards: number
  totalWords: number
  totalCards: number
  dailyGoalProgress: number
}

export interface WeeklyXp {
  weekStart: string
  weekEnd: string
  totalXp: number
}

export interface ProgressStats {
  totalWords: number
  totalQuizzes: number
  totalReviews: number
  averageAccuracy: number
  longestStreak: number
  bestQuizScore: string
  maxDailyXp: number
}

export const CURATED_LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Chinese (Mandarin)', 'Korean', 'Arabic', 'Hindi',
  'Russian', 'Turkish', 'Dutch', 'Swedish',
]

export const VOCABULARY_CATEGORIES = [
  'Greetings & Introductions', 'Numbers & Counting', 'Food & Dining',
  'Travel & Directions', 'Family & Relationships', 'Shopping & Money',
  'Time & Calendar', 'Weather', 'Colors & Shapes', 'Body & Health',
  'Work & School', 'Hobbies & Sports', 'Animals', 'Clothing',
  'House & Furniture', 'Emotions & Feelings', 'Common Verbs', 'Common Adjectives',
]

export const DAILY_GOAL_OPTIONS = [
  { value: 30, label: 'Casual', description: '30 XP / day' },
  { value: 50, label: 'Regular', description: '50 XP / day' },
  { value: 100, label: 'Serious', description: '100 XP / day' },
  { value: 200, label: 'Intense', description: '200 XP / day' },
]
