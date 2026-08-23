import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const htmlPath = new URL('../delivery_map_mapbox/test/index.html', import.meta.url);
const html = fs.readFileSync(htmlPath, 'utf8');

function extractFunction(name, nextName) {
  const startToken = `function ${name}`;
  const endToken = `\nfunction ${nextName}`;
  const start = html.indexOf(startToken);
  const end = html.indexOf(endToken, start);
  assert.notEqual(start, -1, `${name} が見つかりません`);
  assert.notEqual(end, -1, `${name} の終端が見つかりません`);
  return html.slice(start, end);
}

const gpsSource = [
  extractFunction('gpsHasFreshPosition', 'refreshGuidanceAfterMapReturn'),
  extractFunction('refreshGuidanceAfterMapReturn', 'refreshGpsAfterMapReturn'),
  extractFunction('refreshGpsAfterMapReturn', 'ensureGpsWatching')
].join('\n');
const watchSource = [
  extractFunction('ensureGpsWatching', 'scheduleGpsRestart'),
  extractFunction('scheduleGpsRestart', 'toggleGpsTracking')
].join('\n');

const scriptMatch = /<script>\r?\n'use strict';/.exec(html);
const scriptStart = scriptMatch?.index ?? -1;
const scriptEnd = html.lastIndexOf('</script>');
assert.notEqual(scriptStart, -1, 'メインスクリプトが見つかりません');
assert.ok(scriptEnd > scriptStart, 'メインスクリプトの終端が見つかりません');
new vm.Script(html.slice(scriptStart + '<script>'.length, scriptEnd), {
  filename: 'delivery_map_mapbox/test/index.html'
});

function createMapReturnContext({ ageMs, positionResult = 'success' }) {
  const calls = {
    clearRoute: 0,
    ensureWatch: 0,
    freshOptions: null,
    route: 0,
    saveCache: 0,
    status: 0,
    updateLocation: 0
  };
  const now = Date.now();
  const position = {
    timestamp: now,
    coords: { latitude: 35.68, longitude: 139.77, accuracy: 10 }
  };
  const context = vm.createContext({
    GPS_MAP_RETURN_FRESH_MS: 2000,
    GPS_MAP_RETURN_TIMEOUT_MS: 6000,
    clearNextSegmentLayer: () => { calls.clearRoute += 1; },
    clearTimeout,
    console,
    ensureGpsWatching: () => { calls.ensureWatch += 1; return true; },
    gpsAutoFollow: true,
    gpsLastUpdatedAt: now - ageMs,
    gpsMapReturnRefreshId: 0,
    navigator: {
      geolocation: {
        getCurrentPosition(success, error, options) {
          calls.freshOptions = options;
          if (positionResult === 'success') success(position);
          else error({ code: 3 });
        }
      }
    },
    optimizedRouteOrderedIds: ['next'],
    saveGuidanceRouteCache: () => { calls.saveCache += 1; },
    setTimeout,
    updateGuidanceBannerUi: () => { calls.status += 1; },
    updateNextSegmentHighlight: () => {
      calls.route += 1;
      return Promise.resolve(true);
    },
    updateUserLocation: () => { calls.updateLocation += 1; },
    userMarker: {}
  });
  vm.runInContext(gpsSource, context);
  return { calls, context };
}

{
  const { calls, context } = createMapReturnContext({ ageMs: 1000 });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  assert.equal(calls.ensureWatch, 1, '配送完了後もGPS監視を確認する');
  assert.equal(calls.freshOptions, null, '2秒以内のGPSは再取得しない');
  assert.equal(calls.route, 1, '新しいGPSなら案内線をすぐ更新する');
  assert.equal(calls.clearRoute, 0, '新しいGPSでは案内線を待機消去しない');
}

{
  const { calls, context } = createMapReturnContext({ ageMs: 3000 });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  assert.equal(calls.clearRoute, 1, '古い案内線は最新GPSの待機中に消す');
  assert.equal(calls.saveCache, 1, '古い案内線キャッシュを残さない');
  assert.equal(calls.freshOptions.maximumAge, 0, '配送完了後はキャッシュGPSを許可しない');
  assert.equal(calls.freshOptions.timeout, 6000, '最新GPS取得は6秒で打ち切る');
  assert.equal(calls.updateLocation, 1, '取得した最新GPSをマーカーへ反映する');
  assert.equal(calls.route, 1, '最新GPS反映後に案内線を更新する');
}

{
  const { calls, context } = createMapReturnContext({ ageMs: 3000, positionResult: 'error' });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  assert.equal(calls.updateLocation, 0, '最新GPS失敗時は位置を上書きしない');
  assert.equal(calls.route, 1, '最新GPS失敗時も最後の位置で案内線を復旧する');
}

function runWatchError(code) {
  const calls = { cleared: 0, delays: [], toast: [] };
  let errorCallback = null;
  const context = vm.createContext({
    GPS_TRANSIENT_RESTART_DELAY_MS: 1000,
    clearTimeout: () => {},
    console,
    document: { hidden: false },
    gpsActive: false,
    gpsAutoFollow: true,
    gpsInitialCenterStartedAt: 0,
    gpsLastError: '',
    gpsRestartTimer: null,
    gpsTransientNoticeAt: 0,
    gpsWatchId: null,
    navigator: {
      geolocation: {
        clearWatch: () => { calls.cleared += 1; },
        watchPosition: (success, error) => {
          errorCallback = error;
          return 17;
        }
      }
    },
    setTimeout: (callback, delay) => {
      calls.delays.push(delay);
      return { callback, delay };
    },
    showToast: message => { calls.toast.push(message); },
    updateGpsButton: () => {},
    updateRecoveryStatusUi: () => {},
    updateUserLocation: () => {}
  });
  vm.runInContext(watchSource, context);
  context.ensureGpsWatching();
  assert.ok(errorCallback, 'GPS監視のエラー処理を取得できる');
  errorCallback({ code });
  return { calls, context };
}

{
  const { calls, context } = runWatchError(3);
  assert.equal(context.gpsAutoFollow, true, '一時タイムアウトでは追跡を解除しない');
  assert.deepEqual(calls.delays, [1000], '一時エラーは1秒後に再接続する');
  assert.equal(calls.cleared, 1, '失敗したGPS監視を解除してから再接続する');
}

{
  const { calls, context } = runWatchError(1);
  assert.equal(context.gpsAutoFollow, false, '許可拒否時だけ追跡を解除する');
  assert.deepEqual(calls.delays, [], '許可拒否は自動再接続を繰り返さない');
}

assert.equal((html.match(/v2026\.06\.24-test\.122/g) || []).length, 3, 'テスト版表示を3箇所そろえる');
assert.match(html, /clearTemporaryGuidance\(\{ resume: false \}\);/);
assert.match(html, /refreshGpsAfterMapReturn\(\{ refreshGuidance: optimizedRouteOrderedIds\.length > 0 \}\);/);

console.log('delivery GPS map-return tests: PASS');
