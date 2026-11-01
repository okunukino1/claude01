import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../delivery_map_mapbox/', import.meta.url);
const worker = fs.readFileSync(new URL('service-worker.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const base = 'https://fixture.invalid/delivery_map_mapbox/';
function fixture({ offline = false } = {}) {
  const handlers = new Map(), navigations = [], requests = [];
  const windows = ['', 'index.html?refresh=1', 'test/', 'pickup_light/', 'game/'].map(relative => ({
    url: base + relative, navigate(url) { navigations.push(url); return Promise.resolve(); }
  }));
  const context = vm.createContext({ URL, Response, Promise,
    self: { registration: { scope: base }, addEventListener(type, handler) { handlers.set(type, handler); },
      skipWaiting: () => Promise.resolve(), clients: { matchAll: async () => windows,
        claim() { throw Error('Must not claim test clients'); }, openWindow: async url => navigations.push(url) } },
    caches: new Proxy({}, { get() { throw Error('Must not modify or read existing caches'); } }),
    indexedDB: new Proxy({}, { get() { throw Error('Must not touch stored photos'); } }),
    fetch: async (request, options) => { requests.push({ request, options });
      if (offline) throw Error('offline'); return new Response(html); }
  });
  vm.runInContext(worker, context);
  return { context, handlers, navigations, requests };
}
test('stable-only URL matching never captures test, API, other app or foreign URLs', () => {
  const { context: c } = fixture();
  for (const path of ['', 'index.html', '?refresh=1', 'index.html?version_check=1']) assert.ok(c.isStableShellUrl(base + path));
  for (const path of ['test/', 'test/index.html', 'test/service-worker.js', 'api/maps_config.php', 'pickup_light/', 'qr/', 'game/', 'manual.html']) assert.equal(c.isStableShellUrl(base + path), false);
  assert.equal(c.isStableShellUrl('https://other.invalid/delivery_map_mapbox/'), false);
  assert.equal(c.isStableShellUrl('bad'), false);
});
test('worker activation refreshes only stable windows and preserves all stores', async () => {
  const { handlers, navigations } = fixture(); let pending;
  handlers.get('activate')({ waitUntil(promise) { pending = promise; } }); await pending;
  assert.equal(navigations.length, 2);
  assert.ok(navigations.every(url => url === base + '?stable_suspended=1'));
});
test('stable requests bypass the old shell cache and request current network content', async () => {
  const { handlers, requests } = fixture(); let response;
  handlers.get('fetch')({ request: { method: 'GET', url: base }, respondWith(promise) { response = promise; } });
  assert.match(await (await response).text(), /通常版は一時停止中です/);
  assert.equal(requests.length, 1); assert.equal(requests[0].options.cache, 'no-store');
});
test('test/shared API requests, POST and other scopes are passed through untouched', () => {
  const { handlers, requests } = fixture();
  for (const [method, url] of [['GET',base+'test/'],['GET',base+'api/maps_config.php'],['POST',base]]) {
    handlers.get('fetch')({ request: { method, url }, respondWith() { throw Error('Unexpected interception'); } });
  }
  assert.equal(requests.length, 0);
});
test('offline stable requests get a suspension notice, never cached active app HTML', async () => {
  const { context: c } = fixture({ offline: true });
  const response = await c.stableShellNetworkOnly({ url: base });
  assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(await response.text(), /通常版は一時停止中です/);
});
test('a verified server-side restoration is not blocked by the suspension worker', async () => {
  const { context: c } = fixture();
  c.fetch = async () => new Response('verified restored app');
  assert.equal(await (await c.stableShellNetworkOnly({ url: base })).text(), 'verified restored app');
});
test('page registers only its own worker and loads no maps, APIs or data stores', () => {
  new vm.Script(worker);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1]; new vm.Script(script);
  assert.match(script, /register\('service-worker.js', \{ scope: '\.\/', updateViaCache: 'none' \}\)/);
  assert.doesNotMatch(html, /<script[^>]*src=|fetch\(|localStorage|indexedDB|mapbox-gl|google\.maps/);
  assert.doesNotMatch(worker, /caches\.(delete|open)|indexedDB|localStorage|clients\.claim/);
});
