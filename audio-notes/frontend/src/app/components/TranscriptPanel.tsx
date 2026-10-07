import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Pencil, Sparkles, Subtitles } from 'lucide-react';
import { Button, cn, IdentityChip, toast } from '../../kit/index.ts';
import { clock } from '../format.ts';
import type { Note, Segment } from '../types.ts';
import { NameInput, TextBlock } from './fields.tsx';

function Listening({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-[13px] text-[var(--agent-app-muted)]" role="status">
      <span className="an-listen flex w-7 shrink-0 justify-center gap-1" aria-hidden>
        <span className="size-1.5 rounded-full bg-[var(--agent-app-accent)]" />
        <span className="size-1.5 rounded-full bg-[var(--agent-app-accent)]" />
        <span className="size-1.5 rounded-full bg-[var(--agent-app-accent)]" />
      </span>
      {text}
    </div>
  );
}

/** "Person 1: text" once the speaker is known. */
function spoken(s: Segment): string {
  return s.speaker ? `${s.speaker}: ${s.text}` : s.text;
}

/** A pause this long, or a paragraph this long (seconds), starts a new paragraph. */
const PARAGRAPH_PAUSE = 2;
const PARAGRAPH_SECONDS = 40;

/** One person speaking without interruption: paragraphs of segment indexes. */
interface Turn {
  /** '' until the speakers are told apart (and while recording). */
  speaker: string;
  start: number;
  paragraphs: number[][];
}

/**
 * Lines grouped the way a chat reads: a turn per change of speaker (a line
 * with no known speaker stays in the turn it is in), split into paragraphs
 * at pauses. Without speakers every paragraph is its own turn, so each one
 * still shows where it starts.
 */
function groupTurns(segments: Segment[]): Turn[] {
  const turns: Turn[] = [];
  let turn: Turn | null = null;
  let para: number[] = [];
  let paraStart = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s === undefined) continue;
    const speaker = s.speaker ?? '';
    const prev = segments[i - 1];
    const pause = prev !== undefined && (s.start - prev.end >= PARAGRAPH_PAUSE || s.start - paraStart >= PARAGRAPH_SECONDS);
    if (turn === null || (speaker !== '' && speaker !== turn.speaker) || (turn.speaker === '' && pause)) {
      para = [];
      turn = { speaker, start: s.start, paragraphs: [para] };
      turns.push(turn);
      paraStart = s.start;
    } else if (pause) {
      para = [];
      turn.paragraphs.push(para);
      paraStart = s.start;
    }
    para.push(i);
  }
  return turns;
}

/**
 * A turn's header: name (click to rename), start time (click to play), and a
 * rename pencil that shows on hover at the end of the row, so nothing moves.
 * As tall as the avatar, so name and time centre on it.
 */
function TurnHeader({
  speaker,
  start,
  canSeek,
  onSeek,
  onRename,
}: {
  speaker: string;
  start: number;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  onRename: (from: string, to: string) => void;
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="group flex h-7 items-center gap-2">
      {speaker !== '' &&
        (renaming ? (
          <NameInput
            value={speaker}
            ariaLabel={`Rename ${speaker}`}
            onDone={(next) => {
              setRenaming(false);
              if (next !== null) onRename(speaker, next);
            }}
            className="h-7 text-sm font-medium"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title={`Rename ${speaker}`}
            className="-mx-1 rounded-md px-1 text-sm font-medium transition-colors hover:bg-[var(--agent-app-hover)]"
          >
            {speaker}
          </button>
        ))}
      <button
        type="button"
        disabled={!canSeek}
        onClick={() => onSeek(start)}
        title={canSeek ? `Play from ${clock(start)}` : undefined}
        className="text-xs tabular-nums text-[var(--agent-app-muted)] enabled:hover:text-[var(--agent-app-accent)] enabled:hover:underline disabled:cursor-default"
      >
        {clock(start)}
      </button>
      {speaker !== '' && !renaming && (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          aria-label={`Rename ${speaker}`}
          title={`Rename ${speaker}`}
          className="inline-flex size-6 items-center justify-center rounded-md text-[var(--agent-app-muted)] opacity-0 transition-opacity hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * The transcript, read like a chat: each speaker's turn under their name and
 * start time, its sentences flowing as paragraphs. A sentence plays from its
 * moment when clicked; Edit opens every sentence for correction. While
 * recording, new lines arrive as the speech engine finishes each piece, and
 * the view follows them unless the reader has scrolled away.
 */
export function TranscriptPanel({
  note,
  live,
  currentTime,
  onSeek,
  onPatch,
  onGenerate,
  onExport,
  onRename,
}: {
  note: Note;
  /** recording: lines arriving; finishing: last seconds being transcribed. */
  live: 'recording' | 'finishing' | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onPatch: (fields: Partial<Note>) => void;
  onGenerate: () => void;
  onExport: (format: 'txt' | 'srt') => void;
  /** Rename a speaker everywhere in the note. */
  onRename: (from: string, to: string) => void;
}): React.JSX.Element {
  const segments: Segment[] = note.segments ?? [];
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);

  // Follow new live lines only while the reader is at (or near) the bottom.
  useEffect(() => {
    if (live === null) return;
    const onScroll = (): void => {
      const el = end.current;
      if (el === null) return;
      follow.current = el.getBoundingClientRect().top < window.innerHeight + 160;
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [live]);
  useEffect(() => {
    if (live !== null && follow.current) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [segments.length, live]);

  const copy = (): void => {
    const text = segments.length > 0 ? segments.map((s) => `[${clock(s.start)}] ${spoken(s)}`).join('\n') : note.transcript;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error('Copying was blocked by the browser.'));
  };

  // A note without audio: a pasted transcript.
  if (segments.length === 0 && note.audio === '' && live === null) {
    const busy = note.notes_status === 'queued' || note.notes_status === 'processing';
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--agent-app-muted)]">Paste a transcript (from Zoom, Teams, Meet or anywhere) and CraftBot turns it into notes.</p>
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2">
          <TextBlock value={note.transcript} onSave={(transcript) => onPatch({ transcript })} placeholder="Paste or type the transcript here" minRows={10} />
        </div>
        <div>
          <Button disabled={note.transcript.trim() === '' || busy} onClick={onGenerate}>
            <Sparkles size={15} />
            {note.summary === '' ? 'Write notes' : 'Rewrite notes'}
          </Button>
        </div>
      </div>
    );
  }

  if (segments.length === 0 && live === null) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--agent-app-border)] px-6 py-12 text-center text-[13px] text-[var(--agent-app-muted)]">
        The transcript appears here when transcription finishes.
      </p>
    );
  }

  const activeIdx = live === null ? segments.findIndex((s) => currentTime >= s.start && currentTime < s.end) : -1;
  const canSeek = live === null;
  const turns = groupTurns(segments);
  const sentence = (i: number): React.JSX.Element | null => {
    const s = segments[i];
    if (s === undefined) return null;
    if (editing && canSeek) {
      return (
        <TextBlock
          key={`${i}-${s.start}`}
          value={s.text}
          minRows={1}
          onSave={(text) => onPatch({ segments: segments.map((x, k) => (k === i ? { ...x, text: text.trim() } : x)) })}
        />
      );
    }
    const seek = (): void => onSeek(s.start);
    return (
      <span
        key={`${i}-${s.start}`}
        role={canSeek ? 'button' : undefined}
        tabIndex={canSeek ? 0 : undefined}
        title={canSeek ? `Play from ${clock(s.start)}` : undefined}
        onClick={canSeek ? seek : undefined}
        onKeyDown={
          canSeek
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  seek();
                }
              }
            : undefined
        }
        className={cn(
          'rounded-sm [box-decoration-break:clone] transition-colors',
          canSeek && 'cursor-pointer hover:bg-[var(--agent-app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--agent-app-ring)]/40',
          i === activeIdx && 'bg-[var(--agent-app-selected)] hover:bg-[var(--agent-app-selected)]',
        )}
      >
        {s.text}
      </span>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {live === null && (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((e) => !e)}>
            {editing ? <Check size={14} /> : <Pencil size={14} />}
            {editing ? 'Done editing' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onExport('txt')}>
            <Download size={14} />
            Text
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onExport('srt')}>
            <Subtitles size={14} />
            Subtitles
          </Button>
          <span className="ml-auto text-[13px] tabular-nums text-[var(--agent-app-muted)]">{segments.length} lines</span>
        </div>
      )}
      <div className="flex flex-col gap-5 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-5 py-4">
        {segments.length === 0 && live === 'recording' && (
          <p className="text-[13px] text-[var(--agent-app-muted)]">Each sentence appears here a couple of seconds after it is spoken.</p>
        )}
        {turns.map((t) => (
          <div key={`${t.paragraphs[0]?.[0] ?? 0}-${t.start}`} className="flex gap-3">
            {t.speaker !== '' ? <IdentityChip name={t.speaker} /> : <span className="w-7 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1">
              <TurnHeader speaker={t.speaker} start={t.start} canSeek={canSeek} onSeek={onSeek} onRename={onRename} />
              <div className="mt-1 flex flex-col gap-3">
                {t.paragraphs.map((para) =>
                  editing && canSeek ? (
                    <div key={para[0]} className="flex flex-col gap-1">
                      {para.map(sentence)}
                    </div>
                  ) : (
                    <p key={para[0]} className="text-[15px] leading-7">
                      {para.map((i, k) => (
                        <Fragment key={i}>
                          {k > 0 && ' '}
                          {sentence(i)}
                        </Fragment>
                      ))}
                    </p>
                  ),
                )}
              </div>
            </div>
          </div>
        ))}
        {live === 'recording' && <Listening text="Listening" />}
        {live === 'finishing' && <Listening text="Transcribing the last few seconds" />}
        <div ref={end} />
      </div>
    </div>
  );
}
