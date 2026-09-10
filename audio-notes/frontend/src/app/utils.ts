import type { AudioSession, HighlightSection, ActionItem } from './types.ts';

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds <= 0) return '00:00';
  const totalSecs = Math.round(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const hrs = Math.floor(mins / 60);

  if (hrs > 0) {
    const remMins = mins % 60;
    return `${hrs.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function parseActionItems(raw: unknown): ActionItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ActionItem[];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as ActionItem[];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseHighlightSections(raw: unknown): HighlightSection[] {
  if (!raw) {
    return [{ id: 'sec-1', title: 'Key Highlights', content: '' }];
  }
  if (Array.isArray(raw)) {
    if (raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'title' in raw[0]) {
      return raw as HighlightSection[];
    }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [{ id: 'sec-1', title: 'Key Highlights', content: '' }];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        typeof parsed[0] === 'object' &&
        parsed[0] !== null &&
        'title' in parsed[0]
      ) {
        return parsed as HighlightSection[];
      }
    } catch {
      // Non-JSON string: legacy plain text, wrap into single default section
      return [{ id: 'sec-1', title: 'Key Highlights', content: raw }];
    }
  }
  return [{ id: 'sec-1', title: 'Key Highlights', content: String(raw) }];
}

export function serializeHighlightSections(sections: HighlightSection[]): string {
  return JSON.stringify(sections);
}

export function generateSessionMarkdown(session: AudioSession): string {
  const actionsText = parseActionItems(session.action_items)
    .map(
      (item) =>
        `- [${item.completed ? 'x' : ' '}] ${item.title}${item.assignee ? ` (@${item.assignee})` : ''}${item.dueDate ? ` [Due: ${item.dueDate}]` : ''}`
    )
    .join('\n');

  const highlightSections = parseHighlightSections(session.key_highlights);
  const highlightsMarkdown = highlightSections
    .map(
      (s) =>
        `### ${s.title || 'Highlights'}\n${s.content || '_No notes in this section._'}`
    )
    .join('\n\n');

  return `# ${session.title}

- **Date**: ${session.date || 'N/A'}
- **Category**: ${session.category || 'General'}
- **Duration**: ${formatDuration(session.duration || 0)}
- **Attendees**: ${session.attendees || 'None specified'}

---

## 📋 Overview
${session.overview || '_No overview provided._'}

---

## 📝 Executive Summary
${session.summary || '_No summary provided._'}

---

## ✨ Key Highlights
${highlightsMarkdown || '_No key highlights recorded._'}

---

## ✅ Action Items
${actionsText || '_No action items._'}

${
  session.transcript
    ? `\n---\n\n## 🎙️ Transcript\n${session.transcript}`
    : ''
}
`;
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadAudioFile(url: string, baseTitle: string): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    let ext = '.webm';
    if (blob.type.includes('mp3') || url.toLowerCase().includes('.mp3')) ext = '.mp3';
    else if (blob.type.includes('wav') || url.toLowerCase().includes('.wav')) ext = '.wav';
    else if (blob.type.includes('m4a') || url.toLowerCase().includes('.m4a')) ext = '.m4a';
    else if (blob.type.includes('ogg') || url.toLowerCase().includes('.ogg')) ext = '.ogg';

    const sanitized = (baseTitle || 'recording').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${sanitized || 'audio'}${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.warn('Direct blob download failed, falling back to direct anchor:', err);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(baseTitle || 'recording').replace(/\s+/g, '_')}.webm`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  speaker?: string | undefined;
  text: string;
}

export function parseTranscriptSegments(raw: string, totalDuration: number = 60): TranscriptSegment[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const segments: TranscriptSegment[] = [];

  const timeRegex = /\[?(\d{1,2}):(\d{2})\]?\s*(?:-\s*\[?(\d{1,2}):(\d{2})\]?)?\s*(?:([^:]+):)?\s*(.*)/;

  lines.forEach((line, idx) => {
    const match = line.match(timeRegex);
    if (match && match[1] && match[2]) {
      const startMin = parseInt(match[1], 10);
      const startSec = parseInt(match[2], 10);
      const startTotal = startMin * 60 + startSec;

      let endTotal = startTotal + 5;
      if (match[3] && match[4]) {
        const endMin = parseInt(match[3], 10);
        const endSec = parseInt(match[4], 10);
        endTotal = endMin * 60 + endSec;
      }

      const speaker = match[5]?.trim() || undefined;
      const text = match[6]?.trim() || line;

      segments.push({
        id: `seg-${idx}-${startTotal}`,
        start: startTotal,
        end: endTotal,
        speaker,
        text,
      });
    } else {
      const step = Math.max(4, Math.floor((totalDuration || 30) / (lines.length || 1)));
      const startTotal = idx * step;
      const endTotal = startTotal + step;
      segments.push({
        id: `seg-${idx}`,
        start: startTotal,
        end: endTotal,
        text: line,
      });
    }
  });

  return segments;
}

export function generateSrtContent(segments: TranscriptSegment[]): string {
  const formatSrtTime = (seconds: number): string => {
    const safeSec = Math.max(0, isFinite(seconds) ? seconds : 0);
    const hrs = Math.floor(safeSec / 3600);
    const mins = Math.floor((safeSec % 3600) / 60);
    const secs = Math.floor(safeSec % 60);
    const millis = Math.floor((safeSec % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  };

  return segments
    .map((seg, idx) => {
      const speakerPrefix = seg.speaker ? `${seg.speaker}: ` : '';
      return `${idx + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${speakerPrefix}${seg.text}\n`;
    })
    .join('\n');
}

export function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Monday as first day of week: 1 = Mon, ..., 0 = Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekKey(dateStr: string | undefined): string {
  let d: Date;
  if (!dateStr) {
    d = new Date();
  } else {
    d = new Date(dateStr);
    if (isNaN(d.getTime())) d = new Date();
  }
  const start = getStartOfWeek(d);
  return start.toISOString().split('T')[0] ?? '';
}

export function formatWeekRange(weekStartStr: string): string {
  try {
    const start = new Date(weekStartStr);
    if (isNaN(start.getTime())) return weekStartStr;
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const startFormatted = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endFormatted = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return `${startFormatted} – ${endFormatted}`;
  } catch {
    return weekStartStr;
  }
}

export function generateWeeklySummaryMarkdown(sessions: AudioSession[], weekLabel: string): string {
  const totalDuration = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
  const allActionItems = sessions.flatMap((s) => parseActionItems(s.action_items));

  const meetingsMarkdown = sessions
    .map((s, idx) => {
      const actionsList = parseActionItems(s.action_items)
        .map((a) => `  - [${a.completed ? 'x' : ' '}] ${a.title}${a.assignee ? ` (@${a.assignee})` : ''}`)
        .join('\n');

      return `### Meeting ${idx + 1}: ${s.title}
- **Date**: ${s.date || 'N/A'} | **Category**: ${s.category || 'General'} | **Duration**: ${formatDuration(s.duration || 0)}
- **Attendees**: ${s.attendees || 'None listed'}

#### 📝 Executive Summary
${s.summary || '_No summary drafted._'}

${s.meeting_notes ? `#### 💬 Meeting Notes & Decisions\n${s.meeting_notes}\n` : ''}
${s.overview ? `#### 📋 Context & Overview\n${s.overview}\n` : ''}
${actionsList ? `#### ✅ Action Items\n${actionsList}\n` : ''}
`;
    })
    .join('\n---\n\n');

  return `# 📅 Weekly Meeting Summary & Digest (${weekLabel})

- **Total Meetings**: ${sessions.length}
- **Total Recorded Time**: ${formatDuration(totalDuration)}
- **Total Action Items**: ${allActionItems.length} (${allActionItems.filter((a) => a.completed).length} completed)

---

## 📋 Individual Meeting Breakdown

${meetingsMarkdown || '_No meetings recorded for this week._'}
`;
}



