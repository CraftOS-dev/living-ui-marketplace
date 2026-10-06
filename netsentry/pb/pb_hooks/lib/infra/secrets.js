/**
 * INFRA — encryption of stored secrets (alert destination URLs).
 * AES-256-GCM via $security.encrypt with a random 32-byte key kept in
 * pb_data/.netsentry_key (0600). The key never leaves the machine and is never
 * returned by any operation. Losing pb_data loses the key AND the ciphertext
 * together, so there is no half-recoverable state.
 */

function keyPath(app) {
  return $filepath.join(app.dataDir(), '.netsentry_key');
}

function key(app) {
  const path = keyPath(app);
  try {
    const k = toString($os.readFile(path)).trim();
    if (k.length === 32) return k;
  } catch (_) {
    /* first use — create below */
  }
  const k = $security.randomString(32);
  $os.writeFile(path, k, 0o600);
  return k;
}

function encrypt(app, plain) {
  return $security.encrypt(String(plain), key(app));
}

function decrypt(app, cipher) {
  if (!cipher) return '';
  return toString($security.decrypt(String(cipher), key(app)));
}

module.exports = { encrypt, decrypt };
