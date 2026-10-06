/**
 * Files on their way to or from the server (v4 plan §7.1, N-B11), through operations like every
 * other write (bootstrap.pb.js refuses direct record writes):
 *
 *   files.stage-upload    an admin's file (multipart, ≤ 20 MB) — then files.upload prepares saving it
 *   sensors.transfer-put  the monitor's answer to a files.download a person asked for — the file is
 *                         for whoever asked (from the request, never from the monitor's word)
 *
 * Both land in file_transfers, readable only by that person and the server's monitor, gone after an hour.
 */
const repo = require('../infra/repo.js');
const { OpError } = require('../core/util.js');

const MAX = 20000000;
const SHA = /^[0-9a-f]{64}$/;

function uploaded(e) {
  let files = [];
  try {
    files = e.findUploadedFiles('file') || [];
  } catch (_) {
    files = [];
  }
  if (!files.length) throw new OpError(400, 'Send the file as multipart form data (field "file").');
  if (files[0].size > MAX) throw new OpError(413, 'Files up to 20 MB go through NetSentry — use the terminal (scp) for bigger ones.');
  return files[0];
}

function save(app, fields, file) {
  const rec = new Record(app.findCollectionByNameOrId('file_transfers'));
  for (const k of Object.keys(fields)) rec.set(k, fields[k]);
  rec.set('file', file);
  app.save(rec);
  return rec;
}

function stageUpload(app, actor, p, e) {
  const file = uploaded(e);
  const sha = String(p.sha256 || '');
  if (!SHA.test(sha)) throw new OpError(400, 'sha256 (of the file) is required.');
  const server = require('./server.js').theServer(app);
  if (!server) throw new OpError(404, 'No server is set up yet.');
  const name = String(p.name || file.originalName || 'file').replace(/[\\/\0\n\r]/g, '_').slice(0, 255);
  const rec = save(app, { asset: server.id, direction: 'up', name, size: file.size, sha256: sha, created_by: actor.id }, file);
  return { ok: true, transfer_id: rec.id, name, size: file.size };
}

function monitorPut(app, actor, p, e) {
  const sensor = repo.byId(app, 'sensors', actor.id);
  if (!sensor) throw new OpError(403, 'Not a monitor.');
  const pending = $app.store().get(`readpending:${String(p.request_id || '')}`);
  if (!pending || pending.kind !== 'files.download' || pending.asset !== sensor.getString('asset') || pending.who === 'agent') {
    throw new OpError(404, 'No download was asked for on this server.');
  }
  const file = uploaded(e);
  const sha = String(p.sha256 || '');
  const rec = save(app, {
    asset: sensor.getString('asset'), direction: 'down', name: String(p.name || 'file').replace(/[\\/\0\n\r]/g, '_').slice(0, 255),
    size: file.size, sha256: SHA.test(sha) ? sha : '', created_by: pending.who,
  }, file);
  return { ok: true, transfer_id: rec.id };
}

module.exports = { stageUpload, monitorPut };
