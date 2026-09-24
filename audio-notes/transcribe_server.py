import os
import sys
import io
import json
import glob
import sqlite3
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Reconfigure stdout/stderr to utf-8 on Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from faster_whisper import WhisperModel

PORT = 8095
SEARCH_ROOTS = [
    r'C:\ai\living-ui-marketplace\audio-notes\pb\pb_data',
    r'C:\ai\living-ui-marketplace\audio-notes-popup-bridge\pb\pb_data',
    r'C:\ai\living-ui-marketplace\audio-notes-native-os-capture\pb\pb_data',
    r'C:\ai\living-ui-marketplace\audio-notes-mobile-companion\pb\pb_data',
    r'C:\ai\living-ui-marketplace\audio-notes-direct-browser\pb\pb_data',
    r'C:\ai\CraftBot\agent_file_system\workspace\living_ui',
    r'C:\ai\CraftBot\agent_file_system\workspace\agent_app'
]

# Supported ISO 639-1 language codes in Whisper
WHISPER_LANGUAGES = {
    'af', 'am', 'ar', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br', 'bs', 'ca', 'cs', 'cy', 'da',
    'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fo', 'fr', 'gl', 'gu', 'ha', 'haw', 'he', 'hi',
    'hr', 'ht', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'la', 'lb',
    'ln', 'lo', 'lt', 'lv', 'mg', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'nn',
    'no', 'oc', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sa', 'sd', 'si', 'sk', 'sl', 'sn', 'so', 'sq',
    'sr', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tr', 'tt', 'uk', 'ur', 'uz', 'vi',
    'yi', 'yo', 'zh', 'yue'
}

def normalize_language(lang):
    if not lang or str(lang).strip().lower() in ('auto', 'null', 'none', 'undefined', ''):
        return None
    code = str(lang).strip().lower().replace('_', '-')
    # 'en-us' -> 'en', 'zh-cn' -> 'zh'
    if '-' in code:
        code = code.split('-')[0]
    if code in WHISPER_LANGUAGES:
        return code
    return None

print("Initializing Faster-Whisper model (base)...")
whisper_model = WhisperModel('base', device='cpu', compute_type='int8')
print("Faster-Whisper base model loaded and ready!")

def find_session_audio_file(session_id):
    if not session_id:
        return None
    
    # 1. Query sqlite database directly for exact filename
    for root in SEARCH_ROOTS:
        db_path = os.path.join(root, 'data.db')
        if os.path.exists(db_path):
            try:
                con = sqlite3.connect(db_path, timeout=3)
                cur = con.cursor()
                cur.execute("SELECT audio FROM sessions WHERE id = ?", (session_id,))
                row = cur.fetchone()
                con.close()
                if row and row[0]:
                    audio_filename = row[0]
                    # Search in storage directories
                    storage_root = os.path.join(root, 'storage')
                    if os.path.exists(storage_root):
                        for col_dir in os.listdir(storage_root):
                            candidate = os.path.join(storage_root, col_dir, session_id, audio_filename)
                            if os.path.exists(candidate) and os.path.getsize(candidate) > 50:
                                return candidate
            except Exception as e:
                pass
                
    # 2. Fallback search via glob
    for root in SEARCH_ROOTS:
        if not os.path.exists(root):
            continue
        matches = glob.glob(os.path.join(root, '**', session_id, '*.*'), recursive=True)
        for m in matches:
            if not m.endswith('.attrs') and not m.endswith('.json') and os.path.getsize(m) > 50:
                return m
    return None

def update_session_transcript_in_all_dbs(session_id, transcript):
    if not session_id or not transcript:
        return
    for root in SEARCH_ROOTS:
        if not os.path.exists(root):
            continue
        db_files = glob.glob(os.path.join(root, '**', 'data.db'), recursive=True)
        for db_path in db_files:
            try:
                con = sqlite3.connect(db_path, timeout=5)
                cur = con.cursor()
                cur.execute("UPDATE sessions SET transcript = ? WHERE id = ?", (transcript, session_id))
                con.commit()
                con.close()
            except Exception:
                pass

class TranscribeHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self._send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ready", "model": "whisper-base"}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == '/transcribe':
            content_length = int(self.headers.get('Content-Length', 0))
            content_type = self.headers.get('Content-Type', '')
            body = self.rfile.read(content_length)

            audio_file_path = None
            temp_file = None
            session_id = None
            requested_lang = None

            try:
                # 1. Try parsing JSON body with session_id
                if 'application/json' in content_type:
                    try:
                        data = json.loads(body.decode('utf-8'))
                        session_id = data.get('session_id')
                        raw_lang = data.get('language')
                        requested_lang = normalize_language(raw_lang)
                    except Exception:
                        data = None

                if session_id:
                    audio_file_path = find_session_audio_file(session_id)
                    if audio_file_path:
                        print(f"Found audio file for session {session_id}: {audio_file_path} ({os.path.getsize(audio_file_path)} bytes)")

                # 2. If raw binary audio was sent directly
                if not audio_file_path and len(body) > 50:
                    ext = '.webm'
                    if 'mpeg' in content_type or 'mp3' in content_type:
                        ext = '.mp3'
                    elif 'wav' in content_type:
                        ext = '.wav'
                    elif 'mp4' in content_type or 'm4a' in content_type:
                        ext = '.m4a'
                    elif 'ogg' in content_type:
                        ext = '.ogg'

                    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
                    temp_file.write(body)
                    temp_file.close()
                    audio_file_path = temp_file.name
                    print(f"Received raw audio stream ({len(body)} bytes), written to temp: {audio_file_path}")

                if not audio_file_path or not os.path.exists(audio_file_path) or os.path.getsize(audio_file_path) == 0:
                    self.send_response(400)
                    self._send_cors_headers()
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Audio file not found or empty"}).encode('utf-8'))
                    return

                print(f"Transcribing: {audio_file_path} (Language: {requested_lang or 'Auto-Detect'})")

                # Transcribe with optimal Faster-Whisper settings
                segments_gen, info = whisper_model.transcribe(
                    audio_file_path,
                    language=requested_lang,
                    beam_size=5,
                    best_of=5,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=400),
                    temperature=[0.0, 0.2, 0.4],
                )

                segments = []
                formatted_lines = []

                for idx, s in enumerate(segments_gen):
                    text = s.text.strip()
                    if not text:
                        continue
                    start_sec = s.start
                    end_sec = s.end

                    def fmt(sec):
                        m = int(sec // 60)
                        sc = int(sec % 60)
                        return f"{m:02d}:{sc:02d}"

                    line = f"[{fmt(start_sec)} - {fmt(end_sec)}] {text}"
                    formatted_lines.append(line)
                    segments.append({
                        "id": f"seg-{idx}-{int(start_sec)}",
                        "start": round(start_sec, 2),
                        "end": round(end_sec, 2),
                        "text": text
                    })

                full_text = "\n".join(formatted_lines)
                print(f"Transcription finished: {len(segments)} segments, detected language: {info.language} (prob: {info.language_probability:.2f})")

                # Save directly to DB if session_id provided
                if session_id and full_text:
                    update_session_transcript_in_all_dbs(session_id, full_text)

                self.send_response(200)
                self._send_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "language": info.language,
                    "text": full_text,
                    "segments": segments
                }, ensure_ascii=False).encode('utf-8'))

            except Exception as err:
                print("Transcription error:", err)
                self.send_response(500)
                self._send_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(err)}).encode('utf-8'))
            finally:
                if temp_file and os.path.exists(temp_file.name):
                    try:
                        os.remove(temp_file.name)
                    except Exception:
                        pass
            return

        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), TranscribeHandler)
    print(f"Transcribe server running on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
