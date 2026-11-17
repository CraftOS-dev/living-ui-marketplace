# OpenSEO — Tasks

- [x] T-1 (Constraints): Pin OpenSEO v0.1.27 by tag, commit and SHA-256 (`upstream.json`). Download, verify and unpack it unchanged (`sidecar/upstream.mjs`).
- [x] T-2 (System Overview): Toolkit `blueprint-mcp-sidecar`: pipeline, sidecar server, MCP client, child guard, gate check, vendored adapter.
- [x] T-3 (F-FRM-1, F-FRM-2): Pass OpenSEO's UI, API, WebSockets and `/mcp` through on the app's port.
- [x] T-4 (F-FRM-3, F-RNK-2): Start OpenSEO with `vite preview` on loopback, apply migrations when new, and run its own scheduler loop. Answer health once ready.
- [x] T-5 (Operations Design): Map all 84 OpenSEO tools to operations of the same name. Generate params from OpenSEO's schemas. Approval on deletions, public sharing and recurring charges.
- [x] T-6 (Quality of Life): Convert plain-string lists, numbers and booleans by each tool's schema.
- [x] T-7 (F-SET-1, F-SET-2): `app.status` and `app.set_keys`, with keys in `data/settings.env` and an OpenSEO restart on change.
- [x] T-8 (Q12): Keep OpenSEO's state in `data/openseo-state` (linked), so it survives release updates.
- [x] T-9 (Introduction): Credit OpenSEO in the README, NOTICE (MIT text), AGENT_APP.md, catalogue entry and status output.
- [x] T-10 (Q13): Gate: framework files, `sidecar/check.mjs`, describe budget measured on the running app.
- [x] T-11 (Features): CLI-only agent trial through `a2app` across every module.
- [x] T-12 (F-APP-1): `app.guide`: compact overview with live setup state, and OpenSEO's 12 skills as `--topic` playbooks.
- [x] T-13 (F-KW-6, Q13): Bounded results: text view by default with a reported cut, `--view full|data`. Errors answer 409/404 with the recovery in the message.
- [x] T-14 (F-SET-2): Clear OpenSEO's dashboard refresh back-offs when keys change.
