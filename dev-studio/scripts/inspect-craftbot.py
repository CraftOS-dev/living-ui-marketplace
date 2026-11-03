"""Execute CraftBot's real classifier without modifying or launching the host."""
import json
import pathlib
import sys
import hashlib
root = pathlib.Path(sys.argv[1]).resolve()
app_path = pathlib.Path(sys.argv[2]).resolve()
sys.path.insert(0, str(root))
from app.agent_app.manager import AgentAppManager
manifest = json.loads((app_path / "manifest.json").read_text(encoding="utf-8-sig"))
detected = AgentAppManager._find_project_root(app_path)
source = root / "app/agent_app/manager.py"
print(json.dumps({
    "nativeCompatible": detected == app_path,
    "frameworkFormat": manifest.get("agentAppVersion"),
    "detectedNativeRoot": str(detected) if detected else None,
    "classifier": str(source),
    "classifierSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "reason": "CraftBot native import accepted the new-framework package." if detected == app_path else
      "CraftBot's native importer only recognises agentAppVersion == 2; the new framework emits 0.1.0. Native import would enter foreign-app adoption.",
    "nextStep": "Verify host launch and an agent round trip." if detected == app_path else
      "Add official new-framework import/task-bridge support in CraftBot, then repeat installation and round trip. Do not relabel this manifest as version 2.",
}))
