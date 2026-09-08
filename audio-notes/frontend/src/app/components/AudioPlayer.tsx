import { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
  Download,
} from 'lucide-react';
import { formatDuration, downloadAudioFile } from '../utils.ts';

interface AudioPlayerProps {
  audioUrl?: string | undefined;
  duration?: number;
  title?: string | undefined;
  onAudioError?: () => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({
  audioUrl,
  duration = 0,
  title,
  onAudioError,
}: AudioPlayerProps): React.JSX.Element {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [totalDuration, setTotalDuration] = useState<number>(
    duration && isFinite(duration) && duration > 0 ? duration : 0
  );
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (duration > 0 && isFinite(duration)) {
      setTotalDuration(duration);
    }
  }, [duration, audioUrl]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setIsSeeking(false);
  }, [audioUrl]);

  // Listen for audio seek events dispatched from timestamped captions/transcripts
  useEffect(() => {
    const handleAudioSeek = (e: Event) => {
      const customEvent = e as CustomEvent<{ time: number; play?: boolean }>;
      if (customEvent.detail && typeof customEvent.detail.time === 'number') {
        const targetTime = customEvent.detail.time;
        if (audioRef.current && isFinite(targetTime)) {
          audioRef.current.currentTime = targetTime;
          setCurrentTime(targetTime);
          if (customEvent.detail.play !== false) {
            void audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        }
      }
    };

    window.addEventListener('lui-audio-seek', handleAudioSeek);
    return () => window.removeEventListener('lui-audio-seek', handleAudioSeek);
  }, []);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        void audioRef.current.play().catch((err) => {
          console.warn('Playback error:', err);
        });
        setIsPlaying(true);
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isSeeking) {
      const cur = audioRef.current.currentTime;
      setCurrentTime(cur);

      const d = audioRef.current.duration;
      if (d && isFinite(d) && !isNaN(d) && d > 0) {
        setTotalDuration(d);
      } else if (cur > totalDuration && isFinite(cur)) {
        setTotalDuration(Math.ceil(cur));
      }
    }
  };

  const handleSeekInput = (e: React.FormEvent<HTMLInputElement>) => {
    const targetTime = parseFloat((e.target as HTMLInputElement).value);
    if (isFinite(targetTime)) {
      setCurrentTime(targetTime);
    }
  };

  const handleSeekCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const targetTime = parseFloat((e.target as HTMLInputElement).value);
    if (isFinite(targetTime)) {
      setCurrentTime(targetTime);
      if (audioRef.current) {
        audioRef.current.currentTime = targetTime;
      }
    }
    setIsSeeking(false);
  };

  const validDuration =
    isFinite(totalDuration) && totalDuration > 0
      ? totalDuration
      : isFinite(duration) && duration > 0
      ? duration
      : 0;

  const handleSkip = (seconds: number) => {
    const maxDur = validDuration > 0 ? validDuration : 999999;
    if (audioRef.current) {
      const newTime = Math.max(0, Math.min(maxDur, audioRef.current.currentTime + seconds));
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    } else {
      setCurrentTime((prev) => Math.max(0, Math.min(maxDur, prev + seconds)));
    }
  };

  const cycleSpeed = () => {
    const currentIndex = SPEED_OPTIONS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    const nextSpeed = SPEED_OPTIONS[nextIndex] ?? 1;
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
    }
    setIsMuted(val === 0);
  };

  const progressPercent = validDuration > 0 ? Math.min(100, (currentTime / validDuration) * 100) : 0;

  return (
    <div className="doc-box px-4 py-3.5 sm:px-5 sm:py-4 lg:px-6 lg:py-4.5 flex flex-col gap-2.5 select-none">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            const d = audioRef.current?.duration;
            if (d && isFinite(d) && !isNaN(d) && d > 0) {
              setTotalDuration(d);
            } else if (duration > 0 && isFinite(duration)) {
              setTotalDuration(duration);
            }
          }}
          onDurationChange={() => {
            const d = audioRef.current?.duration;
            if (d && isFinite(d) && !isNaN(d) && d > 0) {
              setTotalDuration(d);
            }
          }}
          onCanPlay={() => {
            const d = audioRef.current?.duration;
            if (d && isFinite(d) && !isNaN(d) && d > 0) {
              setTotalDuration(d);
            }
          }}
          onError={() => {
            console.warn('Audio playback error for source:', audioUrl);
            if (onAudioError) {
              onAudioError();
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        {/* Playback Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleSkip(-5)}
            title="Rewind 5s"
            className="p-1 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)] transition-colors"
          >
            <Rewind size={15} />
          </button>

          <button
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-[#FF4F18] hover:bg-[#E64515] text-white flex items-center justify-center transition-all shrink-0 shadow-xs active:scale-95"
          >
            {isPlaying ? (
              <Pause size={14} fill="currentColor" />
            ) : (
              <Play size={14} className="ml-0.5" fill="currentColor" />
            )}
          </button>

          <button
            onClick={() => handleSkip(10)}
            title="Forward 10s"
            className="p-1 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)] transition-colors"
          >
            <FastForward size={15} />
          </button>
        </div>

        {/* Timeline & Scrubber */}
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] lg:text-xs font-mono tabular-numbers text-[var(--lui-muted)]">
            <span>{formatDuration(currentTime)}</span>
            <span className="truncate max-w-[320px] font-sans font-medium text-[var(--lui-foreground)]/80 hidden sm:inline text-center">
              {title || 'Audio track'}
            </span>
            <span>{formatDuration(validDuration)}</span>
          </div>

          <div className="relative flex items-center h-4 group">
            {/* Minimal Waveform Bars */}
            <div className="absolute inset-0 flex items-center gap-[2px] opacity-25 pointer-events-none">
              {Array.from({ length: 44 }).map((_, i) => {
                const heightPercent = 25 + Math.sin(i * 0.45) * 20 + ((i % 4) * 10);
                const isPassed = (i / 44) * 100 <= progressPercent;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-full ${
                      isPassed ? 'bg-[var(--lui-foreground)] opacity-70' : 'bg-[var(--lui-muted)]'
                    }`}
                    style={{ height: `${heightPercent}%` }}
                  />
                );
              })}
            </div>

            {/* Custom Range Track */}
            <div className="w-full h-1 rounded-full bg-[var(--lui-border)] overflow-hidden pointer-events-none relative z-10">
              <div
                className="h-full bg-[#FF4F18]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Interactive Scrubber Input */}
            <input
              type="range"
              min={0}
              max={validDuration > 0 ? validDuration : 100}
              step={0.05}
              value={currentTime}
              onMouseDown={() => setIsSeeking(true)}
              onTouchStart={() => setIsSeeking(true)}
              onInput={handleSeekInput}
              onChange={handleSeekCommit}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              title="Seek audio position"
            />
          </div>
        </div>

        {/* Speed & Volume Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={cycleSpeed}
            title="Playback Speed"
            className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium border border-[var(--lui-border)]/70 hover:bg-[var(--lui-accent)] text-[var(--lui-foreground)] transition-colors min-w-[32px] text-center"
          >
            {playbackSpeed}x
          </button>

          <div className="hidden sm:flex items-center gap-1 group/vol">
            <button
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              className="p-1 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors"
            >
              {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-14 h-1 accent-[var(--lui-foreground)] cursor-pointer"
              title="Volume slider"
            />
          </div>

          {audioUrl && (
            <button
              onClick={() => void downloadAudioFile(audioUrl, title || 'audio-recording')}
              title="Download audio recording"
              className="p-1 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 transition-colors"
            >
              <Download size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
