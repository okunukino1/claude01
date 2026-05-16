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

$key = '';
if (defined('GOOGLE_ROUTES_API_KEY') && GOOGLE_ROUTES_API_KEY) {
  $key = GOOGLE_ROUTES_API_KEY;
} elseif (defined('GOOGLE_MAPS_SERVER_KEY') && GOOGLE_MAPS_SERVER_KEY) {
  $key = GOOGLE_MAPS_SERVER_KEY;
}

if (!$key || $key === 'AIza...Google Geocoding API用キー...') {
  http_response_code(500);
  echo json_encode(['error' => 'Google Routes APIキーが未設定です', 'hint' => 'api/config.php の GOOGLE_ROUTES_API_KEY または GOOGLE_MAPS_SERVER_KEY を確認してください。'], JSON_UNESCAPED_UNICODE);
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

function waypoint($p) {
  return [
    'location' => [
      'latLng' => [
        'latitude' => (float)$p['lat'],
        'longitude' => (float)$p['lng'],
      ],
    ],
  ];
}

function duration_seconds($value) {
  if (!is_string($value) || !preg_match('/^([0-9]+(?:\.[0-9]+)?)s$/', $value, $m)) return null;
  return (float)$m[1];
}

function google_routes_error_response($response, $httpCode) {
  $data = json_decode((string)$response, true);
  $googleError = is_array($data) ? ($data['error'] ?? null) : null;
  $message = is_array($googleError) ? (string)($googleError['message'] ?? '') : '';
  $status = is_array($googleError) ? (string)($googleError['status'] ?? '') : '';
  $reason = '';
  $service = '';
  $project = '';

  if (is_array($googleError) && isset($googleError['details']) && is_array($googleError['details'])) {
    foreach ($googleError['details'] as $detail) {
      if (!is_array($detail)) continue;
      if (($detail['@type'] ?? '') !== 'type.googleapis.com/google.rpc.ErrorInfo') continue;
      $reason = (string)($detail['reason'] ?? '');
      $metadata = is_array($detail['metadata'] ?? null) ? $detail['metadata'] : [];
      $service = (string)($metadata['service'] ?? '');
      $consumer = (string)($metadata['consumer'] ?? '');
      if (preg_match('/projects\/([0-9]+)/', $consumer, $m)) $project = $m[1];
      if (!$project && isset($metadata['containerInfo'])) $project = (string)$metadata['containerInfo'];
    }
  }

  if (
    $httpCode === 403 &&
    ($reason === 'SERVICE_DISABLED' || $service === 'routes.googleapis.com' || stripos($message, 'disabled') !== false)
  ) {
    return [
      'error' => 'Google Routes APIが無効です',
      'hint' => ($project ? 'Google Cloudのプロジェクト ' . $project . ' で ' : 'Google Cloudで ') .
        'Routes APIを有効化し、数分待ってから再試行してください。',
      'status' => $status ?: 'PERMISSION_DENIED',
      'reason' => $reason ?: 'SERVICE_DISABLED',
      'service' => $service ?: 'routes.googleapis.com',
    ];
  }

  if ($httpCode === 403 && stripos($message, 'API key') !== false) {
    return [
      'error' => 'Google Routes APIキーが拒否されました',
      'hint' => 'api/config.php の GOOGLE_ROUTES_API_KEY と、Google Cloud側のAPIキー制限を確認してください。',
      'status' => $status ?: 'PERMISSION_DENIED',
    ];
  }

  return [
    'error' => 'Google Routes API応答エラー',
    'detail' => $message !== '' ? $message : substr((string)$response, 0, 300),
    'status' => $status,
  ];
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
  echo json_encode(['error' => 'Google車用ルートには配送先が2件以上必要です'], JSON_UNESCAPED_UNICODE);
  exit;
}

// 現場運用ではMapbox版と同じ上限に揃える。Google Routes API自体は中間地点25件まで。
if (count($cleanPoints) > 24) {
  http_response_code(400);
  echo json_encode(['error' => 'Google車用ルートは一度に24件まで対応しています'], JSON_UNESCAPED_UNICODE);
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

$destination = $cleanPoints[$endIndex];
array_splice($cleanPoints, $endIndex, 1);
$intermediates = $cleanPoints;

$payload = [
  'origin' => waypoint($start),
  'destination' => waypoint($destination),
  'intermediates' => array_map('waypoint', $intermediates),
  'travelMode' => 'DRIVE',
  'routingPreference' => 'TRAFFIC_AWARE',
  'optimizeWaypointOrder' => true,
  'polylineQuality' => 'OVERVIEW',
  'polylineEncoding' => 'GEO_JSON_LINESTRING',
  'languageCode' => 'ja',
  'units' => 'METRIC',
];

$ch = curl_init('https://routes.googleapis.com/directions/v2:computeRoutes');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 30,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json; charset=utf-8',
    'X-Goog-Api-Key: ' . $key,
    'X-Goog-FieldMask: routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring',
  ],
  CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
]);
$response = curl_exec($ch);
$curlErr = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
  http_response_code(502);
  echo json_encode(['error' => 'Google Routes APIへの接続に失敗しました', 'detail' => $curlErr], JSON_UNESCAPED_UNICODE);
  exit;
}

$data = json_decode($response, true);
if ($httpCode < 200 || $httpCode >= 300 || !is_array($data)) {
  http_response_code(502);
  echo json_encode(google_routes_error_response($response, $httpCode), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$route = $data['routes'][0] ?? null;
if (!is_array($route)) {
  http_response_code(502);
  echo json_encode(['error' => 'Google Routes APIでルートが見つかりませんでした', 'detail' => substr((string)$response, 0, 700)], JSON_UNESCAPED_UNICODE);
  exit;
}

$order = $route['optimizedIntermediateWaypointIndex'] ?? [];
if (!is_array($order)) $order = [];

$orderedPoints = [];
foreach ($order as $idx) {
  if (isset($intermediates[(int)$idx])) $orderedPoints[] = $intermediates[(int)$idx];
}

if (count($orderedPoints) !== count($intermediates)) {
  $used = array_fill(0, count($intermediates), false);
  foreach ($order as $idx) {
    if (isset($used[(int)$idx])) $used[(int)$idx] = true;
  }
  foreach ($intermediates as $idx => $p) {
    if (!$used[$idx]) $orderedPoints[] = $p;
  }
}
$orderedPoints[] = $destination;

$geometry = $route['polyline']['geoJsonLinestring'] ?? null;
if (is_array($geometry) && isset($geometry['coordinates']) && !isset($geometry['type'])) {
  $geometry['type'] = 'LineString';
}

echo json_encode([
  'ok' => true,
  'profile' => 'google/routes-drive',
  'method' => 'google-routes',
  'orderedIds' => array_values(array_map(function($p) { return $p['id']; }, $orderedPoints)),
  'waypoints' => array_values(array_map(function($p, $idx) {
    return ['id' => $p['id'], 'waypoint_index' => $idx + 1, 'name' => '', 'location' => [$p['lng'], $p['lat']]];
  }, $orderedPoints, array_keys($orderedPoints))),
  'distance' => isset($route['distanceMeters']) ? (float)$route['distanceMeters'] : null,
  'duration' => duration_seconds($route['duration'] ?? ''),
  'geometry' => $geometry,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
