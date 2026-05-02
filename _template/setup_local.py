"""
Local development setup — replaces template placeholders with test values.
Run this once before testing locally. Don't commit the changes.

Usage: python setup_local.py [--port BACKEND_PORT] [--frontend-port FRONTEND_PORT]
"""

import sys
from pathlib import Path

# Parse args
backend_port = '3200'
frontend_port = '3201'
for i, arg in enumerate(sys.argv[1:], 1):
    if arg == '--port' and i < len(sys.argv):
        backend_port = sys.argv[i + 1]
    if arg == '--frontend-port' and i < len(sys.argv):
        frontend_port = sys.argv[i + 1]

REPLACEMENTS = {
    '{{PROJECT_ID}}': 'local-dev',
    '{{PROJECT_NAME}}': 'Living UI Template',
    '{{PROJECT_DESCRIPTION}}': 'Empty Living UI base template — clone before customizing',
    '{{PORT}}': frontend_port,
    '{{BACKEND_PORT}}': backend_port,
    '{{THEME}}': 'system',
    '{{CREATED_AT}}': '2026-01-01T00:00:00',
    '{{FEATURES}}': '',
}

TEXT_EXTENSIONS = {'.ts', '.tsx', '.js', '.json', '.html', '.css', '.md', '.py', '.txt'}
SKIP_DIRS = {'node_modules', '.git', '__pycache__', 'dist', 'logs'}

root = Path(__file__).parent

count = 0
for filepath in root.rglob('*'):
    if filepath.is_file() and filepath.suffix in TEXT_EXTENSIONS:
        if any(skip in filepath.parts for skip in SKIP_DIRS):
            continue
        if filepath.name == 'setup_local.py':
            continue
        try:
            content = filepath.read_text(encoding='utf-8')
            modified = False
            for placeholder, value in REPLACEMENTS.items():
                if placeholder in content:
                    content = content.replace(placeholder, value)
                    modified = True
            if modified:
                filepath.write_text(content, encoding='utf-8')
                count += 1
                print(f"  Updated: {filepath.relative_to(root)}")
        except Exception as e:
            print(f"  Skipped: {filepath.relative_to(root)} ({e})")

print(f"\nReplaced placeholders in {count} file(s).")
print(f"Backend port: {backend_port}, Frontend port: {frontend_port}")
print("Run 'git checkout .' to revert when done testing.")
