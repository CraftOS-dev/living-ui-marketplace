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

const KNOWN_FIRST_NAMES = new Set([
  // Popular & Classical English / Western
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles',
  'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua',
  'kenneth', 'kevin', 'brian', 'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan',
  'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon',
  'benjamin', 'samuel', 'gregory', 'alexander', 'patrick', 'frank', 'raymond', 'jack', 'dennis', 'jerry',
  'tyler', 'aaron', 'jose', 'adam', 'nathan', 'henry', 'douglas', 'zachary', 'peter', 'kyle',
  'walter', 'ethan', 'jeremy', 'harold', 'keith', 'christian', 'roger', 'noah', 'gerald', 'carl',
  'terry', 'sean', 'austin', 'arthur', 'lawrence', 'jesse', 'dylan', 'bryan', 'joe', 'jordan',
  'billy', 'bruce', 'albert', 'willie', 'gabriel', 'logan', 'alan', 'juan', 'wayne', 'roy',
  'ralph', 'randy', 'eugene', 'vincent', 'russell', 'louis', 'philip', 'bobby', 'johnny', 'bradley',
  'liam', 'noah', 'oliver', 'elija', 'elijah', 'lucas', 'mason', 'logan', 'ethan', 'aiden',
  'aidan', 'jackson', 'sebastian', 'mateo', 'jack', 'owen', 'theodore', 'wyatt', 'luke', 'asher',
  'carter', 'julian', 'grayson', 'leo', 'jayden', 'gabriel', 'isaac', 'lincoln', 'anthony', 'hudson',
  'dylan', 'ezra', 'thomas', 'charles', 'christopher', 'jaxon', 'maverick', 'josiah', 'isaiah', 'andrew',
  'elias', 'joshua', 'nathan', 'caleb', 'ryan', 'adrian', 'miles', 'eli', 'nolan', 'christian',
  'aaron', 'cameron', 'ezekiel', 'colton', 'luca', 'landon', 'hunter', 'jonathan', 'santiago', 'axel',
  'easton', 'cooper', 'jeremiah', 'angel', 'roman', 'connor', 'jameson', 'robert', 'greyson', 'jordan',
  'ian', 'carson', 'jaxson', 'leonardo', 'nicholas', 'dominic', 'austin', 'everett', 'brooks', 'xavier',
  'kai', 'jose', 'parker', 'adam', 'jace', 'wesley', 'kayden', 'silas', 'bennett', 'declan',
  'waylon', 'weston', 'evan', 'emmett', 'micah', 'ryder', 'damon', 'beau', 'alec',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen',
  'lisa', 'nancy', 'betty', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna', 'michelle',
  'carol', 'amanda', 'dorothy', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia',
  'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela', 'emma', 'nicole', 'helen',
  'samantha', 'katherine', 'christine', 'debra', 'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather',
  'diane', 'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly', 'lauren', 'christina',
  'joan', 'evelyn', 'judith', 'megan', 'andrea', 'cheryl', 'hannah', 'jacqueline', 'martha', 'gloria',
  'teresa', 'ann', 'sara', 'madison', 'frances', 'kathryn', 'janice', 'jean', 'abigail', 'alice',
  'julia', 'judy', 'sophia', 'grace', 'denise', 'amber', 'doris', 'marilyn', 'danielle', 'beverly',
  'olivia', 'emma', 'charlotte', 'amelia', 'ava', 'sophia', 'isabella', 'mia', 'evelyn', 'harper',
  'luna', 'camila', 'gianna', 'elizabeth', 'eleanor', 'ella', 'abigail', 'sofia', 'avery', 'scarlett',
  'emily', 'aria', 'penelope', 'chloe', 'layla', 'mila', 'nora', 'hazel', 'madison', 'ellie',
  'lily', 'nova', 'isla', 'grace', 'violet', 'aurora', 'riley', 'zoey', 'willow', 'emilia',
  'stella', 'zoe', 'victoria', 'hannah', 'addison', 'leah', 'lucy', 'eliana', 'ivy', 'everly',
  'lillian', 'paisley', 'elena', 'naomi', 'maya', 'natasha', 'alina', 'kristen', 'claire', 'audrey',
  'alyssa', 'valerie', 'katie', 'chloe', 'fiona', 'elise', 'tessa', 'bianca', 'carmen', 'sienna',

  // Short & Nicknames
  'elena', 'marcus', 'thorne', 'alex', 'sam', 'max', 'leo', 'ben', 'tom', 'tim', 'dan', 'luke', 'rob',
  'dave', 'mike', 'steve', 'pete', 'matt', 'chris', 'tony', 'nick', 'jake', 'josh', 'zack', 'nate',
  'will', 'bill', 'bob', 'jim', 'ted', 'ed', 'ron', 'ken', 'greg', 'brad', 'jeff', 'andy',
  'jen', 'kate', 'beth', 'liz', 'meg', 'sue', 'pam', 'deb', 'kim', 'bev', 'val', 'joy',

  // South Asian & Middle Eastern
  'aima', 'priya', 'rahul', 'rohit', 'amit', 'ankit', 'neha', 'pooja', 'ananya', 'deepak', 'raj',
  'sanjay', 'vikram', 'arjun', 'sneha', 'kavita', 'aarav', 'vihaan', 'aditya', 'sai', 'ishaan',
  'ali', 'ahmed', 'mohammed', 'muhammad', 'omar', 'fatima', 'zainab', 'hassan', 'hussein', 'tariq',
  'youssef', 'khalid', 'hamza', 'layla', 'yasmin', 'amina', 'bilal', 'mustafa', 'ayesha', 'mariam',

  // East Asian & Japanese
  'midori', 'kenji', 'hiroshi', 'yuki', 'takashi', 'sakura', 'daisuke', 'ren', 'sora', 'haruto',
  'yuto', 'sota', 'kaito', 'hinata', 'mei', 'aoi', 'yui', 'hina', 'mio', 'ichika', 'tsubasa',
  'wei', 'li', 'chen', 'ming', 'jun', 'hao', 'yang', 'lei', 'feng', 'tao', 'xin', 'lin',
  'min', 'ji', 'sung', 'hyun', 'jin', 'woo', 'young', 'soo', 'hye', 'eun'
]);

const NON_NAME_WORDS = new Set([
  'art', 'music', 'tool', 'eraser', 'background', 'photo', 'image', 'brush', 'shortcut', 'fear',
  'people', 'beautiful', 'lamborghini', 'home', 'downtown', 'summer', 'night', 'saturday', 'sunday',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'today', 'tomorrow', 'yesterday', 'week',
  'month', 'year', 'time', 'date', 'session', 'meeting', 'overview', 'summary', 'notes', 'transcript',
  'audio', 'video', 'recording', 'question', 'topic', 'conversation', 'dialogue', 'point', 'decision',
  'action', 'item', 'checklist', 'screen', 'microphone', 'mic', 'speaker', 'sound', 'file', 'download',
  'upload', 'share', 'star', 'delete', 'copy', 'project', 'system', 'theme', 'design', 'app', 'ui',
  'first', 'second', 'third', 'last', 'next', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'my', 'your', 'his', 'her', 'their', 'our', 'its', 'this', 'that', 'these',
  'those', 'there', 'here', 'where', 'when', 'what', 'why', 'how', 'who', 'whom', 'which',
  'very', 'much', 'more', 'most', 'also', 'just', 'only', 'really', 'so', 'well', 'like', 'sure',
  'okay', 'alright', 'yeah', 'yes', 'no', 'nope', 'please', 'thanks', 'thank', 'welcome', 'everyone',
  'everybody', 'someone', 'somebody', 'anyone', 'anybody', 'nobody', 'team', 'all', 'both', 'either',
  'neither', 'general', 'personal', 'work', 'family', 'mother', 'father', 'sister', 'brother', 'room',
  'house', 'home', 'order', 'dessert', 'cake', 'cola', 'fish', 'salad', 'peas', 'vegetable', 'chinese',
  'japanese', 'english', 'french', 'spanish', 'german', 'practice', 'lesson', 'class', 'course',
  'and', 'or', 'but', 'if', 'then', 'because', 'as', 'at', 'by', 'for', 'from', 'in', 'into',
  'of', 'off', 'on', 'onto', 'out', 'over', 'to', 'up', 'with', 'about', 'above', 'across',
  'after', 'against', 'along', 'among', 'around', 'before', 'behind', 'below', 'beneath', 'beside',
  'between', 'beyond', 'during', 'except', 'inside', 'near', 'outside', 'since', 'through', 'throughout',
  'toward', 'under', 'underneath', 'until', 'upon', 'within', 'without', 'call', 'going', 'joining',
  'started', 'doing', 'having', 'taking', 'getting', 'making', 'seeing', 'saying', 'speaking', 'coming',
  'thinking', 'looking', 'trying', 'working', 'talking', 'listening', 'reading', 'writing', 'presented',
  'sent', 'said', 'told', 'asked', 'spoke', 'went', 'came', 'got', 'had', 'did', 'gave', 'took', 'joined',
  'good', 'great', 'bad', 'new', 'old', 'right', 'left', 'big', 'small', 'high', 'low', 'same',
  'different', 'important', 'main', 'major', 'easy', 'hard', 'simple', 'clear', 'fine',
  'department', 'office', 'call', 'engineering', 'sales', 'marketing', 'product', 'lead', 'leading',
  'session', 'discussion', 'agenda', 'focus', 'aligning', 'metrics', 'records', 'table', 'board',
  'designs', 'sprint', 'review', 'client', 'questions', 'answers', 'feedback', 'update', 'ten', 'morning',
  '家族', '誰', '何', '何歳', '僕', '私', '俺', '母', '父', '妹', '弟', '兄', '姉', 'お母さん', 'お父さん',
  'お兄さん', 'お姉さん', '先生', '部屋', '家', '髪', '今日', '明日', '昨日'
]);

/**
 * Universal High-Precision Name & Attendee detection from transcribed text.
 * Accurately scans the entire transcript for names mentioned anywhere in conversation or speaker tags.
 */
export function extractNamesFromTranscript(transcript: string, existingAttendees: string = ''): string[] {
  if (!transcript || typeof transcript !== 'string') return [];

  const found = new Set<string>();
  const existingSet = new Set(
    existingAttendees
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  const cleanCandidate = (raw: string | undefined): string => {
    if (!raw) return '';
    let cleaned = raw.replace(/^[ ,.;:!?"'()[\]{}—–\n\t]+|[ ,.;:!?"'()[\]{}—–\n\t]+$/g, '').trim();
    cleaned = cleaned.replace(/^(?:Speaker\s+\d+|Prof\.?|Professor|Dr\.?|Doctor|Mr\.?|Mrs\.?|Ms\.?)\s*/i, '').trim();
    if (!cleaned || cleaned.length < 2) return '';

    const words = cleaned.split(/\s+/);
    const validWords: string[] = [];
    for (const w of words.slice(0, 2)) {
      const wl = w.toLowerCase();
      if (NON_NAME_WORDS.has(wl) || w.length < 2) break;
      validWords.push(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }

    if (validWords.length === 0) return '';
    const cand = validWords.join(' ');
    if (existingSet.has(cand.toLowerCase()) || NON_NAME_WORDS.has(cand.toLowerCase())) {
      return '';
    }
    return cand;
  };

  // 1. Scan entire transcript for known names (in conversation, sentences, or anywhere in text)
  const tokens = transcript.match(/\b[A-Za-z]{2,25}\b/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const tokLower = tok.toLowerCase();
    if (KNOWN_FIRST_NAMES.has(tokLower) && !NON_NAME_WORDS.has(tokLower)) {
      if (i + 1 < tokens.length) {
        const nextTok = tokens[i + 1];
        if (nextTok && nextTok[0] && nextTok[0] === nextTok[0].toUpperCase()) {
          const nextLower = nextTok.toLowerCase();
          if (!NON_NAME_WORDS.has(nextLower) && !KNOWN_FIRST_NAMES.has(nextLower)) {
            const fullName = `${tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase()} ${nextTok.charAt(0).toUpperCase() + nextTok.slice(1).toLowerCase()}`;
            const c = cleanCandidate(fullName);
            if (c) {
              found.add(c);
              continue;
            }
          }
        }
      }

      const c = cleanCandidate(tok);
      if (c) {
        found.add(c);
      }
    }
  }

  // 2. Speaker prefix patterns: [00:00] Elena: or Marcus: or Dr. Thorne:
  const speakerRegex = /(?:^|\n)(?:\[[\d:\s-]+\]\s*)?([A-Za-z0-9.\s]{2,25}):/g;
  let match: RegExpExecArray | null;
  while ((match = speakerRegex.exec(transcript)) !== null) {
    const c = cleanCandidate(match[1]);
    if (c) found.add(c);
  }

  // 3. Explicit introductions and meeting phrases:
  const introRegex = /(?:my name is|i am|i'm|im|call me|joined by|welcome|here with|meeting with|speaking with|talking to|thanks for joining|thanks to|interview with|introducing|with|have)\s*,?\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/gi;
  while ((match = introRegex.exec(transcript)) !== null) {
    const c = cleanCandidate(match[1]);
    if (c) found.add(c);
  }

  // 4. Multi-person lists: "X and Y", "X, Y and Z"
  const multiIntroRegex = /(?:thanks for joining|welcome|here with|joined by|with|have)\s*,?\s*([A-Za-z]{2,20})(?:,\s*([A-Za-z]{2,20}))?\s+(?:and|&)\s+([A-Za-z]{2,20})/gi;
  while ((match = multiIntroRegex.exec(transcript)) !== null) {
    const c1 = cleanCandidate(match[1]);
    const c2 = match[2] ? cleanCandidate(match[2]) : '';
    const c3 = cleanCandidate(match[3]);
    if (c1) found.add(c1);
    if (c2) found.add(c2);
    if (c3) found.add(c3);
  }

  // 5. Direct address / greetings: "Hey X", "Hi X", "Thanks X", "Thank you X"
  const calloutRegex = /(?:hey|hi|hello|thanks|thank you)\s+([A-Za-z]{2,20})[,!.]/gi;
  while ((match = calloutRegex.exec(transcript)) !== null) {
    const c = cleanCandidate(match[1]);
    if (c) found.add(c);
  }

  // 6. Salutations: Dr. X, Mr. X, Ms. X, Mrs. X, Prof. X
  const salutationRegex = /(?:Dr\.?|Doctor|Mr\.?|Ms\.?|Mrs\.?|Prof\.?|Professor)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/gi;
  while ((match = salutationRegex.exec(transcript)) !== null) {
    const c = cleanCandidate(match[1]);
    if (c) found.add(c);
  }

  // 7. Japanese introductions: はじめまして [名前] です
  const jpIntroRegex = /(?:はじめまして|初めまして)\s*([^\s、。]{1,8})\s*(?:です|だ|と申します)/g;
  while ((match = jpIntroRegex.exec(transcript)) !== null) {
    const cand = match[1]?.trim();
    if (cand && !NON_NAME_WORDS.has(cand) && cand.length >= 1) {
      if (!existingSet.has(cand.toLowerCase())) {
        found.add(cand);
      }
    }
  }

  return Array.from(found);
}

/**
 * Merges newly extracted names into the current attendees string without duplicates.
 */
export function mergeAttendees(currentAttendees: string, newNames: string[]): string {
  const list = currentAttendees
    ? currentAttendees
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const existingLower = new Set(list.map((m) => m.toLowerCase()));

  for (const name of newNames) {
    const trimmed = name.trim();
    if (trimmed && !existingLower.has(trimmed.toLowerCase())) {
      list.push(trimmed);
      existingLower.add(trimmed.toLowerCase());
    }
  }

  return list.join(', ');
}




