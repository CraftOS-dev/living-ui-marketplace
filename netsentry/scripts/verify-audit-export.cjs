#!/usr/bin/env node
/**
 * Verify a NetSentry audit export OFF the NetSentry machine.
 *
 *   node verify-audit-export.cjs netsentry-audit-2026-09-30.jsonl [--checkpoint <seq>:<hash-prefix>]
 *
 * Recomputes every entry's hash with the same algorithm as the console
 * (pb/pb_hooks/lib/core/auditchain.js) and checks the chain is unbroken from
 * entry #1. With --checkpoint (the "Audit checkpoint" line of an earlier daily
 * digest, e.g. 1203:9f86d081884c7d65) it also proves nothing up to that entry
 * was rewritten since the digest was sent. Needs only Node.js.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { verifyChain } = require(path.join(__dirname, '..', 'pb', 'pb_hooks', 'lib', 'core', 'auditchain.js'));

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error('usage: node verify-audit-export.cjs <export.jsonl> [--checkpoint <seq>:<hash-prefix>]');
    return 2;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const header = JSON.parse(lines[0]);
  if (!header.netsentry_audit_export) {
    console.error('Not a NetSentry audit export (missing header line).');
    return 2;
  }
  const rows = lines.slice(1).map((l) => JSON.parse(l));
  if (rows.length && rows[0].seq !== 1) {
    console.error(`The export starts at entry #${rows[0].seq}; a full export starts at #1.`);
    return 1;
  }
  const res = verifyChain(rows, sha256);
  if (!res.ok) {
    console.error(`BROKEN at entry #${res.brokenAt}: ${res.reason}`);
    return 1;
  }
  const i = argv.indexOf('--checkpoint');
  if (i >= 0) {
    const [seq, prefix] = String(argv[i + 1] || '').split(':');
    const row = rows.find((r) => r.seq === Number(seq));
    if (!row) {
      console.error(`Checkpoint entry #${seq} is not in the export — entries were removed.`);
      return 1;
    }
    if (!prefix || !row.hash.startsWith(prefix.replace(/…$/, ''))) {
      console.error(`Checkpoint mismatch at entry #${seq}: history up to that point was rewritten.`);
      return 1;
    }
  }
  const last = rows[rows.length - 1];
  console.log(`OK — ${res.checked} entries, chain intact${last ? `, head #${last.seq} ${last.hash.slice(0, 16)}` : ''}${i >= 0 ? ', checkpoint matches' : ''}.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
