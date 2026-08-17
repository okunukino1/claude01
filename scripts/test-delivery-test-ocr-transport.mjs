import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(scriptDir, '..', 'delivery_map_mapbox', 'test', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('async function ocrBlobToBase64');
const end = html.indexOf('// プレビュー表示と並行してOCRを裏で開始する。', start);
assert.ok(start >= 0 && end > start, 'OCR transport functions were not found');

let usageCalls = 0;
const context = vm.createContext({
  AbortController,
  Blob,
  Response,
  Uint8Array,
  btoa,
  console,
  JSON,
  PHOTO_OCR_MAX_SIZE: 1280,
  PHOTO_OCR_QUALITY: 0.8,
  compressImage: async file => file,
  startVisionOcrComparison: () => {},
  bumpUsage: () => { usageCalls++; },
  fetch: null
});
vm.runInContext(`${html.slice(start, end)}\n` +
  'globalThis.transport = { ocrExtractAddress, ocrWithRotationRetry };', context);

const photo = new Blob(['jpeg-test-bytes'], { type: 'image/jpeg' });

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ address: '東京都中央区1-2-3' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  usageCalls = 0;
  const result = await context.transport.ocrExtractAddress(photo, 0);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['Content-Type'], 'image/jpeg');
  assert.equal(usageCalls, 1);
}

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response('<html>blocked</html>', {
        status: 403,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    return new Response(JSON.stringify({ address: '東京都中央区1-2-3' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  usageCalls = 0;
  const result = await context.transport.ocrExtractAddress(photo, 0);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(Buffer.from(payload.image, 'base64').toString('utf8'), 'jpeg-test-bytes');
  assert.equal(payload.mimeType, 'image/jpeg');
  assert.equal(usageCalls, 1);
}

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ error: 'Gemini API rejected the request' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await context.transport.ocrExtractAddress(photo, 0);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(calls.length, 1);
}

{
  let attempts = 0;
  await assert.rejects(
    () => context.transport.ocrWithRotationRetry(async () => {
      attempts++;
      return { ok: false, status: 403, data: { error: 'blocked' } };
    }, 0),
    /HTTP 403: blocked/
  );
  assert.equal(attempts, 1);
}

console.log('delivery test OCR transport: PASS');
