# Image engine: third-party software

The image engine in `engine/` runs third-party software, unmodified, as
separate files. The app's own engine code is `engine/img_engine/`. Nothing
below ships with the app: `pb/pb_hooks/lib_setup.js` downloads each piece
from its official source on first run (or when the person installs a
background-removal model), pinned by URL, size and SHA-256.

## The engine (downloaded on first run)

| Component | Version | Where | License | Text |
|-----------|---------|-------|---------|------|
| CPython (Windows embeddable package) | 3.11.9 | `python/` (`img-engine.exe` is the package's `python.exe`, renamed so the app can tell its engine process apart) | PSF License 2.0 | `Python-PSF-LICENSE.txt` |
| NumPy (with its bundled OpenBLAS) | 2.4.6 | `site-packages/numpy/`, `site-packages/numpy.libs/` | BSD-3-Clause, and the licenses its LICENSE file lists for bundled code | `numpy-LICENSE.txt` |
| Pillow | 13.0.0 | `site-packages/PIL/` | MIT-CMU (HPND) | `Pillow-LICENSE.txt` |
| pyoxipng (Python bindings to oxipng, the PNG optimizer) | 9.1.1 | `site-packages/oxipng/` | MIT (oxipng itself: MIT) | `pyoxipng-MIT-LICENSE.txt` |
| mozjpeg-lossless-optimization (MozJPEG's lossless Huffman optimization) | 1.3.2 | `site-packages/mozjpeg_lossless_optimization/` | BSD-3-Clause; the MozJPEG / libjpeg-turbo code it contains: IJG License, BSD-3-Clause, zlib License | `mozjpeg-lossless-optimization-LICENSE.txt` |
| cffi (needed by the above) | 2.1.1 | `site-packages/cffi/`, `site-packages/_cffi_backend.*.pyd` | MIT | `cffi-LICENSE.txt` |

### Libraries inside the official Pillow 13.0.0 Windows wheel

Pillow's own build compiles these into its extension modules (`PIL/*.pyd`).
The engine uses them through Pillow. `Pillow-LICENSE.txt` carries their
license texts as the Pillow project ships them.

| Library | Version | License |
|---------|---------|---------|
| libjpeg-turbo | 3.2.0 | IJG License and BSD-3-Clause |
| libpng | 1.6.58 | PNG Reference Library License |
| zlib-ng | 2.3.3 | zlib License |
| libtiff | 4.7.2 | LibTIFF License |
| libwebp | 1.6.0 | BSD-3-Clause |
| libavif, with the dav1d and aom AV1 codecs Pillow's build links | 1.4.2 | BSD-2-Clause (see the libavif section of `Pillow-LICENSE.txt`) |
| OpenJPEG | 2.5.4 | BSD-2-Clause |
| Little CMS 2 | 2.19.1 | MIT |
| FreeType | 2.14.3 | FreeType License (FTL) |
| HarfBuzz and raqm | 14.5.0, 0.11.0 | MIT |
| Brotli | 1.2.0 | MIT |
| XZ Utils (liblzma) | 5.8.4 | 0BSD |
| FriBiDi, through Pillow's fribidi shim (right-to-left text layout) | 1.0.16 | GNU LGPL 2.1 or later |

Pillow's software bill of materials also lists libimagequant (GPL 3.0) and
libxcb; neither is part of the Windows wheel (`PIL.features` reports them as
not available), and the engine never quantizes with libimagequant.

FriBiDi is LGPL: it is part of the unmodified Pillow wheel, downloaded from
PyPI on this computer. It can be replaced by installing another build of
Pillow 13.0.0 in its place. FriBiDi's source code:
https://github.com/fribidi/fribidi (tag v1.0.16). Pillow's build scripts:
https://github.com/python-pillow/Pillow (tag 13.0.0, `winbuild/`).

## Background removal (downloaded only when the person installs it)

| Component | Version | Where | License | Text |
|-----------|---------|-------|---------|------|
| ONNX Runtime (CPU) | 1.31.1 | `site-packages/onnxruntime/` | MIT, with the notices it ships for the code it includes | `onnxruntime-MIT-LICENSE.txt`, `onnxruntime-ThirdPartyNotices.txt` |
| U^2-Net, small model (`u2netp.onnx`, the ONNX export published by the rembg project) | rembg release v0.0.0 | `models/u2netp.onnx` | Apache 2.0 (U^2-Net, Xuebin Qin et al.) | `Apache-2.0.txt` |
| IS-Net / DIS, general model (`isnet-general-use.onnx`, rembg's export) | rembg release v0.0.0 | `models/isnet-general-use.onnx` | Apache 2.0 (DIS, Xuebin Qin et al.) | `Apache-2.0.txt` |

The models are always named explicitly. rembg's own default model
(BRIA RMBG) is under a non-commercial license and is never downloaded or
used. Model sources: https://github.com/xuebinqin/U-2-Net and
https://github.com/xuebinqin/DIS; the exports:
https://github.com/danielgatis/rembg/releases/tag/v0.0.0.

## Not used, on purpose

- pillow-heif (HEIC/HEIF, GPL 2.0 through libheif's x265 build) and
  pillow-jxl-plugin (JPEG XL, GPL 3.0 build): HEIC and JPEG XL are not
  read or written. HEIC photos can be exported as JPEG from the phone or
  Windows Photos first.
- libimagequant / pngquant (GPL 3.0): PNG palettes use Pillow's own
  quantizer and oxipng.

## How the engine folder is assembled

The app does this itself (`pb/pb_hooks/lib_setup.js`), from the downloads
pinned there; each one is checked (size, SHA-256) before it is unpacked,
with Windows' own curl.exe, certutil.exe and tar.exe. The PyPI wheels are
unpacked as they are, which is what `pip install --target` puts in place
apart from pip's own bookkeeping files.

1. The CPython 3.11.9 Windows embeddable package (amd64) from python.org,
   unzipped into `python/`; `python.exe` written as `img-engine.exe`
   (`python.exe` and `pythonw.exe` are not used and not kept).
2. `python/python311._pth` lists `python311.zip`, `.`, `..\site-packages`
   and `..` (the last makes `img_engine` importable).
3. The packages in `site-packages/`, the same set as `pip install --target
   site-packages numpy==2.4.6 pillow==13.0.0 pyoxipng==9.1.1
   mozjpeg-lossless-optimization==1.3.2` with a matching CPython 3.11: the
   cp311 win_amd64 wheels of those and cffi 2.1.1 (a dependency of
   mozjpeg-lossless-optimization).
4. Background removal, when installed: the onnxruntime 1.31.1 cp311
   win_amd64 wheel into `site-packages/`, and the model files into
   `models/`.
