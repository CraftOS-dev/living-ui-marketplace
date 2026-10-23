"""CAD Workshop geometry engine.

Builds parts from a typed feature tree with the OpenCascade (OCCT 8) kernel,
names every face and edge by the feature that made it, and answers
measurement, export and render jobs. It runs as one long-lived process next
to the app's PocketBase; jobs arrive as JSON files (see server.py).
"""

ENGINE_VERSION = "1"
