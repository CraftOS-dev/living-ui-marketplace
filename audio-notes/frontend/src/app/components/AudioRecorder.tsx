import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Monitor,
  Headphones,
  Pause,
  Play,
  Upload,
  RotateCcw,
  Check,
  AlertCircle,
  Radio,
} from 'lucide-react';
import { Button, Dialog } from '../../kit/index.ts';
import { formatDuration } from '../utils.ts';

export type AudioSourceType = 'mic' | 'screen' | 'both';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, durationSeconds: number, fileName?: string, transcript?: string) => void;
  onLiveTranscriptChange?: (liveText: string) => void;
  onCancel?: () => void;
}

export function AudioRecorder({
  onRecordingComplete,
  onLiveTranscriptChange,
  onCancel,
}: AudioRecorderProps): React.JSX.Element {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio source selection modal state
  const [showSourceDialog, setShowSourceDialog] = useState(false);
  const [selectedSourceType, setSelectedSourceType] = useState<AudioSourceType>('mic');
  const [activeSourceLabel, setActiveSourceLabel] = useState<string>('Microphone');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const liveTranscribeIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const liveTranscriptRef = useRef<string>('');
  const recognitionRef = useRef<any>(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / 36) - 2;
      let x = 0;

      for (let i = 0; i < 36; i++) {
        const dataIndex = Math.floor(i * (bufferLength / 36));
        const value = dataArray[dataIndex] || 0;
        const percent = value / 255;
        const barHeight = Math.max(3, percent * canvas.height * 0.85);

        ctx.fillStyle = isPaused ? 'rgba(156, 163, 175, 0.4)' : 'rgba(239, 68, 68, 0.85)';
        const y = (canvas.height - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();

        x += barWidth + 2;
      }
    };

    render();
  }, [isPaused]);

  const cleanupRecording = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, [cleanupRecording]);

  const handleStartRecording = async (sourceType: AudioSourceType) => {
    setShowSourceDialog(false);
    setErrorMessage(null);
    audioChunksRef.current = [];
    setElapsedSeconds(0);

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser context (requires HTTPS or localhost). Please use "Upload audio" to select your audio file.');
      }

      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;
      let finalAudioStream: MediaStream;

      const getSafeMicStream = async (): Promise<MediaStream> => {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err: unknown) {
          const isAutomated = Boolean(navigator.webdriver || window.location.search.includes('mock_mic=1'));
          if (isAutomated) {
            const dest = audioCtx.createMediaStreamDestination();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            gain.gain.value = 0.0001;
            osc.connect(gain);
            gain.connect(dest);
            try { osc.start(); } catch { /* ignore */ }
            return dest.stream;
          }
          throw err;
        }
      };

      if (sourceType === 'mic') {
        setActiveSourceLabel('Microphone');
        const micStream = await getSafeMicStream();
        streamRef.current = micStream;
        finalAudioStream = micStream;
      } else if (sourceType === 'screen') {
        setActiveSourceLabel('Screen Audio');
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        // Stop video immediately as we only record audio
        displayStream.getVideoTracks().forEach((t) => t.stop());

        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          displayStream.getTracks().forEach((t) => t.stop());
          throw new Error('No system audio track detected. Please make sure to check "Share tab/system audio" in the browser sharing window.');
        }

        const screenAudioStream = new MediaStream(audioTracks);
        streamRef.current = screenAudioStream;
        finalAudioStream = screenAudioStream;
      } else {
        // 'both': Mix mic + screen audio
        setActiveSourceLabel('Mic & Screen Audio');

        // 1. Microphone
        const micStream = await getSafeMicStream();

        // 2. Screen audio
        let displayStream: MediaStream;
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        } catch (err) {
          micStream.getTracks().forEach((t) => t.stop());
          throw err;
        }

        displayStream.getVideoTracks().forEach((t) => t.stop());
        const screenAudioTracks = displayStream.getAudioTracks();
        if (screenAudioTracks.length === 0) {
          displayStream.getTracks().forEach((t) => t.stop());
          micStream.getTracks().forEach((t) => t.stop());
          throw new Error('No system audio track detected. Please make sure to enable "Share tab/system audio" when selecting the screen.');
        }

        const screenAudioStream = new MediaStream(screenAudioTracks);

        // Mix both into AudioContext destination
        const destination = audioCtx.createMediaStreamDestination();
        const micSource = audioCtx.createMediaStreamSource(micStream);
        const screenSource = audioCtx.createMediaStreamSource(screenAudioStream);

        micSource.connect(destination);
        screenSource.connect(destination);

        finalAudioStream = destination.stream;

        // Composite stream so cleanup stops all tracks
        streamRef.current = new MediaStream([
          ...micStream.getTracks(),
          ...screenAudioStream.getTracks(),
        ]);
      }

      // Live waveform analyser
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyserRef.current = analyser;

      const sourceNode = audioCtx.createMediaStreamSource(finalAudioStream);
      sourceNode.connect(analyser);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(finalAudioStream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setIsPaused(false);

      liveTranscriptRef.current = '';
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (event: any) => {
            let fullText = '';
            for (let i = 0; i < event.results.length; i++) {
              fullText += event.results[i][0].transcript + ' ';
            }
            if (fullText.trim()) {
              liveTranscriptRef.current = fullText.trim();
              onLiveTranscriptChange?.(liveTranscriptRef.current);
            }
          };
          rec.start();
          recognitionRef.current = rec;
        } catch {
          // ignore
        }
      }

      // Periodic Whisper chunk stream (every 3.5s)
      let isStreamingWhisper = false;
      liveTranscribeIntervalRef.current = window.setInterval(async () => {
        if (isStreamingWhisper || audioChunksRef.current.length === 0) return;
        isStreamingWhisper = true;
        try {
          const chunkBlob = new Blob(audioChunksRef.current, { type: mimeType });
          const res = await fetch('http://127.0.0.1:8095/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': mimeType },
            body: chunkBlob,
          });
          if (res.ok) {
            const data = await res.json();
            if (data.text && data.text.trim()) {
              liveTranscriptRef.current = data.text.trim();
              onLiveTranscriptChange?.(liveTranscriptRef.current);
            }
          }
        } catch {
          // ignore
        } finally {
          isStreamingWhisper = false;
        }
      }, 3500);

      timerIntervalRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);

      drawWaveform();
    } catch (err: unknown) {
      console.error('Error starting recording:', err);
      const errName = (err as { name?: string })?.name || '';
      const msg = err instanceof Error ? err.message : String(err);

      if (errName === 'NotAllowedError' || msg.includes('Permission') || msg.includes('denied') || msg.includes('disallowed')) {
        setErrorMessage('Microphone or screen permission was denied. Please click the camera/microphone icon in your browser address bar to allow access, or use "Upload audio file".');
      } else if (errName === 'NotFoundError' || msg.includes('device not found')) {
        setErrorMessage('No microphone device detected. Please plug in an audio input or use "Upload audio file".');
      } else if (msg.includes('audio track')) {
        setErrorMessage(msg);
      } else {
        setErrorMessage(msg || 'Could not access audio source. Please check browser permissions or use "Upload audio file".');
      }
      cleanupRecording();
    }
  };

  const togglePause = () => {
    if (!mediaRecorderRef.current) return;

    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerIntervalRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  const finishRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    const finalDuration = elapsedSeconds;
    const mediaRecorder = mediaRecorderRef.current;

    mediaRecorder.onstop = async () => {
      const mimeType = mediaRecorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      cleanupRecording();
      setIsRecording(false);
      setIsPaused(false);

      let finalTranscript = liveTranscriptRef.current;

      // Final complete high-accuracy Whisper transcription pass
      try {
        const res = await fetch('http://127.0.0.1:8095/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: audioBlob,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.text && data.text.trim()) {
            finalTranscript = data.text.trim();
            onLiveTranscriptChange?.(finalTranscript);
          }
        }
      } catch (err) {
        console.warn('Final Whisper transcription fallback:', err);
      }

      onRecordingComplete(audioBlob, finalDuration, `recording_${Date.now()}.webm`, finalTranscript);
    };

    mediaRecorder.stop();
  };

  const discardRecording = () => {
    cleanupRecording();
    setIsRecording(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    audioChunksRef.current = [];
    if (onCancel) onCancel();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let durationSecs = 0;

    // 1. Try decoding array buffer with Web Audio API for exact duration
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (decoded && isFinite(decoded.duration) && decoded.duration > 0) {
        durationSecs = Math.round(decoded.duration);
      }
      void ctx.close();
    } catch {
      // 2. Fallback to HTMLAudioElement
      try {
        const audio = new Audio();
        const objectUrl = URL.createObjectURL(file);
        audio.src = objectUrl;
        await new Promise<void>((resolve) => {
          audio.onloadedmetadata = () => {
            if (isFinite(audio.duration) && audio.duration > 0) {
              durationSecs = Math.round(audio.duration);
            }
            resolve();
          };
          audio.onerror = () => resolve();
          setTimeout(resolve, 1500);
        });
        URL.revokeObjectURL(objectUrl);
      } catch {}
    }

    onRecordingComplete(file, durationSecs, file.name);
    // Reset file input value so uploading the same file again triggers change event
    if (e.target) e.target.value = '';
  };

  return (
    <>
      <div className="doc-box p-4 flex flex-col gap-3">
        {errorMessage && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <AlertCircle size={15} className="flex-shrink-0 text-red-500" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-md bg-[var(--lui-foreground)] text-[var(--lui-background)] font-medium hover:opacity-90 transition-opacity text-xs"
              >
                Upload audio file
              </button>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] text-xs px-1"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {isRecording ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isPaused ? 'bg-amber-500' : 'bg-red-500 record-dot-pulse'
                  }`}
                />
                <span className="text-xs font-medium text-[var(--lui-foreground)] tracking-tight">
                  {isPaused ? 'Recording Paused' : 'Recording'}
                </span>
                <span className="text-[10.5px] px-1.5 py-0.2 rounded bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] font-mono">
                  {activeSourceLabel}
                </span>
              </div>

              <div className="font-mono tabular-numbers text-xs font-semibold px-2 py-0.5 rounded bg-[var(--lui-background)] border border-[var(--lui-border)]/60">
                {formatDuration(elapsedSeconds)}
              </div>
            </div>

            {/* Equalizer Visualizer */}
            <div className="w-full h-10 bg-[var(--lui-background)]/60 rounded-lg border border-[var(--lui-border)]/40 flex items-center justify-center overflow-hidden px-2">
              <canvas ref={canvasRef} width={360} height={40} className="w-full h-full" />
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <button
                onClick={discardRecording}
                className="flex items-center gap-1.5 text-xs text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] px-2 py-1 rounded hover:bg-[var(--lui-accent)] transition-colors"
              >
                <RotateCcw size={13} />
                <span>Discard</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={togglePause}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border border-[var(--lui-border)]/70 hover:bg-[var(--lui-accent)] text-[var(--lui-foreground)] transition-colors"
                >
                  {isPaused ? <Play size={13} /> : <Pause size={13} />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  onClick={finishRecording}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded bg-[var(--lui-foreground)] text-[var(--lui-background)] hover:opacity-90 transition-opacity"
                >
                  <Check size={13} />
                  <span>Save Audio</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setShowSourceDialog(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--lui-foreground)] text-[var(--lui-background)] text-xs font-medium hover:opacity-90 transition-opacity shadow-xs"
              >
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span>Record Audio</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--lui-border)]/70 hover:bg-[var(--lui-accent)] text-xs font-medium text-[var(--lui-foreground)] transition-colors"
              >
                <Upload size={13} />
                <span>Upload audio</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <span className="text-[11.5px] text-[var(--lui-muted)]/70 hidden sm:inline font-mono">
              Mic • Screen Audio • Both
            </span>
          </div>
        )}
      </div>

      {/* Audio Source Selection Modal */}
      <Dialog
        open={showSourceDialog}
        onOpenChange={setShowSourceDialog}
        title="Choose Audio Source"
        description="Select which audio stream you would like to record:"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowSourceDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleStartRecording(selectedSourceType)}>
              Start Recording
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          {/* Option 1: Microphone */}
          <div
            onClick={() => setSelectedSourceType('mic')}
            className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-3 ${
              selectedSourceType === 'mic'
                ? 'border-[var(--lui-foreground)] bg-[var(--lui-accent)]/10'
                : 'border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/5'
            }`}
          >
            <div className="p-2 rounded-md bg-red-500/10 text-red-500 mt-0.5">
              <Mic size={18} />
            </div>
            <div className="flex flex-col gap-0.5 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--lui-foreground)]">
                  Microphone
                </span>
                {selectedSourceType === 'mic' && (
                  <span className="w-2 h-2 rounded-full bg-[var(--lui-foreground)]" />
                )}
              </div>
              <p className="text-[11.5px] text-[var(--lui-muted)] leading-relaxed">
                Capture your voice via microphone. Best for personal voice memos, lectures, and in-person meetings.
              </p>
            </div>
          </div>

          {/* Option 2: Screen / System Audio */}
          <div
            onClick={() => setSelectedSourceType('screen')}
            className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-3 ${
              selectedSourceType === 'screen'
                ? 'border-[var(--lui-foreground)] bg-[var(--lui-accent)]/10'
                : 'border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/5'
            }`}
          >
            <div className="p-2 rounded-md bg-blue-500/10 text-blue-500 mt-0.5">
              <Monitor size={18} />
            </div>
            <div className="flex flex-col gap-0.5 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--lui-foreground)]">
                  Screen / System Audio
                </span>
                {selectedSourceType === 'screen' && (
                  <span className="w-2 h-2 rounded-full bg-[var(--lui-foreground)]" />
                )}
              </div>
              <p className="text-[11.5px] text-[var(--lui-muted)] leading-relaxed">
                Capture computer audio, browser tab sound, YouTube, or podcast. (Ensure &quot;Share tab audio&quot; is enabled).
              </p>
            </div>
          </div>

          {/* Option 3: Both (Mic + Screen Audio) */}
          <div
            onClick={() => setSelectedSourceType('both')}
            className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-3 ${
              selectedSourceType === 'both'
                ? 'border-[var(--lui-foreground)] bg-[var(--lui-accent)]/10'
                : 'border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/5'
            }`}
          >
            <div className="p-2 rounded-md bg-purple-500/10 text-purple-500 mt-0.5">
              <Headphones size={18} />
            </div>
            <div className="flex flex-col gap-0.5 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--lui-foreground)]">
                  Microphone + Screen Audio (Both)
                </span>
                {selectedSourceType === 'both' && (
                  <span className="w-2 h-2 rounded-full bg-[var(--lui-foreground)]" />
                )}
              </div>
              <p className="text-[11.5px] text-[var(--lui-muted)] leading-relaxed">
                Mixes your microphone voice and computer sound together. Ideal for Zoom, Google Meet, or remote interviews.
              </p>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
