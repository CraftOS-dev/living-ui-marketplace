import { useState, useEffect, useRef } from 'react';
import type { AudioSession } from '../types.ts';
import {
  Copy,
  Check,
  RotateCcw,
  Download,
  Languages,
  MessageSquare,
} from 'lucide-react';
import {
  downloadFile,
  parseTranscriptSegments,
  generateSrtContent,
} from '../utils.ts';

interface AudioToTextSectionProps {
  session: AudioSession;
  audioUrl?: string | undefined;
  duration?: number | undefined;
  onUpdateSession: (fields: Partial<AudioSession>) => void;
  onNavigateTab?: (tab: 'overview' | 'summary' | 'highlights') => void;
}

const SUPPORTED_LANGUAGES = [
  { code: 'auto', label: 'Auto Detect' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'zh', label: 'Chinese (中文)' },
  { code: 'ar', label: 'Arabic (العربية)' },
  { code: 'th', label: 'Thai (ไทย)' },
];

export function AudioToTextSection({
  session,
  audioUrl,
  duration = 0,
  onUpdateSession,
}: AudioToTextSectionProps): React.JSX.Element {
  const [transcriptText, setTranscriptText] = useState(session.transcript || '');
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setTranscriptText(session.transcript || '');
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [session.id, session.transcript]);

  // Copy transcript
  const handleCopy = () => {
    if (!transcriptText) return;
    void navigator.clipboard.writeText(transcriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download as TXT
  const handleDownloadTxt = () => {
    if (!transcriptText) return;
    const filename = `${(session.title || 'transcript').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_')}_transcript.txt`;
    downloadFile(transcriptText, filename, 'text/plain;charset=utf-8');
    setStatusMessage('✓ Downloaded transcript as TXT');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Download as SRT
  const handleDownloadSrt = () => {
    if (!transcriptText) return;
    const segments = parseTranscriptSegments(transcriptText, duration || session.duration || 60);
    if (!segments.length) return;
    const srtContent = generateSrtContent(segments);
    const filename = `${(session.title || 'subtitles').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_')}.srt`;
    downloadFile(srtContent, filename, 'application/x-subrip;charset=utf-8');
    setStatusMessage('✓ Downloaded subtitles as SRT');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Convert audio to text using Whisper AI
  const handleConvertAudioToText = async () => {
    if (isTranscribing) return;
    setIsTranscribing(true);
    setTranscribeProgress(20);
    setStatusMessage('Transcribing audio with Whisper AI...');

    try {
      let transcribedText = '';

      // 1. Ask local Faster-Whisper server by session_id
      try {
        const res = await fetch('http://127.0.0.1:8095/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: session.id,
            language: selectedLanguage,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.text && data.text.trim()) {
            transcribedText = data.text.trim();
            if (data.language) {
              setStatusMessage(`✓ Audio transcribed successfully (${data.language.toUpperCase()})`);
            }
          }
        }
      } catch (err) {
        console.warn('Local Whisper session lookup failed, trying direct stream:', err);
      }

      // 2. Fallback: Send audio blob directly if available
      if (!transcribedText && audioUrl) {
        try {
          setTranscribeProgress(50);
          setStatusMessage('Processing audio stream with Whisper AI...');
          const fullUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
          const audioRes = await fetch(fullUrl);
          const audioBlob = await audioRes.blob();

          const uploadRes = await fetch('http://127.0.0.1:8095/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
            body: audioBlob,
          });

          if (uploadRes.ok) {
            const data = await uploadRes.json();
            if (data.text && data.text.trim()) {
              transcribedText = data.text.trim();
              if (data.language) {
                setStatusMessage(`✓ Audio transcribed successfully (${data.language.toUpperCase()})`);
              }
            }
          }
        } catch (err) {
          console.warn('Direct audio stream transcription failed:', err);
        }
      }

      // 3. Fallback: Browser Web Speech API
      if (!transcribedText) {
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          setStatusMessage('Listening via Web Speech API...');
          await new Promise<void>((resolve) => {
            try {
              const rec = new SpeechRec();
              rec.continuous = true;
              rec.interimResults = true;
              rec.lang = selectedLanguage === 'auto' ? 'en-US' : selectedLanguage;
              let captured = '';

              rec.onresult = (event: any) => {
                for (let i = event.resultIndex; i < event.results.length; i++) {
                  if (event.results[i].isFinal) {
                    captured += event.results[i][0].transcript + ' ';
                  }
                }
              };

              rec.onend = () => {
                if (captured.trim()) transcribedText = captured.trim();
                resolve();
              };

              rec.onerror = () => resolve();

              rec.start();
              setTimeout(() => {
                try {
                  rec.stop();
                } catch {
                  // ignore
                }
                resolve();
              }, 4000);
            } catch {
              resolve();
            }
          });
        }
      }

      if (transcribedText) {
        setTranscribeProgress(100);
        setTranscriptText(transcribedText);
        onUpdateSession({ transcript: transcribedText });
        setStatusMessage('✓ Audio transcribed successfully!');
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        setStatusMessage('No speech detected. Please check audio file.');
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      console.error('Transcription error:', err);
      setStatusMessage('Transcription error occurred.');
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setIsTranscribing(false);
      setTranscribeProgress(0);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTranscriptText(val);
  };

  const handleTextBlur = () => {
    if (transcriptText !== session.transcript) {
      onUpdateSession({ transcript: transcriptText });
    }
  };

  return (
    <div className="doc-box p-4 sm:p-5 lg:p-6 flex flex-col gap-3.5">
      {/* Top Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[var(--lui-border)]/50">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)] flex items-center gap-2">
              <MessageSquare size={15} className="opacity-70" />
              <span>Transcript</span>
            </h3>
            {isTranscribing && (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-amber-500/15 text-amber-600 font-medium animate-pulse flex items-center gap-1 font-sans">
                Transcribing ({transcribeProgress}%)
              </span>
            )}
          </div>
          <p className="text-[12px] text-[var(--lui-muted)] mt-0.5">
            Full spoken transcript transcribed from audio • Editable and automatically saved
          </p>
        </div>

        {/* Controls: Language, Convert CTA, Downloads */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Language Selector */}
          <div className="flex items-center gap-1 text-xs">
            <Languages size={13} className="text-[var(--lui-muted)]" />
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={isTranscribing}
              className="px-2 py-1 rounded text-xs bg-[var(--lui-surface)] border border-[var(--lui-border)] text-[var(--lui-foreground)] cursor-pointer"
              title="Select spoken language"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Transcribe Button */}
          <button
            onClick={handleConvertAudioToText}
            disabled={isTranscribing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all shadow-xs ${
              isTranscribing
                ? 'bg-[#FF4F18]/50 text-white cursor-not-allowed'
                : 'bg-[#FF4F18] hover:bg-[#E64515] text-white active:scale-95'
            }`}
            title="Transcribe audio to text"
          >
            {isTranscribing ? (
              <>
                <RotateCcw size={13} className="animate-spin" />
                <span>Transcribing...</span>
              </>
            ) : (
              <span>Transcribe</span>
            )}
          </button>

          {/* Export TXT */}
          {transcriptText && (
            <button
              onClick={handleDownloadTxt}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] transition-colors"
              title="Download transcript as TXT"
            >
              <Download size={12} />
              <span>↓ TXT</span>
            </button>
          )}

          {/* Export SRT */}
          {transcriptText && (
            <button
              onClick={handleDownloadSrt}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] transition-colors"
              title="Download subtitles as SRT"
            >
              <Download size={12} />
              <span>↓ SRT</span>
            </button>
          )}

          {/* Copy Button */}
          {transcriptText && (
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 border border-[var(--lui-border)]/50 transition-colors"
              title="Copy transcript"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {isTranscribing && (
        <div className="w-full bg-[var(--lui-border)]/50 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-[var(--lui-foreground)] h-full transition-all duration-200"
            style={{ width: `${transcribeProgress}%` }}
          />
        </div>
      )}

      {/* Status Feedback Message */}
      {statusMessage && (
        <div className="px-3 py-1.5 rounded-md bg-[var(--lui-surface)] border border-[var(--lui-border)] text-xs text-[var(--lui-foreground)] flex items-center gap-2 animate-in fade-in duration-150">
          <Check size={13} className="text-emerald-500 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Full Transcript Textarea (Default size with auto scrollbar when content grows) */}
      <textarea
        ref={textareaRef}
        value={transcriptText}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        placeholder="Audio transcript will appear here. Live speech will stream directly into this box as you record..."
        rows={10}
        className="doc-textarea w-full p-4 sm:p-5 text-[13.5px] sm:text-[14px] font-sans leading-relaxed tracking-normal text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/40 tabular-numbers h-[280px] max-h-[280px] overflow-y-auto resize-none"
      />
    </div>
  );
}
