import type { RecordModel } from 'pocketbase';

export interface ActionItem {
  id: string;
  title: string;
  completed: boolean;
  assignee?: string | undefined;
  dueDate?: string | undefined;
}

export interface HighlightSection {
  id: string;
  title: string;
  content: string;
}

export interface AudioSession extends RecordModel {
  title: string;
  category: string;
  date: string;
  duration: number;
  attendees: string;
  is_starred: boolean;
  audio?: string | undefined;
  audio_format?: string | undefined;
  audio_url?: string | undefined;
  overview: string;
  summary: string;
  meeting_notes?: string | undefined;
  key_highlights: string;
  action_items?: ActionItem[] | undefined;
  transcript?: string | undefined;
  share_token?: string | undefined;
  is_shared?: boolean | undefined;
}

export type ActiveTab = 'overview' | 'summary' | 'highlights' | 'all';
export type AppViewMode = 'note' | 'weekly-summary';
