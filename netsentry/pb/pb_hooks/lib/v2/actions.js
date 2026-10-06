/**
 * Typed actions (docs/SYSTEM-V2-PLAN.md §23.4) — the ONLY changes NetSentry's
 * own executor (the monitor on a machine, with fixing switched on there) can
 * make. Each has validated parameters, words for people, an undo, and what it
 * may disrupt. Free-form commands never run through NetSentry; they are only
 * ever shown to a person as instructions. Pure.
 *
 * fixFor(control, evidence, ctx) → { title, steps: [{ action, params, description, rollback, target }], downtime, preconditions } | null
 */

const ACTIONS = {
  'router.remove_port_mapping': {
    params: (p) => Number.isInteger(p.external_port) && p.external_port > 0 && p.external_port < 65536 && /^(TCP|UDP)$/.test(p.proto) && !!p.router_id,
    describe: (p) => `Remove the router rule that sends internet port ${p.external_port} to ${p.internal_client}:${p.internal_port}${p.router ? ` (${p.router})` : ''}`,
    undo: (p) => `Put that router rule back (internet port ${p.external_port} → ${p.internal_client}:${p.internal_port})`,
    disrupts: 'Nothing at home: only access from the internet stops.',
  },
  'ssh.disable_passwords': {
    params: () => true,
    describe: (p) => `Turn off password logins for remote login (SSH) on ${p.machine} — sign-in keys keep working`,
    undo: () => 'Put the previous remote-login settings back and reload SSH',
    disrupts: 'Anyone who logs in with a password must use a key instead. Sessions already open stay connected.',
    precondition: 'At least one sign-in key is already set up on the server (otherwise NetSentry refuses: you would be locked out).',
  },
  'cloud.aws.revoke_ingress': {
    params: (p) =>
      /^sg-[0-9a-f]{8,32}$/.test(p.group || '') && ['0.0.0.0/0', '::/0'].indexOf(p.cidr) >= 0 && ['tcp', 'udp'].indexOf(p.proto) >= 0 &&
      Number.isInteger(p.from_port) && Number.isInteger(p.to_port) && p.from_port >= 0 && p.from_port <= p.to_port && p.to_port < 65536,
    describe: (p) => `Remove the rule in security group ${p.group_name || p.group} that lets the whole internet reach port ${p.from_port === p.to_port ? p.from_port : `${p.from_port}-${p.to_port}`}`,
    undo: (p) => `Put that security-group rule back (port ${p.from_port} from ${p.cidr})`,
    disrupts: 'Connections from the internet to that port stop; the server and other rules are untouched.',
    precondition: "The server's cloud role may change security groups (ec2:RevokeSecurityGroupIngress / AuthorizeSecurityGroupIngress) — an opt-in you give it.",
  },
  'app.config.set': {
    params: (p) => !!p.container && !!p.path && p.format === 'ini' && !!p.key && typeof p.value === 'string',
    describe: (p) => `In ${p.app}, set "${p.label}" to ${p.value_words} and restart it`,
    undo: (p) => `Put ${p.app}'s previous settings file back and restart it`,
    disrupts: 'The app restarts (a few seconds of downtime).',
  },
  // v3 M2 — running things (docs/SYSTEM-V3-PLAN.md §8.2). The monitor re-checks every target itself.
  'container.restart': {
    params: (p) => CONTAINER.test(p.container || ''),
    describe: (p) => `Restart ${p.app || p.container}`,
    undo: () => 'Nothing to undo: a restart leaves everything as it was',
    disrupts: 'The app is unavailable for a few seconds while it restarts.',
    operate: true,
  },
  'container.stop': {
    params: (p) => CONTAINER.test(p.container || ''),
    describe: (p) => `Stop ${p.app || p.container}`,
    undo: (p) => `Start ${p.app || p.container} again`,
    disrupts: 'The app is unavailable until it is started again.',
    operate: true,
  },
  'container.start': {
    params: (p) => CONTAINER.test(p.container || ''),
    describe: (p) => `Start ${p.app || p.container}`,
    undo: (p) => `Stop ${p.app || p.container} again`,
    disrupts: 'Nothing: the app was not running.',
    operate: true,
  },
  'service.restart': {
    params: (p) => SERVICE.test(p.unit || ''),
    describe: (p) => `Restart the service ${unitWords(p)} on ${p.machine}`,
    undo: () => 'Nothing to undo: a restart leaves everything as it was',
    disrupts: 'Whatever the service does pauses for a few seconds.',
    operate: true,
  },
  'service.stop': {
    params: (p) => SERVICE.test(p.unit || ''),
    describe: (p) => `Stop the service ${unitWords(p)} on ${p.machine}`,
    undo: (p) => `Start the service ${unitWords(p)} again`,
    disrupts: 'Whatever the service does stops until it is started again.',
    operate: true,
  },
  'service.start': {
    params: (p) => SERVICE.test(p.unit || ''),
    describe: (p) => `Start the service ${unitWords(p)} on ${p.machine}`,
    undo: (p) => `Stop the service ${unitWords(p)} again`,
    disrupts: 'Nothing: the service was not running.',
    operate: true,
  },
};

// v3 M3 — updates (docs/SYSTEM-V3-PLAN.md §10.2). The monitor snapshots, checks health and undoes by itself.
ACTIONS['app.update'] = {
  params: (p) =>
    CONTAINER.test(p.container || '') && IMAGE.test(p.image || '') && IMAGE.test(p.from_image || '') && Array.isArray(p.keep) &&
    p.keep.every((m) => m && typeof m.source === 'string' && typeof m.destination === 'string'),
  describe: (p) => `Update ${p.app} to ${String(p.image).split(':').pop()}${p.image === p.from_image ? ' (newer build)' : ''}`,
  undo: (p) => `Put ${p.app} back on ${String(p.from_image).split(':').pop()} with its settings as they were`,
  disrupts: 'The app is unavailable for about a minute while the new version starts.',
};
ACTIONS['app.rollback'] = {
  params: (p) => CONTAINER.test(p.container || '') && /^[a-z0-9]{6,32}$/.test(p.change_id || ''),
  describe: (p) => `Put ${p.app} back the way it was before the update`,
  undo: () => 'Nothing: this puts back what was there before',
  disrupts: 'The app is unavailable for about a minute.',
};
ACTIONS['os.security_updates'] = {
  params: (p) => Array.isArray(p.packages) && p.packages.length > 0 && p.packages.length <= 500 && p.packages.every((x) => /^[a-zA-Z0-9][a-zA-Z0-9+.:~_-]{0,127}$/.test(x)),
  describe: (p) => `Install ${p.packages.length} security update${p.packages.length === 1 ? '' : 's'} on ${p.machine}`,
  undo: () => 'Operating-system updates are not undone (a restart window is offered instead)',
  disrupts: 'Services being updated restart briefly.',
};
ACTIONS['os.reboot'] = {
  params: (p) => Number.isInteger(p.delay_minutes) && p.delay_minutes >= 1 && p.delay_minutes <= 1440,
  describe: (p) => `Restart ${p.machine} in ${p.delay_minutes} minute${p.delay_minutes === 1 ? '' : 's'}`,
  undo: () => 'Cancel the restart (before it happens)',
  disrupts: 'Everything on the server is unavailable for a few minutes; apps set to start automatically come back.',
};
// v3 M4 — backups the monitor takes, tests and restores (docs/SYSTEM-V3-PLAN.md §11).
const ABS_PATH = /^(\/|[A-Za-z]:\\)[^\0]{0,250}$/;
const ARCHIVE = /^\d{4}-\d{2}-\d{2}_\d{6}\.tar\.gz$/;
ACTIONS['backup.run'] = {
  params: (p) => CONTAINER.test(p.container || '') && ABS_PATH.test(p.dest || '') && Array.isArray(p.keep) && !!p.plan_id,
  describe: (p) => `Back up ${p.app} to ${p.dest}`,
  undo: () => 'Nothing to undo: a backup only adds a copy',
  disrupts: 'If the app keeps its data in files, it pauses for the few seconds the copy takes.',
};
ACTIONS['backup.test'] = {
  params: (p) => CONTAINER.test(p.container || '') && ABS_PATH.test(p.dest || '') && ARCHIVE.test(p.archive || ''),
  describe: (p) => `Test that ${p.app}'s backup of ${p.archive.slice(0, 10)} restores`,
  undo: () => 'Nothing to undo: the test only reads the copy',
  disrupts: 'Nothing: the app keeps running.',
};
ACTIONS['backup.restore'] = {
  params: (p) => CONTAINER.test(p.container || '') && ABS_PATH.test(p.dest || '') && ARCHIVE.test(p.archive || ''),
  describe: (p) => `Restore ${p.app} from its backup of ${p.archive.slice(0, 10)} ${p.archive.slice(11, 13)}:${p.archive.slice(13, 15)}`,
  undo: () => 'NetSentry keeps a copy of what is there now, and puts it back by itself if the app doesn’t come back healthy',
  disrupts: 'The app stops while its data is put back, then starts again. Anything changed since that backup is lost.',
};
// v3 M5 — install an app from NetSentry's list; the monitor checks the template against its own rules.
ACTIONS['app.install'] = {
  params: (p) => /^[a-z0-9]{2,20}$/.test(p.template || '') && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(p.project || '') && ABS_PATH.test(p.root || '') && !!p.spec && typeof p.spec.services === 'object',
  describe: (p) => `Install ${p.app} on ${p.root}/${p.project}`,
  undo: () => 'Stop it again (its folder is kept)',
  disrupts: 'Nothing already running changes — a new app is added.',
};
const IMAGE = /^[a-z0-9][a-z0-9._\/:@-]{0,254}$/i;

// ------------------------------------------------------------------ v4 (docs/SYSTEM-V4-PLAN.md §7, §8)
// The monitor re-checks every one of these against its own rules (roots, risks, lock-out guards).
const FULL_PATH = /^(\/|[A-Za-z]:\\)[^\0\n\r]{0,1000}$/;
const FILE_NAME = /^(?!\.{1,2}$)[^\/\\\0\n\r]{1,255}$/;
const SHA = /^[0-9a-f]{64}$/;
const lastName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
ACTIONS['files.write'] = {
  params: (p) => FULL_PATH.test(p.path || '') && typeof p.content === 'string' && p.content.length <= 1000000 && (p.expected_sha256 === '' || SHA.test(p.expected_sha256 || '')),
  describe: (p) => `${p.expected_sha256 ? 'Save your changes to' : 'Create'} ${p.path}`,
  undo: (p) => (p.expected_sha256 ? `Put the previous ${lastName(p.path)} back` : `Remove the new ${lastName(p.path)}`),
  disrupts: 'Nothing restarts; an app that reads this file sees the change the next time it reads it (often when it restarts).',
};
ACTIONS['files.mkdir'] = {
  params: (p) => FULL_PATH.test(p.path || '') && FILE_NAME.test(lastName(p.path || '')),
  describe: (p) => `Make the folder ${p.path}`,
  undo: () => 'Remove it again (while it is empty)',
  disrupts: '',
};
ACTIONS['files.move'] = {
  params: (p) => FULL_PATH.test(p.path || '') && FULL_PATH.test(p.to || '') && p.path !== p.to,
  describe: (p) => (String(p.path).replace(/[^\\/]*$/, '') === String(p.to).replace(/[^\\/]*$/, '') ? `Rename ${p.path} to ${lastName(p.to)}` : `Move ${p.path} to ${p.to}`),
  undo: () => 'Move it back',
  disrupts: 'An app that uses it by its old name stops finding it.',
};
ACTIONS['files.delete'] = {
  params: (p) => FULL_PATH.test(p.path || ''),
  describe: (p) => `Delete ${p.path}`,
  undo: () => 'Take it back out of NetSentry’s bin (kept 7 days)',
  disrupts: 'An app that uses it stops finding it.',
};
ACTIONS['files.upload'] = {
  params: (p) =>
    FULL_PATH.test(p.folder || '') && FILE_NAME.test(p.name || '') && SHA.test(p.sha256 || '') && /^[a-z0-9]{15}$/.test(p.transfer_id || '') &&
    Number.isInteger(p.size) && p.size >= 0 && p.size <= 20000000,
  describe: (p) => `Upload ${p.name} (${p.size >= 1e6 ? `${(p.size / 1e6).toFixed(1)} MB` : p.size >= 1000 ? `${Math.round(p.size / 1e3)} KB` : `${p.size} bytes`}) to ${p.folder}`,
  undo: (p) => `Remove ${p.name} again`,
  disrupts: '',
};
const PORTS_OK = (list) =>
  Array.isArray(list) && list.length <= 30 &&
  list.every((x) => x && /^\d{1,5}$/.test(String(x.published)) && /^\d{1,5}$/.test(String(x.target)) && ['tcp', 'udp'].indexOf(x.protocol || 'tcp') >= 0);
ACTIONS['app.settings.set'] = {
  params: (p) =>
    CONTAINER.test(p.container || '') && FULL_PATH.test(p.file || '') && SHA.test(p.file_sha256 || '') && !!p.changes && typeof p.changes === 'object' &&
    Object.keys(p.changes).length > 0 && Object.keys(p.changes).every((k) => ['ports', 'environment', 'restart', 'volumes'].indexOf(k) >= 0) &&
    (!p.changes.ports || PORTS_OK(p.changes.ports)) && Array.isArray(p.accepted_risks || []),
  describe: (p) => `Change ${p.app}'s ${p.words || 'settings'}`,
  undo: (p) => `Put ${p.app}'s Compose file back as it was`,
  disrupts: 'If it’s running, it restarts (a few seconds to a minute) and NetSentry checks it comes back healthy, putting the old settings back if it doesn’t. If it’s stopped, it stays stopped.',
};
ACTIONS['app.compose.apply'] = {
  params: (p) =>
    CONTAINER.test(p.container || '') && FULL_PATH.test(p.file || '') && SHA.test(p.file_sha256 || '') && typeof p.content === 'string' &&
    p.content.length > 0 && p.content.length <= 256000 && Array.isArray(p.accepted_risks || []),
  describe: (p) => `Save your edit of ${p.app}'s Compose file`,
  undo: (p) => `Put ${p.app}'s Compose file back as it was`,
  disrupts: 'If it’s running, every part that changed restarts and NetSentry checks it comes back healthy, putting the old file back if it doesn’t. If it’s stopped, it stays stopped.',
};
ACTIONS['app.remove'] = {
  params: (p) => CONTAINER.test(p.container || '') && ['keep', 'everything'].indexOf(p.mode) >= 0,
  describe: (p) => (p.mode === 'everything' ? `Remove ${p.app} and everything it keeps` : `Remove ${p.app} (its folder and data stay)`),
  undo: (p) =>
    p.mode === 'everything'
      ? 'Take its folder back out of NetSentry’s bin (7 days) and start it — its Docker volumes can’t come back'
      : `Start ${p.app} again`,
  disrupts: 'The app stops and is gone from the server.',
};
const CLEANUP_WORDS = {
  docker_images: 'Remove Docker images no app uses (never one an app runs, and never the copies Roll back needs)',
  docker_build_cache: 'Remove Docker’s build cache',
  journal: 'Shrink the system journal to 200 MB (older log entries go)',
  netsentry_rollbacks: 'Remove roll-back copies of updates older than 3 days (those updates can no longer be rolled back)',
  bin: 'Empty NetSentry’s bin (deleted files and removed apps can no longer come back)',
};
ACTIONS['disk.cleanup'] = {
  params: (p) => !!CLEANUP_WORDS[p.what],
  describe: (p) => CLEANUP_WORDS[p.what],
  undo: () => 'Nothing to undo: only caches and copies go',
  disrupts: 'Nothing that runs.',
};
ACTIONS['process.stop'] = {
  params: (p) => Number.isInteger(p.pid) && p.pid > 1 && typeof p.start === 'string' && p.start.length > 0 && /^[^\0\n]{1,64}$/.test(p.name || ''),
  describe: (p) => `Stop the program ${p.name} (${p.pid})${p.user ? ` run by ${p.user}` : ''}`,
  undo: () => 'A stopped program can’t be un-stopped; start it again the way it was started',
  disrupts: 'Whatever that program was doing stops. NetSentry asks it to close, and forces it after 10 seconds.',
};
const FW = (p) =>
  /^\d{1,5}$/.test(String(p.port)) && Number(p.port) > 0 && Number(p.port) < 65536 && ['tcp', 'udp'].indexOf(p.proto) >= 0 &&
  /^(any|local|[0-9a-fA-F.:\/]{2,49})$/.test(p.source || '');
const FROM_WORDS = (s) => (s === 'any' ? 'every network' : s === 'local' ? 'your local network' : s);
ACTIONS['firewall.allow'] = {
  params: FW,
  describe: (p) => `Open port ${p.port}/${p.proto} in the firewall to ${FROM_WORDS(p.source)}${p.label ? ` (${p.label})` : ''}`,
  undo: (p) => `Close port ${p.port}/${p.proto} again`,
  disrupts: 'Nothing that runs; the port becomes reachable.',
};
ACTIONS['firewall.remove'] = {
  params: FW,
  describe: (p) => `Close port ${p.port}/${p.proto} (from ${FROM_WORDS(p.source)}) in the firewall`,
  undo: (p) => `Open port ${p.port}/${p.proto} again`,
  disrupts: 'Whoever used that port from there can’t reach it any more. NetSentry refuses to remove the last rule letting remote login (SSH) in.',
};
ACTIONS['firewall.enable'] = {
  params: (p) => Array.isArray(p.keep_open) && p.keep_open.length <= 20 && p.keep_open.every((x) => /^\d{1,5}$/.test(String(x))),
  describe: (p) => `Switch the firewall on (remote login${p.keep_open.length ? ` and NetSentry (port ${p.keep_open.join(', ')})` : ''} stay open)`,
  undo: () => 'Switch it off again',
  disrupts: 'Ports nothing allows stop being reachable from other devices. Remote login (SSH) and NetSentry are allowed first, so you aren’t locked out.',
};
// v4 §17: manage the whole firewall — switch any rule off or on, block a port, a network profile off or on.
// any rule name, path ones too ("TCP Query User{guid}C:\…\app.exe"), but never a wildcard: -Name would match several
const RULE_ID = /^[^\x00-\x1f\x7f*?[\]]{1,400}$/;
ACTIONS['firewall.rule.toggle'] = {
  params: (p) => Array.isArray(p.rule_ids) && p.rule_ids.length > 0 && p.rule_ids.length <= 50 && p.rule_ids.every((x) => RULE_ID.test(String(x))) && typeof p.enable === 'boolean' && String(p.name || '').length <= 200,
  describe: (p) => `Switch the firewall rule “${p.name || p.rule_ids[0]}” ${p.enable ? 'on' : 'off'}${p.rule_ids.length > 1 ? ` (${p.rule_ids.length} rules: each protocol and kind of network)` : ''}`,
  undo: (p) => `Switch it ${p.enable ? 'off' : 'on'} again`,
  disrupts: (p) =>
    p.enable
      ? 'What that rule lets in can reach this server again.'
      : 'Whatever that rule let in can’t reach this server any more. NetSentry refuses to switch off the last rule letting remote login (SSH, Remote Desktop) in.',
};
ACTIONS['firewall.block'] = {
  params: FW,
  describe: (p) => `Block port ${p.port}/${p.proto} from ${FROM_WORDS(p.source)}`,
  undo: (p) => `Remove that block on port ${p.port}/${p.proto}`,
  disrupts: 'Whoever used that port from there can’t reach it any more. NetSentry never blocks remote login (22, 3389, 5985, 5986).',
};
ACTIONS['firewall.profile'] = {
  params: (p) => ['Domain', 'Private', 'Public'].indexOf(p.profile) >= 0 && typeof p.enable === 'boolean',
  describe: (p) => `Switch Windows Firewall ${p.enable ? 'on' : 'off'} for ${p.profile.toLowerCase()} networks`,
  undo: (p) => `Switch it ${p.enable ? 'off' : 'on'} again`,
  disrupts: (p) =>
    p.enable
      ? `On ${p.profile.toLowerCase()} networks, only what the rules allow can come in.`
      : `On ${p.profile.toLowerCase()} networks, anything can reach this server's open ports — the rules stop applying until it is switched on again.`,
};
const KEY_LINE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+\/]{40,}={0,3}( [\x20-\x7e]{1,100})?$/;
const UNIX_USER = /^[a-z_][a-z0-9_.-]{0,31}\$?$/;
ACTIONS['ssh.key.add'] = {
  params: (p) => UNIX_USER.test(p.user || '') && KEY_LINE.test(p.key || ''),
  describe: (p) => `Let a new key sign in as ${p.user}${p.comment ? ` (${p.comment})` : ''}`,
  undo: (p) => `Remove that key from ${p.user} again`,
  disrupts: 'Nothing; whoever holds that key can sign in as that user.',
};
ACTIONS['ssh.key.remove'] = {
  params: (p) => UNIX_USER.test(p.user || '') && /^SHA256:[A-Za-z0-9+\/]{43}$/.test(p.fingerprint || ''),
  describe: (p) => `Stop the key ${String(p.fingerprint).slice(7, 19)}…${p.comment ? ` (${p.comment})` : ''} signing in as ${p.user}`,
  undo: (p) => `Let that key sign in as ${p.user} again`,
  disrupts: 'Whoever uses that key can’t sign in any more. NetSentry refuses if it would leave no administrator able to sign in.',
};
ACTIONS['schedule.set'] = {
  params: (p) =>
    typeof p.pause === 'boolean' &&
    ((p.kind === 'cron' && FULL_PATH.test(p.file || '') && /^[0-9a-f]{16}$/.test(p.id || '')) ||
      (p.kind === 'timer' && /^[A-Za-z0-9@_.:-]{1,120}\.timer$/.test(p.unit || '')) ||
      (p.kind === 'task' && /^[^'"`$;|&<>]{1,200}$/.test(p.name || '') && /^\\[^'"`$;|&<>]{0,200}$/.test(p.path || ''))),
  describe: (p) => `${p.pause ? 'Pause' : 'Resume'} the scheduled job ${p.words || p.unit || p.name || ''}`.trim(),
  undo: (p) => `${p.pause ? 'Resume' : 'Pause'} it again`,
  disrupts: (p) => (p.pause ? 'It doesn’t run until it is resumed.' : 'It runs on its schedule again.'),
};
// v4 §17 (N-B42): a new scheduled job — one command on one of a few schedules, only in NetSentry's own place.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const JOB_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,59}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const whenOk = (w) =>
  !!w &&
  ((w.every === 'minutes' && [5, 10, 15, 30].indexOf(w.n) >= 0) ||
    (w.every === 'hour' && Number.isInteger(w.minute) && w.minute >= 0 && w.minute <= 59) ||
    (w.every === 'day' && HHMM.test(w.at || '')) ||
    (w.every === 'week' && HHMM.test(w.at || '') && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6) ||
    w.every === 'start');
const whenWords = (w) =>
  w.every === 'minutes'
    ? `every ${w.n} minutes`
    : w.every === 'hour'
      ? `every hour at :${String(w.minute).padStart(2, '0')}`
      : w.every === 'day'
        ? `every day at ${w.at}`
        : w.every === 'week'
          ? `every ${DAY_NAMES[w.day]} at ${w.at}`
          : 'when the server starts';
ACTIONS['schedule.create'] = {
  params: (p) =>
    JOB_NAME.test(p.name || '') &&
    String(p.name).toLowerCase().indexOf('netsentry') < 0 &&
    typeof p.command === 'string' &&
    p.command.trim().length >= 1 &&
    p.command.length <= 1000 &&
    !/[\0\r\n]/.test(p.command) &&
    whenOk(p.when) &&
    (p.runs_as === 'root' || p.runs_as === 'SYSTEM'),
  describe: (p) => `Make a scheduled job “${p.name}” that runs ${whenWords(p.when)}, as ${p.runs_as}: ${p.command}`.slice(0, 2000),
  undo: () => 'Delete the job again',
  disrupts: 'Whatever the command does, each time it runs — read it before confirming.',
};
ACTIONS['schedule.delete'] = {
  params: (p) =>
    (p.kind === 'cron' && /^\/etc\/cron\.d\/made-in-netsentry-[a-z0-9-]{1,62}$/.test(p.file || '')) ||
    (p.kind === 'task' && JOB_NAME.test(p.name || '') && p.path === '\\Made in NetSentry\\'),
  describe: (p) => `Delete the scheduled job “${p.words || p.name || p.file}”`,
  undo: () => 'Put the job back',
  disrupts: 'It doesn’t run any more.',
};
ACTIONS['remote.tailscale.install'] = {
  params: () => true,
  describe: () => 'Install Tailscale (its official installer) so you can reach this server from away, privately',
  undo: () => 'Uninstall Tailscale',
  disrupts: 'Nothing that runs; afterwards you sign it in on Tailscale’s own site.',
};
const shellWord = (a) => (/^[A-Za-z0-9_@%+=:,.\/-]+$/.test(a) ? a : "'" + a.split("'").join("'\\''") + "'");
ACTIONS['command.run'] = {
  params: (p) =>
    Array.isArray(p.argv) && p.argv.length >= 1 && p.argv.length <= 64 && p.argv.every((a) => typeof a === 'string' && a.length <= 4000 && a.indexOf('\0') < 0) &&
    Number.isInteger(p.timeout) && p.timeout >= 1 && p.timeout <= 600 && (!p.cwd || FULL_PATH.test(p.cwd)) && typeof p.why === 'string' && p.why.length >= 3,
  describe: (p) => `Run on the server, as root: ${p.argv.map(shellWord).join(' ')}`.slice(0, 2000),
  undo: () => 'A command can’t be undone by NetSentry — read what it does before confirming',
  disrupts: 'Whatever this command does.',
};

// Docker's container names; systemd units / Windows service names. Anything else never reaches a monitor.
const CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
// A service only: a bare name or name.service — never a target, socket or timer (security review 2026-10-01, C8).
const SERVICE = /^(?=.{1,120}$)[A-Za-z0-9@_-][A-Za-z0-9@_-]*(\.service)?$/;

/** The real unit always shows; a friendly name only alongside it, so a person confirms what actually runs. */
function unitWords(p) {
  const unit = String(p.unit || '');
  const label = String(p.label || '').trim();
  return label && label.toLowerCase() !== unit.toLowerCase().replace(/\.service$/, '') ? `${unit} (${label})` : unit;
}

/** A one-step plan to run something (start / stop / restart) — the target is re-checked on the machine. */
function operatePlan(action, params, target) {
  const a = ACTIONS[action];
  if (!a || !a.operate) return null;
  const s = step(action, params, target);
  if (!s) return null;
  return { title: s.description, steps: [s], downtime: a.disrupts, preconditions: [] };
}

function step(action, params, target) {
  const a = ACTIONS[action];
  if (!a || !a.params(params)) return null;
  return { action, params, description: a.describe(params), rollback: a.undo(params), target: target || '', command: '' };
}

/** The fix NetSentry can apply itself for a failing check, or null (then it's instructions for a person). */
function fixFor(control, evidence, ctx) {
  const ev = evidence || {};
  if (control === 'REACH-BEYOND-INTENT') {
    const beyondInternet = ctx.intent !== 'internet';
    const forwards = (ev.paths || []).filter((p) => p.vantage === 'internet').map((p) => p.hops[0]).filter((h) => h && h.component === 'router forward' && h.via_upnp);
    if (!beyondInternet || !forwards.length) return null;
    const steps = forwards
      .map((h) => step('router.remove_port_mapping', { router_id: h.router_id, router: h.router, external_port: h.external_port, proto: h.proto || 'TCP', internal_client: h.internal_client, internal_port: h.internal_port }, ctx.machine))
      .filter(Boolean);
    return steps.length ? { title: `Close ${ctx.app} to the internet`, steps, downtime: ACTIONS['router.remove_port_mapping'].disrupts, preconditions: [] } : null;
  }
  if (control === 'HST-SSH-PASSWORD') {
    const s = step('ssh.disable_passwords', { machine: ctx.machine }, ctx.machine);
    return s ? { title: `Turn off password logins for remote login on ${ctx.machine}`, steps: [s], downtime: ACTIONS['ssh.disable_passwords'].disrupts, preconditions: [ACTIONS['ssh.disable_passwords'].precondition] } : null;
  }
  if (control === 'CLD-ADMIN-PORT-OPEN') {
    const steps = (ev.open || [])
      .map((r) => step('cloud.aws.revoke_ingress', { group: r.group, group_name: r.group_name || '', proto: String(r.proto || 'tcp'), from_port: r.from_port, to_port: r.to_port, cidr: r.source }, ctx.machine))
      .filter(Boolean);
    const a = ACTIONS['cloud.aws.revoke_ingress'];
    return steps.length ? { title: `Close ${ctx.machine}'s admin ports to the internet`, steps, downtime: a.disrupts, preconditions: [a.precondition] } : null;
  }
  if (control === 'APP-QBIT-AUTH-BYPASS' && ctx.config) {
    const cfg = (ev.config || {});
    const steps = [];
    if (String(cfg['Preferences/WebUI\\AuthSubnetWhitelistEnabled'] || '').toLowerCase() === 'true') {
      steps.push(step('app.config.set', { app: ctx.app, container: ctx.config.container, path: ctx.config.path, format: 'ini', key: 'Preferences/WebUI\\AuthSubnetWhitelistEnabled', value: 'false', label: 'Bypass authentication for clients in whitelisted IP subnets', value_words: 'off' }, ctx.machine));
    }
    if (String(cfg['Preferences/WebUI\\LocalHostAuth'] || '').toLowerCase() === 'false') {
      steps.push(step('app.config.set', { app: ctx.app, container: ctx.config.container, path: ctx.config.path, format: 'ini', key: 'Preferences/WebUI\\LocalHostAuth', value: 'true', label: 'Bypass authentication for clients on localhost', value_words: 'off' }, ctx.machine));
    }
    const ok = steps.filter(Boolean);
    return ok.length ? { title: `Make ${ctx.app} ask everyone for its password`, steps: ok, downtime: ACTIONS['app.config.set'].disrupts, preconditions: [] } : null;
  }
  return null;
}

/** Is this a plan NetSentry's executor runs (every step a known typed action)? */
function isTyped(plan) {
  return !!(plan && Array.isArray(plan.steps) && plan.steps.length && plan.steps.every((s) => s && ACTIONS[s.action] && ACTIONS[s.action].params(s.params || {})));
}

module.exports = { ACTIONS, fixFor, isTyped, operatePlan };
