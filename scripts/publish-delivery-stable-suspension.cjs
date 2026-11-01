'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const dir = '/tmp/delivery-stable-suspension';
const targets = ['index.html', 'service-worker.js'];
const protectedFiles = ['test/index.html', 'test/service-worker.js'];
const normalized = value => value.toString('utf8').replaceAll('\r\n', '\n');
const digest = value => crypto.createHash('sha256').update(normalized(value)).digest('hex');
const expected = [process.env.APPROVED_HTML_SHA256, process.env.APPROVED_WORKER_SHA256];
const id = process.env.GITHUB_RUN_ID;
const result = { suspended: false, filesPublished: [], cleanupComplete: true, testUnchanged: false,
  candidate: process.env.CANDIDATE_SHA, realApiCalls: 0 };
const staged = ['index.stable-suspend-' + id + '.html', 'worker.stable-suspend-' + id + '.js'];
const rollback = ['index.stable-rollback-' + id + '.html', 'worker.stable-rollback-' + id + '.js'];
let root, credentialsValid = false, stagedAttempted = false;
const promoted = [];
const before = new Map(), candidates = new Map();
const quote = value => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
function ftp(relative, options = []) {
  const config = ['silent', 'show-error', 'fail', 'ssl-reqd', 'connect-timeout = 20', 'max-time = 60', 'retry = 0',
    'url = ' + quote(`ftp://${process.env.FTP_SERVER}/${root}/${relative}`),
    'user = ' + quote(process.env.FTP_USERNAME + ':' + process.env.FTP_PASSWORD)];
  for (const [key, value] of options) config.push(value === true ? key : key + ' = ' + quote(value));
  const call = spawnSync('curl', ['-q', '--config', '-'], { input: config.join('\n') + '\n', encoding: 'utf8', timeout: 70000, maxBuffer: 2 * 1024 * 1024 });
  if (call.error || call.status !== 0) {
    let details = String(call.stderr || call.error?.message || '').slice(0, 500);
    for (const name of ['FTP_PASSWORD', 'FTP_USERNAME', 'FTP_SERVER', 'FTP_REMOTE_DIR']) if (process.env[name]) details = details.replaceAll(process.env[name], '[redacted]');
    throw Error(`FTPS operation failed (${call.status}): ${details}`);
  }
  return call.stdout;
}
async function http(relative, label) {
  const response = await fetch('https://rys-services.com/delivery_map_mapbox/' + relative + '?suspension=' + id + '-' + label,
    { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(label + ' HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
function equal(actual, wanted, label) { if (digest(actual) !== digest(wanted)) throw Error(label + ' hash mismatch'); }
function promote(from, to, wanted, outputName) {
  const output = path.join(dir, outputName);
  ftp(to, [['quote', 'RNFR ' + root + '/' + from], ['quote', 'RNTO ' + root + '/' + to], ['output', output]]);
  if (!fs.readFileSync(output).equals(wanted)) throw Error(to + ' renamed bytes mismatch');
}
async function settled(relative, wanted, previous, label) {
  for (const delay of [0, 2000, 5000, 10000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const actual = await http(relative, label + '-' + delay);
    if (digest(actual) === digest(wanted)) return actual;
    if (digest(actual) !== digest(previous)) throw Error(label + ' unexpected third-party file');
  }
  throw Error(label + ' stayed stale');
}
async function checkTest(label) {
  for (const file of protectedFiles) equal(await http(file, label), before.get(file), label + ' ' + file);
  equal(await http('test/', label + '-directory'), before.get('test/index.html'), 'Test directory');
}
(async () => {
  try {
    if (!/^\d+$/.test(id)) throw Error('Invalid run identifier');
    root = String(process.env.FTP_REMOTE_DIR || '').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (process.env.FTP_SERVER !== 'www1106.onamae.ne.jp' || root !== 'rys-services.com/delivery_map_mapbox') throw Error('Unapproved FTP destination');
    if (!process.env.FTP_USERNAME || !process.env.FTP_PASSWORD || /[\r\n\0]/.test(process.env.FTP_USERNAME + process.env.FTP_PASSWORD)) throw Error('Invalid FTP credentials');
    credentialsValid = true;
    fs.mkdirSync(dir, { recursive: true });
    for (const [index, file] of targets.entries()) {
      const bytes = fs.readFileSync('delivery_map_mapbox/' + file);
      if (digest(bytes) !== expected[index]) throw Error('Candidate changed: ' + file);
      candidates.set(file, bytes);
    }
    for (const file of [...targets, ...protectedFiles]) {
      const bytes = await http(file, 'before');
      equal(bytes, fs.readFileSync(path.join(dir, 'expected-' + file.replaceAll('/', '_'))), 'Public baseline ' + file);
      before.set(file, bytes); fs.writeFileSync(path.join(dir, 'before-' + file.replaceAll('/', '_')), bytes);
    }
    for (const file of targets) {
      const output = path.join(dir, 'ftp-before-' + file);
      ftp(file, [['output', output]]); equal(fs.readFileSync(output), before.get(file), 'FTP baseline ' + file);
    }
    if (process.env.PREPARE_ONLY === 'true') { result.prepared = true; return; }
    stagedAttempted = true;
    for (const [index, file] of targets.entries()) {
      ftp(staged[index], [['upload-file', 'delivery_map_mapbox/' + file]]);
      const output = path.join(dir, 'staged-' + file); ftp(staged[index], [['output', output]]);
      if (!fs.readFileSync(output).equals(candidates.get(file))) throw Error('Staged bytes mismatch');
      equal(await http(staged[index], 'stage'), candidates.get(file), 'Staged public ' + file);
    }
    await checkTest('pre-promote');
    for (const file of targets) equal(await http(file, 'pre-promote'), before.get(file), 'Stable before ' + file);
    for (const [index, file] of targets.entries()) {
      promoted.push(index);
      promote(staged[index], file, candidates.get(file), 'ftp-after-' + file);
      const bytes = await settled(file, candidates.get(file), before.get(file), 'after-' + index);
      fs.writeFileSync(path.join(dir, 'after-' + file), bytes);
      result.filesPublished.push(file);
    }
    equal(await http('', 'directory'), candidates.get('index.html'), 'Stable directory');
    await checkTest('after');
    result.suspended = true; result.testUnchanged = true; result.publishedAt = new Date().toISOString();
  } catch (error) {
    result.error = error.message; process.exitCode = 1;
    if (promoted.length) {
      try {
        for (const index of [...promoted].reverse()) {
          const file = targets[index], check = path.join(dir, 'rollback-check-' + file);
          ftp(file, [['output', check]]); const current = fs.readFileSync(check);
          if (digest(current) === digest(candidates.get(file))) {
            const backup = path.join(dir, 'ftp-before-' + file), stagedBackup = path.join(dir, 'rollback-staged-' + file);
            ftp(rollback[index], [['upload-file', backup]]); ftp(rollback[index], [['output', stagedBackup]]);
            if (!fs.readFileSync(stagedBackup).equals(fs.readFileSync(backup))) throw Error('Rollback staging mismatch');
            promote(rollback[index], file, fs.readFileSync(backup), 'ftp-restored-' + file);
          } else equal(current, before.get(file), 'Rollback refuses third-party overwrite');
          await settled(file, before.get(file), candidates.get(file), 'restored-' + index);
        }
        result.rollbackRestored = true;
      } catch (rollbackError) { result.rollbackRestored = false; result.rollbackError = rollbackError.message; }
    }
  } finally {
    if (credentialsValid && stagedAttempted) {
      try {
        const present = ftp('', [['list-only', true]]).split(/\r?\n/).map(name => name.split('/').pop());
        for (const file of [...staged, ...rollback]) if (present.includes(file)) ftp('index.html', [['quote', 'DELE ' + root + '/' + file], ['output', path.join(dir, 'cleanup-current.html')]]);
        const remaining = ftp('', [['list-only', true]]).split(/\r?\n/).map(name => name.split('/').pop());
        if ([...staged, ...rollback].some(file => remaining.includes(file))) throw Error('Temporary files remain');
      } catch (error) { result.cleanupComplete = false; result.cleanupError = error.message; process.exitCode = 1; }
    }
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
