<?php
// テスト版専用: 走行中の向き・速度・GPS精度を使って出発直後の案内を安定させる。
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
require_once __DIR__ . '/request_guard.php';
require_once __DIR__ . '/route_restrictions_test_lib.php';
delivery_app_require_same_origin_request();

$token = '';
if (defined('MAPBOX_OPTIMIZATION_TOKEN') && MAPBOX_OPTIMIZATION_TOKEN) {
  $token = MAPBOX_OPTIMIZATION_TOKEN;
} elseif (defined('MAPBOX_ACCESS_TOKEN') && MAPBOX_ACCESS_TOKEN) {
  $token = MAPBOX_ACCESS_TOKEN;
}

if (!$token || $token === 'pk.eyJ...Mapbox公開トークン...') {
  http_response_code(500);
  echo json_encode(['error' => 'Mapboxルート検索トークンが未設定です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

function valid_segment_coord($value) {
  return is_numeric($value) && is_finite((float)$value);
}

function normalize_segment_point($value) {
  if (!is_array($value)
      || !valid_segment_coord($value['lat'] ?? null)
      || !valid_segment_coord($value['lng'] ?? null)) {
    return null;
  }
  $lat = (float)$value['lat'];
  $lng = (float)$value['lng'];
  if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) return null;
  return ['lat' => $lat, 'lng' => $lng];
}

function normalize_segment_heading($value) {
  if (!is_numeric($value)) return null;
  $heading = (float)$value;
  if (!is_finite($heading) || $heading < 0 || $heading > 360) return null;
  return fmod($heading + 360.0, 360.0);
}

function normalize_segment_blocked_points($value) {
  if (!is_array($value)) return [];
  $points = [];
  foreach ($value as $candidate) {
    $point = normalize_segment_point($candidate);
    if (!$point) continue;
    $key = number_format($point['lat'], 7, '.', '') . ',' . number_format($point['lng'], 7, '.', '');
    $points[$key] = $point;
    if (count($points) >= 50) break;
  }
  return array_values($points);
}

function segment_point_exclusions($points) {
  return implode(',', array_map(function($point) {
    return 'point(' . number_format((float)$point['lng'], 7, '.', '') . ' '
      . number_format((float)$point['lat'], 7, '.', '') . ')';
  }, $points));
}

function segment_has_point_exclusion_violation($value) {
  if (!is_array($value)) return false;
  if (($value['subtype'] ?? '') === 'pointExclusion') return true;
  foreach ($value as $child) {
    if (is_array($child) && segment_has_point_exclusion_violation($child)) return true;
  }
  return false;
}

$start = normalize_segment_point($input['start'] ?? null);
$destination = normalize_segment_point($input['destination'] ?? null);
if (!$start || !$destination) {
  http_response_code(400);
  echo json_encode(['error' => '始点または目的地の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$heading = normalize_segment_heading($input['heading'] ?? null);
$destinationHeading = normalize_segment_heading($input['destination_heading'] ?? null);
$blockedPoints = normalize_segment_blocked_points($input['blocked_points'] ?? null);
$manualRestrictions = rm_normalize_restrictions($input['manual_restrictions'] ?? null);

$speed = isset($input['speed']) && is_numeric($input['speed'])
  ? max(0.0, min(60.0, (float)$input['speed']))
  : null;
$accuracy = isset($input['accuracy']) && is_numeric($input['accuracy'])
  ? max(0.0, min(500.0, (float)$input['accuracy']))
  : null;
$avoidManeuverRadius = $speed !== null && $speed >= 1.5
  ? max(25, min(80, (int)round(20 + $speed * 6)))
  : null;
$originSnapRadius = $accuracy !== null && $accuracy > 0 && $accuracy <= 50
  ? max(18, min(60, (int)ceil($accuracy * 1.5)))
  : null;

function segment_request_origin() {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin !== '' && preg_match('/^https?:\/\//i', $origin)) return $origin . '/';

  $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($referer !== '' && preg_match('/^https?:\/\//i', $referer)) return $referer;

  $host = (string)($_SERVER['HTTP_HOST'] ?? '');
  if ($host === '') return '';
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
  return ($https ? 'https://' : 'http://') . $host . '/';
}

function call_segment_directions($profile, $start, $destination, $token, $heading, $destinationHeading, $blockedPoints, $useCurb, $useSafetySnap, $avoidManeuverRadius, $originSnapRadius, $alternatives) {
  $coords = rawurlencode((string)$start['lng']) . ',' . rawurlencode((string)$start['lat']) . ';'
    . rawurlencode((string)$destination['lng']) . ',' . rawurlencode((string)$destination['lat']);
  $params = [
    'access_token' => $token,
    'geometries' => 'geojson',
    'overview' => 'full',
    'steps' => 'false',
    'language' => 'ja',
    'continue_straight' => 'true',
    'notifications' => 'all'
  ];
  if ($alternatives) $params['alternatives'] = 'true';
  if ($profile === 'mapbox/driving-traffic') $params['depart_at'] = 'now';
  if ($useCurb) $params['approaches'] = 'unrestricted;curb';
  if ($heading !== null || $destinationHeading !== null) {
    $params['bearings'] = ($heading === null ? '' : round($heading, 1) . ',45') . ';'
      . ($destinationHeading === null ? '' : round($destinationHeading, 1) . ',45');
  }
  if (count($blockedPoints)) $params['exclude'] = segment_point_exclusions($blockedPoints);
  if ($useSafetySnap && $avoidManeuverRadius !== null) {
    $params['avoid_maneuver_radius'] = (string)$avoidManeuverRadius;
  }
  if ($useSafetySnap && $originSnapRadius !== null) {
    $params['radiuses'] = $originSnapRadius . ';unlimited';
  }

  $url = 'https://api.mapbox.com/directions/v5/' . $profile . '/' . $coords . '?' . http_build_query($params);
  $ch = curl_init($url);
  $headers = ['Accept: application/json'];
  $referer = segment_request_origin();
  if ($referer !== '') {
    $headers[] = 'Referer: ' . $referer;
    $parts = parse_url($referer);
    if (is_array($parts) && isset($parts['scheme'], $parts['host'])) {
      $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
      $headers[] = 'Origin: ' . $origin;
    }
  }

  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => $headers,
  ]);
  $body = curl_exec($ch);
  $curlErr = curl_error($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  $data = is_string($body) ? json_decode($body, true) : null;
  $routes = is_array($data) && is_array($data['routes'] ?? null) ? $data['routes'] : [];
  $route = $routes[0] ?? null;
  $valid = $body !== false
    && $httpCode >= 200 && $httpCode < 300
    && is_array($data) && (($data['code'] ?? '') === 'Ok')
    && count(array_filter($routes, 'rm_valid_route')) > 0;

  return [
    'ok' => $valid,
    'body' => $body,
    'curlErr' => $curlErr,
    'httpCode' => $httpCode,
    'data' => $data,
    'route' => $route,
    'routes' => $routes,
  ];
}

function output_segment_route($attempt, $settings, $selection, $blockedPoints, $manualRestrictions, $avoidManeuverRadius, $originSnapRadius, $fallbackApplied) {
  $route = $selection['route'];
  echo json_encode([
    'ok' => true,
    'profile' => $settings['profile'],
    'headingApplied' => $settings['heading'] !== null,
    'destinationHeadingApplied' => $settings['destinationHeading'] !== null,
    'curbApproachApplied' => $settings['curb'],
    'departureTimeApplied' => $settings['profile'] === 'mapbox/driving-traffic',
    'avoidManeuverRadius' => $settings['safety'] ? $avoidManeuverRadius : null,
    'originSnapRadius' => $settings['safety'] ? $originSnapRadius : null,
    'roadMemoryApplied' => count($blockedPoints),
    'roadMemoryUnavoidable' => false,
    'manualRestrictionsApplied' => count($manualRestrictions),
    'manualRestrictionCandidatesChecked' => (int)($selection['checked'] ?? 0),
    'manualRestrictionFallbackApplied' => (bool)$fallbackApplied,
    'manualRestrictionUnavoidable' => false,
    'distance' => isset($route['distance']) ? (float)$route['distance'] : null,
    'duration' => isset($route['duration']) ? (float)$route['duration'] : null,
    'geometry' => $route['geometry'],
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$attempts = [
  ['profile' => 'mapbox/driving-traffic', 'heading' => $heading, 'destinationHeading' => $destinationHeading, 'curb' => false, 'safety' => true],
  ['profile' => 'mapbox/driving-traffic', 'heading' => $heading, 'destinationHeading' => $destinationHeading, 'curb' => false, 'safety' => false],
  ['profile' => 'mapbox/driving-traffic', 'heading' => null, 'destinationHeading' => $destinationHeading, 'curb' => false, 'safety' => false],
  ['profile' => 'mapbox/driving-traffic', 'heading' => null, 'destinationHeading' => null, 'curb' => false, 'safety' => false],
  ['profile' => 'mapbox/driving-traffic', 'heading' => null, 'destinationHeading' => null, 'curb' => true, 'safety' => false],
  ['profile' => 'mapbox/driving', 'heading' => null, 'destinationHeading' => $destinationHeading, 'curb' => false, 'safety' => false],
  ['profile' => 'mapbox/driving', 'heading' => null, 'destinationHeading' => null, 'curb' => false, 'safety' => false],
  ['profile' => 'mapbox/driving', 'heading' => null, 'destinationHeading' => null, 'curb' => true, 'safety' => false],
];

$lastAttempt = null;
$attemptedSettings = [];
$restrictedAttempt = null;
$restrictedSettings = null;
foreach ($attempts as $settings) {
  if ($settings['safety'] && $avoidManeuverRadius === null && $originSnapRadius === null) continue;
  $settingsKey = $settings['profile'] . '|' . ($settings['heading'] === null ? '' : (string)$settings['heading']) . '|'
    . ($settings['destinationHeading'] === null ? '' : (string)$settings['destinationHeading']) . '|'
    . ($settings['curb'] ? '1' : '0') . '|' . ($settings['safety'] ? '1' : '0');
  if (isset($attemptedSettings[$settingsKey])) continue;
  $attemptedSettings[$settingsKey] = true;
  $attempt = call_segment_directions(
    $settings['profile'],
    $start,
    $destination,
    $token,
    $settings['heading'],
    $settings['destinationHeading'],
    $blockedPoints,
    $settings['curb'],
    $settings['safety'],
    $avoidManeuverRadius,
    $originSnapRadius,
    count($manualRestrictions) > 0
  );
  $lastAttempt = $attempt;
  if (!$attempt['ok']) continue;

  $selection = rm_select_safe_route($attempt['routes'], $manualRestrictions);
  if ($selection['route'] !== null) {
    output_segment_route(
      $attempt,
      $settings,
      $selection,
      $blockedPoints,
      $manualRestrictions,
      $avoidManeuverRadius,
      $originSnapRadius,
      false
    );
  }

  $restrictedAttempt = $attempt;
  $restrictedSettings = $settings;
  break;
}

if ($restrictedAttempt && count($manualRestrictions) > 0) {
  $fallbackPoints = rm_merge_blocked_points(
    $blockedPoints,
    rm_fallback_blocked_points($manualRestrictions),
    50
  );
  $fallbackAttempt = call_segment_directions(
    $restrictedSettings['profile'],
    $start,
    $destination,
    $token,
    $restrictedSettings['heading'],
    $restrictedSettings['destinationHeading'],
    $fallbackPoints,
    $restrictedSettings['curb'],
    $restrictedSettings['safety'],
    $avoidManeuverRadius,
    $originSnapRadius,
    true
  );
  $lastAttempt = $fallbackAttempt;
  if ($fallbackAttempt['ok']) {
    $fallbackSelection = rm_select_safe_route($fallbackAttempt['routes'], $manualRestrictions);
    if ($fallbackSelection['route'] !== null) {
      output_segment_route(
        $fallbackAttempt,
        $restrictedSettings,
        $fallbackSelection,
        $fallbackPoints,
        $manualRestrictions,
        $avoidManeuverRadius,
        $originSnapRadius,
        true
      );
    }
  }
}

if ($restrictedAttempt) {
  http_response_code(409);
  echo json_encode([
    'error' => '登録した通行規制を避けられる安全な経路がありません',
    'roadMemoryApplied' => count($blockedPoints),
    'roadMemoryUnavoidable' => count($blockedPoints) > 0,
    'manualRestrictionsApplied' => count($manualRestrictions),
    'manualRestrictionFallbackApplied' => count($manualRestrictions) > 0,
    'manualRestrictionUnavoidable' => count($manualRestrictions) > 0,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$detail = '';
if (is_array($lastAttempt)) {
  if ($lastAttempt['body'] === false) $detail = (string)$lastAttempt['curlErr'];
  elseif (is_array($lastAttempt['data'])) $detail = (string)($lastAttempt['data']['message'] ?? '');
}
http_response_code(502);
echo json_encode([
  'error' => '道路に沿った案内線を取得できませんでした',
  'detail' => substr($detail, 0, 300),
], JSON_UNESCAPED_UNICODE);
