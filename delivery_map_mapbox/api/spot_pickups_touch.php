<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;

function touch_cfg($name, $default = '') {
  return defined($name) ? constant($name) : $default;
}

$secret = trim((string)touch_cfg('SPOT_PICKUP_REFRESH_SECRET'));
if ($secret === '' || $secret === 'change-this-refresh-secret') {
  http_response_code(500);
  echo json_encode(['error' => 'スポット集荷取得設定が未設定です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$minInterval = (int)touch_cfg('SPOT_PICKUP_TOUCH_MIN_INTERVAL_SECONDS', 300);
if ($minInterval < 60) $minInterval = 60;
$stateFile = dirname(__DIR__) . '/data/spot_pickups_touch_state.json';
$now = time();
$lastRun = 0;
if (file_exists($stateFile)) {
  $state = json_decode((string)file_get_contents($stateFile), true);
  if (is_array($state)) $lastRun = (int)($state['last_run'] ?? 0);
}

if ($lastRun > 0 && ($now - $lastRun) < $minInterval) {
  echo json_encode([
    'ok' => true,
    'skipped' => true,
    'reason' => 'recently refreshed',
    'age_seconds' => $now - $lastRun,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

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
  $dir = dirname($stateFile);
  if (!is_dir($dir)) @mkdir($dir, 0775, true);
  @file_put_contents($stateFile, json_encode([
    'last_run' => $now,
    'last_run_at' => date('c', $now),
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
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
