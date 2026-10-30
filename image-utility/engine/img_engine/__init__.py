"""Image Utility's engine: renders an image's edit stack, exports it in any
format and answers questions about its pixels. Runs in the app's embedded
Python (engine/python/img-engine.exe) with Pillow, NumPy, oxipng and the
MozJPEG optimizer, plus onnxruntime when the background add-on is installed.
"""

ENGINE_VERSION = "1.0.0"
