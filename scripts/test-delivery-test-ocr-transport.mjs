import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(scriptDir, '..', 'delivery_map_mapbox', 'test', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('async function ocrBlobToBase64');
const end = html.indexOf('// プレビュー表示と並行してOCRを裏で開始する。', start);
assert.ok(start >= 0 && end > start, 'OCR transport functions were not found');

let usageCalls = [];
const context = vm.createContext({
  AbortController,
  Blob,
  Response,
  Uint8Array,
  btoa,
  console,
  JSON,
  Number,
  performance,
  window: { performance },
  OCR_HYBRID_API: '../api/extract_address_hybrid_test.php',
  PHOTO_OCR_MAX_SIZE: 1280,
  PHOTO_OCR_QUALITY: 0.8,
  compressImage: async file => file,
  bumpUsage: name => { usageCalls.push(name); },
  normalizeVisionComparisonProvider: (data, status, elapsedMs) => ({
    state: String(data && data.state || (data && data.ok ? 'success' : 'error')),
    ok: !!(data && data.ok),
    elapsedMs: Number(data && data.elapsed_ms) || elapsedMs,
    addressCandidates: data && data.address_candidates || [],
    postalCodes: data && data.postal_codes || [],
    roomCandidates: data && data.room_candidates || [],
    errorCode: String(data && data.error_code || ''),
    error: String(data && data.error || '')
  }),
  assignOcrComparisonVisionResult: (session, provider) => {
    session.visionStarted = true;
    session.visionPromise = Promise.resolve(provider);
  },
  fetch: null
});
vm.runInContext(`${html.slice(start, end)}\n` +
  'globalThis.transport = { ocrExtractAddress, ocrWithRotationRetry };', context);

const photo = new Blob(['jpeg-test-bytes'], { type: 'image/jpeg' });
const createSession = () => ({ hybridAttempted: false, geminiAttempts: 0 });

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      ok: true,
      result: { address: '〒103-0015 東京都中央区日本橋箱崎町43-5', ocr_mode: 'vision_gemini_text' },
      vision: {
        state: 'success',
        ok: true,
        elapsed_ms: 700,
        address_candidates: ['東京都中央区日本橋箱崎町43-5']
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  usageCalls = [];
  const session = createSession();
  const result = await context.transport.ocrExtractAddress(photo, 0, undefined, null, session);
  assert.equal(result.ok, true);
  assert.equal(result.data.ocr_mode, 'vision_gemini_text');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '../api/extract_address_hybrid_test.php');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(usageCalls, ['visionOcr', 'ocr']);
  assert.equal((await session.visionPromise).ok, true);
}

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        ok: false,
        fallback_required: true,
        error_code: 'selector_low_confidence',
        vision: { state: 'success', ok: true, address_candidates: ['東京都中央区1-2-3'] }
      }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ address: '東京都中央区1-2-3' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  usageCalls = [];
  const session = createSession();
  const result = await context.transport.ocrExtractAddress(photo, 0, undefined, null, session);
  assert.equal(result.ok, true);
  assert.equal(result.data.ocr_mode, 'gemini_image_fallback');
  assert.equal(result.data.hybrid_fallback_reason, 'selector_low_confidence');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '../api/extract_address_test.php');
  assert.equal(calls[1].options.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(usageCalls, ['visionOcr', 'ocr', 'ocr']);
}

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        ok: false,
        fallback_required: true,
        error_code: 'vision_no_text',
        vision: { state: 'no_text', ok: false, error_code: 'no_text' }
      }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    if (calls.length === 2) {
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
  usageCalls = [];
  const result = await context.transport.ocrExtractAddress(photo, 0, undefined, null, createSession());
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  const payload = JSON.parse(calls[2].options.body);
  assert.equal(Buffer.from(payload.image, 'base64').toString('utf8'), 'jpeg-test-bytes');
  assert.deepEqual(usageCalls, ['visionOcr', 'ocr', 'ocr']);
}

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      ok: false,
      fallback_required: false,
      error_code: 'selector_quota_exceeded',
      error: '利用上限です',
      vision: { state: 'success', ok: true }
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  };
  usageCalls = [];
  const result = await context.transport.ocrExtractAddress(photo, 0, undefined, null, createSession());
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(calls.length, 1);
  assert.deepEqual(usageCalls, ['visionOcr', 'ocr']);
}

{
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        ok: false,
        fallback_required: true,
        error_code: 'selector_low_confidence',
        vision: { state: 'success', ok: true }
      }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    if (calls.length === 2) {
      return new Response(JSON.stringify({ address: '', error: '向き不明', rotation_hint: 180 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ address: '東京都中央区1-2-3', rotation_hint: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  usageCalls = [];
  const session = createSession();
  const result = await context.transport.ocrWithRotationRetry(
    rotation => context.transport.ocrExtractAddress(photo, rotation, undefined, null, session),
    0
  );
  assert.equal(result.address, '東京都中央区1-2-3');
  assert.equal(calls.filter(call => call.url === '../api/extract_address_hybrid_test.php').length, 1);
  assert.equal(calls.filter(call => call.url === '../api/extract_address_test.php').length, 2);
  assert.deepEqual(usageCalls, ['visionOcr', 'ocr', 'ocr', 'ocr']);
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

console.log('delivery test hybrid OCR transport: PASS');
