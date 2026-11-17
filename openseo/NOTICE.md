# Notice

This app runs **OpenSEO** (https://openseo.so, https://github.com/every-app/open-seo), made by Ben Senescu and Every App, Inc.

OpenSEO is not modified, and is not redistributed in this folder. The install step downloads the authors' own release archive (`v0.1.27`, SHA-256 `369570b1c8c1bb6a54408b2a42fa53d1f08f7e3a00a32ace2b7c542cd4086dfb`) from GitHub and unpacks it into `upstream/`, together with its own `LICENSE`.

OpenSEO's licence:

```
MIT License

Copyright (c) 2026 Ben Senescu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**What this folder adds** (marketplace code, MIT):
- `sidecar/`: the Agent App sidecar (toolkit `blueprint-mcp-sidecar`), with the pinned `@a2app` adapter packages;
- `a2app/`: how to install, build and start OpenSEO, and the map from OpenSEO's MCP tools to agent operations;
- the framework files: `manifest.json`, `operations.json`, `AGENT_APP.md` and `reference/`.

The operation descriptions in `AGENT_APP.md` are OpenSEO's own tool descriptions, quoted under its licence.
