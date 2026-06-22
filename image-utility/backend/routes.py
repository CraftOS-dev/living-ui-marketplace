"""
Image Utility API Routes

Image upload, transform, and download. Includes standard Living UI agent routes.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional, Literal
from database import get_db
from models import AppState, ImageAsset, UISnapshot, UIScreenshot
from datetime import datetime
from pathlib import Path
import logging
import shutil
import uuid
import io

from PIL import Image

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

OUTPUT_DIR = Path(__file__).parent / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
FORMAT_EXT = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
FORMAT_MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


class StateUpdate(BaseModel):
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


class UISnapshotUpdate(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


class CropSpec(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ResizeSpec(BaseModel):
    width: Optional[int] = Field(default=None, gt=0)
    height: Optional[int] = Field(default=None, gt=0)
    maintain_aspect: bool = True


class TransformRequest(BaseModel):
    crop: Optional[CropSpec] = None
    resize: Optional[ResizeSpec] = None
    # Literal format → OpenAPI enum for marketplace smoke tests
    format: Literal["PNG", "JPEG", "WEBP"] = "PNG"
    quality: int = Field(default=85, ge=1, le=100)


def _normalize_format(fmt: str) -> str:
    fmt = (fmt or "PNG").upper()
    if fmt in ("JPG", "JPEG"):
        return "JPEG"
    if fmt in ("PNG", "WEBP"):
        return fmt
    return "PNG"


def _validate_image_bytes(content: bytes) -> tuple[str, int, int]:
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.verify()
        with Image.open(io.BytesIO(content)) as img:
            fmt = _normalize_format(img.format or "PNG")
            return fmt, img.width, img.height
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image file: {exc}") from exc


def _load_image(path: Path) -> Image.Image:
    try:
        img = Image.open(path)
        img.load()
        return img
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to open image: {exc}") from exc


def _apply_crop(img: Image.Image, crop: CropSpec) -> Image.Image:
    w, h = img.size
    if crop.x + crop.width > w or crop.y + crop.height > h:
        raise HTTPException(status_code=400, detail="Crop region exceeds image bounds")
    box = (crop.x, crop.y, crop.x + crop.width, crop.y + crop.height)
    return img.crop(box)


def _apply_resize(img: Image.Image, resize: ResizeSpec) -> Image.Image:
    target_w = resize.width
    target_h = resize.height
    if not target_w and not target_h:
        return img

    src_w, src_h = img.size
    if resize.maintain_aspect:
        if target_w and not target_h:
            target_h = max(1, round(src_h * target_w / src_w))
        elif target_h and not target_w:
            target_w = max(1, round(src_w * target_h / src_h))
        elif target_w and target_h:
            ratio = min(target_w / src_w, target_h / src_h)
            target_w = max(1, round(src_w * ratio))
            target_h = max(1, round(src_h * ratio))
    else:
        target_w = target_w or src_w
        target_h = target_h or src_h

    return img.resize((target_w, target_h), Image.Resampling.LANCZOS)


def _save_image(img: Image.Image, path: Path, fmt: str, quality: int) -> None:
    save_kwargs: Dict[str, Any] = {}
    out_fmt = _normalize_format(fmt)
    if out_fmt == "JPEG":
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        save_kwargs["quality"] = quality
        save_kwargs["optimize"] = True
    elif out_fmt == "WEBP":
        save_kwargs["quality"] = quality
    elif out_fmt == "PNG":
        save_kwargs["optimize"] = True
    img.save(path, format=out_fmt, **save_kwargs)


def _delete_asset_files(asset: ImageAsset) -> None:
    src = Path(asset.file_path)
    if src.exists():
        src.unlink()
    if asset.last_output and asset.last_output.get("path"):
        out = Path(asset.last_output["path"])
        if out.exists():
            out.unlink()
    out_dir = OUTPUT_DIR / str(asset.id)
    if out_dir.exists():
        shutil.rmtree(out_dir)


@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}

    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}

    return {"status": "unknown_action", "action": action, "data": current_data}


@router.post("/images/upload")
def upload_image(file: UploadFile = File(None), db: Session = Depends(get_db)):
    if file is None:
        return {"message": "No file provided. Send an image in the 'file' field."}

    filename = file.filename or "image.png"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    fmt, width, height = _validate_image_bytes(content)

    unique_name = f"{uuid.uuid4().hex}_{filename}"
    file_path = UPLOAD_DIR / unique_name
    with open(file_path, "wb") as f:
        f.write(content)

    asset = ImageAsset(
        filename=filename,
        file_path=str(file_path),
        file_size=len(content),
        format=fmt,
        width=width,
        height=height,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    logger.info(f"[Routes] Uploaded image: {filename} ({width}x{height})")
    return asset.to_dict()


@router.get("/images")
def list_images(db: Session = Depends(get_db)):
    assets = db.query(ImageAsset).order_by(ImageAsset.uploaded_at.desc()).all()
    return [a.to_dict() for a in assets]


@router.get("/images/{image_id}")
def get_image(image_id: int, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == image_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Image not found")
    return asset.to_dict()


@router.delete("/images/{image_id}")
def delete_image(image_id: int, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == image_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Image not found")

    _delete_asset_files(asset)
    db.delete(asset)
    db.commit()
    logger.info(f"[Routes] Deleted image: {image_id}")
    return {"status": "deleted", "id": image_id}


@router.get("/images/{image_id}/preview")
def preview_image(image_id: int, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == image_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Image not found")

    path = Path(asset.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing on disk")

    mime = FORMAT_MIME.get(asset.format, "application/octet-stream")
    return FileResponse(str(path), media_type=mime, filename=asset.filename)


@router.post("/images/{image_id}/transform")
def transform_image(image_id: int, request: TransformRequest, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == image_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Image not found")

    src_path = Path(asset.file_path)
    if not src_path.exists():
        raise HTTPException(status_code=404, detail="Source image missing on disk")

    img = _load_image(src_path)

    if request.crop:
        img = _apply_crop(img, request.crop)

    if request.resize:
        img = _apply_resize(img, request.resize)

    out_fmt = _normalize_format(request.format)
    out_dir = OUTPUT_DIR / str(image_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    stem = Path(asset.filename).stem
    out_name = f"{stem}_edited{FORMAT_EXT[out_fmt]}"
    out_path = out_dir / out_name

    _save_image(img, out_path, out_fmt, request.quality)
    out_size = out_path.stat().st_size
    out_w, out_h = img.size

    original_size = asset.last_output["size"] if asset.last_output else asset.file_size
    pct_smaller = round((1 - out_size / original_size) * 100, 1) if original_size else 0

    output_meta = {
        "path": str(out_path),
        "filename": out_name,
        "size": out_size,
        "format": out_fmt,
        "width": out_w,
        "height": out_h,
    }
    asset.last_output = output_meta
    db.commit()
    db.refresh(asset)

    logger.info(f"[Routes] Transformed image {image_id} -> {out_name}")
    return {
        "image_id": image_id,
        "output": output_meta,
        "percent_smaller": pct_smaller,
    }


@router.get("/images/{image_id}/download")
def download_image(image_id: int, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == image_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Image not found")
    if not asset.last_output or not asset.last_output.get("path"):
        raise HTTPException(status_code=404, detail="No processed output available. Run transform first.")

    out_path = Path(asset.last_output["path"])
    if not out_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing on disk")

    fmt = asset.last_output.get("format", "PNG")
    mime = FORMAT_MIME.get(fmt, "application/octet-stream")
    filename = asset.last_output.get("filename", out_path.name)
    return FileResponse(str(out_path), media_type=mime, filename=filename)


@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None,
            "visibleText": [],
            "inputValues": {},
            "componentState": {},
            "currentView": None,
            "viewport": {},
            "timestamp": None,
            "status": "no_snapshot",
        }
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)

    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport

    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {
            "imageData": None,
            "width": None,
            "height": None,
            "timestamp": None,
            "status": "no_screenshot",
        }
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)

    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()

    db.commit()
    db.refresh(screenshot)
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}
