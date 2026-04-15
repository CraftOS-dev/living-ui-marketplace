import type {
  UserProfile, VocabularyWord, VocabularyListData, FlashcardCard,
  FlashcardStats, QuizQuestion, QuizAttemptData, ChatMessageData,
  ChatSession, DashboardData, DailyActivityData, AchievementBadge,
  WeeklyXp, ProgressStats,
} from '../types'

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}'

class ApiServiceClass {
  private baseUrl: string

  constructor() {
    this.baseUrl = BACKEND_URL
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || response.statusText)
    }
    return response.json()
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }

  // State Management
  async getState<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>('/state')
  }

  async updateState<T = Record<string, unknown>>(updates: Partial<T>): Promise<T> {
    return this.request<T>('/state', { method: 'PUT', body: JSON.stringify({ data: updates }) })
  }

  async executeAction(action: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('/action', { method: 'POST', body: JSON.stringify({ action, payload }) })
  }

  // Profile
  async getProfile(): Promise<UserProfile | null> {
    return this.request<UserProfile | null>('/profile')
  }

  async createProfile(data: { nativeLanguage: string; targetLanguage: string; proficiencyLevel: string; displayName?: string }): Promise<UserProfile> {
    return this.request<UserProfile>('/profile', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
    return this.request<UserProfile>('/profile', { method: 'PUT', body: JSON.stringify(data) })
  }

  async recordPractice(): Promise<UserProfile> {
    return this.request<UserProfile>('/profile/record-practice', { method: 'POST' })
  }

  // Vocabulary
  async getVocabulary(params?: { category?: string; difficulty?: string; search?: string; page?: number; limit?: number }): Promise<{ words: VocabularyWord[]; total: number; page: number; limit: number }> {
    const qs = new URLSearchParams()
    if (params?.category) qs.set('category', params.category)
    if (params?.difficulty) qs.set('difficulty', params.difficulty)
    if (params?.search) qs.set('search', params.search)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/vocabulary${query}`)
  }

  async createWord(data: Partial<VocabularyWord>): Promise<VocabularyWord> {
    return this.request<VocabularyWord>('/vocabulary', { method: 'POST', body: JSON.stringify(data) })
  }

  async deleteWord(id: number): Promise<void> {
    await this.request(`/vocabulary/${id}`, { method: 'DELETE' })
  }

  async generateVocabulary(category: string, difficulty: string, count: number = 10): Promise<{ words: VocabularyWord[] }> {
    return this.request('/vocabulary/generate', { method: 'POST', body: JSON.stringify({ category, difficulty, count }) })
  }

  // Vocabulary Lists
  async getLists(): Promise<VocabularyListData[]> {
    return this.request<VocabularyListData[]>('/lists')
  }

  async createList(data: { name: string; description?: string; category?: string; difficulty?: string }): Promise<VocabularyListData> {
    return this.request<VocabularyListData>('/lists', { method: 'POST', body: JSON.stringify(data) })
  }

  async getList(id: number): Promise<VocabularyListData> {
    return this.request<VocabularyListData>(`/lists/${id}`)
  }

  async deleteList(id: number): Promise<void> {
    await this.request(`/lists/${id}`, { method: 'DELETE' })
  }

  async addWordToList(listId: number, wordId: number): Promise<void> {
    await this.request(`/lists/${listId}/words`, { method: 'POST', body: JSON.stringify({ wordId }) })
  }

  async generateList(category: string, difficulty: string, count: number = 10): Promise<VocabularyListData> {
    return this.request<VocabularyListData>('/lists/generate', { method: 'POST', body: JSON.stringify({ category, difficulty, count }) })
  }

  // Flashcards
  async getDueFlashcards(limit: number = 20): Promise<{ cards: FlashcardCard[]; totalDue: number }> {
    return this.request(`/flashcards/due?limit=${limit}`)
  }

  async getFlashcardStats(): Promise<FlashcardStats> {
    return this.request<FlashcardStats>('/flashcards/stats')
  }

  async addToFlashcards(wordId: number): Promise<{ status: string }> {
    return this.request(`/flashcards/add/${wordId}`, { method: 'POST' })
  }

  async reviewFlashcard(wordId: number, quality: number): Promise<{ progress: FlashcardCard['progress']; xpEarned: number }> {
    return this.request('/flashcards/review', { method: 'POST', body: JSON.stringify({ wordId, quality }) })
  }

  async addListToFlashcards(listId: number): Promise<{ count: number }> {
    return this.request(`/flashcards/add-list/${listId}`, { method: 'POST' })
  }

  // Quizzes
  async generateQuiz(quizType: string, category?: string, count: number = 5): Promise<{ questions: QuizQuestion[]; quizType: string; count: number }> {
    return this.request('/quiz/generate', { method: 'POST', body: JSON.stringify({ quizType, category, count }) })
  }

  async submitQuiz(data: { quizType: string; category?: string; totalQuestions: number; correctAnswers: number; timeTakenSeconds?: number; questionsData?: QuizQuestion[] }): Promise<{ attempt: QuizAttemptData; xpEarned: number }> {
    return this.request('/quiz/submit', { method: 'POST', body: JSON.stringify(data) })
  }

  async getQuizHistory(limit: number = 20): Promise<QuizAttemptData[]> {
    return this.request<QuizAttemptData[]>(`/quiz/history?limit=${limit}`)
  }

  // AI Teacher Chat
  async sendChatMessage(sessionId: string, content: string): Promise<{ message: ChatMessageData; userMessage: ChatMessageData }> {
    return this.request('/chat/message', { method: 'POST', body: JSON.stringify({ sessionId, content }) })
  }

  async getChatSessions(): Promise<ChatSession[]> {
    return this.request<ChatSession[]>('/chat/sessions')
  }

  async getChatSession(sessionId: string): Promise<{ sessionId: string; messages: ChatMessageData[] }> {
    return this.request(`/chat/sessions/${sessionId}`)
  }

  async createChatSession(): Promise<{ sessionId: string }> {
    return this.request('/chat/sessions', { method: 'POST', body: JSON.stringify({}) })
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    await this.request(`/chat/sessions/${sessionId}`, { method: 'DELETE' })
  }

  // Tips
  async getTips(): Promise<{ tips: string[] }> {
    return this.request('/tips')
  }

  // Progress
  async getDashboard(): Promise<DashboardData> {
    return this.request<DashboardData>('/progress/dashboard')
  }

  async getActivity(days: number = 30): Promise<DailyActivityData[]> {
    return this.request<DailyActivityData[]>(`/progress/activity?days=${days}`)
  }

  async getStats(): Promise<ProgressStats> {
    return this.request<ProgressStats>('/progress/stats')
  }

  async getAchievements(): Promise<{ badges: AchievementBadge[]; earnedCount: number; totalCount: number }> {
    return this.request('/progress/achievements')
  }

  async getWeeklyXp(weeks: number = 8): Promise<WeeklyXp[]> {
    return this.request<WeeklyXp[]>(`/progress/weekly-xp?weeks=${weeks}`)
  }

  // Gamification
  async buyStreakFreeze(): Promise<UserProfile> {
    return this.request<UserProfile>('/streak-freeze/buy', { method: 'POST' })
  }

  async updateDailyGoal(dailyXpGoal: number): Promise<UserProfile> {
    return this.request<UserProfile>('/daily-goal', { method: 'PUT', body: JSON.stringify({ dailyXpGoal }) })
  }
}

export const ApiService = new ApiServiceClass()
