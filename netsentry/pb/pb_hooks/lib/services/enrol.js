/**
 * Rolling monitors out to many machines (plan §4.2 S5, §10.2 step 9).
 *
 * - Join tokens: an admin makes one (time-limited, capped, revocable); a new
 *   monitor swaps it for its own credential on first start (POST /api/netsentry/join).
 *   It can only create monitors — never read anything.
 * - The console serves the monitor's own code (text files) and an install script,
 *   so one command sets a Linux machine up: by hand, from Ansible, or cloud-init.
 *   (D11: nothing here writes to a cloud.)
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const { OpError } = require('../core/util.js');

const PREFIX = 'nsj1';

/** The configured address machines use to reach this console ('' until an admin sets it). */
function consoleUrl(app) {
  const s = repo.first(app, 'settings', 'id != ""');
  return s ? s.getString('console_url') : '';
}

/** Single-quote a value for a POSIX shell. */
function shq(v) {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

function hash(secret) {
  return $security.sha256(String(secret));
}

function createJoinToken(app, actor, p) {
  const label = String(p.label || '').trim().slice(0, 120) || 'Rollout';
  const days = p.days === undefined || p.days === '' ? 7 : Number(p.days);
  const maxUses = p.max_uses === undefined || p.max_uses === '' ? 25 : Number(p.max_uses);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new OpError(400, 'days must be 1–30.');
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) throw new OpError(400, 'max_uses must be 1–1000.');
  const secret = $security.randomString(40);
  const rec = repo.create(app, 'join_tokens', {
    label, token_hash: hash(secret), expires_at: new Date(Date.now() + days * 86400000).toISOString(), max_uses: maxUses, uses: 0, revoked: false,
    created_by: actor.label || actor.type,
  });
  audit.append(app, actor, 'join_token.created', { collection: 'join_tokens', id: rec.id }, `Made a join token "${label}" (${maxUses} servers, ${days} days)`, null);
  return { ok: true, join_token_id: rec.id, token: `${PREFIX}.${rec.id}.${secret}`, message: 'Copy it now — it is shown only once.' };
}

function revokeJoinToken(app, actor, p) {
  const rec = repo.byId(app, 'join_tokens', String(p.join_token_id || ''));
  if (!rec) throw new OpError(404, 'Join token not found.');
  repo.update(app, rec, { revoked: true });
  audit.append(app, actor, 'join_token.revoked', { collection: 'join_tokens', id: rec.id }, `Revoked join token "${rec.getString('label')}"`, null);
  return { ok: true };
}

/** Public: a new monitor presents a join token and gets its own credential. Same answer for every bad token. */
function join(app, token, name) {
  const refuse = new OpError(403, 'This join token is not valid (wrong, expired, used up or revoked).');
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw refuse;
  const rec = repo.byId(app, 'join_tokens', parts[1]);
  if (!rec || rec.getString('token_hash') !== hash(parts[2])) throw refuse;
  if (rec.getBool('revoked') || repo.isoOf(rec, 'expires_at') < repo.nowIso() || rec.getInt('uses') >= rec.getInt('max_uses')) throw refuse;
  // v4 §16 (N-B32): the server NetSentry already knows (same hostname) is RE-connected, not added again:
  // its monitor record — name, history, apps — gets a new key, and the old key stops working. (A monitor
  // enrolled with another NetSentry, or whose key was lost, comes back as itself.)
  const host = String(name || '').trim().toLowerCase();
  const same = host ? repo.find(app, 'sensors', 'status != "revoked"').find((s) => s.getString('hostname').toLowerCase() === host) : null;
  if (same) {
    const password = $security.randomString(40);
    same.setPassword(password);
    same.set('joined_with', rec.id);
    app.save(same);
    repo.update(app, rec, { uses: rec.getInt('uses') + 1, last_used: repo.nowIso() });
    audit.append(app, { type: 'system', id: '', label: `join token "${rec.getString('label')}"`, role: '' }, 'sensor.rekeyed',
      { collection: 'sensors', id: same.id }, `Reconnected the monitor "${same.getString('name')}" with a new key`, null);
    return { ok: true, token: `ns1.${same.getString('email').split('@')[0]}.${password}`, name: same.getString('name'), reconnected: true };
  }
  let base = String(name || '').trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 70) || 'machine';
  const taken = (n) => repo.find(app, 'sensors', 'status != "revoked"').some((s) => s.getString('name').toLowerCase() === n.toLowerCase());
  let unique = base;
  for (let i = 2; taken(unique) && i < 100; i++) unique = `${base}-${i}`;
  const actor = { type: 'system', id: '', label: `join token "${rec.getString('label')}"`, role: '' };
  const out = require('./sensors.js').register(app, actor, { name: unique });
  const s = repo.byId(app, 'sensors', out.sensor_id);
  if (s) repo.update(app, s, { joined_with: rec.id });
  repo.update(app, rec, { uses: rec.getInt('uses') + 1, last_used: repo.nowIso() });
  return { ok: true, token: out.token, name: unique };
}

function sensorRoot() {
  const hooks = String(__hooks).replace(/[\\/]+$/, '');
  return $filepath.join($filepath.dir($filepath.dir(hooks)), 'sensor');
}

let cachedVersion = null;

/** The monitor version this console ships (sensor/netsentry_sensor/__init__.py), '' if unreadable. */
function sensorVersion() {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const text = toString($os.readFile($filepath.join(sensorRoot(), 'netsentry_sensor', '__init__.py')));
    const m = /__version__\s*=\s*["']([0-9.]+)["']/.exec(text);
    cachedVersion = m ? m[1] : '';
  } catch {
    cachedVersion = '';
  }
  return cachedVersion;
}

/** Every text file the monitor needs (its package + pyproject), path → content. */
function sensorFiles() {
  const root = sensorRoot();
  const files = {};
  const walk = (rel) => {
    for (const entry of $os.readDir($filepath.join(root, rel))) {
      const name = entry.name();
      if (name === '__pycache__' || name.indexOf('.') === 0) continue;
      const path = rel ? `${rel}/${name}` : name;
      if (entry.isDir()) walk(path);
      else if (/\.(py|toml|md)$/.test(name)) files[path] = toString($os.readFile($filepath.join(root, path)));
    }
  };
  walk('netsentry_sensor');
  for (const f of ['pyproject.toml', 'README.md']) {
    try {
      files[f] = toString($os.readFile($filepath.join(root, f)));
    } catch (_) {
      /* optional */
    }
  }
  return files;
}

/** The Linux install script (systemd). Console URL from the request; the join token comes from the environment. */
function installScript(consoleAddress) {
  const url = String(consoleAddress).replace(/\/+$/, '');
  return `#!/bin/sh
# NetSentry monitor — install (or update) on a Linux server (systemd). Run as root:
#   curl -fsSL ${url}/api/netsentry/sensor/install.sh | sudo NETSENTRY_JOIN=nsj1.… sh
# Run it again later to UPDATE the monitor: the server keeps its identity and settings.
#
# It installs the monitor's code to /opt/netsentry/sensor, enrols this server once (the join
# token is swapped for this server's own credential and not kept), and starts it as a service.
#
# Changes: NetSentry can restart apps, update them safely, back them up and install new ones —
# only if YOU allow it here, on this server (the console can never switch it on). Answer the
# question, or set NETSENTRY_MANAGE=yes (or no). Every change still needs a person to confirm it.
#
# Terminal: an admin can open a shell on this server from NetSentry (password asked again, recorded,
# closes when idle) — only if YOU allow it here. It runs as the account that ran this installer with
# sudo, never root unless you set NETSENTRY_TERMINAL_USER=root. Answer, or set NETSENTRY_TERMINAL=yes (or no).
set -eu
CONSOLE=${shq(url)}
STATE=/var/lib/netsentry-sensor
UNIT=/etc/systemd/system/netsentry-sensor.service
command -v python3 >/dev/null 2>&1 || { echo "python3 is required (apt install python3 / dnf install python3)"; exit 1; }
if [ ! -s "$STATE/token" ] && [ -z "\${NETSENTRY_JOIN:-}" ]; then
  echo "Set NETSENTRY_JOIN to a join token from NetSentry (Settings -> Monitor)."; exit 1
fi
DEST=/opt/netsentry/sensor
mkdir -p "$DEST"
curl -fsSL "$CONSOLE/api/netsentry/sensor/files" | python3 -c '
import json, os, sys
dest = sys.argv[1]
for path, text in json.load(sys.stdin)["files"].items():
    full = os.path.join(dest, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)
' "$DEST"
mkdir -p "$STATE"
chmod 700 "$STATE"
if [ -s "$STATE/token" ] && [ -n "\${NETSENTRY_JOIN:-}" ]; then
  echo "Reconnecting this monitor with the one-time code (it keeps its name and history in NetSentry)."
  cd "$DEST" && python3 -m netsentry_sensor enrol --replace --console "$CONSOLE" --join "$NETSENTRY_JOIN" --name "$(hostname)" || exit 1
elif [ -s "$STATE/token" ]; then
  echo "Already enrolled: updating the monitor's code only."
else
  cd "$DEST" && python3 -m netsentry_sensor enrol --console "$CONSOLE" --join "$NETSENTRY_JOIN" --name "$(hostname)"
fi
# Changes on this server: the answer given before is kept unless NETSENTRY_MANAGE says otherwise.
MANAGE="\${NETSENTRY_MANAGE:-}"
if [ -z "$MANAGE" ] && [ -f "$UNIT" ]; then
  grep -q '^Environment=NETSENTRY_EXECUTOR=on' "$UNIT" && MANAGE=yes || MANAGE=no
fi
if [ -z "$MANAGE" ] && [ -r /dev/tty ]; then
  printf 'Let NetSentry make changes on this server when a person confirms them (restart and update apps, back them up, install new ones)? [y/N] ' > /dev/tty
  read -r answer < /dev/tty || answer=n
  case "$answer" in y|Y|yes|YES) MANAGE=yes ;; *) MANAGE=no ;; esac
fi
EXECUTOR=""
[ "$MANAGE" = "yes" ] && EXECUTOR="Environment=NETSENTRY_EXECUTOR=on"
# The terminal on this server: the answer given before is kept unless NETSENTRY_TERMINAL says otherwise.
TERMINAL="\${NETSENTRY_TERMINAL:-}"
TUSER="\${NETSENTRY_TERMINAL_USER:-}"
if [ -f "$UNIT" ]; then
  [ -z "$TERMINAL" ] && { grep -q '^Environment=NETSENTRY_TERMINAL=on' "$UNIT" && TERMINAL=yes || TERMINAL=no; }
  [ -z "$TUSER" ] && TUSER=$(sed -n 's/^Environment=NETSENTRY_TERMINAL_USER=//p' "$UNIT" | head -1)
fi
if [ -z "$TERMINAL" ] && [ -r /dev/tty ]; then
  printf 'Let NetSentry admins open a terminal on this server (password asked again, recorded, closes when idle)? [y/N] ' > /dev/tty
  read -r answer < /dev/tty || answer=n
  case "$answer" in y|Y|yes|YES) TERMINAL=yes ;; *) TERMINAL=no ;; esac
fi
[ -z "$TUSER" ] && TUSER="\${SUDO_USER:-}"
TERMLINES=""
if [ "$TERMINAL" = "yes" ]; then
  if [ -z "$TUSER" ] || ! id "$TUSER" >/dev/null 2>&1; then
    echo "The terminal needs an account to run as: set NETSENTRY_TERMINAL_USER (run this with sudo from your own account). Terminal: off."
    TERMINAL=no
  else
    TERMLINES="Environment=NETSENTRY_TERMINAL=on
Environment=NETSENTRY_TERMINAL_USER=$TUSER"
  fi
fi
cat > "$UNIT" <<UNITFILE
[Unit]
Description=NetSentry monitor
After=network-online.target
[Service]
Environment=NETSENTRY_CONSOLE=$CONSOLE
$EXECUTOR
$TERMLINES
ExecStart=/usr/bin/env python3 -m netsentry_sensor run
WorkingDirectory=$DEST
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNITFILE
systemctl daemon-reload
systemctl enable netsentry-sensor >/dev/null 2>&1 || true
systemctl restart netsentry-sensor
if [ "$MANAGE" = "yes" ]; then
  echo "NetSentry monitor running on $(hostname). Changes: ALLOWED here (each one still needs a person to confirm it)."
else
  echo "NetSentry monitor running on $(hostname). Changes: not allowed here (run this again with NETSENTRY_MANAGE=yes to allow them)."
fi
if [ "$TERMINAL" = "yes" ]; then
  echo "Terminal: ALLOWED here for NetSentry admins, as $TUSER (recorded)."
else
  echo "Terminal: not allowed here (run this again with NETSENTRY_TERMINAL=yes to allow it)."
fi
`;
}

// Python for the Windows monitor: python.org's own embeddable package, pinned to its hash
// (checked against python.org's published checksum on 2026-10-01). Nothing else is installed.
const WIN_PYTHON = {
  url: 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
  sha256: '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3',
  pth: 'python312._pth',
};

/** PowerShell single-quoted string. */
function psq(v) {
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** Windows: install (or update) the monitor as a startup task running as SYSTEM. Run in an administrator PowerShell. */
/** Windows PowerShell 5.1 reads a script without a byte-order mark as ANSI: keep it ASCII. */
function asciiOnly(text) {
  return String(text).replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

function installPs1(consoleAddress) {
  const url = String(consoleAddress).replace(/\/+$/, '');
  return asciiOnly(`# NetSentry monitor - install (or update) on Windows 10/11 or Windows Server. In an ADMINISTRATOR PowerShell:
#   $env:NETSENTRY_JOIN='nsj1....'; irm ${url}/api/netsentry/sensor/install.ps1 | iex
# Run it again later to UPDATE the monitor: the server keeps its identity and settings.
# Uninstall:  $env:NETSENTRY_UNINSTALL='yes'; irm ${url}/api/netsentry/sensor/install.ps1 | iex
#
# It puts python.org's embeddable Python (checked against its pinned hash) and the monitor's code in
# C:\\Program Files\\NetSentry, keeps the server's credential in C:\\ProgramData\\NetSentrySensor (SYSTEM and
# Administrators only), and starts the monitor at boot as a scheduled task running as SYSTEM.
#
# Changes: NetSentry can restart services and apps, update apps safely, back them up - only if YOU allow
# it here (the console can never switch it on). Answer the question, or set $env:NETSENTRY_MANAGE='yes' (or 'no').
$ErrorActionPreference = 'Stop'
$Console = ${psq(url)}
$Root = Join-Path $env:ProgramFiles 'NetSentry'
$Py = Join-Path $Root 'python'
$Code = Join-Path $Root 'sensor'
$State = Join-Path $env:ProgramData 'NetSentrySensor'
$Task = 'NetSentry monitor'
# Windows PowerShell 5.1 turns a native command's error output into a stopping error: commands that may
# legitimately fail ("no such task yet") run through this instead.
function Quiet([string]$exe, [string[]]$argv) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; & $exe @argv 2>&1 | Out-Null; $ErrorActionPreference = $old }
# Stop the running monitor: the task, and the exact process it recorded (it runs as SYSTEM, so it can't be found by its path).
function StopMonitor { Quiet schtasks.exe @('/End', '/TN', $Task); $pidFile = Join-Path $State 'monitor.pid'; if (Test-Path $pidFile) { Quiet taskkill.exe @('/F', '/T', '/PID', (Get-Content $pidFile -Raw).Trim()); Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2 }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this in an administrator PowerShell (right-click -> Run as administrator).' }
if ($env:NETSENTRY_UNINSTALL -eq 'yes') {
  StopMonitor
  Quiet schtasks.exe @('/Delete', '/TN', $Task, '/F')
  # Windows lets go of a stopped program's files a moment later: try for up to 15 seconds.
  for ($i = 0; $i -lt 15 -and ((Test-Path $Root) -or (Test-Path $State)); $i++) {
    Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $State -ErrorAction SilentlyContinue
    if ((Test-Path $Root) -or (Test-Path $State)) { Start-Sleep -Seconds 1 }
  }
  if (Test-Path $Root) { $left = (Get-ChildItem -Recurse -File $Root -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { $_.FullName }) -join ', '; throw "Could not remove $Root completely ($left) - close anything using it and run this again." }
  Write-Host 'NetSentry monitor removed from this server (remove it from NetSentry too: Settings -> Monitor).'
  return
}
$enrolled = Test-Path (Join-Path $State 'token')
if (-not $enrolled -and -not $env:NETSENTRY_JOIN) { throw 'Set $env:NETSENTRY_JOIN to a join token from NetSentry first.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $Root, $Code, $State | Out-Null
# The server's credential: SYSTEM and Administrators only.
icacls $State /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
if (-not (Test-Path (Join-Path $Py 'python.exe'))) {
  $zip = Join-Path $env:TEMP 'netsentry-python.zip'
  Invoke-WebRequest -UseBasicParsing -Uri ${psq(WIN_PYTHON.url)} -OutFile $zip
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne ${psq(WIN_PYTHON.sha256)}) { Remove-Item $zip; throw 'The Python download does not match its pinned fingerprint - not installing it.' }
  Expand-Archive -Force $zip $Py
  Remove-Item $zip
}
# Let the embedded Python find the monitor's code (and nothing else).
Set-Content -Encoding ASCII (Join-Path $Py ${psq(WIN_PYTHON.pth)}) "python312.zip\`r\`n.\`r\`n..\\sensor"
if ($enrolled) { StopMonitor }
$reply = Invoke-WebRequest -UseBasicParsing -Uri "$Console/api/netsentry/sensor/files"
$files = ([Text.Encoding]::UTF8.GetString($reply.RawContentStream.ToArray()) | ConvertFrom-Json).files
foreach ($name in $files.PSObject.Properties.Name) {
  $full = Join-Path $Code ($name -replace '/', '\\')
  New-Item -ItemType Directory -Force -Path (Split-Path $full) | Out-Null
  [IO.File]::WriteAllText($full, $files.$name, (New-Object Text.UTF8Encoding($false)))
}
$python = Join-Path $Py 'python.exe'
if ($enrolled -and $env:NETSENTRY_JOIN) {
  Write-Host 'Reconnecting this monitor with the one-time code (it keeps its name and history in NetSentry).'
  & $python -m netsentry_sensor enrol --replace --console $Console --join $env:NETSENTRY_JOIN --name $env:COMPUTERNAME --state-dir $State; if ($LASTEXITCODE) { throw 'Reconnecting failed (see above).' }
}
elseif ($enrolled) { Write-Host 'Already enrolled: updating the monitor only.' }
else { & $python -m netsentry_sensor enrol --console $Console --join $env:NETSENTRY_JOIN --name $env:COMPUTERNAME --state-dir $State; if ($LASTEXITCODE) { throw 'Enrolment failed (see above).' } }
# Changes on this server: the earlier answer is kept unless NETSENTRY_MANAGE says otherwise.
$runCmd = Join-Path $Root 'run.cmd'
$manage = $env:NETSENTRY_MANAGE
if (-not $manage -and (Test-Path $runCmd)) { $manage = if (Select-String -Quiet -Path $runCmd -Pattern 'NETSENTRY_EXECUTOR=on') { 'yes' } else { 'no' } }
if (-not $manage) { $manage = if ((Read-Host 'Let NetSentry make changes on this server when a person confirms them (restart services and apps, update apps, back them up)? [y/N]') -match '^(y|yes)$') { 'yes' } else { 'no' } }
# The terminal: on Windows it is PowerShell as the monitor's own account (SYSTEM) — said in the question.
$terminal = $env:NETSENTRY_TERMINAL
if (-not $terminal -and (Test-Path $runCmd)) { $terminal = if (Select-String -Quiet -Path $runCmd -Pattern 'NETSENTRY_TERMINAL=on') { 'yes' } else { 'no' } }
if (-not $terminal) { $terminal = if ((Read-Host 'Let NetSentry admins open a PowerShell terminal on this server (it runs as SYSTEM; password asked again, recorded, closes when idle)? [y/N]') -match '^(y|yes)$') { 'yes' } else { 'no' } }
$lines = @('@echo off', "set NETSENTRY_CONSOLE=$Console")
if ($manage -eq 'yes') { $lines += 'set NETSENTRY_EXECUTOR=on' }
if ($terminal -eq 'yes') { $lines += 'set NETSENTRY_TERMINAL=on'; $lines += 'set NETSENTRY_TERMINAL_USER=SYSTEM' }
# Start outside the install folder: anything the monitor runs (tasklist, PowerShell) inherits it, and a
# leftover child holding C:\Program Files\NetSentry stopped uninstall (Windows Sandbox, 2026-10-01).
# The code is found through python312._pth (..\sensor), not the working folder.
$lines += "cd /d ""%SystemRoot%"""
$lines += """$python"" -m netsentry_sensor run --state-dir ""$State"""
Set-Content -Encoding ASCII $runCmd ($lines -join "\`r\`n")
icacls $Root /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'Users:(OI)(CI)RX' | Out-Null
# The startup task: Windows' own schtasks with a task definition (runs as SYSTEM at boot, restarts every
# minute if it stops, no time limit). schtasks needs no management service (CIM), unlike the cmdlets.
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>NetSentry monitor</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c "$runCmd"</Arguments></Exec></Actions>
</Task>
"@
$xmlFile = Join-Path $env:TEMP 'netsentry-task.xml'
[IO.File]::WriteAllText($xmlFile, $xml, [Text.Encoding]::Unicode)
StopMonitor
$ErrorActionPreference = 'Continue'
schtasks.exe /Create /TN $Task /XML $xmlFile /F 2>&1 | Out-Null
$created = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($created) { Remove-Item $xmlFile; throw 'Windows refused to create the startup task (run this in an administrator PowerShell).' }
Remove-Item $xmlFile
schtasks.exe /Run /TN $Task | Out-Null
if ($manage -eq 'yes') { Write-Host "NetSentry monitor running on $env:COMPUTERNAME. Changes: ALLOWED here (each one still needs a person to confirm it)." }
else { Write-Host "NetSentry monitor running on $env:COMPUTERNAME. Changes: not allowed here (run this again with \`$env:NETSENTRY_MANAGE='yes' to allow them)." }
`);
}

module.exports = { createJoinToken, revokeJoinToken, join, sensorFiles, installScript, installPs1, WIN_PYTHON, sensorRoot, consoleUrl, sensorVersion };
