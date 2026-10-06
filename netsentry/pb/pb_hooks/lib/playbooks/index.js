/**
 * PURE — remediation playbooks. A playbook is a GENERIC fix: the agent turns it
 * into a concrete plan for the real system (distro, web server, resource ids);
 * a person approves that plan; the agent executes it; NetSentry re-checks
 * `verifies` (the rule that found the problem) to decide whether it worked.
 *
 * risk:
 *   auto    — low risk, reversible, no lockout/downtime/cost (still confirmed by a person, v4)
 *   approve — may disrupt; a person approves the exact plan
 *   high    — downtime or data at stake; approval + a backup/snapshot first
 *   guided  — must be done by a person (credentials, billing, key custody); never executed by the agent
 */

const P = (id, o) => Object.assign({ id, lockoutRisk: false, downtime: 'none expected', cost: 'none', preconditions: [], rollback: [] }, o);

const ALL = [
  P('close-exposed-port', {
    title: 'Stop exposing the service to the internet',
    risk: 'approve',
    forRules: ['CLD-001'],
    verifies: 'same',
    lockoutRisk: true,
    preconditions: ['If the port is SSH/RDP: a second way in is confirmed (SSM, console, VPN or an allow-listed IP)', 'Current firewall / security-group rule exported'],
    steps: ['Find the rule that opens the port (cloud security group, host firewall, router port-forward)', 'Remove it, or restrict the source to known addresses', 'Confirm the service is still reachable from where it must be'],
    rollback: ['Re-apply the exported rule'],
  }),
  P('bind-service-localhost', {
    title: 'Make the service listen on localhost only',
    risk: 'approve',
    forRules: ['HOST-001'],
    when: (ev) => [135, 445].indexOf(Number(ev.port)) < 0,
    verifies: 'same',
    downtime: 'a service restart',
    preconditions: ['No other server needs to reach the service (or it will go through a tunnel/proxy)', 'Service configuration backed up'],
    steps: ['Set the listen/bind address to 127.0.0.1 in the service configuration (e.g. listen_addresses for PostgreSQL, bind for Redis)', 'Validate the configuration', 'Restart the service'],
    rollback: ['Restore the backed-up configuration and restart'],
  }),
  P('docker-bind-localhost', {
    title: 'Publish the container port on localhost only',
    risk: 'approve',
    forRules: ['HOST-002'],
    verifies: 'same',
    downtime: 'a short restart of that tool',
    preconditions: ['docker-compose file or run command backed up'],
    steps: ['Change the port mapping to 127.0.0.1:<host>:<container>', 'Recreate the container', 'Put a reverse proxy in front if it must stay public'],
    rollback: ['Restore the previous mapping and recreate the container'],
  }),
  P('ssh-harden', {
    title: 'Allow only key-based SSH logins and no direct root login',
    risk: 'approve',
    forRules: ['HOST-003'],
    verifies: 'same',
    lockoutRisk: true,
    preconditions: ['A key-based login for an admin user is confirmed working', 'sshd_config backed up', 'Keep an existing session open while applying'],
    steps: ['Set PasswordAuthentication no and PermitRootLogin prohibit-password (or no) in sshd_config (drop-in files take precedence)', 'Validate with sshd -t', 'Reload sshd (do not restart existing sessions)'],
    rollback: ['Restore the backed-up sshd_config and reload sshd'],
  }),
  P('turn-off-file-sharing', {
    title: 'Turn off Windows file and printer sharing',
    risk: 'guided',
    forRules: ['HOST-001'],
    when: (ev) => Number(ev.port) === 445,
    verifies: 'same',
    preconditions: ['Nobody needs shared folders or printers from this server'],
    steps: ['Open Settings → Network & internet → Advanced network settings → Advanced sharing settings', 'Turn off "File and printer sharing" for all networks', 'NetSentry sees the change on the monitor’s next report'],
  }),
  P('enable-host-firewall', {
    title: 'Turn on the host firewall with a default-deny inbound policy',
    risk: 'approve',
    forRules: ['DEV-002'],
    verifies: 'same',
    lockoutRisk: true,
    preconditions: ['Inbound ports that must stay open are listed (SSH, web)', 'Current rules exported'],
    steps: ['Allow the required inbound ports first', 'Enable the firewall (Windows Defender Firewall profiles / ufw / firewalld)', 'Confirm remote access still works'],
    rollback: ['Disable the firewall or restore the exported rules'],
  }),
  P('enable-antivirus', {
    title: 'Turn real-time malware protection back on',
    risk: 'auto',
    forRules: ['DEV-004'],
    verifies: 'same',
    steps: ['Turn real-time protection back on (Windows: Set-MpPreference -DisableRealtimeMonitoring $false)', 'Check why it was off (policy, third-party AV)'],
    rollback: ['None needed'],
  }),
  P('enable-disk-encryption', {
    title: 'Encrypt the system disk',
    risk: 'guided',
    forRules: ['DEV-001'],
    verifies: 'same',
    downtime: 'encryption runs in the background; a reboot may be needed',
    preconditions: ['A place to store the recovery key that is not this server (password manager, IT escrow)'],
    steps: ['Windows: turn on BitLocker and save the recovery key off the server', 'macOS: turn on FileVault', 'Linux: LUKS normally needs a reinstall — plan it'],
  }),
  P('apply-security-updates', {
    title: 'Install pending security updates and enable automatic security updates',
    risk: 'approve',
    forRules: ['HOST-007'],
    verifies: 'same',
    downtime: 'services may restart; a reboot if the kernel is updated',
    preconditions: ['A snapshot or backup exists for servers'],
    steps: ['Install security updates (apt-get upgrade / dnf upgrade --security)', 'Enable unattended security updates (unattended-upgrades / dnf-automatic)', 'Reboot in a maintenance window if required'],
    rollback: ['Restore the snapshot if an update breaks the service'],
  }),
  P('block-source', {
    title: 'Block the attacking or malicious address',
    risk: 'auto',
    forRules: ['HOST-005', 'NET-001', 'NET-009'],
    verifies: null, // the traffic stopping is the evidence; no state check to re-run
    steps: ['Add a deny rule for the address (host firewall, security group/NACL, or CrowdSec decision)', 'Record the block with an expiry'],
    rollback: ['Remove the deny rule'],
  }),
  P('investigate-compromise', {
    title: 'Investigate a possible compromise',
    risk: 'guided',
    forRules: ['HOST-016', 'HOST-006', 'HOST-008', 'HOST-009', 'NET-006', 'NET-007', 'NET-008', 'CLD-002', 'CLD-003'],
    verifies: null,
    steps: [
      'Contain: isolate the host or the account (disable the user, revoke sessions and keys)',
      'Collect: who logged in, new users/keys, autostart entries, listeners and outbound connections (NetSentry shows these)',
      'Eradicate: remove what was added; rebuild the host if in doubt',
      'Recover: rotate credentials that were on the host; restore from a known-good backup',
    ],
  }),
  P('enable-cloud-threat-detection', {
    title: "Turn on the cloud provider's threat detection",
    risk: 'approve',
    forRules: ['CLD-004'],
    verifies: 'same',
    cost: 'GuardDuty is billed per volume of events analysed — typically a few dollars a month for one instance (30-day free trial)',
    preconditions: ['Someone with rights to enable GuardDuty in this account/region runs it (the server monitor’s access is read-only)'],
    steps: ['Enable GuardDuty in the region shown (console, or aws guardduty create-detector --enable)', 'Optionally route high-severity findings to email via EventBridge/SNS'],
    rollback: ['Suspend or delete the detector'],
  }),
  P('encrypt-cloud-disk', {
    title: 'Encrypt the cloud disk (and new disks by default)',
    risk: 'high',
    forRules: ['CLD-005'],
    verifies: 'same',
    downtime: 'an instance stop/start while the volume is swapped',
    preconditions: ['A snapshot of the current volume exists (it is the backup and the source of the encrypted copy)', 'A maintenance window is agreed'],
    steps: ['Enable EBS encryption by default in the region', 'Snapshot the volume; copy the snapshot with encryption enabled', 'Create a volume from the encrypted copy in the same availability zone', 'Stop the instance, detach the old volume, attach the new one on the same device, start the instance'],
    rollback: ['Stop the instance and re-attach the original (unencrypted) volume'],
  }),
  P('require-imdsv2', {
    title: 'Require session tokens for instance metadata (IMDSv2)',
    risk: 'approve',
    forRules: ['CLD-006'],
    verifies: 'same',
    preconditions: ['Software on the instance that reads instance metadata uses an IMDSv2-capable SDK or client'],
    steps: ['aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 2 (2 keeps containers working)', 'Watch application logs for metadata errors'],
    rollback: ['aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens optional'],
  }),
  P('rotate-leaked-secret', {
    title: 'Rotate the leaked secret and move it out of the code',
    risk: 'guided',
    forRules: ['CODE-001'],
    verifies: 'same',
    preconditions: ['Access to the provider that issued the credential'],
    steps: ['Revoke/rotate the credential at its provider first', 'Put the new value in an environment variable or secret manager', 'Remove it from the code; optionally purge history with git filter-repo'],
  }),
  P('upgrade-dependency', {
    title: 'Upgrade the vulnerable dependency to a fixed version',
    risk: 'approve',
    forRules: ['CODE-002'],
    verifies: 'same',
    downtime: 'a redeploy',
    preconditions: ['Tests exist or the change can be checked by hand', 'The project is under version control (the change is a revertible commit)'],
    steps: ['Upgrade the package to the fixed version shown (npm install pkg@ver / pip install pkg==ver) and update the lockfile', 'Run the tests / build', 'Deploy'],
    rollback: ['Revert the lockfile change and redeploy'],
  }),
  P('restart-sensor', {
    title: 'Get the server monitor reporting again',
    risk: 'guided',
    forRules: ['RES-002'],
    verifies: 'same',
    steps: ['Check the server is switched on and connected to the internet', 'On the server, run the monitor’s install command again (Settings → Monitor shows it)', 'If nobody stopped it, find out who did'],
  }),
];

const BY_ID = {};
for (const p of ALL) BY_ID[p.id] = p;

function get(id) {
  return BY_ID[id] || null;
}

/** Playbooks that address a rule, most specific first. */
/** Everyday names for the Simple view (the technical `title` stays for Detailed and the agent). */
const PLAIN_NAMES = {
  'close-exposed-port': 'Close it to the internet',
  'bind-service-localhost': 'Let only this server use it',
  'docker-bind-localhost': 'Let only this server use it',
  'ssh-harden': 'Allow key logins only',
  'enable-host-firewall': 'Turn the firewall on',
  'enable-antivirus': 'Turn virus protection back on',
  'enable-disk-encryption': 'Encrypt the disk',
  'apply-security-updates': 'Install the updates',
  'publish-email-auth': 'Turn on email protection',
  'remove-dangling-cname': 'Remove the unused name',
  'renew-certificate': 'Renew the certificate',
  'renew-domain': 'Renew the web address',
  'patch-vulnerable-service': 'Update the software',
  'block-source': 'Block that address',
  'investigate-compromise': 'Check for a break-in',
  'enable-cloud-threat-detection': 'Turn on cloud threat detection',
  'encrypt-cloud-disk': 'Encrypt the cloud disk',
  'require-imdsv2': 'Switch to the safer cloud setting',
  'add-security-headers': 'Add the browser safety settings',
  'block-exposed-files': 'Hide the file and change the passwords in it',
  'enable-https': 'Turn on HTTPS',
  'rotate-leaked-secret': 'Change the leaked password or key',
  'upgrade-dependency': 'Update the building block',
  'restart-sensor': 'Get the monitor running again',
  'turn-off-file-sharing': 'Turn off file sharing',
};

/** Fixes that apply to this rule — and, when a fix says so, to these particular facts. */
function forRule(ruleId, evidence) {
  return ALL.filter((p) => p.forRules.indexOf(ruleId) >= 0 && (!p.when || p.when(evidence || {}, ruleId)));
}

function plainName(pb) {
  return PLAIN_NAMES[pb.id] || pb.title;
}

/** The rule whose passing proves the fix worked. */
function verifyRule(playbook, ruleId) {
  if (!playbook || playbook.verifies === null) return null;
  return playbook.verifies === 'same' ? ruleId : playbook.verifies;
}

module.exports = { ALL, get, forRule, verifyRule, plainName };
