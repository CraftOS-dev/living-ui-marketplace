/**
 * CraftBot Pet - Tamagotchi Types
 * TypeScript interfaces for the virtual pet app
 */

// Base app state
export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  pet: Pet | null
  retiredPet: Pet | null
  activityLog: ActivityLogEntry[]
  evolutionStatus: EvolutionStatus | null
}

// Pet life stages
export type PetStage = 'egg' | 'baby' | 'child' | 'teen' | 'adult'

// Pet moods
export type PetMood = 'happy' | 'excited' | 'neutral' | 'hungry' | 'sad' | 'sick' | 'sleeping' | 'critical'

// Care actions
export type CareAction = 'feed' | 'play' | 'sleep' | 'wake' | 'clean' | 'medicine'

// The virtual pet
export interface Pet {
  id: number
  name: string
  stage: PetStage
  hunger: number        // 0-100, 100=full
  happiness: number     // 0-100, 100=very happy
  health: number        // 0-100, 100=perfect
  is_sleeping: boolean
  is_sick: boolean
  is_retired: boolean
  retired_at: string | null
  evolution_points: number
  age_minutes: number
  cooldowns: Record<string, string>  // action -> ISO timestamp
  mood: PetMood
  created_at: string
  last_updated: string
}

// Activity log entry
export interface ActivityLogEntry {
  id: number
  pet_id: number
  action: string
  description: string
  timestamp: string
}

// Evolution status
export interface EvolutionStatus {
  stage: PetStage
  evolution_points: number
  current_threshold: number
  next_stage: PetStage | null
  can_retire: boolean
  is_max_stage: boolean
}

// Stage display info
export interface StageInfo {
  label: string
  emoji: string
  description: string
  color: string
}

export const STAGE_INFO: Record<PetStage, StageInfo> = {
  egg: {
    label: 'Egg',
    emoji: '🥚',
    description: 'A mysterious egg...',
    color: '#8b5cf6',
  },
  baby: {
    label: 'Baby',
    emoji: '🐣',
    description: 'A tiny baby bot!',
    color: '#6366f1',
  },
  child: {
    label: 'Child',
    emoji: '🤖',
    description: 'Growing up fast!',
    color: '#06b6d4',
  },
  teen: {
    label: 'Teen',
    emoji: '⚡',
    description: 'Full of energy!',
    color: '#8b5cf6',
  },
  adult: {
    label: 'Adult',
    emoji: '✨',
    description: 'A fully grown CraftBot!',
    color: '#6366f1',
  },
}

// Mood display info
export interface MoodInfo {
  label: string
  emoji: string
  color: string
}

export const MOOD_INFO: Record<PetMood, MoodInfo> = {
  happy: { label: 'Happy', emoji: '😊', color: '#22c55e' },
  excited: { label: 'Excited', emoji: '🤩', color: '#f59e0b' },
  neutral: { label: 'Neutral', emoji: '😐', color: '#6b7280' },
  hungry: { label: 'Hungry', emoji: '😋', color: '#f97316' },
  sad: { label: 'Sad', emoji: '😢', color: '#3b82f6' },
  sick: { label: 'Sick', emoji: '🤒', color: '#ef4444' },
  sleeping: { label: 'Sleeping', emoji: '😴', color: '#8b5cf6' },
  critical: { label: 'Critical!', emoji: '🚨', color: '#dc2626' },
}

// Action display info
export interface ActionInfo {
  label: string
  emoji: string
  description: string
  cooldownSeconds: number
}

export const ACTION_INFO: Record<CareAction, ActionInfo> = {
  feed: {
    label: 'Feed',
    emoji: '🍖',
    description: 'Give your pet a snack',
    cooldownSeconds: 30,
  },
  play: {
    label: 'Play',
    emoji: '🎮',
    description: 'Play together',
    cooldownSeconds: 60,
  },
  sleep: {
    label: 'Sleep',
    emoji: '💤',
    description: 'Put to sleep',
    cooldownSeconds: 0,
  },
  wake: {
    label: 'Wake',
    emoji: '☀️',
    description: 'Wake up',
    cooldownSeconds: 0,
  },
  clean: {
    label: 'Clean',
    emoji: '🛁',
    description: 'Give a bath',
    cooldownSeconds: 120,
  },
  medicine: {
    label: 'Medicine',
    emoji: '💊',
    description: 'Give medicine',
    cooldownSeconds: 60,
  },
}
