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

const snapshotSource = extractFunction('gpsPositionSnapshot', 'gpsAssessPosition');
const assessmentSource = extractFunction('gpsAssessPosition', 'updateGpsFilterStatus');
const mapReturnSource = [
  snapshotSource,
  extractFunction('finishGpsMapReturnRefresh', 'considerGpsMapReturnCandidate'),
  extractFunction('considerGpsMapReturnCandidate', 'gpsHasFreshPosition'),
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

function distanceMeters(a, b) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLng = toRad(Number(b.lng) - Number(a.lng));
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function position({ lat = 35.68, lng = 139.77, accuracy = 10, timestamp = Date.now() } = {}) {
  return { timestamp, coords: { latitude: lat, longitude: lng, accuracy } };
}

function createAssessmentContext({ last = null, ageMs = 0 } = {}) {
  const now = Date.now();
  const context = vm.createContext({
    Date,
    GPS_DEGRADED_POSITION_HOLD_MS: 3000,
    GPS_GOOD_ACCURACY_M: 25,
    GPS_JUMP_CONFIRM_RADIUS_M: 80,
    GPS_JUMP_CONFIRM_WINDOW_MS: 5000,
    GPS_MAX_PLAUSIBLE_SPEED_MPS: 55,
    GPS_POOR_POSITION_HOLD_MS: 12000,
    GPS_RAW_POSITION_MAX_AGE_MS: 15000,
    GPS_USABLE_ACCURACY_M: 60,
    distanceMeters,
    gpsLastUpdatedAt: last ? now - ageMs : 0,
    gpsPendingJump: null,
    lastKnownGps: last
  });
  vm.runInContext(`${snapshotSource}\n${assessmentSource}`, context);
  return { context, now };
}

{
  const { context } = createAssessmentContext();
  const result = context.gpsAssessPosition(position({ accuracy: 90 }));
  assert.equal(result.accept, true, '最初の有効位置は精度が荒くても現在地を表示する');
}

{
  const { context, now } = createAssessmentContext({
    last: { lat: 35.68, lng: 139.77, accuracy: 10 },
    ageMs: 1000
  });
  const result = context.gpsAssessPosition(position({ accuracy: 100, timestamp: now }));
  assert.equal(result.accept, false, '直前に良好位置がある時は60m超の粗い位置を保持しない');
  assert.equal(result.reason, 'poor_accuracy');
}

{
  const { context, now } = createAssessmentContext({
    last: { lat: 35.68, lng: 139.77, accuracy: 10 },
    ageMs: 13000
  });
  const result = context.gpsAssessPosition(position({ accuracy: 100, timestamp: now }));
  assert.equal(result.accept, true, '良好位置が12秒以上更新されなければ粗い位置でも追従を再開する');
}

{
  const { context, now } = createAssessmentContext({
    last: { lat: 35.68, lng: 139.77, accuracy: 10 },
    ageMs: 1000
  });
  const result = context.gpsAssessPosition(position({ accuracy: 40, timestamp: now }));
  assert.equal(result.accept, false, '直後に精度が大きく悪化した値は一時保留する');
  assert.equal(result.reason, 'degraded_accuracy');
}

{
  const { context, now } = createAssessmentContext({
    last: { lat: 35.68, lng: 139.77, accuracy: 10 },
    ageMs: 1000
  });
  const moving = position({ lat: 35.68054, accuracy: 40, timestamp: now });
  const result = context.gpsAssessPosition(moving);
  assert.equal(result.accept, true, '約60mの現実的な走行移動は精度40mでも止めない');
}

{
  const { context, now } = createAssessmentContext({
    last: { lat: 35.68, lng: 139.77, accuracy: 10 },
    ageMs: 1000
  });
  const firstJump = context.gpsAssessPosition(position({ lat: 35.685, accuracy: 10, timestamp: now }));
  assert.equal(firstJump.accept, false, '単発の約500m位置飛びは採用しない');
  assert.equal(firstJump.reason, 'jump');
  const confirmed = context.gpsAssessPosition(position({ lat: 35.68504, accuracy: 10, timestamp: now + 1000 }));
  assert.equal(confirmed.accept, true, '同じ移動先を連続受信した場合は実移動として追従を再開する');
  assert.equal(confirmed.reason, 'confirmed_jump');
}

function createTimers(calls) {
  let nextId = 1;
  const timers = new Map();
  return {
    clearTimeout(id) { timers.delete(id); },
    runDelay(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `${delay}ms のタイマーが見つかりません`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      calls.delays.push(delay);
      return id;
    },
    timers
  };
}

function createMapReturnContext({ ageMs, lastAccuracy = 10 }) {
  const calls = {
    clearRoute: 0,
    delays: [],
    ensureWatch: 0,
    freshError: null,
    freshOptions: null,
    freshSuccess: null,
    handled: 0,
    route: 0,
    saveCache: 0
  };
  const timers = createTimers(calls);
  const now = Date.now();
  let context;
  context = vm.createContext({
    Date,
    GPS_GOOD_ACCURACY_M: 25,
    GPS_MAP_RETURN_FRESH_MS: 2000,
    GPS_MAP_RETURN_SAMPLE_SETTLE_MS: 1200,
    GPS_MAP_RETURN_TIMEOUT_MS: 4000,
    GPS_RAW_POSITION_MAX_AGE_MS: 15000,
    GPS_USABLE_ACCURACY_M: 60,
    clearNextSegmentLayer: () => { calls.clearRoute += 1; },
    clearTimeout: timers.clearTimeout,
    console,
    ensureGpsWatching: () => { calls.ensureWatch += 1; return true; },
    gpsAutoFollow: true,
    gpsLastUpdatedAt: now - ageMs,
    gpsMapReturnCollector: null,
    gpsMapReturnRefreshId: 0,
    handleGpsPosition: pos => {
      calls.handled += 1;
      context.considerGpsMapReturnCandidate(pos, true);
      return true;
    },
    lastKnownGps: { lat: 35.68, lng: 139.77, accuracy: lastAccuracy },
    navigator: {
      geolocation: {
        getCurrentPosition(success, error, options) {
          calls.freshSuccess = success;
          calls.freshError = error;
          calls.freshOptions = options;
        }
      }
    },
    optimizedRouteOrderedIds: ['next'],
    saveGuidanceRouteCache: () => { calls.saveCache += 1; },
    setTimeout: timers.setTimeout,
    updateGuidanceBannerUi: () => {},
    updateNextSegmentHighlight: () => {
      calls.route += 1;
      return Promise.resolve(true);
    },
    userMarker: {}
  });
  vm.runInContext(mapReturnSource, context);
  return { calls, context, now, timers };
}

{
  const { calls, context } = createMapReturnContext({ ageMs: 1000, lastAccuracy: 10 });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  assert.equal(calls.ensureWatch, 1, '配送完了後もGPS監視を確認する');
  assert.equal(calls.freshOptions, null, '2秒以内かつ25m以内なら再取得を待たない');
  assert.equal(calls.route, 1, '良好なGPSでは案内線を即時更新する');
}

{
  const { calls, context, now, timers } = createMapReturnContext({ ageMs: 3000 });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  assert.equal(calls.clearRoute, 1, '古い案内線は再測位中に消す');
  assert.equal(calls.saveCache, 1, '古い案内線キャッシュを残さない');
  assert.equal(calls.freshOptions.maximumAge, 0, '配送完了後はキャッシュGPSを許可しない');
  assert.equal(calls.freshOptions.timeout, 4000, '最新GPS取得は4秒で打ち切る');
  calls.freshSuccess(position({ accuracy: 45, timestamp: now }));
  assert.equal(calls.route, 0, '中精度の位置は短時間だけ追加測位を待つ');
  assert.equal(context.gpsMapReturnCollector.best.accuracy, 45);
  timers.runDelay(1200);
  assert.equal(calls.route, 1, '1.2秒後には中精度位置で案内を再開する');
}

{
  const { calls, context, now } = createMapReturnContext({ ageMs: 3000 });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  calls.freshSuccess(position({ accuracy: 12, timestamp: now }));
  assert.equal(calls.route, 1, '25m以内の位置が来たら待たずに案内を再開する');
  assert.equal(context.gpsMapReturnCollector, null, '確定後は再測位タイマーを残さない');
}

{
  const { calls, context, timers } = createMapReturnContext({ ageMs: 3000 });
  context.refreshGpsAfterMapReturn({ refreshGuidance: true });
  calls.freshError({ code: 3 });
  assert.equal(calls.route, 0, '一時タイムアウトでも監視側の測位を待つ');
  timers.runDelay(4000);
  assert.equal(calls.route, 1, '測位がなくても4秒後には最後の位置で案内を復旧する');
}

function runWatchError(code) {
  const calls = { cleared: 0, delays: [], handled: 0, toast: [] };
  let errorCallback = null;
  let successCallback = null;
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
    handleGpsPosition: () => { calls.handled += 1; },
    navigator: {
      geolocation: {
        clearWatch: () => { calls.cleared += 1; },
        watchPosition: (success, error) => {
          successCallback = success;
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
    updateRecoveryStatusUi: () => {}
  });
  vm.runInContext(watchSource, context);
  context.ensureGpsWatching();
  assert.ok(errorCallback, 'GPS監視のエラー処理を取得できる');
  successCallback(position());
  assert.equal(calls.handled, 1, '通常監視も共通のGPS補正を通る');
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

assert.equal((html.match(/v2026\.06\.24-test\.123/g) || []).length, 3, 'テスト版表示を3箇所そろえる');
assert.match(html, /clearTemporaryGuidance\(\{ resume: false \}\);/);
assert.match(html, /refreshGpsAfterMapReturn\(\{ refreshGuidance: optimizedRouteOrderedIds\.length > 0 \}\);/);
assert.match(html, /watchPosition\(\s*\(pos\) => \{ handleGpsPosition\(pos, gpsAutoFollow\); \}/);
assert.match(html, /maximumAge: 0/);

console.log('delivery adaptive GPS tests: PASS');
