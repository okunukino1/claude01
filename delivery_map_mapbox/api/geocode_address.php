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
  echo json_encode(['error' => 'サーバー設定ファイルがありません', 'hint' => 'api/config.sample.php を api/config.php にコピーし、GOOGLE_MAPS_SERVER_KEYを設定してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;

$key = '';
if (defined('GOOGLE_MAPS_SERVER_KEY') && GOOGLE_MAPS_SERVER_KEY && GOOGLE_MAPS_SERVER_KEY !== 'AIza...Google Geocoding API用キー...') {
  $key = GOOGLE_MAPS_SERVER_KEY;
} elseif (defined('GOOGLE_MAPS_BROWSER_KEY') && GOOGLE_MAPS_BROWSER_KEY && GOOGLE_MAPS_BROWSER_KEY !== 'AIza...Google Maps JavaScript API用キー...') {
  // 小規模テスト用のフォールバックです。本番ではブラウザ用とサーバー用を分けることを推奨します。
  $key = GOOGLE_MAPS_BROWSER_KEY;
}

if (!$key) {
  http_response_code(500);
  echo json_encode(['error' => 'Google Geocoding APIキーが未設定です', 'hint' => 'api/config.php の GOOGLE_MAPS_SERVER_KEY を設定してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$address = trim((string)($input['address'] ?? ''));
if ($address === '') {
  http_response_code(400);
  echo json_encode(['error' => '住所が空です'], JSON_UNESCAPED_UNICODE);
  exit;
}
if (mb_strlen($address, 'UTF-8') > 300) {
  http_response_code(400);
  echo json_encode(['error' => '住所文字列が長すぎます'], JSON_UNESCAPED_UNICODE);
  exit;
}

$params = http_build_query([
  'address' => $address,
  'region' => 'jp',
  'language' => 'ja',
  'key' => $key
]);
$url = 'https://maps.googleapis.com/maps/api/geocode/json?' . $params;

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 20
]);
$response = curl_exec($ch);
$curlErr = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
  http_response_code(502);
  echo json_encode(['error' => 'Google Geocoding APIへの接続に失敗しました', 'detail' => $curlErr], JSON_UNESCAPED_UNICODE);
  exit;
}

$data = json_decode($response, true);
if ($httpCode < 200 || $httpCode >= 300 || !is_array($data)) {
  http_response_code(502);
  echo json_encode(['error' => 'Google Geocoding API応答エラー', 'detail' => substr($response, 0, 500)], JSON_UNESCAPED_UNICODE);
  exit;
}

$status = $data['status'] ?? '';
if ($status !== 'OK') {
  $err = $data['error_message'] ?? $status;
  http_response_code($status === 'ZERO_RESULTS' ? 404 : 502);
  echo json_encode(['error' => '住所検索に失敗しました', 'detail' => $err, 'status' => $status], JSON_UNESCAPED_UNICODE);
  exit;
}

$result = $data['results'][0] ?? null;
$loc = $result['geometry']['location'] ?? null;
if (!$loc || !isset($loc['lat'], $loc['lng'])) {
  http_response_code(404);
  echo json_encode(['error' => '位置情報が見つかりません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$locType = $result['geometry']['location_type'] ?? '';
$isApprox = ($result['partial_match'] ?? false)
  || in_array($locType, ['APPROXIMATE', 'GEOMETRIC_CENTER']);

echo json_encode([
  'lat'          => (float)$loc['lat'],
  'lng'          => (float)$loc['lng'],
  'formatted'    => $result['formatted_address'] ?? '',
  'approx'       => $isApprox,
  'location_type' => $locType,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
