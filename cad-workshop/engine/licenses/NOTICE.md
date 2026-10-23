# Geometry engine: third-party software

The geometry engine in `engine/` runs third-party software, unmodified, as
separate files. The app's own engine code is `engine/cad_engine/`.

| Component | Version | Where | License | Text |
|-----------|---------|-------|---------|------|
| CPython (Windows embeddable package) | 3.11.9 | `python/` (`cad-engine.exe` is the package's `python.exe`, renamed so the app can tell its engine process apart) | PSF License 2.0 | `Python-PSF-LICENSE.txt` |
| Open CASCADE Technology (OCCT), the geometry kernel | 8.0.1 | `site-packages/cadquery_ocp_novtk.libs/TK*.dll` | GNU LGPL 2.1 with the Open CASCADE exception 1.0 | `OpenCascade-LGPL-2.1.txt`, `OpenCascade-LGPL-exception.txt` |
| OCP, the Python bindings to OCCT (wheel `cadquery-ocp-novtk`, with `cadquery-ocp-proxy`) | 8.0.1.1.0 | `site-packages/OCP/`, `site-packages/cadquery_ocp_proxy/` | Apache 2.0 | `OCP-Apache-2.0.txt` |
| NumPy (with its bundled OpenBLAS) | 2.4.6 | `site-packages/numpy/`, `site-packages/numpy.libs/` | BSD-3-Clause, and the licenses its LICENSE file lists for bundled code | `numpy-LICENSE.txt` |
| Pillow | 12.3.0 | `site-packages/PIL/` | MIT-CMU (HPND) | `Pillow-LICENSE.txt` |

## Libraries bundled with the OCP wheel

The wheel carries these DLLs (in `site-packages/cadquery_ocp_novtk.libs/`)
for OCCT's image, font and compression support. The engine does not call
them itself. Each keeps its upstream project's license:

| Library | Files | License |
|---------|-------|---------|
| FreeImage | `FreeImage.dll` | FreeImage Public License 1.0, or GPL 2.0 / 3.0 |
| FreeType | `freetype.dll` | FreeType License (FTL), or GPL 2.0 |
| libjpeg | `jpeg8.dll` | IJG License |
| libpng | `libpng16.dll` | libpng License |
| LibTIFF | `tiff.dll` | LibTIFF License |
| libwebp | `libwebp.dll`, `libwebpmux.dll`, `libsharpyuv.dll` | BSD-3-Clause |
| OpenJPEG | `openjp2.dll` | BSD-2-Clause |
| OpenJPH | `openjph.dll` | BSD-2-Clause |
| OpenEXR and Imath | `OpenEXR.dll`, `OpenEXRCore.dll`, `Iex.dll`, `IlmThread.dll`, `Imath.dll` | BSD-3-Clause |
| LibRaw | `raw.dll` | LGPL 2.1, or CDDL 1.0 |
| Little CMS | `lcms2.dll` | MIT |
| LERC | `Lerc.dll` | Apache 2.0 |
| libdeflate | `deflate.dll` | MIT |
| zlib | `zlib.dll` | zlib License |
| Zstandard | `zstd.dll` | BSD-3-Clause, or GPL 2.0 |
| XZ Utils (liblzma) | `liblzma.dll` | 0BSD (public domain in older releases) |
| Microsoft Visual C++ runtime | `msvcp140.dll`, `vcomp140.dll` (and `vcruntime140*.dll` in `python/`) | Microsoft Visual C++ Redistributable license |

## LGPL notes (OCCT, LibRaw)

- These libraries are used as unmodified shared libraries (DLLs), loaded at
  run time. Any of them can be replaced with a compatible build of the same
  version by swapping its DLL file.
- OCCT's source code: https://github.com/Open-Cascade-SAS/OCCT (tag V8_0_1).
  OCP's source code: https://github.com/CadQuery/OCP. LibRaw's source code:
  https://github.com/LibRaw/LibRaw.

## How the engine folder is assembled

The app does this itself on first run (`pb/pb_hooks/lib_setup.js`), from
the official downloads pinned there by URL, size and SHA-256 (the PyPI
wheels are unpacked as they are, which is what `pip install --target` puts
in place apart from pip's own bookkeeping files):

1. The CPython 3.11.9 Windows embeddable package (amd64) from python.org,
   unzipped into `python/`; `python.exe` renamed to `cad-engine.exe`
   (`pythonw.exe` is not used and removed).
2. `python/python311._pth` lists `python311.zip`, `.`, `..\site-packages`
   and `..` (the last makes `cad_engine` importable).
3. The packages in `site-packages/`, the same set as `pip install --target
   site-packages cadquery-ocp-novtk==8.0.1.1.0 numpy==2.4.6 pillow==12.3.0`
   with a matching CPython 3.11: the cp311 win_amd64 wheels of those three
   and cadquery-ocp-proxy 8.0.1.1.0 (a dependency of cadquery-ocp-novtk).
