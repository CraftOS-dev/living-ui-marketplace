// Format the existing credential-free Node commands for the user's shell.
// Older running Studio instances return JSON-quoted Windows paths; decode those
// arguments before shell quoting so copied paths don't contain doubled slashes.
export function terminalCommand(command) {
  const parts = /^node\s+("(?:\\.|[^"\\])*")\s+("(?:\\.|[^"\\])*")(.*)$/.exec(command || "");
  if (!parts) return { text: command || "", shell: "Terminal" };
  const script = JSON.parse(parts[1]), root = JSON.parse(parts[2]);
  const windows = /^[a-z]:[\\/]/i.test(root);
  const quote = value => windows
    ? "'" + value.replaceAll("\\", "/").replaceAll("'", "''") + "'"
    : "'" + value.replaceAll("'", "'\\''") + "'";
  return { text: `node ${quote(script)} ${quote(root)}${parts[3]}`, shell: windows ? "PowerShell" : "Terminal" };
}
