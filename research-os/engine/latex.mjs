/**
 * The typesetting engine: builds a manuscript's PDF with Tectonic (a
 * self-contained XeTeX that fetches the LaTeX packages a document uses).
 *
 *   node engine/latex.mjs start <job dir>   starts the build in the background and returns at once
 *   node engine/latex.mjs run <job dir>     the build itself
 *
 * The job dir holds main.tex and what it uses (references.bib, figures/,
 * the venue's style files). The build writes status.json there:
 *
 *   { phase, beat, ok?, pages?, errors?, warnings?, log?, seconds? }
 *
 * phase is starting, engine (fetching Tectonic, once per computer),
 * packages (the first build fetches the LaTeX packages, about 40 MB),
 * compiling, done or failed. `beat` moves every few seconds while a build
 * runs, which tells a build that stopped (the computer slept or restarted)
 * from a slow one. An error or warning is { message, file?, line? } with
 * the line in that file, as Tectonic reports it.
 *
 * Tectonic is downloaded once per computer from its GitHub release and
 * checked against the SHA-256 pinned in latex.json, into RO_LATEX_HOME
 * (default: the user's cache folder). LaTeX can write files anywhere
 * (\openout), and Tectonic has no switch against it, so the engine runs
 * confined: it writes only to the job dir and its package cache (Windows:
 * Low integrity; macOS: sandbox-exec; Linux: bubblewrap, which is required).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PIN = JSON.parse(readFileSync(join(here, 'latex.json'), 'utf8')).tectonic;
const WIN = process.platform === 'win32';
const SYS = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const [cmd, job] = process.argv.slice(2);

/** A failure the person can act on; its message is shown as it is. */
class Fault extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function home() {
  if (process.env.RO_LATEX_HOME) return process.env.RO_LATEX_HOME;
  if (WIN) return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'research-os', 'latex');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'research-os', 'latex');
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'research-os', 'latex');
}

let state = { phase: 'starting' };
/** Write status.json in one step (the app may read it at any moment). */
function put(patch) {
  state = Object.assign(state, patch, { beat: Date.now() });
  try {
    const tmp = join(job, 'status.json.tmp');
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, join(job, 'status.json'));
  } catch {
    /* the build was deleted while it ran */
  }
}

/** Windows: label a file or folder Low integrity (a folder's new files inherit it). */
function low(path, folder) {
  const r = spawnSync(join(SYS, 'icacls.exe'), [path, '/setintegritylevel', folder ? '(OI)(CI)low' : 'low'], { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Fault('Could not confine the LaTeX engine: ' + String(r.stdout || r.stderr || r.error || '').trim().slice(0, 300));
}

/** Tectonic for this computer, downloaded and checked the first time. */
async function tool() {
  const key = process.platform + '-' + process.arch;
  const pin = PIN.assets[key];
  if (!pin) throw new Fault('There is no LaTeX engine for this computer (' + key + ').');
  const name = WIN ? 'tectonic.exe' : 'tectonic';
  const dir = join(home(), 'tectonic-' + PIN.version);
  const bin = join(dir, name);
  if (existsSync(bin)) return bin;
  mkdirSync(home(), { recursive: true });
  const lock = dir + '.lock';
  // One download per computer: other builds wait for it.
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (existsSync(bin)) return bin;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10 * 60 * 1000) rmSync(lock, { recursive: true, force: true });
      } catch {
        /* it just went */
      }
      put({ phase: 'engine' });
      await sleep(1000);
    }
  }
  try {
    if (existsSync(bin)) return bin;
    put({ phase: 'engine' });
    const url = PIN.url.split('{version}').join(PIN.version).replace('{asset}', pin.asset);
    let res;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (e) {
      throw new Fault('Could not download the LaTeX engine: ' + String((e && e.cause && e.cause.message) || (e && e.message) || e).slice(0, 300));
    }
    if (!res.ok) throw new Fault('Could not download the LaTeX engine (HTTP ' + res.status + ').');
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash('sha256').update(buf).digest('hex') !== pin.sha256) throw new Fault('The downloaded LaTeX engine did not match its checksum, so it was not used.');
    const work = dir + '.part';
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const archive = join(work, pin.asset);
    writeFileSync(archive, buf);
    const x = spawnSync(WIN ? join(SYS, 'tar.exe') : 'tar', [pin.asset.endsWith('.zip') ? '-xf' : '-xzf', archive, '-C', work], { windowsHide: true, encoding: 'utf8' });
    if (x.status !== 0) throw new Fault('Could not unpack the LaTeX engine: ' + String(x.stderr || x.error || '').trim().slice(0, 300));
    rmSync(archive, { force: true });
    if (!existsSync(join(work, name))) throw new Fault('The LaTeX engine download did not hold ' + name + '.');
    if (!WIN) chmodSync(join(work, name), 0o755);
    rmSync(dir, { recursive: true, force: true });
    renameSync(work, dir);
    return bin;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The command that runs Tectonic so it can write only to the job dir and the cache. */
function confined(bin, args, cache) {
  if (WIN) return { file: bin, args: args };
  const J = realpathSync(job);
  const C = realpathSync(cache);
  if (process.platform === 'darwin') {
    const profile = '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath (param "JOB")) (subpath (param "CACHE")) (subpath (param "TMP")) (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper"))';
    return { file: '/usr/bin/sandbox-exec', args: ['-p', profile, '-D', 'JOB=' + J, '-D', 'CACHE=' + C, '-D', 'TMP=' + realpathSync(tmpdir()), bin].concat(args) };
  }
  const bwrap = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'].find((p) => existsSync(p));
  if (bwrap === undefined) throw new Fault('Building PDFs on Linux needs bubblewrap, so that a document cannot write outside its build folder. Install it (for example: sudo apt install bubblewrap) and build again.');
  return { file: bwrap, args: ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--bind', J, J, '--bind', C, C, '--unshare-all', '--share-net', '--die-with-parent', '--chdir', J, '--', bin].concat(args) };
}

function compile(bin, cache, first) {
  return new Promise((resolve) => {
    const c = confined(bin, ['-X', 'compile', 'main.tex', '--untrusted', '--keep-logs', '-Z', 'continue-on-errors'], cache);
    const minutes = first ? 20 : 6;
    let out = '';
    let err = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(c.file, c.args, { cwd: job, env: Object.assign({}, process.env, { TECTONIC_CACHE_DIR: cache }), windowsHide: true });
    } catch (e) {
      resolve({ code: -1, out: '', err: 'error: ' + String((e && e.message) || e), timedOut: false, minutes: minutes });
      return;
    }
    child.stdout.on('data', (d) => {
      if (out.length < 2000000) out += d;
    });
    child.stderr.on('data', (d) => {
      if (err.length < 2000000) err += d;
    });
    const limit = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, minutes * 60 * 1000);
    const beat = setInterval(() => put({}), 3000);
    let done = false;
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      clearTimeout(limit);
      clearInterval(beat);
      resolve({ code: code, out: out, err: err + (extra || ''), timedOut: timedOut, minutes: minutes });
    };
    child.on('error', (e) => finish(-1, '\nerror: ' + String((e && e.message) || e)));
    child.on('close', (code) => finish(code === null ? -1 : code));
  });
}

/**
 * What Tectonic reported: its "error:" and "warning:" lines, each with the
 * file and line when it gives them. XeTeX's own transcript, which Tectonic
 * prints between two rules of "=" after a failure, is the log, not a list.
 */
function issues(text) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  let inside = false;
  let last = null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^={20,}\s*$/.test(raw)) {
      inside = !inside;
      continue;
    }
    if (inside) continue;
    const cause = /^caused by: (.*)$/.exec(raw);
    if (cause !== null && last !== null) {
      last.message = (last.message + ' (' + cause[1].trim() + ')').slice(0, 600);
      continue;
    }
    const m = /^(error|warning): (?:(.+?):(\d+): )?(.*)$/.exec(raw);
    if (m === null) continue;
    const message = m[4].trim().replace(/^!\s*/, '');
    if (message === '' || seen.has(raw)) continue;
    seen.add(raw);
    // A warning without a place is about the run (how it was started), not the document.
    if (m[1] === 'warning' && m[2] === undefined) continue;
    const item = { message: message.slice(0, 500) };
    if (m[2] !== undefined) {
      item.file = m[2].replace(/^\.\//, '');
      item.line = Number(m[3]);
    }
    (m[1] === 'error' ? errors : warnings).push(item);
    last = item;
  }
  return { errors: errors.slice(0, 200), warnings: warnings.slice(0, 200) };
}

async function pageCount(path) {
  try {
    const pkg = join(here, '..', 'frontend', 'node_modules', 'pdfjs-dist');
    const pdfjs = await import(pathToFileURL(join(pkg, 'legacy', 'build', 'pdf.mjs')).href);
    const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    const n = (await task.promise).numPages;
    await task.destroy();
    return n;
  } catch {
    return 0;
  }
}

function logOf(r) {
  const path = join(job, 'main.log');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : r.out + '\n' + r.err;
  return text.length > 150000 ? text.slice(text.length - 150000) : text;
}

async function run() {
  const t0 = Date.now();
  const seconds = () => Math.round((Date.now() - t0) / 100) / 10;
  try {
    put({ phase: 'starting' });
    const bin = await tool();
    const cache = join(home(), 'cache');
    mkdirSync(cache, { recursive: true });
    if (WIN) {
      low(bin, false);
      low(cache, true);
      low(job, true);
    }
    const first = readdirSync(cache).length === 0;
    put({ phase: first ? 'packages' : 'compiling' });
    const r = await compile(bin, cache, first);
    const found = issues(r.err);
    if (r.timedOut) found.errors.unshift({ message: 'The build took longer than ' + r.minutes + ' minutes and was stopped.' });
    if (r.code !== 0 && found.errors.length === 0) found.errors.push({ message: 'The LaTeX engine stopped (exit code ' + r.code + ').' });
    const pdf = join(job, 'main.pdf');
    const ok = r.code === 0 && existsSync(pdf);
    put({ phase: ok ? 'done' : 'failed', ok: ok, pages: ok ? await pageCount(pdf) : 0, errors: found.errors, warnings: found.warnings, log: logOf(r), seconds: seconds() });
  } catch (e) {
    put({ phase: 'failed', ok: false, pages: 0, errors: [{ message: e instanceof Fault ? e.message : 'The build did not run: ' + String((e && e.message) || e).slice(0, 400) }], warnings: [], log: '', seconds: seconds() });
  }
}

if (!job || (cmd !== 'start' && cmd !== 'run')) {
  console.error('usage: node latex.mjs start|run <job dir>');
  process.exit(2);
}
if (cmd === 'start') {
  put({ phase: 'starting' });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', job], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
} else {
  await run();
}
