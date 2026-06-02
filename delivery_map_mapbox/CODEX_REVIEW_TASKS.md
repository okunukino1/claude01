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

---

# db88c7e バグ検証結果 — 追加タスク (v2026.06.01-1)

> **検証日**: 2026-06-01  
> **検証対象コミット**: `db88c7e` "Remove stale pickup markers in delivery mode"  
> **前提**: 07936f1 → 47c01a7 → db88c7e の3段階修正を総合評価

---

## 検証サマリー

| 懸念点 | 判定 | 根拠 |
|---|---|---|
| `renderMarkers(visibleDeliveries idx)` vs `renderList(deliveries index)` の数字ズレ | **問題なし** | `removePickupRecordsFromDeliveryState()` が両関数の先頭で `deliveries` を浄化するため、実行時点では `visibleDeliveries === deliveries` |
| `clearAllMarkers()` DOM sweep が GPS マーカーを消す | **問題なし** | GPS マーカー要素はクラス属性なし。`.delivery-marker` セレクターに一致しない |
| `markerKey = d.id \|\| 'idx:${idx}'` と `markers.get(d.id)` の不整合 | **実質無害** | `uid()` が UUID を保証するため `d.id` は常に truthy。フォールバックは使われない |
| `syncPickupProgressFromSheets` がモード切替後に完走するパス | **ガード済み** | 完走しても `saveDeliveries()` → `removePickupRecordsFromDeliveryState()` が先に呼ばれてから `renderMarkers()` が実行される |
| `activeDeliveryId` の整合性 | **問題なし** | `removePickupRecordsFromDeliveryState()` がアクティブアイテム除去時に `activeDeliveryId = null` にリセットする |
| 配送モードでの青いスポットピン問題（根本原因） | **解決済み** | 3段階修正で triple-guard が揃っている |

---

## TASK-M1: `oldMarker.remove()` dead code 除去と `markerKey` 統一 🟡 P2

### 問題

`renderMarkers()` で `clearAllMarkers()` を呼んだ直後に `oldMarker` チェックを行っているが、
`clearAllMarkers()` が既に `markers.clear()` しているため `markers.get(markerKey)` は常に `undefined` を返す。
`oldMarker.remove()` は絶対に実行されない dead code。

また、`markerKey = d.id || \`idx:${idx}\`` としているが、`uid()` が UUID を保証する以上フォールバックは不要であり、
`updateMarkerZIndexes()` が `markers.get(d.id)` で参照するキーと一致させるべき。

### 現在のコード（`index.html` 内 `renderMarkers()` のループ末尾）

```javascript
const markerKey = d.id || `idx:${idx}`;
const oldMarker = markers.get(markerKey);  // clearAllMarkers() 後なので常に undefined
if (oldMarker) oldMarker.remove();          // 絶対に実行されない
markers.set(markerKey, marker);
```

### 修正後

```javascript
markers.set(d.id, marker);
```

### 確認事項
- `updateMarkerZIndexes()` が `markers.get(d.id)` でマーカーを取得できること
- マーカークリック → 詳細パネル開閉が正常に動作すること
- 変更は3行→1行に減るだけ。ロジックの変化なし

---

## TASK-M2: `updateMarkerZIndexes()` の idx を visible ベースに統一 🟢 P3

### 問題

`renderMarkers()` が `visibleDeliveries` の `idx` で z-index 初期値を計算してマーカーを作成するのに対し、
`updateMarkerZIndexes()` は `deliveries` の `idx` で z-index を再計算する。

現状は `removePickupRecordsFromDeliveryState()` のおかげで delivery mode では両者が一致するが、
将来 `isVisibleInCurrentMode` が pickup mode でもフィルタリングするようになった場合に z-index がズレる。
コードの意図を明示するため統一する。

### 現在のコード

```javascript
// renderMarkers()
const visibleDeliveries = deliveries.filter(isVisibleInCurrentMode);
visibleDeliveries.forEach((d, idx) => {
  wrapper.style.zIndex = String(markerZIndex(d, idx));  // visibleDeliveries の idx
  ...
  markers.set(d.id, marker);  // TASK-M1 適用後
});

// updateMarkerZIndexes() — 別関数
function updateMarkerZIndexes() {
  deliveries.forEach((d, idx) => {          // deliveries の idx (異なる)
    const marker = markers.get(d.id);
    if (!marker) return;
    marker.getElement().style.zIndex = String(markerZIndex(d, idx));
  });
}
```

### 修正後

モジュールスコープに `_lastVisibleDeliveries` を追加し、`renderMarkers()` で更新する:

```javascript
// モジュール変数に追加（let deliveries = []; の近く）
let _lastVisibleDeliveries = [];

// renderMarkers() 内
const visibleDeliveries = deliveries.filter(isVisibleInCurrentMode);
_lastVisibleDeliveries = visibleDeliveries;

// updateMarkerZIndexes() を修正
function updateMarkerZIndexes() {
  _lastVisibleDeliveries.forEach((d, idx) => {
    const marker = markers.get(d.id);
    if (!marker) return;
    marker.getElement().style.zIndex = String(markerZIndex(d, idx));
  });
}
```

### 確認事項
- マーカーをタップ → 選択マーカーが最前面に移動すること（z-index 100000 が適用される）
- 完了マーカーが未完了マーカーより後ろに表示されること

---

## TASK-M3: GPS マーカーに explicit 保護属性を付与 🟢 P3

### 問題

`clearAllMarkers()` の DOM sweep は偶然 GPS マーカーを回避できているが（クラスなしのため）、
将来 GPS マーカーに `.delivery-marker` 系クラスが追加された場合に誤削除するリスクがある。
防護を偶然ではなく意図的にする。

### 現在のコード（`updateUserLocation()` 内）

```javascript
userMarkerEl = document.createElement('div');
userMarkerEl.style.cssText = `
  width: 18px; height: 18px;
  background: #2563eb;
  ...
`;
```

### 修正後

```javascript
userMarkerEl = document.createElement('div');
userMarkerEl.dataset.role = 'user-location';  // 追加
userMarkerEl.style.cssText = `
  width: 18px; height: 18px;
  background: #2563eb;
  ...
`;
```

`clearAllMarkers()` の DOM sweep 条件を明示化:

```javascript
document.querySelectorAll('.mapboxgl-marker .delivery-marker').forEach(el => {
  const markerEl = el.closest('.mapboxgl-marker');
  if (markerEl && !markerEl.querySelector('[data-role="user-location"]')) {
    markerEl.remove();
  }
});
```

### 確認事項
- GPS 追跡 ON → 現在地マーカー（青い円）が地図上に表示されること
- GPS 中に `renderMarkers()` が呼ばれても現在地マーカーが消えないこと

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

---

# パフォーマンス改善タスク (v2026.06.01-1)

> **作成日**: 2026-06-01
> **基準ブランチ**: `origin/main`（**v2026.06.01-1**）。行番号はすべて `origin/main` のもの。
> **重要**: 作業ブランチが古い場合は、必ず `origin/main` を取り込んでから着手すること。
> 既存の高速化（並列ジオコーディング・OCR先読み・インメモリキャッシュ）を巻き戻さないこと。

## ⚠️ 既に対処済み（再実装しないこと）

以下はレビューで「ボトルネック候補」に挙がったが、最新版で**既に解決済み**。手を入れない。

| 項目 | 対処コミット | 現状 |
|---|---|---|
| ジオコードキャッシュの読み取り時 I/O | `47c01a7` | `getGeocodeCacheObject()` でインメモリ化済み。読み取り時に `JSON.parse`/`setItem` しない |
| インポート時ジオコーディングの直列処理 | `686e4d1` | `mapWithConcurrency(items, PICKUP_GEOCODE_CONCURRENCY=3, ...)` で並列化済み（行4114, 4159） |
| OCR画像が重い / 同一住所の重複リクエスト | `c34d088` | 1120px/0.8圧縮 + `prefetchGeocodeAddress`（読取り中に先読み）+ `geocodeInFlight` で重複防止済み |

---

## TASK-P1: マーカー/リスト描画を差分更新化する 🟡 P2（最優先・常時コスト）

### 問題
`renderMarkers()`（行2514）と `renderList()`（行2773）が、操作のたびにペアで全再構築している。
コード全体で約58箇所から呼ばれ、完了トグル1件でも全件を作り直す。件数Nに比例して重くなる。

- `renderMarkers()` → `clearAllMarkers()`（行2367）で全マーカーを破棄し、`deliveries` 全件を `new mapboxgl.Marker()` で再生成
- `renderList()` → `body.innerHTML = listItems.map(...).join('')`（行2803）で DOM 全置換し、毎回 `querySelectorAll('button[data-action]')` + `addEventListener` を全件に再付与

### 修正方針

**(a) マーカーの差分更新**
`markers` Map を活かす:
- 今回の可視ID集合を作る
- `markers` にあって可視集合にないIDだけ `.remove()` + `markers.delete()`
- 可視集合にあって `markers` にないIDだけ新規生成
- 既存マーカーは `setLngLat()` と class / z-index の更新のみ（DOM再生成しない）

`clearAllMarkers()` の全破棄方式はモード切替時など限定的な場面でのみ使う。

**(b) リストのイベント委譲**
`list-body` に**1つだけ** click リスナーを置き、`e.target.closest('[data-action]')` と `closest('.delivery-item')` で判定する。
これで再描画ごとの `querySelectorAll + addEventListener`（行2806以降）が不要になる。
完了トグルなど1件のみの変化は、該当行の class 切替＋num-badge更新だけで済ませられればなお良い（段階的でよい）。

### 確認事項
- マーカークリック→詳細パネル、リスト各ボタン（完了/ナビ/位置/編集）が従来通り動作
- `activeDeliveryId` のハイライト（`.selected`）と z-index 最前面化が維持される
- 配送/集荷モード切替、タブ切替で表示が崩れない

---

## TASK-P2: 集荷同期の複数シート fetch を並列化する 🟡 P2

### 問題
`syncPickupProgressFromSheets()`（行4060）が複数シートを直列 fetch している（行4079）。
20秒ごとのポーリングで、シート枚数ぶん順番に待機する。

### 現在のコード（行4079付近）
```javascript
for (const sheet of sheets) {
  const data = await fetchPickupItems(sheet, false);   // 1枚ずつ順番待ち
  if (isSpotPickupSheet(sheet)) {
    changed = await mergePickupSheetSpotItems(data.items || [], { silent }) || changed;
  }
  changed = applyPickupProgressFromItems(data.items || []) || changed;
}
```

### 修正方針
**fetch（I/O）だけ並列化**し、結果適用は順次のままにする:
```javascript
const fetched = await Promise.all(
  sheets.map(sheet => fetchPickupItems(sheet, false).then(data => ({ sheet, data })))
);
for (const { sheet, data } of fetched) {
  if (isSpotPickupSheet(sheet)) {
    changed = await mergePickupSheetSpotItems(data.items || [], { silent }) || changed;
  }
  changed = applyPickupProgressFromItems(data.items || []) || changed;
}
```
`N×遅延` → `1×遅延` になる。`mergePickupSheetSpotItems` の適用は直列のままにし、`deliveries` への副作用の競合を避ける。

### 確認事項
- 複数コース（小舟町/浜町南/浜町北）の進捗とスポットが従来通り反映される
- `pickupSyncInFlight` ガードと整合（並列化は fetch 内部のみ）

---

## TASK-P3: 同期時スポット集荷のジオコーディングを並列化する 🟢 P3

### 問題
`mergePickupSheetSpotItems()`（行3950）内で、座標なしの新規スポットに対し `await geocodeAddress()` を直列実行している（行4010, 4024付近）。
通常は `savedLocation`（シート保存済み座標）でヒットするため発火しないが、新規スポットが多い瞬間は直列で遅くなる。

### 修正方針
既存の `mapWithConcurrency()`（行4114）を再利用し、ジオコーディングが必要なアイテムだけ先に並列解決してから `deliveries` への反映ループを回す。インポート経路（`resolvePickupImportItem` + `importPickupItems`）と同じパターンに揃える。

### 確認事項
- スポット集荷の新規追加・座標反映・キャンセル扱いが従来通り
- 既存座標がある場合はジオコーディングを呼ばない（`savedLocation` 優先を維持）

---

## TASK-P4: 描画・保存時の重複 localStorage 書き込みを削減する 🟢 P3

### 問題
`removePickupRecordsFromDeliveryState()`（行1524）が `renderMarkers()`・`renderList()` の冒頭と `saveDeliveries()`（行1544、約25箇所から呼ばれる）でそれぞれ実行され、配送モードでは毎回 `deliveries` 全体を `JSON.stringify` して localStorage に書き込む可能性がある。描画のたびに stringify が走る。

### 修正方針
- 描画関数（`renderMarkers`/`renderList`）からは「pickup記録の物理移動＋localStorage書き込み」を外し、**読み取り専用のフィルタ**（`isVisibleInCurrentMode`）のみに依存させる。
- 実際の移動（`movePickupRecordsToPickupStorage` + localStorage書き込み）は**状態変化時のみ**に限定する（モード切替 `switchAppMode`、インポート、シート同期で `changed===true` の時）。
- これにより毎描画の `JSON.stringify(deliveries)` が消える。

### 確認事項
- 配送モードに集荷記録が表示されない不変条件（db88c7e で確立）を維持すること
- ⚠️ `removePickupRecordsFromDeliveryState` の挙動変更は db88c7e のバグ修正と密接。慎重に。表示テスト必須

---

## TASK-P5: PHP `optimize_route.php` の 2-opt 反復を可変化する 🟢 P3

### 問題
`improve_matrix_route()` が最大80反復 × O(N²)（24件で約46,000ループ）をPHPで実行。ルート最適化ボタン押下時のみだが、件数が多いと数秒かかる。

### 修正方針
- 反復上限を件数に応じて可変にするか、経過時間ベース（例: 1.5秒）で打ち切る。
- 早期収束（改善が一定回数なければ break）を入れる。
- ※ アルゴリズムの結果品質を大きく変えないこと。24件上限の制約は維持。

---

## TASK-P6: PHP `spot_pickups_refresh.php` の直列スクレイピングを並列化する 🟢 P3（要注意）

### 問題
複数ターゲットを直列に HTTP GET している。`N×2秒` 程度かかる。

### 修正方針
`curl_multi_*` で並列取得する。
⚠️ **注意**: スクレイピング先（エコ配ドライバーポータル）への同時接続数を増やすことになる。負荷・BANリスクを考慮し、並列度は控えめ（2〜3）に。動作確認とレート配慮を最優先。

---

## TASK-P7: 起動時の直列 await を一部並走させる 🟢 P3

### 問題
init で `await loadMapboxConfig()` → `await initMap()` → `await resetStalePickupCompletions()` が直列。

### 修正方針
地図ロードに依存しない処理（`resetStalePickupCompletions` など）を `initMap()` と並走させる。
⚠️ Mapbox の地図初期化処理自体（`initMap` の中身、`map.on('load')` フロー）は**変更しないこと**（「変更してはいけないこと」参照）。並走の制御は init 関数側のみで行う。

### 確認事項
- 起動時に地図・マーカー・リストが従来通り表示される
- 通知から起動した場合のコース展開（`openPickupCourseFromNotification`）が動作する

---

## パフォーマンスタスク 優先度まとめ

| タスク | 優先度 | 効果 | リスク |
|---|---|---|---|
| P1 マーカー/リスト差分更新 | 🟡 P2 | 大（常時・件数比例） | 中（描画ロジック広範） |
| P2 同期シート並列fetch | 🟡 P2 | 中（20秒ごと） | 低 |
| P3 同期時ジオコード並列化 | 🟢 P3 | 小〜中（新規時のみ） | 低 |
| P4 重複localStorage削減 | 🟢 P3 | 中（描画毎） | 中（db88c7e と密接） |
| P5 2-opt反復可変化 | 🟢 P3 | 中（最適化時のみ） | 低 |
| P6 PHP並列スクレイピング | 🟢 P3 | 中（更新時のみ） | 中（外部負荷・BAN） |
| P7 起動時await並走 | 🟢 P3 | 小（起動時のみ） | 低 |

---

# 🔴 テスト版 ピン位置ずれバグ — 緊急修正 (test/index.html)

> **発見日**: 2026-06-02
> **対象ファイル**: `delivery_map_mapbox/test/index.html` のみ（**テスト版**）
> **対象バージョン**: `v2026.06.01-4-test.3`（`origin/main`）
> **起因コミット**: `752c9dc` "Improve test map rendering performance"（TASK-P1 のマーカー差分更新実装）
> **症状**: テスト版で、lat/lng を変えていないのに地図上のピンが移動する／位置がずれる
>
> ⚠️ **安定版 `delivery_map_mapbox/index.html` は正常動作中。絶対に変更しないこと。**

---

## TASK-T1: マーカー要素の className 上書きで `mapboxgl-marker` クラスが消える 🔴 最優先

### 根本原因（断定）

`updateDeliveryMarkerElement()` の `wrapper.className = '...'` が、
Mapbox が wrapper に付与した `mapboxgl-marker` / `mapboxgl-marker-anchor-bottom` クラスを**上書き削除**している。

Mapbox GL JS v3.7.0 のソース（`src/ui/marker.ts` L.182, L.194）:
```javascript
this._element = options.element;                    // = wrapper
this._element.classList.add('mapboxgl-marker');     // wrapper に付与
classList.add(`mapboxgl-marker-anchor-bottom`);     // wrapper に付与
```

Mapbox のCSS（`src/css/mapbox-gl.css`）:
```css
.mapboxgl-marker {
    position: absolute;   /* ← ピンの位置決めの根拠。これが消えると崩れる */
    top: 0;
    left: 0;
    will-change: transform;
}
```

#### なぜ安定版は正常で、テスト版だけ壊れるか

**安定版（正常）** — `index.html` の `renderMarkers()`:
```
① wrapper.className = 'delivery-marker ...'      ← 先にアプリ側クラスを設定
② new mapboxgl.Marker({element: wrapper})        ← Mapbox が 'mapboxgl-marker' を追記
結果: className = 'delivery-marker ... mapboxgl-marker mapboxgl-marker-anchor-bottom'
→ position: absolute 保持 ✅
```

**テスト版（752c9dc 以降・バグ）** — `createDeliveryMarker()` → `updateDeliveryMarkerElement()`:
```
① new mapboxgl.Marker({element: wrapper})        ← Mapbox が 'mapboxgl-marker' を付与
   className = 'mapboxgl-marker mapboxgl-marker-anchor-bottom'
② updateDeliveryMarkerElement: wrapper.className = 'delivery-marker ...'  ← 全部上書き
   → 'mapboxgl-marker' が消滅
   → position: absolute 喪失 ❌
```

`position: absolute` を失ったマーカー要素は、`display: flex` の静的フロー（normal flow）で
縦に積み重なる。`transform`（Mapbox の位置計算）は残るため、
ピン#Nはフローオフセット`44px×(N-1)`ぶん累積してずれ、再描画のたびに位置が動いて見える。

### 確定した「原因ではない」もの（再調査不要）

| 候補 | 判定 | 根拠 |
|---|---|---|
| `anchor: 'bottom'` を空要素で初期化したことによるズレ | **無関係** | v3.7.0 の anchor は CSS パーセント値 `translate(-50%,-100%)`（`src/ui/anchor.ts`）。ブラウザが描画時に要素の現在サイズで動的計算するため、後からDOMを充填しても位置は正しく決まる |
| 19aaa7f（TASK-P4 の `removePickupRecordsFromDeliveryState` 除去） | **無関係** | 配送モードの集荷記録除外は `isVisibleInCurrentMode()` フィルタが担保。ピンの座標計算には影響しない |

### 現在のコード（`test/index.html` L.2561-2568）

```javascript
function updateDeliveryMarkerElement(wrapper, d, idx, modeKey, overlap) {
  const num = displayNumber(d, idx);
  wrapper.className = 'delivery-marker'
    + (d.completed ? ' done' : '')
    + (d.approx ? ' approx' : '')
    + (isSpotPickupDelivery(d) ? ' spot' : '');
  wrapper.style.zIndex = String(markerZIndex(d, idx));
  wrapper.innerHTML = '';
  ...
```

### 修正（最小パッチ）

`className =`（全置換）をやめ、`classList` でアプリ側クラスだけを足し引きする:

```javascript
function updateDeliveryMarkerElement(wrapper, d, idx, modeKey, overlap) {
  const num = displayNumber(d, idx);
  // className 全置換は Mapbox が付与した 'mapboxgl-marker'(position:absolute) を消すため classList を使う
  wrapper.classList.add('delivery-marker');
  wrapper.classList.toggle('done', !!d.completed);
  wrapper.classList.toggle('approx', !!d.approx);
  wrapper.classList.toggle('spot', !!isSpotPickupDelivery(d));
  wrapper.style.zIndex = String(markerZIndex(d, idx));
  wrapper.innerHTML = '';
  ...
```

`updateDeliveryMarkerElement` 以降（innerHTML 充填部分）は変更不要。

### 修正後に確認すべき操作

| 確認項目 | 操作 |
|---|---|
| ピン位置が正しい | 配送先を2件以上追加 → 各ピンが住所どおりの位置に表示される |
| ピンが動かない | 完了トグル・編集などリスト操作後、他のピンの地図位置が変わらない |
| done/approx/spot 切替 | 完了トグルで灰色化、スポットコースで青ピンが正しい位置 |
| ラベルモード切替 | 「表示: 番地」等に切り替えてもピン位置不変 |
| 差分更新 | 件数の増減（追加・削除）後、残存ピンの位置が動かない |
| 安定版への非影響 | `delivery_map_mapbox/index.html` に変更がないこと（本修正は `test/` のみ）|

### 制約
- **`delivery_map_mapbox/index.html`（安定版）は触らない。**
- 修正対象は `delivery_map_mapbox/test/index.html` の `updateDeliveryMarkerElement` のみ。
- バージョン文字列を上げる場合は `-test.4` 系のテスト表記で（安定版の版数を動かさない）。
