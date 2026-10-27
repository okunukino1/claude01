import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../delivery_map_mapbox/test/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing source: ${start}`);
  return html.slice(first, last);
}
const normalization = section('function normalizeAddress(', '\nfunction canonicalAddressForCacheWithNormalizer(');
const preferMapbox = section('async function preferExactMapboxAddress(', '\nasync function geocodeAddress(');
const cachedLookup = section('async function geocodeAddress(rawAddress)', '\nasync function getSharedGeocodeCache(');
const lookup = section('async function geocodeAddressUncached(', '\n// 国土地理院 住所検索API');
const fullScript = html.slice(html.indexOf("<script>\n'use strict';") + '<script>'.length, html.lastIndexOf('</script>'));
new vm.Script(fullScript);
const prefix = '架空県架空市架空町';
const address = `${prefix}12番34号 架空ビル203号室`;

function fixture({ responses = [], mapbox, local, shared, gsi, sharedWait } = {}) {
  const calls = { google: [], mapbox: 0, shared: 0, gsi: [], usage: [], cached: [], saved: [], logs: [] };
  const ctx = vm.createContext({ MAPBOX_ADDRESS_MATCH_VERSION: 1, geocodeInFlight: new Map(),
    geocodeCacheKey: value => value,
    getCachedGeocode: () => local || null,
    getSharedGeocodeCache: async () => { calls.shared++; if (sharedWait) await sharedWait; return shared || null; },
    lookupExactMapboxAddress: async () => { calls.mapbox++; return mapbox || { state: 'checked' }; },
    setCachedGeocode: (key, result) => calls.cached.push({ key, result }),
    saveSharedGeocodeCache: (key, raw, result) => calls.saved.push({ key, raw, result }),
    bumpUsage: name => calls.usage.push(name),
    console: { warn: (...args) => calls.logs.push(args), info: (...args) => calls.logs.push(args) },
    fetch: async (url, options) => {
      assert.equal(url, '../api/geocode_address.php');
      assert.equal(options.method, 'POST');
      calls.google.push(JSON.parse(options.body).address);
      const response = responses[Math.min(calls.google.length - 1, responses.length - 1)];
      assert.ok(response, 'Unexpected Google request');
      if (response.throw) throw new Error('private-address-token-and-url-must-not-be-logged');
      return { status: response.http, ok: response.http >= 200 && response.http < 300,
        json: async () => {
          if (response.invalidJson) throw new Error('private-address-token-and-url-must-not-be-logged');
          return response.data;
        } };
    },
    geocodeAddressViaGsi: async value => { calls.gsi.push(value); return gsi || null; }
  });
  new vm.Script([normalization, preferMapbox, cachedLookup, lookup].join('\n')).runInContext(ctx, { timeout: 1000 });
  return { ctx, calls, run: value => ctx.geocodeAddress(value ?? address) };
}
const result = { lat: 35, lng: 139, approx: false, formatted: 'fixture', location_type: 'ROOFTOP' };
const ok = { http: 200, data: result };
const notFound = { http: 404, data: { status: 'ZERO_RESULTS', detail: 'private-address-token-and-url-must-not-be-logged' } };

test('complete lot numbers and explicit units survive; buildings and rooms are removed', () => {
  const { ctx } = fixture();
  const samples = [
    ['12番34号', '12番34号'], ['12丁目3番4号', '12丁目3番4号'],
    ['1丁目2番3号 架空ビル203号室', '1丁目2番3号'],
    ['1-2-3 架空ビル203号室', '1-2-3'], ['1-2-3-203号室', '1-2-3'],
    ['1-2-3-203', '1-2-3-203'], ['12-34 架空ビル5-6 203号室', '12-34'],
    ['12番地34号', '12番地34号'], ['12番地の34', '12番地の34'],
    ['1丁目2番', '1丁目2番'], ['12番地 架空ビル', '12番地'],
    ['1丁目2-3 架空ビル', '1丁目2-3'], ['1の2の3 架空ビル', '1の2の3'],
    ['1 ノ 2 ノ 3 架空ビル', '1 ノ 2 ノ 3'], ['12 番 34 号 架空ビル', '12 番 34 号'],
    ['１２番３４号 架空ビル', '12番34号'], ['十二丁目三番四号 架空ビル', '12丁目3番4号'],
    ['12345 架空ビル203号室', '12345'], ['123-4567', '123-4567'],
    ['1-2-3 6F', '1-2-3'], ['1-2-3 A-203号室', '1-2-3'],
    ['1-2-3 架空様', '1-2-3'], ['1丁目', '1丁目'], ['', '']
  ];
  for (const [input, expected] of samples) assert.equal(ctx.cleanAddressForGeocoding(prefix + input), prefix + expected, input);
  assert.equal(ctx.cleanAddressForGeocoding(`〒123-4567 ${address}`), `${prefix}12番34号`);
  assert.equal(ctx.cleanAddressForGeocoding(`郵便番号：1234567 ${address}`), `${prefix}12番34号`);
  assert.equal(ctx.cleanAddressForGeocoding(`123-4567${address}`), `${prefix}12番34号`);
  assert.equal(ctx.cleanAddressForGeocoding('架空市北12条西3丁目4番5号 架空ビル'), '架空市北12条西3丁目4番5号');
  assert.equal(ctx.cleanAddressForGeocoding('架空市西六郷一丁目二番三号'), '架空市西六郷1丁目2番3号');
  assert.equal(ctx.cleanAddressForGeocoding('架空市二番町12番34号'), '架空市二番町12番34号');
  assert.equal(ctx.cleanAddressForGeocoding(''), '');
  assert.equal(ctx.cleanAddressForGeocoding(null), '');
});

test('alternate candidates retain the same numbers and never re-add room/building details', () => {
  const { ctx } = fixture();
  assert.deepEqual(Array.from(ctx.geocodingAddressCandidates(address)), [`${prefix}12番34号`, `${prefix}12-34`]);
  assert.deepEqual(Array.from(ctx.geocodingAddressCandidates(`${prefix}1-2-3 架空ビル203号室`)), [`${prefix}1-2-3`]);
  assert.deepEqual(Array.from(ctx.geocodingAddressCandidates(`${prefix}1丁目2番3号`)), [`${prefix}1丁目2番3号`, `${prefix}1-2-3`]);
  assert.deepEqual(Array.from(ctx.geocodingAddressCandidates(`${prefix}1ノ2ノ3`)), [`${prefix}1ノ2ノ3`, `${prefix}1-2-3`]);
  assert.deepEqual(Array.from(ctx.geocodingAddressCandidates('')), []);
});

test('success uses the complete address once and retains cache/source metadata', async () => {
  const { run, calls } = fixture({ responses: [ok] });
  const found = await run();
  assert.deepEqual(calls.google, [`${prefix}12番34号`]);
  assert.equal(found.source, 'google'); assert.equal(found.approx, false);
  assert.equal(found.locationType, 'ROOFTOP'); assert.equal(found.mapboxMatchVersion, 1);
  assert.equal(calls.cached.length, 1); assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].raw, address); assert.equal(calls.gsi.length, 0);
});

test('ZERO_RESULTS alone permits the distinct alternate, without extra retries', async () => {
  const { run, calls } = fixture({ responses: [notFound, ok] });
  assert.equal((await run()).source, 'google');
  assert.deepEqual(calls.google, [`${prefix}12番34号`, `${prefix}12-34`]);
  assert.equal(calls.gsi.length, 0);
});

for (const status of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'INVALID_REQUEST', 'UNKNOWN_ERROR']) {
  test(`${status} stops Google re-search while preserving approximate fallback`, async () => {
    const { run, calls } = fixture({ responses: [{ http: 502, data: { status, detail: address } }],
      gsi: { lat: 35, lng: 139, approx: true, source: 'gsi' } });
    assert.equal((await run()).source, 'gsi');
    assert.equal(calls.google.length, 1); assert.equal(calls.gsi.length, 1);
    assert.equal(calls.cached.length, 0); assert.equal(calls.saved.length, 0);
    assert.ok(!JSON.stringify(calls.logs).includes(address));
  });
}

for (const response of [
  { http: 401, data: {} }, { http: 403, data: {} }, { http: 429, data: {} },
  { http: 404, data: {} }, { http: 500, data: {} }, { http: 502, data: {} },
  { http: 503, data: { status: 'ZERO_RESULTS' } }, { http: 500, data: result },
  { http: 200, data: { ...result, status: 'REQUEST_DENIED' } },
  { http: 200, data: { lat: null, lng: null } }, { http: 200, data: { lat: 91, lng: 139 } },
  { http: 200, data: { lat: '35', lng: '139' } }, { http: 200, data: [] },
  { http: 200, invalidJson: true }, { throw: true }
]) {
  test(`unavailable response does not send another Google request: ${JSON.stringify(response)}`, async () => {
    const { run, calls } = fixture({ responses: [response] });
    assert.equal(await run(), null); assert.equal(calls.google.length, 1);
    assert.equal(calls.gsi.length, 2);
    assert.ok(!JSON.stringify(calls.logs).includes('private-address'));
  });
}

test('two result misses preserve GSI fallback and remove sensitive logging', async () => {
  const { run, calls } = fixture({ responses: [notFound] });
  assert.equal(await run(), null); assert.equal(calls.google.length, 2);
  assert.equal(calls.gsi.length, 2); assert.equal(calls.cached.length, 0);
  assert.ok(!JSON.stringify(calls.logs).includes('private-address'));
});

test('approximate Google locations remain approximate and are not locally fixed', async () => {
  const { run, calls } = fixture({ responses: [{ http: 200, data: { ...result, approx: true } }] });
  assert.equal((await run()).approx, true); assert.equal(calls.cached.length, 0);
  assert.equal(calls.saved.length, 1); assert.equal(calls.saved[0].result.approx, true);
});

test('valid numeric zero is accepted; malformed coordinates are not', () => {
  const { ctx } = fixture();
  assert.equal(ctx.googleGeocodeResponseKind({ ok: true }, { lat: 0, lng: 0 }), 'found');
  assert.equal(ctx.googleGeocodeResponseKind({ ok: true }, { lat: NaN, lng: 139 }), 'unavailable');
  assert.equal(ctx.googleGeocodeResponseKind({ ok: true }, { lat: 35, lng: Infinity }), 'unavailable');
});

test('exact Mapbox match bypasses Google', async () => {
  const exact = { lat: 35, lng: 139, source: 'mapbox', approx: false };
  const { run, calls } = fixture({ mapbox: { state: 'matched', result: exact } });
  assert.equal(await run(), exact); assert.equal(calls.google.length, 0); assert.equal(calls.gsi.length, 0);
});

for (const cache of ['local', 'shared']) {
  test(`${cache} manual pin is never replaced by a fresh lookup`, async () => {
    const manual = { lat: 35, lng: 139, manual: true };
    const { run, calls } = fixture({ [cache]: manual });
    assert.equal(await run(), manual); assert.equal(calls.google.length, 0); assert.equal(calls.mapbox, 0);
  });
}

test('concurrent identical inputs share a lookup and release the in-flight entry', async () => {
  let release;
  const sharedWait = new Promise(resolve => { release = resolve; });
  const { run, calls, ctx } = fixture({ responses: [ok], sharedWait });
  const first = run(), second = run(); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(calls.google.length, 1); assert.equal(calls.shared, 1);
  assert.equal(ctx.geocodeInFlight.size, 0);
});

test('empty input never generates a Google or GSI request', async () => {
  const { run, calls } = fixture();
  assert.equal(await run(''), null); assert.equal(calls.google.length, 0); assert.equal(calls.gsi.length, 0);
});
