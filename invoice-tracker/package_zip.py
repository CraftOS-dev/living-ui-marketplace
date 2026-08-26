import os
import zipfile
from pathlib import Path

source_dir = Path(r"c:\ai\living-ui-marketplace\invoice-tracker")
zip_output_1 = Path(r"c:\ai\living-ui-marketplace\invoice-tracker.zip")
zip_output_2 = Path(r"C:\Users\Aima\Downloads\invoice-tracker.zip")

EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    ".pytest_cache",
    "dist",
    ".vscode",
    ".idea",
    ".venv",
    "venv",
}

EXCLUDE_EXTS = {
    ".pyc",
    ".pyo",
    ".log",
    ".tmp",
}

def create_zip(target_zip_path: Path):
    target_zip_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(target_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            for file in files:
                if any(file.endswith(ext) for ext in EXCLUDE_EXTS):
                    continue
                file_path = Path(root) / file
                rel_path = file_path.relative_to(source_dir.parent)
                zipf.write(file_path, arcname=str(rel_path))
                count += 1
    size_mb = target_zip_path.stat().st_size / (1024 * 1024)
    print(f"Created {target_zip_path} ({count} files, {size_mb:.2f} MB)")

create_zip(zip_output_1)
try:
    create_zip(zip_output_2)
except Exception as e:
    print(f"Downloads error: {e}")
