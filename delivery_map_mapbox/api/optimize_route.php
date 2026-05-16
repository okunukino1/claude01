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
  echo json_encode(['error' => 'サーバー設定ファイルがありません', 'hint' => 'api/config.php を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;

$token = '';
if (defined('MAPBOX_OPTIMIZATION_TOKEN') && MAPBOX_OPTIMIZATION_TOKEN) {
  $token = MAPBOX_OPTIMIZATION_TOKEN;
} elseif (defined('MAPBOX_ACCESS_TOKEN') && MAPBOX_ACCESS_TOKEN) {
  $token = MAPBOX_ACCESS_TOKEN;
}

if (!$token || $token === 'pk.eyJ...Mapbox公開トークン...') {
  http_response_code(500);
  echo json_encode(['error' => 'Mapboxルート最適化トークンが未設定です', 'hint' => 'api/config.php の MAPBOX_ACCESS_TOKEN または MAPBOX_OPTIMIZATION_TOKEN を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

function valid_coord($value) {
  return is_numeric($value) && is_finite((float)$value);
}

function distance_meters($a, $b) {
  $lat1 = deg2rad((float)$a['lat']);
  $lat2 = deg2rad((float)$b['lat']);
  $dLat = $lat2 - $lat1;
  $dLng = deg2rad((float)$b['lng'] - (float)$a['lng']);
  $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
  return 6371000 * 2 * atan2(sqrt($h), sqrt(max(0, 1 - $h)));
}

$start = $input['start'] ?? null;
if (!is_array($start) || !valid_coord($start['lat'] ?? null) || !valid_coord($start['lng'] ?? null)) {
  http_response_code(400);
  echo json_encode(['error' => '始点の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}
$start = ['id' => '__start__', 'lat' => (float)$start['lat'], 'lng' => (float)$start['lng']];

$points = $input['points'] ?? [];
if (!is_array($points)) $points = [];

$cleanPoints = [];
foreach ($points as $p) {
  if (!is_array($p)) continue;
  $id = trim((string)($p['id'] ?? ''));
  if ($id === '' || !valid_coord($p['lat'] ?? null) || !valid_coord($p['lng'] ?? null)) continue;
  $cleanPoints[] = ['id' => $id, 'lat' => (float)$p['lat'], 'lng' => (float)$p['lng']];
}

if (count($cleanPoints) < 2) {
  http_response_code(400);
  echo json_encode(['error' => '車用ルート最適化には配送先が2件以上必要です'], JSON_UNESCAPED_UNICODE);
  exit;
}

// Mapbox Optimization API v1 は最大12座標。始点を含めるため配送先は11件まで。
if (count($cleanPoints) > 11) {
  http_response_code(400);
  echo json_encode([
    'error' => '車用ルート最適化は一度に11件まで対応しています',
    'detail' => 'Mapbox Optimization API v1 の最大12座標制限に合わせています。'
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$endIndex = 0;
$endDistance = -1;
foreach ($cleanPoints as $idx => $p) {
  $dist = distance_meters($start, $p);
  if ($dist > $endDistance) {
    $endDistance = $dist;
    $endIndex = $idx;
  }
}

$endPoint = $cleanPoints[$endIndex];
array_splice($cleanPoints, $endIndex, 1);
$orderedInput = array_merge([$start], $cleanPoints, [$endPoint]);

$coordText = implode(';', array_map(function($p) {
  return rawurlencode((string)$p['lng']) . ',' . rawurlencode((string)$p['lat']);
}, $orderedInput));

function call_mapbox_optimization($profile, $coordText, $token, $useCurb, $count) {
  $params = [
    'access_token' => $token,
    'source' => 'first',
    'destination' => 'last',
    'roundtrip' => 'false',
    'geometries' => 'geojson',
    'overview' => 'full',
    'steps' => 'true',
    'language' => 'ja',
    'annotations' => 'duration,distance'
  ];
  if ($useCurb) {
    $params['approaches'] = implode(';', array_merge(['unrestricted'], array_fill(0, $count - 1, 'curb')));
  }

  $url = 'https://api.mapbox.com/optimized-trips/v1/' . $profile . '/' . $coordText . '?' . http_build_query($params);
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
  ]);
  $body = curl_exec($ch);
  $curlErr = curl_error($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  return [
    'body' => $body,
    'curlErr' => $curlErr,
    'httpCode' => (int)$httpCode,
  ];
}

$profile = (string)($input['profile'] ?? 'mapbox/driving');
if (!in_array($profile, ['mapbox/driving', 'mapbox/driving-traffic'], true)) {
  $profile = 'mapbox/driving';
}

$attempt = call_mapbox_optimization($profile, $coordText, $token, true, count($orderedInput));
$data = is_string($attempt['body']) ? json_decode($attempt['body'], true) : null;

// 縁側到着指定で失敗した場合は、到着側指定なしで再試行する。
if ($attempt['body'] === false || $attempt['httpCode'] < 200 || $attempt['httpCode'] >= 300 || !is_array($data) || (($data['code'] ?? '') !== 'Ok')) {
  $fallback = call_mapbox_optimization($profile, $coordText, $token, false, count($orderedInput));
  $fallbackData = is_string($fallback['body']) ? json_decode($fallback['body'], true) : null;
  if ($fallback['body'] !== false && $fallback['httpCode'] >= 200 && $fallback['httpCode'] < 300 && is_array($fallbackData) && (($fallbackData['code'] ?? '') === 'Ok')) {
    $attempt = $fallback;
    $data = $fallbackData;
  }
}

if ($attempt['body'] === false) {
  http_response_code(502);
  echo json_encode(['error' => 'Mapbox Optimization APIへの接続に失敗しました', 'detail' => $attempt['curlErr']], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($attempt['httpCode'] < 200 || $attempt['httpCode'] >= 300 || !is_array($data)) {
  http_response_code(502);
  echo json_encode(['error' => 'Mapbox Optimization API応答エラー', 'detail' => substr((string)$attempt['body'], 0, 500)], JSON_UNESCAPED_UNICODE);
  exit;
}

if (($data['code'] ?? '') !== 'Ok') {
  http_response_code(502);
  echo json_encode([
    'error' => '車用ルートを計算できませんでした',
    'code' => $data['code'] ?? '',
    'detail' => $data['message'] ?? ''
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$waypoints = $data['waypoints'] ?? [];
$positions = [];
foreach ($waypoints as $inputIndex => $wp) {
  if (!isset($orderedInput[$inputIndex])) continue;
  $id = $orderedInput[$inputIndex]['id'];
  if ($id === '__start__') continue;
  $positions[] = [
    'id' => $id,
    'waypoint_index' => (int)($wp['waypoint_index'] ?? 9999),
    'name' => (string)($wp['name'] ?? ''),
    'location' => $wp['location'] ?? null,
  ];
}
usort($positions, function($a, $b) {
  return $a['waypoint_index'] <=> $b['waypoint_index'];
});

$trip = $data['trips'][0] ?? [];
echo json_encode([
  'ok' => true,
  'profile' => $profile,
  'orderedIds' => array_values(array_map(function($p) { return $p['id']; }, $positions)),
  'waypoints' => array_values($positions),
  'distance' => isset($trip['distance']) ? (float)$trip['distance'] : null,
  'duration' => isset($trip['duration']) ? (float)$trip['duration'] : null,
  'geometry' => $trip['geometry'] ?? null,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
