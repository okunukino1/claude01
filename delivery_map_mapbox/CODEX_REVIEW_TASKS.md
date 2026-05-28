# 配送・集荷アプリ — Codex修正タスク一覧

リポジトリ: `okunukino1/claude01`
対象ディレクトリ: `delivery_map_mapbox/`
アプリバージョン: `v2026.05.28-6`

このファイルは、コードレビューで検出した問題をCodexが実装できる形でまとめたものです。
**修正は変更しないこと：** 集荷/配送ロジックの振る舞いは変えず、セキュリティ・バグ・パフォーマンスの問題のみ修正してください。

---

## 優先度凡例
- 🔴 **P1 — すぐ修正**（セキュリティ・データ破壊リスク）
- 🟡 **P2 — 近日中に修正**（バグ・パフォーマンス・保守性）
- 🟢 **P3 — 余裕があれば修正**（軽微・将来リスク）

---

# 🔴 P1 タスク（すぐ修正）

---

## TASK-S1: SSRF脆弱性を修正する — `api/spot_pickups_touch.php`

### 問題
`$_SERVER['HTTP_HOST']` はHTTPリクエストの `Host:` ヘッダーそのままで、クライアントが偽装できる。
攻撃者が `Host: attacker.example.com` でPOSTすると、サーバーが `attacker.example.com` へ
`?secret=<実シークレット>` 付きリクエストを送信してしまう（SSRF + シークレット漏洩）。

### 現在のコード（`api/spot_pickups_touch.php` L.50-53）
```php
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? '';
$path = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/') . '/spot_pickups_refresh.php';
$url = $scheme . '://' . $host . $path . '?secret=' . rawurlencode($secret) . '&trigger=touch';

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 60,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS => 5,
  CURLOPT_SSL_VERIFYPEER => false,
  CURLOPT_SSL_VERIFYHOST => false,
  CURLOPT_HTTPHEADER => ['Accept: application/json,text/plain,*/*'],
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

$ok = $response !== false && $httpCode >= 200 && $httpCode < 300;
if ($ok) {
  // ... state file write
}

if (!$ok) {
  http_response_code(502);
  echo json_encode([
    'error' => 'スポット集荷の起動時チェックに失敗しました',
    'detail' => $curlErr ?: ('HTTP ' . $httpCode),
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$data = json_decode((string)$response, true);
echo json_encode([
  'ok' => true,
  'skipped' => false,
  'refresh' => is_array($data) ? $data : null,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
```

### 修正方針
外部HTTP呼び出しをやめ、`spot_pickups_refresh.php` を直接 `require` して呼び出す。
ただし `spot_pickups_refresh.php` は単体でも動作する必要があるため、関数抽出方式で対応する。

### 修正手順

**Step 1: `api/spot_pickups_refresh.php` の処理を関数化する**

`spot_pickups_refresh.php` の末尾（`$date = current_pickup_date();` 以降のメイン処理）を
`run_spot_pickup_refresh(string $slot): array` という関数に包む。
ファイルが直接実行された場合（`php_sapi_name()` でも `$_SERVER['SCRIPT_FILENAME']` でも可）は
従来通り出力する。関数呼び出し時はレスポンスを返すだけで `echo` しない。

**Step 2: `api/spot_pickups_touch.php` を書き換える**

HTTP curl呼び出しブロック全体を削除し、代わりに以下のように直接呼び出す。

```php
// spot_pickups_touch.php の curl ブロックをこれに置き換える

// state file に last_run を書き込む
$dir = dirname($stateFile);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($stateFile, json_encode([
  'last_run' => $now,
  'last_run_at' => date('c', $now),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);

// 直接呼び出す（HTTP経由をやめる）
require_once __DIR__ . '/spot_pickups_refresh.php';
$refreshResult = run_spot_pickup_refresh('all');

echo json_encode([
  'ok' => true,
  'skipped' => false,
  'refresh' => $refreshResult,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
```

---

## TASK-S2: SSL検証を有効にする — 全 cURL 呼び出し

### 問題
以下のファイルで `CURLOPT_SSL_VERIFYPEER => false` / `CURLOPT_SSL_VERIFYHOST => false` が設定されており、
MITM攻撃でシークレットや集荷データが傍受される可能性がある。

### 対象ファイルと行番号
| ファイル | 行（概算） | 用途 |
|---|---|---|
| `api/pickup_sheet.php` | L.63-64 | Google Sheets CSV取得 |
| `api/pickup_progress.php` | L.96-97 | Apps Script書き込み |
| `api/pickup_location.php` | L.103-104 | Apps Script書き込み |
| `api/spot_pickups_refresh.php` | L.126,329 | エコ配ログイン・Apps Script |
| `api/tile_proxy.php` | L.44-45 | Geoshapeタイル取得 |

### 修正方針
各ファイルの `CURLOPT_SSL_VERIFYPEER => false` と `CURLOPT_SSL_VERIFYHOST => false` の2行を削除する。

サーバーのCAバンドルが古い場合は `CURLOPT_CAINFO => '/etc/ssl/certs/ca-certificates.crt'` を追加する
（削除後に動作確認して決める）。

### 削除する行のパターン（全ファイル共通）
```php
// この2行を各ファイルから削除する
CURLOPT_SSL_VERIFYPEER => false,
CURLOPT_SSL_VERIFYHOST => false,
```

---

## TASK-S3: OCR・ジオコーディングAPIに簡易リファラーチェックを追加する

### 問題
`api/extract_address.php` と `api/geocode_address.php` は認証なしで公開されており、
誰でも繰り返し呼び出して Gemini / Google Geocoding の課金を発生させることができる。

### 対象ファイル
- `api/extract_address.php`（L.1〜末尾）
- `api/geocode_address.php`（L.1〜末尾）

### 修正方針
PHPの `$_SERVER['HTTP_REFERER']` または Origin ヘッダーでドメインチェックを行う。
`config.php` に許可ドメインを追加し、一致しないリクエストを 403 で拒否する。

**Step 1: `api/config.php`（および `api/config.sample.php`）に追記する**
```php
// === API アクセス制限 ===
// このドメインからのリクエストのみ extract_address.php / geocode_address.php を許可します。
// 末尾スラッシュなし。例: 'https://your-domain.com'
define('ALLOWED_ORIGIN', 'https://your-domain.com');
```

**Step 2: 両PHPファイルの `require_once $configFile;` の直後に追加する**
```php
// Origin / Referer チェック
(function() {
  if (!defined('ALLOWED_ORIGIN') || ALLOWED_ORIGIN === '' || ALLOWED_ORIGIN === 'https://your-domain.com') {
    return; // 未設定時はチェックをスキップ（後方互換）
  }
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  $referer = $_SERVER['HTTP_REFERER'] ?? '';
  $allowed = rtrim((string)ALLOWED_ORIGIN, '/');
  $ok = ($origin !== '' && rtrim($origin, '/') === $allowed)
     || ($referer !== '' && strncasecmp($referer, $allowed . '/', strlen($allowed) + 1) === 0);
  if (!$ok) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'アクセスが許可されていません'], JSON_UNESCAPED_UNICODE);
    exit;
  }
})();
```

---

## TASK-S4: スプレッドシートIDを config.php に移動する

### 問題
`api/pickup_sheet.php` L.14 に本番スプレッドシートIDがハードコードされている。
設定値はすべて `config.php` で管理するべき。

### 現在のコード（`api/pickup_sheet.php` L.14）
```php
$spreadsheetId = '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU';
```

### 修正手順

**Step 1: `api/config.php` と `api/config.sample.php` に追加する**
```php
// === 集荷スプレッドシートID ===
define('PICKUP_SPREADSHEET_ID', '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU');
// config.sample.php では以下に変更:
// define('PICKUP_SPREADSHEET_ID', 'your-spreadsheet-id-here');
```

**Step 2: `api/pickup_sheet.php` L.14 を書き換える**
```php
// 変更前
$spreadsheetId = '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU';

// 変更後（config.phpのrequireより後に記述）
if (!defined('PICKUP_SPREADSHEET_ID') || trim((string)PICKUP_SPREADSHEET_ID) === '' || PICKUP_SPREADSHEET_ID === 'your-spreadsheet-id-here') {
  http_response_code(500);
  echo json_encode(['error' => 'スプレッドシートIDが未設定です。api/config.php の PICKUP_SPREADSHEET_ID を設定してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
$spreadsheetId = trim((string)PICKUP_SPREADSHEET_ID);
```

---

## TASK-S5: `tile_proxy.php` のCORSをオリジン限定にする

### 問題
`api/tile_proxy.php` L.2 の `Access-Control-Allow-Origin: *` により、
任意のサイトがこのプロキシを使いサーバーの帯域を消費できる。

### 現在のコード（`api/tile_proxy.php` L.1-8）
```php
<?php
header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
```

### 修正後のコード
```php
<?php
// Geoshapeタイルプロキシ — 自サイトからのリクエストのみ許可
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigin = defined('ALLOWED_ORIGIN') ? rtrim((string)ALLOWED_ORIGIN, '/') : '';

// ALLOWED_ORIGIN が設定されていれば一致するOriginのみ許可、未設定なら同一オリジンのみ（OPTIONSで判定）
if ($allowedOrigin !== '' && $allowedOrigin !== 'https://your-domain.com') {
  if (rtrim($requestOrigin, '/') === $allowedOrigin) {
    header('Access-Control-Allow-Origin: ' . $requestOrigin);
    header('Vary: Origin');
  }
  // 一致しないOriginにはCORSヘッダーを返さない（ブラウザがブロック）
} else {
  // ALLOWED_ORIGIN 未設定時: 同一オリジン想定のため * は返さず、Vary のみ
  header('Vary: Origin');
}

// config.php が存在すればALLOWED_ORIGINを読み込む
$configFile = __DIR__ . '/config.php';
if (file_exists($configFile)) {
  require_once $configFile;
  // ALLOWED_ORIGINを使った再チェックはここでは不要（上記は起動時に評価済み）
}

header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}
```

**注意**: TASK-S3 で `ALLOWED_ORIGIN` を config.php に追加済みであることが前提。
`tile_proxy.php` は `config.php` を `require` していないため、`require_once` を先頭近くに追加する必要がある。

---

# 🟡 P2 タスク（近日中に修正）

---

## TASK-D1: `extract_address.php` の mimeType を whitelist 検証する

### 問題
クライアントから送られた `mimeType` が検証なしで Gemini API に渡される。

### 現在のコード（`api/extract_address.php` L.33-38）
```php
$image = $input['image'] ?? '';
$mimeType = $input['mimeType'] ?? 'image/jpeg';
if (!$image || !preg_match('/^[A-Za-z0-9+\/\r\n=]+$/', $image)) {
  http_response_code(400);
  echo json_encode(['error' => '画像データが不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}
```

### 修正後のコード
```php
$image = $input['image'] ?? '';
$mimeType = $input['mimeType'] ?? 'image/jpeg';

// mimeType を whitelist で検証
$allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
if (!in_array($mimeType, $allowedMimeTypes, true)) {
  $mimeType = 'image/jpeg'; // 不正な値はデフォルトに落とす
}

if (!$image || !preg_match('/^[A-Za-z0-9+\/\r\n=]+$/', $image)) {
  http_response_code(400);
  echo json_encode(['error' => '画像データが不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}
```

---

## TASK-D2: `syncPickupProgressFromSheets` のエントリーレースコンディションを修正する

### 問題
`pickupSyncInFlight = true` をセットする前に `await retryPendingPickupProgress()` があるため、
`window` の `online` イベントと `visibilitychange` イベントが同時に発火した場合、
2つの呼び出しが両方ガードをすり抜けて重複同期が起きる可能性がある。

### 現在のコード（`index.html` L.4032-4052 付近）
```javascript
async function syncPickupProgressFromSheets(silent = true) {
  if (appMode !== 'pickup' || pickupSyncInFlight) return;
  await retryPendingPickupProgress({ silent: true });   // ← ここで中断、ガードをすり抜けられる
  const sheetSet = new Set(deliveries.filter(isPickupBackedDelivery).map(d => d.pickupSheet));
  ...
  pickupSyncInFlight = true;   // ← 遅すぎる
  try {
    ...
  } finally {
    pickupSyncInFlight = false;
  }
}
```

### 修正後のコード
```javascript
async function syncPickupProgressFromSheets(silent = true) {
  if (appMode !== 'pickup' || pickupSyncInFlight) return;
  pickupSyncInFlight = true;   // ← await より前に移す
  try {
    await retryPendingPickupProgress({ silent: true });
    const sheetSet = new Set(deliveries.filter(isPickupBackedDelivery).map(d => d.pickupSheet));
    const selectedSpotSheet = spotSheetForPickupCourse(getSelectedPickupSheet());
    if (selectedSpotSheet) {
      await triggerSpotPickupTouchIfDue({ silent: true });
      sheetSet.add(selectedSpotSheet);
    }
    const sheets = [...sheetSet].filter(Boolean);
    if (sheets.length === 0) {
      pickupLastSyncedAt = null;
      renderList();
      return;
    }
    let changed = false;
    for (const sheet of sheets) {
      const data = await fetchPickupItems(sheet, false);
      if (isSpotPickupSheet(sheet)) {
        changed = await mergePickupSheetSpotItems(data.items || [], { silent }) || changed;
      }
      changed = applyPickupProgressFromItems(data.items || []) || changed;
    }
    pickupLastSyncedAt = new Date();
    if (changed) {
      saveDeliveries();
      renderMarkers();
    }
    renderList();
  } catch (e) {
    console.warn('pickup auto sync failed', e);
    if (!silent) showToast('集荷進捗の同期に失敗しました', true);
  } finally {
    pickupSyncInFlight = false;
  }
}
```

---

## TASK-D3: ジオコードキャッシュをメモリキャッシュ化して I/O を削減する

### 問題
`getCachedGeocode` と `setCachedGeocode` が毎回 `localStorage.getItem` → `JSON.parse` →
変更 → `JSON.stringify` → `localStorage.setItem` を実行する。
集荷コース読み込み時（3並行 × 25件）で 50〜75 回の重複 I/O が発生し、モバイルでUI詰まりの原因になる。

### 修正方針
モジュールレベルで `let _geocodeCacheObj = null` を持ち、
初回のみ localStorage から読み込んでメモリに保持する。
`lastUsedAt` の更新はキャッシュヒット時には即書き込みせず、
次の `setCachedGeocode` 呼び出し時にまとめて永続化する（lazy write）。

### 現在のコード（`index.html` L.2660-2703 付近）
```javascript
function loadGeocodeCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
  } catch (e) {
    return {};
  }
}

function getCachedGeocode(key) {
  if (!key) return null;
  const cache = loadGeocodeCache();
  const item = cache[key];
  if (!item || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng))) return null;
  item.lastUsedAt = Date.now();
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  return {
    lat: Number(item.lat),
    lng: Number(item.lng),
    approx: !!item.approx,
    formatted: item.formatted || ''
  };
}

function setCachedGeocode(key, result) {
  if (!key || !result) return;
  const cache = loadGeocodeCache();
  cache[key] = {
    lat: Number(result.lat),
    lng: Number(result.lng),
    approx: !!result.approx,
    formatted: result.formatted || '',
    savedAt: Date.now(),
    lastUsedAt: Date.now()
  };
  const entries = Object.entries(cache);
  if (entries.length > GEOCODE_CACHE_MAX_ITEMS) {
    entries
      .sort((a, b) => Number(a[1].lastUsedAt || a[1].savedAt || 0) - Number(b[1].lastUsedAt || b[1].savedAt || 0))
      .slice(0, entries.length - GEOCODE_CACHE_MAX_ITEMS)
      .forEach(([oldKey]) => delete cache[oldKey]);
  }
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
}
```

### 修正後のコード
```javascript
// モジュールレベルに追加（既存の let 変数宣言群の近く）
let _geocodeCacheObj = null;

function _getGeocodeCacheObj() {
  if (_geocodeCacheObj !== null) return _geocodeCacheObj;
  try {
    const parsed = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
    _geocodeCacheObj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    _geocodeCacheObj = {};
  }
  return _geocodeCacheObj;
}

function _persistGeocodeCache() {
  if (_geocodeCacheObj === null) return;
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(_geocodeCacheObj));
}

function loadGeocodeCache() {
  return _getGeocodeCacheObj();
}

function getCachedGeocode(key) {
  if (!key) return null;
  const cache = _getGeocodeCacheObj();
  const item = cache[key];
  if (!item || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng))) return null;
  // lastUsedAt は書き込み時にまとめて永続化（読み取り時は localStorage I/O しない）
  item.lastUsedAt = Date.now();
  return {
    lat: Number(item.lat),
    lng: Number(item.lng),
    approx: !!item.approx,
    formatted: item.formatted || ''
  };
}

function setCachedGeocode(key, result) {
  if (!key || !result) return;
  const cache = _getGeocodeCacheObj();
  cache[key] = {
    lat: Number(result.lat),
    lng: Number(result.lng),
    approx: !!result.approx,
    formatted: result.formatted || '',
    savedAt: Date.now(),
    lastUsedAt: Date.now()
  };
  const entries = Object.entries(cache);
  if (entries.length > GEOCODE_CACHE_MAX_ITEMS) {
    entries
      .sort((a, b) => Number(a[1].lastUsedAt || a[1].savedAt || 0) - Number(b[1].lastUsedAt || b[1].savedAt || 0))
      .slice(0, entries.length - GEOCODE_CACHE_MAX_ITEMS)
      .forEach(([oldKey]) => delete cache[oldKey]);
  }
  _persistGeocodeCache();
}
```

---

## TASK-D4: `api/pickup_sheet.php` の GID テーブルを config.php に移動する

### 問題
シート名とGIDの対応テーブル（`$allowedSheets`）が `pickup_sheet.php` にハードコードされており、
コース追加・変更のたびに複数ファイルの編集が必要。

### 現在のコード（`api/pickup_sheet.php` L.15-22）
```php
$allowedSheets = [
  '小舟町店' => 2042847900,
  '小舟町店スポット' => 728416139,
  '浜町店 南' => 1102972916,
  '浜町店 南スポット' => null,
  '浜町店 北' => 591145494,
  '浜町店 北スポット' => null,
];
```

### 修正手順

**Step 1: `api/config.php` と `api/config.sample.php` に追加する**
```php
// === 集荷シート設定 ===
// シート名 => GID（数値またはnull）の配列。nullの場合はシート名でフォールバック取得します。
// コースを追加する場合はここだけを変更してください。
define('PICKUP_SHEET_CONFIG', [
  '小舟町店'        => 2042847900,
  '小舟町店スポット' => 728416139,
  '浜町店 南'       => 1102972916,
  '浜町店 南スポット'=> null,
  '浜町店 北'       => 591145494,
  '浜町店 北スポット'=> null,
]);
```

**Step 2: `api/pickup_sheet.php` の `$allowedSheets` 定義を書き換える**
```php
// 変更前
$allowedSheets = [
  '小舟町店' => 2042847900,
  ...
];

// 変更後
if (!defined('PICKUP_SHEET_CONFIG') || !is_array(PICKUP_SHEET_CONFIG) || count(PICKUP_SHEET_CONFIG) === 0) {
  http_response_code(500);
  echo json_encode(['error' => 'シート設定が未設定です。api/config.php の PICKUP_SHEET_CONFIG を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
$allowedSheets = PICKUP_SHEET_CONFIG;
```

---

## TASK-D5: Apps Script の `handleSpotPickupsSync` を clearContent → setValues のアトミック化に近づける

### 問題
`clearContent()` と `setValues()` の間に `pickup_sheet.php` がCSV読み取りを実行すると、
空のスポットリストが返り、ブラウザ側で全スポット集荷が一時消去される。

### 現在のコード（`apps_script/pickup_progress.gs` L.192-213 付近）
```javascript
if (sheet.getLastRow() > 1) {
  sheet.getRange(2, 1, sheet.getLastRow() - 1, SPOT_PICKUP_COLUMNS.length).clearContent();
}

const rows = items
  .filter(item => item && item.id && item.address)
  .map(item => { ... });

if (rows.length > 0) {
  sheet.getRange(2, 1, rows.length, SPOT_PICKUP_COLUMNS.length).setValues(rows);
}
SpreadsheetApp.flush();
```

### 修正方針
`clearContent` せずに行を上書きし、余剰行のみ後から `clearContent` する。
これによりシートが空になる瞬間をなくす。

### 修正後のコード
```javascript
// clearContent を先に行わず、書き込み → 余剰行クリアの順にする
const rows = items
  .filter(item => item && item.id && item.address)
  .map(item => {
    const id = String(item.id || '').trim();
    const saved = existing[id] || {};
    const cancelled = item.cancelled === true || String(item.cancelled || '').toUpperCase() === 'TRUE';
    return SPOT_PICKUP_COLUMNS.map(name => {
      if (name === 'collected') return cancelled ? true : (saved.collected || false);
      if (name === 'collected_at') return cancelled ? String(item.collected_at || '') : (saved.collected_at || '');
      if (name === 'collected_by') return cancelled ? 'キャンセル' : (saved.collected_by || '');
      return String(item[name] || '');
    });
  });

// 既存行数
const existingDataRows = Math.max(sheet.getLastRow() - 1, 0);

if (rows.length > 0) {
  // 必要行数が足りなければ追加
  if (sheet.getMaxRows() < rows.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  }
  // 上書き（クリアせずに書く）
  sheet.getRange(2, 1, rows.length, SPOT_PICKUP_COLUMNS.length).setValues(rows);
}

// 余剰行をクリア（新データより多い古い行だけ）
if (existingDataRows > rows.length) {
  sheet.getRange(rows.length + 2, 1, existingDataRows - rows.length, SPOT_PICKUP_COLUMNS.length).clearContent();
}

SpreadsheetApp.flush();
```

---

# 🟢 P3 タスク（余裕があれば修正）

---

## TASK-L1: ナビゲーション遷移を `window.open` に変更する

### 問題
`window.location.assign(url)` だとPWA（ホーム画面追加）のウィンドウが Google Maps に上書きされる。
`window.open` のほうが PWA として自然な動作になる。

### 現在のコード（`index.html` L.2853-2858 付近）
```javascript
function openNavigation(id) {
  const d = deliveries.find(x => x.id === id);
  if (!d || d.lat == null) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`;
  window.location.assign(url);
}
```

### 修正後のコード
```javascript
function openNavigation(id) {
  const d = deliveries.find(x => x.id === id);
  if (!d || d.lat == null) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`;
  window.open(url, '_blank', 'noopener');
}
```

---

## TASK-L2: `uid()` を `crypto.randomUUID()` に変更する

### 問題
現在の `uid()` はエントロピーが31ビット程度。ID衝突の確率は現状の利用規模では問題ないが、
Web Crypto API を使うとより安全になる。

### 現在のコード（`index.html` L.1466-1468 付近）
```javascript
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
```

### 修正後のコード
```javascript
function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // フォールバック（古いブラウザ向け）
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
```

---

## TASK-L3: `apps_script/pickup_progress.gs` のシークレット比較を定数時間比較にする

### 問題
JavaScriptの `!==` は早期終了するため厳密にはタイミング攻撃の余地がある（実害は極めて低い）。

### 現在のコード（`apps_script/pickup_progress.gs` L.43, L.105, L.174 付近）
```javascript
// handlePickupProgress, handlePickupLocation, handleSpotPickupsSync 各関数の先頭
if (payload.secret !== PICKUP_PROGRESS_SECRET) {
  return respond({ ok: false, error: 'unauthorized' });
}
```

### 修正後のコード
```javascript
// ファイル先頭付近にヘルパー関数を追加する
function secureCompare(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let result = 0;
  for (let i = 0; i < sa.length; i++) {
    result |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return result === 0;
}

// 各関数のシークレットチェックを以下に変更
if (!secureCompare(payload.secret, PICKUP_PROGRESS_SECRET)) {
  return respond({ ok: false, error: 'unauthorized' });
}
```

---

## TASK-L4: `data/private/` の保護に関する README/コメントを追加する

### 問題
`data/private/.htaccess` による保護は Apache の `AllowOverride All` 設定が前提。
Nginx や `AllowOverride None` の Apache では機能しない。
誤設定時に push_subscriptions.json（プッシュ購読キー）が外部公開されるリスクがある。

### 修正方針
`data/private/.htaccess` を以下のように強化する（Apache向け）:

```apache
# Apache: このディレクトリへの直接アクセスをすべて拒否
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Deny from all
</IfModule>
Options -Indexes
```

Nginx を使っている場合は、vhost設定に以下を追加する（`api/config.php` か `README.md` に記載）:
```nginx
location ^~ /delivery_map_mapbox/data/private/ {
    deny all;
    return 403;
}
```

`api/config.sample.php` にコメントを追加する:
```php
// 重要: data/private/ ディレクトリはWebから直接アクセスできないよう設定してください。
// Apache: data/private/.htaccess が自動的に保護します（AllowOverride All が必要）。
// Nginx: vhost設定で /data/private/ への直接アクセスを deny してください。
```

---

# 修正後の確認事項

各タスク完了後に以下を確認してください:

| チェック項目 | 確認方法 |
|---|---|
| S-1: SSRF修正後、スポット集荷取得が動作する | ブラウザから集荷コース読み込み → スポットが表示される |
| S-2: SSL修正後、Google Sheets / Apps Script 通信が正常 | 集荷進捗を完了にしてシートに反映されること |
| S-3: 認証追加後、アプリからのOCR・ジオコーディングが通る | 伝票撮影 → 住所読み取り → 地図に追加される |
| S-4: spreadsheetId移動後、集荷リスト読み込みが動作する | コース選択 → 集荷リストが表示される |
| S-5: CORS変更後、町丁目境界タイルが表示される | メニュー → 町丁目境界 ON で境界線が表示される |
| D-2: レース修正後、オフライン復帰時に二重同期しない | 機内モードOFF時のトースト表示が1回だけ |
| D-3: キャッシュ修正後、集荷コース読み込み速度が改善する | 2回目以降の読み込みが体体感で速くなること |

---

# 変更してはいけないこと

- 配送モード / 集荷モードの切り替えロジック（`switchAppMode`）の振る舞い
- `progressSyncFailed` フラグを使ったオフライン再送ロジック
- `dedupeSpotPickupItems` / `dedupeStoredSpotPickups` の判定ロジック
- `resetStalePickupCompletions` の日付リセット判定
- `STORAGE_KEY` / `PICKUP_STORAGE_KEY` の分離構造
- GPS追跡・地図操作の挙動
- Service Worker / Web Push の登録フロー
- Mapbox GL JS の地図初期化処理
