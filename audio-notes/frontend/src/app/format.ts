/** Dates are local calendar days ("YYYY-MM-DD"), never UTC-shifted. */
export function localDay(d: Date = new Date()): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day) ?? new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
}

export function weekStart(day: string): string {
  const d = parseDay(day) ?? new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d);
}

export function fmtDay(day: string, withYear = true): string {
  const d = parseDay(day);
  if (d === null) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

/** "Today", "Yesterday", "This week", "Last week", or the month. */
export function dayGroup(day: string): string {
  const d = parseDay(day);
  if (d === null) return 'Undated';
  const today = localDay();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const thisWeek = weekStart(today);
  if (day >= thisWeek && day < today) return 'This week';
  if (day >= addDays(thisWeek, -7) && day < thisWeek) return 'Last week';
  if (day > today) return 'Upcoming';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 1568 -> "26 min", 45 -> "45 s", 4000 -> "1 h 7 min". */
export function length(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Spoken languages offered for transcription (Whisper codes). */
/** A download size in megabytes: "172 MB". */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ru', label: 'Russian' },
  { value: 'hi', label: 'Hindi' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'tr', label: 'Turkish' },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.value === code)?.label ?? code.toUpperCase();
}

export const CATEGORIES: ReadonlyArray<string> = ['Meeting', 'Interview', 'Call', 'Lecture', 'Brainstorm', 'Voice memo', 'Personal', 'General'];

/** Per-viewer conveniences (never data). */
export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`audio-notes.${key}`, value);
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

export function recall(key: string, dflt: string): string {
  try {
    return localStorage.getItem(`audio-notes.${key}`) ?? dflt;
  } catch {
    return dflt;
  }
}
